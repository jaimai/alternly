"""Pages marketing par fonctionnalité et par public (référencement).

Une page = une intention de recherche (« journal de garde », « revalorisation
pension alimentaire »…). Contenu en français, rendu par templates/page_feature.html.
Chaque entrée : chemin, titre/description SEO, accroche, points clés (icône, titre,
texte), étapes facultatives, FAQ (balisage FAQPage) et liens internes.
"""

SIGNUP = "/register?lang=fr"


def _cta(campaign: str) -> str:
    return f"{SIGNUP}&utm_source=site&utm_medium=web&utm_campaign={campaign}"


FEATURE_PAGES: dict[str, dict] = {
    "journal": {
        "path": "/journal-de-garde",
        "title": "Journal de garde : notez les faits, exportez en PDF — Alternly",
        "description": "Tenez un journal de garde factuel et horodaté : passages de relais, retards, "
        "changements, santé, école. Privé, exportable en PDF pour votre avocat ou le médiateur.",
        "eyebrow": "Journal de garde",
        "h1": "Notez les faits.",
        "h1_em": "Pas les rancœurs.",
        "lede": "Un retard au passage de relais, un rendez-vous médical, un week-end échangé : "
        "notez-le en dix secondes. Chaque note est datée et horodatée à sa saisie, privée, "
        "et s'exporte en un document clair le jour où vous en avez besoin.",
        "cta": "Commencer mon journal",
        "cta_href": _cta("journal"),
        "points": [
            ("lock", "Privé, vraiment",
             "L'autre parent ne voit jamais votre journal : aucune notification, rien dans l'historique partagé."),
            ("clock", "Horodaté à la saisie",
             "La date et l'heure d'écriture sont enregistrées automatiquement, ainsi que toute modification."),
            ("calendar", "Recoupé avec le calendrier",
             "L'export rappelle, pour chaque jour noté, chez qui étaient prévus les enfants."),
            ("download", "Exportable en PDF",
             "Un document sobre, chronologique, à imprimer ou à transmettre à votre avocat ou au médiateur."),
        ],
        "steps": [
            ("Choisissez le type", "Passage, retard, passage manqué, changement convenu, santé, école, frais…"),
            ("Écrivez les faits", "Qui, quoi, quand. Un conseil vous aide à rester neutre."),
            ("Exportez si besoin", "Choisissez une période, imprimez ou enregistrez en PDF."),
        ],
        "faq": [
            ("À quoi sert un journal de garde ?",
             "À garder une trace fiable des faits liés à la garde des enfants : passages de relais, retards, "
             "absences, changements convenus, événements de santé ou d'école. En cas de désaccord ou de "
             "procédure, une chronologie précise vaut mieux que des souvenirs."),
            ("L'autre parent peut-il voir mon journal ?",
             "Non. Le journal est strictement personnel : l'autre parent n'y a pas accès, n'est pas notifié "
             "et rien n'apparaît dans l'historique partagé du foyer."),
            ("Le journal a-t-il une valeur de preuve ?",
             "C'est un document personnel, pas un constat certifié. Il aide à présenter une chronologie claire "
             "et datée ; c'est au juge d'en apprécier la portée. Votre avocat vous dira comment l'utiliser."),
            ("Faut-il que l'autre parent utilise Alternly ?",
             "Non. Le journal fonctionne même si vous êtes seul à utiliser l'application."),
        ],
        "related": [("/pension-alimentaire", "Suivre la pension alimentaire"),
                    ("/depenses-partagees", "Dépenses partagées et demandes de remboursement")],
    },
    "pension": {
        "path": "/pension-alimentaire",
        "title": "Pension alimentaire : suivi des versements et revalorisation — Alternly",
        "description": "Suivez la pension alimentaire mois par mois (payée, partielle, non reçue), "
        "calculez la revalorisation annuelle selon l'indice INSEE et recevez un rappel chaque année.",
        "eyebrow": "Pension alimentaire",
        "h1": "La pension,",
        "h1_em": "suivie au mois près.",
        "lede": "Notez les versements reçus, voyez d'un coup d'œil les mois payés, partiels ou manquants, "
        "et calculez la revalorisation annuelle prévue par le jugement. Alternly vous la rappelle "
        "chaque année, le bon mois.",
        "cta": "Suivre ma pension",
        "cta_href": _cta("pension"),
        "points": [
            ("calendar", "Mois par mois",
             "Chaque échéance est marquée payée, partielle, non reçue ou à venir. Le reste dû se calcule tout seul."),
            ("trend", "Revalorisation en un clic",
             "Saisissez le nouvel indice : Alternly applique la formule du jugement et garde l'historique des montants."),
            ("clock", "Rappel annuel",
             "Une notification le mois de la revalorisation : plus besoin d'y penser."),
            ("users", "Même si l'autre parent n'est pas inscrit",
             "Vous pouvez tout suivre seul ; s'il rejoint le foyer, il voit les mêmes chiffres."),
        ],
        "steps": [
            ("Renseignez la pension", "Montant, jour d'échéance, et la base de revalorisation du jugement."),
            ("Notez les versements", "Montant reçu et date : l'échéancier se met à jour."),
            ("Revalorisez chaque année", "Le nouveau montant s'applique à partir du mois choisi."),
        ],
        "faq": [
            ("Comment se calcule la revalorisation d'une pension alimentaire ?",
             "La formule habituelle est : montant initial × nouvel indice ÷ indice de référence. Les deux indices "
             "sont ceux de la série INSEE prévue par le jugement (souvent l'indice des prix à la consommation "
             "hors tabac), le premier au moment de la décision, le second le plus récent publié avant la date "
             "de revalorisation."),
            ("Quand faut-il revaloriser la pension ?",
             "À la date prévue par la décision ou la convention, le plus souvent une fois par an (au 1er janvier "
             "ou à la date anniversaire du jugement). Le parent qui verse doit appliquer la revalorisation "
             "lui-même, sans attendre de demande."),
            ("Que faire si la pension n'est pas versée ?",
             "Gardez une trace des mois impayés : l'échéancier d'Alternly les fait apparaître. En cas d'impayés, "
             "l'Agence de recouvrement et d'intermédiation des pensions alimentaires (ARIPA, via la CAF ou la MSA) "
             "peut intervenir. Renseignez-vous auprès d'elle ou d'un avocat."),
            ("Alternly calcule-t-il le montant de la pension ?",
             "Non : le montant est fixé par le juge ou par votre accord. Alternly suit les versements et applique "
             "la revalorisation prévue."),
        ],
        "related": [("/outils/revalorisation-pension-alimentaire", "Calculer une revalorisation (gratuit)"),
                    ("/depenses-partagees", "Les frais partagés en plus de la pension")],
    },
    "depenses": {
        "path": "/depenses-partagees",
        "title": "Dépenses partagées entre parents séparés : solde et remboursements — Alternly",
        "description": "Cantine, santé, activités : notez qui a payé, Alternly calcule le solde entre parents "
        "et génère une demande de remboursement en PDF, même si l'autre parent n'utilise pas l'application.",
        "eyebrow": "Dépenses partagées",
        "h1": "Qui doit combien ?",
        "h1_em": "La réponse, sans dispute.",
        "lede": "Chaque parent note ce qu'il avance pour les enfants. Alternly applique votre répartition "
        "(50/50 ou autre), tient le solde à jour et prépare une demande de remboursement claire, "
        "à envoyer même à un parent qui n'utilise pas l'application.",
        "cta": "Suivre nos dépenses",
        "cta_href": _cta("depenses"),
        "points": [
            ("wallet", "Un solde clair",
             "Qui a payé quoi, la part de chacun, et le montant restant dû, toujours à jour."),
            ("receipt", "Demande de remboursement en PDF",
             "Les frais avancés, la part due et le total, dans un document prêt à envoyer."),
            ("swap", "Contestations et remboursements",
             "Une dépense se conteste avec un motif, se règle en un clic, et tout reste tracé."),
            ("users", "Seul ou à deux",
             "Commencez seul ; quand l'autre parent rejoint, il retrouve toutes les dépenses qui le concernent."),
        ],
        "steps": [],
        "faq": [
            ("Quels frais partager entre parents séparés ?",
             "Ceux prévus par votre jugement ou votre accord : souvent les frais de santé non remboursés, la "
             "scolarité, la cantine, les activités extrascolaires. Alternly vous laisse fixer la part de chacun "
             "pour chaque dépense."),
            ("Les dépenses partagées remplacent-elles la pension alimentaire ?",
             "Non : la pension est un montant fixe ; les frais exceptionnels ou partagés s'y ajoutent si la "
             "décision le prévoit. Alternly suit les deux séparément."),
            ("L'autre parent doit-il avoir un compte ?",
             "Non. Vous pouvez noter les dépenses et envoyer une demande de remboursement en PDF ; s'il crée son "
             "compte plus tard, il retrouve tout."),
        ],
        "related": [("/pension-alimentaire", "Suivre la pension alimentaire"),
                    ("/journal-de-garde", "Tenir un journal de garde")],
    },
    "pros": {
        "path": "/professionnels",
        "title": "Avocats, médiateurs familiaux : recommandez Alternly à vos clients",
        "description": "Un calendrier de garde clair et partagé pour les parents que vous accompagnez : "
        "rythme, vacances scolaires, années paires et impaires, échanges tracés, données hébergées en Europe.",
        "eyebrow": "Pour les professionnels",
        "h1": "Moins de conflits sur le calendrier,",
        "h1_em": "plus de temps pour l'essentiel.",
        "lede": "Avocats en droit de la famille, médiateurs, travailleurs sociaux : Alternly transforme la "
        "décision ou la convention en calendrier partagé, tient à jour les vacances scolaires et garde la "
        "trace des échanges. Les parents arrivent à vos rendez-vous avec des faits, pas des malentendus.",
        "cta": "Nous contacter",
        "cta_href": "/feedback?lang=fr&sujet=professionnel",
        "points": [
            ("scale", "Fidèle à la décision",
             "Rythme, partage des vacances, années paires et impaires, jours de fête : la règle est appliquée telle quelle."),
            ("swap", "Des échanges tracés",
             "Chaque changement est proposé, accepté ou refusé, et horodaté dans un historique non modifiable."),
            ("note", "Des faits plutôt que des récits",
             "Le journal de garde et la demande de remboursement aident chaque parent à présenter une chronologie claire."),
            ("briefcase", "Un accès professionnel en préparation",
             "Un accès gratuit pour suivre les familles que vous accompagnez est en préparation : parlons-en."),
        ],
        "steps": [],
        "faq": [
            ("Alternly est-il gratuit pour les parents ?",
             "Le calendrier est gratuit. L'abonnement Premium (69 € par an et par foyer) ajoute les dépenses, le "
             "mur, le journal et la pension ; un seul parent paie pour les deux."),
            ("Où sont hébergées les données ?",
             "Dans l'Union européenne. Les données ne sont jamais revendues."),
            ("Alternly remplace-t-il un conseil juridique ?",
             "Non. Alternly organise le quotidien ; il ne remplace ni une décision de justice ni un conseil."),
        ],
        "related": [("/journal-de-garde", "Le journal de garde"), ("/tarifs", "Les tarifs")],
    },
}

PRICING_FAQ = [
    ("Le calendrier est-il vraiment gratuit ?",
     "Oui, sans limite de durée : rythme de garde, vacances scolaires, années paires et impaires, échanges de "
     "jours et invitation de l'autre parent."),
    ("Faut-il que les deux parents paient ?",
     "Non. L'abonnement est par foyer : un seul parent paie, les deux en profitent."),
    ("Puis-je résilier à tout moment ?",
     "Oui, depuis vos réglages. L'essai gratuit se résilie sans frais avant sa fin."),
    ("Que se passe-t-il si l'autre parent n'utilise pas Alternly ?",
     "Vous profitez quand même du calendrier, du journal de garde, des dépenses (avec demande de remboursement "
     "en PDF) et du suivi de la pension."),
]

PRICING_FAQ_EN = [
    ("Is the calendar really free?",
     "Yes, with no time limit: custody schedule, school breaks, holidays that alternate by even/odd year, "
     "day swaps and inviting your co-parent."),
    ("Do both parents have to pay?",
     "No. The subscription is per household: one parent pays, both get access."),
    ("Can I cancel anytime?",
     "Yes, from your settings. The free trial can be canceled at no cost before it ends."),
    ("What if my co-parent doesn't use Alternly?",
     "You still get the calendar, the custody journal, expenses (with reimbursement requests as PDF) "
     "and child support tracking."),
]
