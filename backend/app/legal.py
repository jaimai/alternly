"""Contenu des pages légales (SSR). Rédigé comme point de départ sérieux ;
à faire relire par un professionnel du droit avant de s'y fier, et à compléter
là où figurent des crochets [ ] (raison sociale, adresse, SIREN…)."""

UPDATED = "24 juillet 2026"

CONTACT = "contact@alternly.com"

# Sous-traitants / prestataires effectivement utilisés.
_SUBPROCESSORS = """
<ul>
  <li><strong>Railway</strong> — hébergement de l'API.</li>
  <li><strong>Vercel</strong> — hébergement de l'application web et mesure d'audience respectueuse de la vie privée (sans cookies).</li>
  <li><strong>alwaysdata</strong> — base de données (Union européenne).</li>
  <li><strong>Resend</strong> — envoi des e-mails transactionnels (notifications).</li>
  <li><strong>Paddle</strong> — traitement des paiements et facturation (revendeur / Merchant of Record).</li>
</ul>
"""

TERMS = f"""
<p>Les présentes conditions générales régissent l'utilisation d'Alternly (« le Service »),
édité par [Raison sociale de l'éditeur], [forme juridique], [adresse], immatriculée sous le
numéro [SIREN]. En créant un compte, vous les acceptez.</p>

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

<h2>3. Essai et abonnement</h2>
<p>Alternly est proposé avec un essai gratuit de 14 jours, sans carte bancaire. À l'issue de
l'essai, l'accès complet nécessite un abonnement annuel de 39&nbsp;€ TTC par parent. Les
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
<p>[Raison sociale de l'éditeur], [adresse]. Contact :
<a href="mailto:{CONTACT}">{CONTACT}</a>.</p>

<h2>2. Données collectées</h2>
<p>Nous appliquons une stricte minimisation :</p>
<ul>
  <li><strong>Compte</strong> : adresse e-mail, mot de passe (chiffré), prénom d'affichage.</li>
  <li><strong>Foyer &amp; garde</strong> : nom du foyer, prénom des enfants (l'anniversaire est
  facultatif), zone scolaire, règles de garde, échanges, dépenses et messages que vous saisissez.</li>
  <li><strong>Techniques</strong> : données de connexion et mesure d'audience agrégée
  (Vercel Analytics, sans cookies ni profilage individuel).</li>
</ul>
<p>Aucune donnée sensible (santé, opinions…) n'est requise ; nous vous invitons à ne pas en
saisir dans les champs libres.</p>

<h2>3. Finalités et base légale</h2>
<p>Les données servent à fournir le Service (exécution du contrat), à vous notifier des
changements, et à assurer la sécurité. Les e-mails de notification reposent sur l'exécution du
contrat et peuvent être désactivés dans vos réglages.</p>

<h2>4. Hébergement</h2>
<p>Les données sont hébergées dans l'Union européenne.</p>

<h2>5. Sous-traitants</h2>
{_SUBPROCESSORS}

<h2>6. Durée de conservation</h2>
<p>Vos données sont conservées tant que votre compte est actif, puis supprimées ou anonymisées
dans un délai raisonnable après sa fermeture, sous réserve des obligations légales (ex. facturation).</p>

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

<h2>1. Essai gratuit</h2>
<p>L'essai de 14 jours est entièrement gratuit et ne nécessite pas de carte bancaire : aucun
montant n'est prélevé pendant l'essai. Si vous ne souscrivez pas, aucun paiement n'a lieu.</p>

<h2>2. Droit de rétractation</h2>
<p>Conformément au droit de la consommation de l'Union européenne, vous disposez d'un délai de
rétractation de 14 jours à compter de la souscription de l'abonnement pour demander un
remboursement intégral, sauf renonciation expresse à ce droit.</p>

<h2>3. Abonnement annuel</h2>
<p>L'abonnement est annuel et sans engagement de reconduction forcée : vous pouvez le résilier à
tout moment, ce qui interrompt le renouvellement. Au-delà du délai de rétractation, les périodes
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
