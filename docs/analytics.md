# Analytics produit — PostHog (région UE)

Alternly mesure l'audience du site et l'usage de l'app avec **PostHog Cloud EU**
(`eu.posthog.com`, ingestion `eu.i.posthog.com`, hébergement Francfort). Tout est
**désactivé (no-op)** tant que les clés ne sont pas renseignées (dev, tests).

## Architecture

| Couche | Fichiers | Rôle |
| --- | --- | --- |
| SPA (React) | `frontend/src/analytics.ts`, `analyticsEvents.ts`, `components/ConsentBanner.tsx`, `components/AnalyticsBridge.tsx` | Consentement, init `posthog-js` (chargé à la demande), pages vues, identité, événements produit |
| Site marketing (SSR) | `backend/app/static/analytics.js`, `templates/base*.html` | Même bannière, `posthog-js` via `/ingest/static/array.js`, événements marketing |
| API (FastAPI) | `backend/app/services/analytics.py` | Événements serveur faisant autorité, exceptions non gérées, logs (optionnel) |
| Proxy | `frontend/vercel.json` | `/ingest/static/*` → `eu-assets.i.posthog.com`, `/ingest/*` → `eu.i.posthog.com` (contourne les bloqueurs, même origine → CSP inchangée hors `worker-src blob:`) |
| Dashboards as code | `scripts/posthog_setup.py` | Actions, cohortes, 5 tableaux de bord (idempotent) |

## Consentement (RGPD / ePrivacy, recommandations CNIL)

* **Avant réponse ou après refus** : mesure **anonyme sans cookie** (`cookieless_mode: 'on_reject'`
  + `opt_out_capturing_by_default: true`). Aucun cookie, aucun stockage, aucun identifiant
  persistant, pas de profil, pas de replay. PostHog calcule côté serveur un hash quotidien
  non persistant (visiteurs uniques/jour).
* **Après acceptation** : persistance `localStorage+cookie`, `identify(user.id)` (jamais
  e-mail ni nom), groupe `household`, replay de session avec **toutes les saisies masquées**.
* **Choix** stocké en `localStorage['alternly_consent'] = {"value": "granted"|"denied", "at": <ms>}`,
  partagé entre site et app (même origine), **redemandé après 13 mois**. La bannière a deux
  boutons de poids identique (Refuser / Accepter).
* **Changer d'avis** : lien « Gérer les cookies » / « Cookie settings » en pied de page du site ;
  dans l'app, Réglages → Compte → « Cookies et mesure d'audience ». La révocation fait
  `reset()` + retour au mode anonyme.
* **Côté serveur** : `users.analytics_consent` (null/true/false) est mis à jour par la SPA
  (`PATCH /api/auth/me`, et à l'inscription). Si ≠ `true`, les événements serveur partent avec
  un identifiant aléatoire par événement et `$process_person_profile: false`, sans groupe.
* **Nettoyage** : `before_send` retire les jetons d'invitation (`/join/<jeton>`) et de
  réinitialisation (`?token=`) de toutes les propriétés ; le serveur filtre `/api/ical/<jeton>`.
* **Masquage replay/autocapture** : classes `ph-mask` (texte masqué dans le replay) +
  `ph-sensitive` (aucun texte en autocapture) sur les pages Dépenses, Mur, Historique, le
  calendrier, les notifications, les demandes de changement, les modales, les prénoms
  (enfants/parents) et l'e-mail ; `ph-no-capture` (bloqué) sur les QR codes secrets
  (invitation, iCal) et le nom du foyer.

## Variables d'environnement

| Où | Variable | Valeur |
| --- | --- | --- |
| Railway | `POSTHOG_TOKEN` | Clé de projet `phc_…` (publique par conception) — déjà présente |
| Railway | `POSTHOG_HOST` | défaut `https://eu.i.posthog.com` |
| Railway | `POSTHOG_SERVER_LOGS` | `true` pour envoyer les logs WARNING+ en événements `server_log` (défaut `false`, 30/min max) |
| Vercel | `VITE_POSTHOG_KEY` | même valeur que `POSTHOG_TOKEN` (puis redéployer) |
| Vercel | `VITE_POSTHOG_HOST` | optionnel, défaut `/ingest` (proxy) |

Sans `VITE_POSTHOG_KEY`, `posthog-js` n'est même pas inclus dans le build ; sans
`POSTHOG_TOKEN`, ni bannière ni script sur le site marketing et aucun envoi serveur.

## Réglages du projet PostHog (à faire dans l'UI)

1. **Région UE** (projet créé sur eu.posthog.com).
2. **Cookieless tracking : activer** (Project settings → Web analytics → *Cookieless server
   hash mode*). **Indispensable** : sans cela, tous les événements envoyés avant consentement
   ou après refus sont ignorés.
3. **Discard client IP data : activer** (Project settings → *IP data capture*). Vérifier que
   la géolocalisation pays reste renseignée (elle est calculée à l'ingestion).
4. **Session replay** : activer ; *Mask all inputs* = oui ; conserver le masquage par défaut des
   éléments `.ph-no-capture` ; ne pas activer la capture des requêtes réseau ni de la console
   (risque de données personnelles) ; rétention ≤ 30 jours.
5. **Autocapture** : activée ; *Exception autocapture* (Error tracking) activée ;
   *Web vitals* au choix.
6. **Rétention des données** : ≤ 13 mois pour les événements (cohérent avec la politique de
   confidentialité).
7. **Groupes** : le type `household` est créé au premier `group()` ; renommer son libellé en
   « Foyer » (Settings → Groups).
8. **Filtrer les comptes de test** : ajouter vos comptes internes (ou `$host` = localhost)
   dans *Filter out internal and test users* — les insights du script utilisent ce filtre.
9. **Ne pas activer** : surveys, feature flags (désactivés côté client), toolbar sur le domaine
   de production sans besoin.

## Tableaux de bord (script)

```bash
export POSTHOG_PERSONAL_API_KEY=phx_…   # Settings → Personal API keys (scopes : insight,
                                        # dashboard, action, cohort en écriture ; project en lecture)
export POSTHOG_PROJECT_ID=12345          # visible dans l'URL /project/<id>/
python scripts/posthog_setup.py --dry-run   # affiche les payloads
python scripts/posthog_setup.py             # crée ou met à jour (idempotent, par nom)
```

Crée : actions « Action clé (utilisateur actif) » et « Visite de la landing » ; cohortes
« Foyers activés », « Premium », « Inscrits Google », « US users » ; tableaux de bord
**Acquisition**, **Activation**, **Engagement & rétention**, **Monétisation**, **Santé technique**.
Relancer après avoir reçu les premiers événements `household` pour que les funnels par foyer
utilisent le bon index de groupe.

Limites connues : les funnels multi-étapes et la rétention ne relient que les visiteurs
ayant **accepté** (ou, avant consentement, les événements d'une même journée, même
navigateur, grâce au hash cookieless). Les compteurs simples (trends) incluent tout le monde.

## Dictionnaire des événements

Propriétés : uniquement énumérations, booléens et nombres — **jamais de texte libre** (libellés,
notes, messages, prénoms, e-mails). C = client (SPA), M = site marketing, S = serveur.

### Acquisition (site marketing)
| Événement | Source | Quand | Propriétés |
| --- | --- | --- | --- |
| `$pageview` / `$pageleave` | M, C | chaque page (SPA : à chaque changement de route) | auto (+ `site_lang` sur M) |
| `landing_cta_clicked` | M | clic vers `/register` | `location` (nav, hero, tarifs, footer…), `lang` |
| `pricing_viewed` | M | section tarifs visible (40 %) | `lang` |
| `blog_article_viewed` | M | ouverture d'un article | `slug`, `lang` |
| `blog_cta_clicked` | M | CTA d'inscription d'un article | `slug`, `location`, `lang` |
| `faq_opened` | M | ouverture d'une question | `question_index`, `lang` |
| `language_switched` | M | lien FR/EN | `from`, `to` |

UTM, `gclid` et `fbclid` de l'URL d'arrivée sont ajoutés aux liens `/register` et `/login`,
puis joints à `signup_started` / `signed_up` (et gardés en `sessionStorage` seulement après
consentement). PostHog renseigne aussi `$initial_utm_*` sur la personne après consentement.

### Compte & activation
| Événement | Source | Quand | Propriétés |
| --- | --- | --- | --- |
| `signup_started` | C | envoi du formulaire d'inscription / bouton Google (page inscription) | `method`, `utm_*` |
| `signed_up` | C | compte créé | `method` (email, google), `via_invite`, `utm_*` |
| `user_signed_up` | S | compte créé (fait autorité) | `method`, `via_invite`, `locale` |
| `login` | C | connexion réussie | `method` |
| `household_created` | S | foyer créé | `country` |
| `onboarding_step_completed` | C | étape d'onboarding | `step` (household, children, rules, invite), `skipped`, `country`, `zone`, `children_count`, `pattern` |
| `onboarding_completed` | C | règles de garde enregistrées | `country`, `children_count`, `pattern` |
| `child_added` | C | enfant ajouté | `has_birthdate` |
| `invite_created` | C | lien d'invitation généré | — |
| `invite_shared` | C | partage de l'invitation | `channel` (native, whatsapp, sms, email, copy, qr, alternly_email), `source` (settings, onboarding, calendar) |
| `invite_message_edited` | C | message pré-rédigé modifié (1 fois par écran) | `source` |
| `invite_email_sent` | S | invitation envoyée par Alternly (Resend a accepté) | `reminder` |
| `invite_reminder_sent` | S | relance cron (inviteur à J+2/J+5, invité à J+3) | `day`, `target` (inviter, invitee), `email` |
| `invite_nudge_sent` | S | relance unique « invitez l'autre parent » 24 h après l'onboarding | — |
| `invite_opened` | C | page `/join` (souvent anonyme) | `valid` |
| `invite_preview_viewed` | S | aperçu public du planning (`/join`, anonyme) | `country` |
| `invite_accepted` | C | invitation acceptée | — |
| `partner_joined` | S | 2e parent a rejoint | `country`, `days_since_household_created` |
| `password_reset_requested` | C | « mot de passe oublié » | — |
| `password_reset_completed` | S | réinitialisation effectuée | — |
| `password_changed` | C | changement / définition | `first_password` |
| `data_exported` | C | export RGPD | — |
| `account_deleted` | S | suppression de compte | `had_subscription` |
| `language_changed` | C | langue changée dans les réglages | `from`, `to`, `source` |

### Calendrier & coparentalité
| Événement | Source | Quand | Propriétés |
| --- | --- | --- | --- |
| `exchange_proposed` / `exchange_countered` | C | échange proposé / contre-proposé | `days`, `lead_days`, `has_note` |
| `exchange_submitted` | S | échange enregistré (fait autorité) | `solo`, `is_counter`, `days`, `lead_days` |
| `exchange_accepted` / `exchange_refused` / `exchange_withdrawn` / `exchange_deleted` | C | réponse à un échange | — |
| `exchange_resolved` | S | échange accepté / refusé / retiré | `status`, `is_counter`, `hours_to_resolve` |
| `change_request_created` | C | modification sensible soumise à accord (202) | `kind` |
| `change_request_accepted` / `_refused` / `_withdrawn` | C | réponse | `kind` |
| `change_request_resolved` | S | idem (fait autorité) | `kind`, `status` (dont `outdated`) |
| `calendar_navigated` | C | changement de mois/semaine (max 1 / 10 s) | `direction`, `view` |
| `history_viewed` | C | page Historique | — |
| `notification_opened` | C | clic sur une notification | `type`, `unread` |

### Dépenses, mur, synchro
| Événement | Source | Quand | Propriétés |
| --- | --- | --- | --- |
| `expense_added` | C | dépense créée | `category`, `amount`, `payer_percent`, `split` (equal, custom), `has_child` |
| `expense_disputed` / `expense_settled` | C | contestation / marquée remboursée | — |
| `settlement_recorded` | C | remboursement enregistré | `amount` |
| `wall_post_created` | C | publication | `kind` (message, task, question), `has_due_date`, `assigned`, `has_child` |
| `wall_reply_created` / `task_completed` | C | réponse / tâche cochée | — |
| `ical_link_generated` / `ical_link_copied` | C | lien iCal régénéré / copié | — |
| `ical_feed_polled` | S | appel du flux iCal par un agenda (échantillon 1/20, anonyme) | `country`, `sample_rate` |

### Monétisation
| Événement | Source | Quand | Propriétés |
| --- | --- | --- | --- |
| `paywall_viewed` | C | paywall affiché | `feature` (expenses, wall, onboarding) |
| `checkout_opened` | C | ouverture du checkout Paddle | `plan`, `source` |
| `checkout_completed` | C | callback Paddle `checkout.completed` | `plan` |
| `plan_changed` | C | bascule annuel/mensuel | `plan` |
| `subscription_cancel_requested` | C | clic « résilier » | — |
| `subscription_activated` / `_renewed` / `_past_due` / `_canceled` | S | webhook Paddle (transition de statut ; renouvellement = `transaction.completed` récurrente) | `plan`, `currency`, `amount` |

### Technique
| Événement | Source | Propriétés |
| --- | --- | --- |
| `$exception` | C, M, S | auto (front) ; serveur : `path` (nettoyé), `method` — sans corps ni en-têtes |
| `server_log` | S | `level`, `logger`, `message` (tronqué, e-mails masqués), `path`, `exception_type` |

### Personne et groupe (après consentement uniquement)
* Personne : `locale`, `auth_method`, `created_at`, `country`, `has_household`,
  `subscription_status`, `is_premium`.
* Groupe `household` : `country`, `zone` (FR), `members_count`, `children_count`, `premium`.
