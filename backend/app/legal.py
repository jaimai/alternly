"""Contenu des pages légales (SSR). Rédigé comme point de départ sérieux ;
à faire relire par un professionnel du droit avant de s'y fier."""

UPDATED = "26 septembre 2026"

CONTACT = "honoentreprise@gmail.com"

# Éditeur / responsable de traitement.
EDITOR = (
    "Hōnō, SASU au capital de 1 000 €, immatriculée au RCS de Lille sous le "
    "numéro 939 911 897, dont le siège social est situé 229 rue de Solférino, "
    "59000 Lille, France. Directeur de la publication : Thomas Ferrer, Président"
)
EDITOR_SHORT = "Hōnō, SASU — 229 rue de Solférino, 59000 Lille, France"

# Sous-traitants / prestataires effectivement utilisés.
_SUBPROCESSORS = """
<ul>
  <li><strong>Railway</strong> — hébergement de l'API.</li>
  <li><strong>Vercel</strong> — hébergement de l'application web et mesure d'audience respectueuse de la vie privée (sans cookies).</li>
  <li><strong>alwaysdata</strong> — base de données (Union européenne).</li>
  <li><strong>Resend</strong> — envoi des e-mails transactionnels (notifications).</li>
  <li><strong>Paddle</strong> — traitement des paiements et facturation (revendeur / Merchant of Record).</li>
  <li><strong>Google</strong> — connexion « Continuer avec Google », si vous la choisissez (nom, adresse e-mail et identifiant de compte Google).</li>
  <li><strong>PostHog Inc.</strong> — mesure d'audience et analyse d'usage du produit ; avec votre
  consentement, enregistrement de sessions (saisies masquées). Données hébergées dans l'Union
  européenne (Francfort, Allemagne).</li>
</ul>
"""

TERMS = f"""
<p>Les présentes conditions générales régissent l'utilisation d'Alternly (« le Service »),
édité par {EDITOR}. En créant un compte, vous les acceptez.</p>

<h2>1. Le Service</h2>
<p>Alternly est un calendrier de garde alternée et un ensemble d'outils de coordination pour
parents séparés : génération du calendrier de garde, vacances scolaires, échanges de jours,
dépenses partagées et mur de communication. Alternly organise le quotidien ; <strong>il ne
remplace ni une décision de justice ni un conseil juridique</strong> et n'a pas de valeur
probante en justice.</p>

<h2>2. Compte</h2>
<p>Vous êtes responsable de l'exactitude des informations fournies et de la confidentialité de
vos identifiants. Le Service est réservé aux personnes majeures. Vous vous engagez à un usage
loyal et à ne pas porter atteinte aux droits de l'autre parent ou de tiers.</p>

<h2>3. Gratuit et abonnement premium</h2>
<p>Le calendrier de garde d'Alternly est gratuit. Les fonctionnalités premium (dépenses
partagées, mur de communication, notifications e-mail et synchronisation) nécessitent un
abonnement : 69&nbsp;€ TTC par an et par foyer, ou 8,99&nbsp;€ TTC par mois. L'abonnement est
souscrit par un parent et bénéficie à l'ensemble du foyer. Les
paiements et la facturation sont assurés par notre partenaire <strong>Paddle</strong>, qui
agit en qualité de revendeur (Merchant of Record) et dont les conditions s'appliquent à la
transaction. L'abonnement est sans engagement et résiliable à tout moment ; voir la
<a href="/refund">politique de remboursement</a>.</p>

<h2>4. Disponibilité</h2>
<p>Nous nous efforçons d'assurer la continuité du Service sans pouvoir la garantir. Le Service
est fourni « en l'état ». Nous pouvons le faire évoluer, le suspendre pour maintenance ou en
modifier les fonctionnalités.</p>

<h2>5. Responsabilité</h2>
<p>Dans les limites permises par la loi, notre responsabilité ne saurait être engagée pour les
dommages indirects, ni pour les conséquences de décisions prises sur la base des informations
affichées (dates, soldes, échanges). Vous restez seul responsable de l'organisation de la garde
de vos enfants.</p>

<h2>6. Résiliation</h2>
<p>Vous pouvez fermer votre compte à tout moment. Nous pouvons suspendre un compte en cas de
manquement aux présentes conditions.</p>

<h2>7. Droit applicable</h2>
<p>Les présentes conditions sont soumises au droit français. En cas de litige, une solution
amiable sera recherchée avant toute action judiciaire.</p>

<h2>8. Contact</h2>
<p>Pour toute question : <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

PRIVACY = f"""
<p>Cette politique décrit comment Alternly traite vos données personnelles, dans le respect du
Règlement général sur la protection des données (RGPD).</p>

<h2>1. Responsable de traitement</h2>
<p>{EDITOR_SHORT}. Contact :
<a href="mailto:{CONTACT}">{CONTACT}</a>.</p>

<h2>2. Données collectées</h2>
<p>Nous appliquons une stricte minimisation :</p>
<ul>
  <li><strong>Compte</strong> : adresse e-mail, mot de passe (chiffré), prénom d'affichage.</li>
  <li><strong>Foyer &amp; garde</strong> : nom du foyer, prénom des enfants (l'anniversaire est
  facultatif), zone scolaire, règles de garde, échanges, dépenses et messages que vous saisissez.</li>
  <li><strong>Techniques</strong> : données de connexion et mesure d'audience agrégée
  (Vercel Analytics et PostHog, sans cookies ni profilage individuel).</li>
  <li><strong>Analyse d'usage (avec votre accord)</strong> : pages consultées, actions effectuées
  dans l'app (ex. « échange proposé », « dépense ajoutée » — jamais leur contenu), type
  d'appareil et de navigateur, pays déduit de l'adresse IP (qui n'est pas conservée),
  enregistrement de sessions avec saisies et contenus personnels masqués. Ces données sont
  rattachées à un identifiant technique, jamais à votre e-mail ou à votre nom.</li>
</ul>
<p>Aucune donnée sensible (santé, opinions…) n'est requise ; nous vous invitons à ne pas en
saisir dans les champs libres.</p>

<h2>3. Finalités et base légale</h2>
<p>Les données servent à fournir le Service (exécution du contrat), à vous notifier des
changements, et à assurer la sécurité. Les e-mails de notification reposent sur l'exécution du
contrat et peuvent être désactivés dans vos réglages. La mesure d'audience anonyme, sans cookie
ni identifiant persistant, repose sur notre intérêt légitime à améliorer le Service ; l'analyse
d'usage détaillée et l'enregistrement de sessions reposent sur votre consentement, retirable à
tout moment.</p>

<h2>4. Hébergement</h2>
<p>Les données sont hébergées dans l'Union européenne.</p>

<h2>5. Sous-traitants</h2>
{_SUBPROCESSORS}

<h2>6. Durée de conservation</h2>
<p>Vos données sont conservées tant que votre compte est actif, puis supprimées ou anonymisées
dans un délai raisonnable après sa fermeture, sous réserve des obligations légales (ex. facturation).
Les données de mesure d'audience sont conservées au plus 13 mois, les enregistrements de session
au plus 30 jours.</p>

<h2>6 bis. Cookies et traceurs</h2>
<p>Sans votre accord, aucun cookie de mesure n'est déposé : la fréquentation est mesurée de
façon anonyme, sans cookie ni stockage sur votre appareil. Lors de votre première visite, une
bannière vous propose d'accepter ou de refuser, aussi simplement l'un que l'autre, des cookies
et un stockage local de mesure d'audience (PostHog) qui nous aident à comprendre les parcours
et à améliorer Alternly. Si vous acceptez, un identifiant technique est conservé sur votre
appareil et vos sessions peuvent être enregistrées, avec toutes les saisies et contenus
personnels masqués. Votre choix est mémorisé 13 mois au plus, puis vous est redemandé.</p>
<p>Vous pouvez changer d'avis à tout moment via le lien « Gérer les cookies » en bas de chaque
page du site, ou dans l'app (Réglages → Compte → Cookies et mesure d'audience). Les éléments
strictement nécessaires (session de connexion, langue, mémorisation de votre choix) ne
nécessitent pas de consentement.</p>

<h2>7. Vos droits</h2>
<p>Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition
et de portabilité. Écrivez-nous à <a href="mailto:{CONTACT}">{CONTACT}</a>. Vous pouvez également
introduire une réclamation auprès de la CNIL.</p>

<h2>8. Sécurité</h2>
<p>Les mots de passe sont hachés (bcrypt), les accès sont authentifiés et cloisonnés par foyer,
et les échanges chiffrés en transit (HTTPS).</p>

<h2>9. Contact</h2>
<p><a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

REFUND = f"""
<p>Cette politique décrit les conditions de remboursement de l'abonnement Alternly.</p>

<h2>1. Version gratuite</h2>
<p>Le calendrier de garde est gratuit : aucun paiement n'est requis pour l'utiliser. Seul
l'abonnement premium (mensuel ou annuel) est payant.</p>

<h2>2. Droit de rétractation</h2>
<p>Conformément au droit de la consommation de l'Union européenne, vous disposez d'un délai de
rétractation de 14 jours à compter de la souscription de l'abonnement pour demander un
remboursement intégral, sauf renonciation expresse à ce droit.</p>

<h2>3. Abonnement</h2>
<p>L'abonnement (mensuel ou annuel) est sans engagement de reconduction forcée : vous pouvez le
résilier à tout moment, ce qui interrompt le renouvellement. Au-delà du délai de rétractation, les périodes
déjà entamées ne sont pas remboursées au prorata, sauf disposition légale contraire ou geste
commercial.</p>

<h2>4. Comment demander un remboursement</h2>
<p>Les paiements étant gérés par <strong>Paddle</strong> (Merchant of Record), les remboursements
sont traités via Paddle. Écrivez-nous à <a href="mailto:{CONTACT}">{CONTACT}</a> en précisant
l'adresse e-mail de votre compte et la référence de paiement reçue de Paddle ; nous traitons les
demandes éligibles dans les meilleurs délais.</p>

<h2>5. Contact</h2>
<p><a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

PAGES = {
    "terms": {"title": "Conditions générales", "eyebrow": "Légal", "body": TERMS},
    "privacy": {"title": "Politique de confidentialité", "eyebrow": "Légal", "body": PRIVACY},
    "refund": {"title": "Politique de remboursement", "eyebrow": "Légal", "body": REFUND},
}


# --------------------------------------------------------------------------
# Version anglaise (parents américains). Point de départ sérieux, à faire
# relire par un juriste US avant un lancement public.
# --------------------------------------------------------------------------

UPDATED_EN = "September 26, 2026"

EDITOR_EN = (
    "Hōnō, a French simplified joint-stock company (SASU) with share capital of "
    "€1,000, registered with the Lille Trade and Companies Register under number "
    "939 911 897, whose registered office is at 229 rue de Solférino, 59000 Lille, "
    "France. Publication director: Thomas Ferrer, President"
)

_SUBPROCESSORS_EN = """
<ul>
  <li><strong>Railway</strong> — API hosting.</li>
  <li><strong>Vercel</strong> — web app hosting and privacy-friendly, cookieless analytics.</li>
  <li><strong>alwaysdata</strong> — database (European Union).</li>
  <li><strong>Resend</strong> — transactional emails (notifications).</li>
  <li><strong>Paddle</strong> — payment processing and billing (reseller / Merchant of Record).</li>
  <li><strong>Google</strong> — "Continue with Google" sign-in, if you choose it (name, email address and Google account identifier).</li>
  <li><strong>PostHog Inc.</strong> — audience measurement and product analytics; with your
  consent, session replay (inputs masked). Data hosted in the European Union (Frankfurt,
  Germany).</li>
</ul>
"""

TERMS_EN = f"""
<p>These terms govern your use of Alternly (the “Service”), operated by {EDITOR_EN}. By
creating an account, you agree to them.</p>

<h2>1. The Service</h2>
<p>Alternly is a shared-custody calendar and a set of coordination tools for separated and
divorced co-parents: custody-schedule generation, school breaks, day swaps, shared expenses,
and a message board. Alternly helps you organize day-to-day life; <strong>it does not replace a
court order, a parenting plan, or legal advice</strong>, and it is not intended as evidence in
any legal proceeding.</p>

<h2>2. Account</h2>
<p>You are responsible for the accuracy of the information you provide and for keeping your
credentials confidential. The Service is intended for adults. You agree to use it fairly and not
to infringe the rights of the other parent or any third party.</p>

<h2>3. Free plan and premium subscription</h2>
<p>Alternly’s custody calendar is free. Premium features (shared expenses, message board, email
reminders, and calendar sync) require a subscription: US$79 per year per household, or US$8.99
per month. A subscription is purchased by one parent and benefits the whole household. Payments,
billing, and applicable sales tax are handled by our partner <strong>Paddle</strong>, acting as
reseller (Merchant of Record); Paddle’s terms apply to the transaction. The subscription has no
minimum commitment and can be canceled at any time; see the
<a href="/en/refund">refund policy</a>.</p>

<h2>4. Availability</h2>
<p>We strive to keep the Service available but cannot guarantee it. The Service is provided “as
is.” We may change it, suspend it for maintenance, or modify its features.</p>

<h2>5. Limitation of liability</h2>
<p>To the extent permitted by law, we are not liable for indirect damages, nor for the
consequences of decisions made based on the information displayed (dates, balances, swaps). You
remain solely responsible for organizing custody of your children.</p>

<h2>6. Termination</h2>
<p>You may close your account at any time. We may suspend an account that breaches these terms.</p>

<h2>7. Governing law</h2>
<p>These terms are governed by French law (the operator being a French company). Nothing in these
terms limits any mandatory consumer-protection rights available to you under the laws of your
place of residence. We will seek an amicable resolution before any legal action.</p>

<h2>8. Contact</h2>
<p>Questions: <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

PRIVACY_EN = f"""
<p>This policy explains how Alternly handles your personal information. Alternly is operated by a
European company and applies the standards of the EU General Data Protection Regulation (GDPR) to
all users, including in the United States.</p>

<h2>1. Data controller</h2>
<p>{EDITOR_SHORT}. Contact: <a href="mailto:{CONTACT}">{CONTACT}</a>.</p>

<h2>2. Information we collect</h2>
<p>We apply strict data minimization:</p>
<ul>
  <li><strong>Account</strong>: email address, password (hashed), display name.</li>
  <li><strong>Household &amp; custody</strong>: household name, children’s first names (birthday
  optional), custody rules, swaps, expenses, and messages you enter.</li>
  <li><strong>Technical</strong>: sign-in data and aggregate, cookieless analytics
  (Vercel Analytics and PostHog — no individual profiling).</li>
  <li><strong>Product analytics (with your consent)</strong>: pages viewed, actions taken in the
  app (e.g. "swap proposed", "expense added" — never their content), device and browser type,
  country derived from your IP address (which is not stored), and session recordings with inputs
  and personal content masked. This data is linked to a technical identifier, never to your
  email or name.</li>
</ul>
<p>No sensitive data (health, opinions, etc.) is required; please do not enter any in free-text
fields.</p>

<h2>3. Purposes and legal basis</h2>
<p>Data is used to provide the Service (performance of the contract), to notify you of changes,
and to keep the Service secure. Notification emails are part of providing the Service and can be
turned off in your settings. Anonymous, cookieless audience measurement relies on our legitimate
interest in improving the Service; detailed product analytics and session replay rely on your
consent, which you can withdraw at any time.</p>

<h2>4. Hosting and international transfers</h2>
<p>Data is hosted in the European Union. If you use Alternly from the United States, your
information is transferred to and processed in the EU under GDPR-level protection.</p>

<h2>5. Service providers</h2>
{_SUBPROCESSORS_EN}

<h2>6. Retention</h2>
<p>Your data is kept while your account is active, then deleted or anonymized within a reasonable
period after closure, subject to legal obligations (e.g., billing records). Analytics data is kept
for at most 13 months and session recordings for at most 30 days.</p>

<h2>6a. Cookies and similar technologies</h2>
<p>Without your consent, no analytics cookie is set: traffic is measured anonymously, with no
cookie or storage on your device. On your first visit, a banner lets you accept or decline — just
as easily — analytics cookies and local storage (PostHog) that help us understand how Alternly
is used and improve it. If you accept, a technical identifier is kept on your device and your
sessions may be recorded, with all inputs and personal content masked. Your choice is remembered
for up to 13 months, after which we ask again.</p>
<p>You can change your mind at any time with the "Cookie settings" link at the bottom of every page
of the site, or in the app (Settings → Account → Cookies &amp; analytics). Strictly necessary items
(sign-in session, language, remembering your choice) do not require consent.</p>

<h2>7. Your rights</h2>
<p>You have rights of access, rectification, erasure, restriction, objection, and portability.
Write to us at <a href="mailto:{CONTACT}">{CONTACT}</a>. We do not sell your personal information.</p>

<h2>8. Security</h2>
<p>Passwords are hashed (bcrypt), access is authenticated and isolated per household, and data is
encrypted in transit (HTTPS).</p>

<h2>9. Contact</h2>
<p><a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

REFUND_EN = f"""
<p>This policy describes refunds for the Alternly subscription.</p>

<h2>1. Free plan</h2>
<p>The custody calendar is free: no payment is required to use it. Only the premium subscription
(monthly or annual) is paid.</p>

<h2>2. Money-back guarantee</h2>
<p>If you are not satisfied, you may request a full refund within 14 days of your subscription
purchase.</p>

<h2>3. Subscription</h2>
<p>The subscription (monthly or annual) has no forced renewal: you can cancel at any time, which
stops future renewals. After the 14-day window, already-started periods are not prorated unless
required by applicable law or offered as a goodwill gesture.</p>

<h2>4. How to request a refund</h2>
<p>Because payments are handled by <strong>Paddle</strong> (Merchant of Record), refunds are
processed through Paddle. Email us at <a href="mailto:{CONTACT}">{CONTACT}</a> with your account
email and the Paddle payment reference; we handle eligible requests promptly.</p>

<h2>5. Contact</h2>
<p><a href="mailto:{CONTACT}">{CONTACT}</a>.</p>
"""

PAGES_EN = {
    "terms": {"title": "Terms of Service", "eyebrow": "Legal", "body": TERMS_EN},
    "privacy": {"title": "Privacy Policy", "eyebrow": "Legal", "body": PRIVACY_EN},
    "refund": {"title": "Refund Policy", "eyebrow": "Legal", "body": REFUND_EN},
}
