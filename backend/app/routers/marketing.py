from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..legal import PAGES as LEGAL_PAGES
from ..legal import PAGES_EN as LEGAL_PAGES_EN
from ..legal import UPDATED as LEGAL_UPDATED
from ..legal import UPDATED_EN as LEGAL_UPDATED_EN
from ..marketing_pages import FEATURE_PAGES, PRICING_FAQ
from ..ratelimit import MINUTE, rate_limit
from ..services import billing as billing_service
from ..services import vacation_tool
from ..services.blog import CONTENT_DIR_EN, load_articles, render_article
from ..services.public_holidays import PublicDataUnavailable

router = APIRouter(tags=["marketing"])

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
# URL publique du site (Vercel). La landing et l'app sont sous la même origine :
# les liens « se connecter/s'inscrire » sont donc relatifs (/login, /register).
# `site_url` sert au canonical/OG (la landing est proxifiée par Vercel).
templates.env.globals["site_url"] = settings.public_site_url.rstrip("/")
# Jeton de projet PostHog (public) : lu au rendu, vide → ni bannière ni mesure d'audience.
templates.env.globals["analytics_key"] = lambda: settings.posthog_token
templates.env.globals["billing_plans"] = billing_service.plans
# Pages traduites (chemin → (fr, en)) : seules celles-ci reçoivent des hreflang.
# Un hreflang vers l'accueil depuis un article le déclarerait à tort « traduction ».
HREFLANG_PAIRS = {
    path: pair
    for pair in [("/", "/en")] + [(f"/{s}", f"/en/{s}") for s in ("terms", "privacy", "refund")]
    for path in pair
}
templates.env.globals["hreflang_pairs"] = HREFLANG_PAIRS


def site_base(request: Request) -> str:
    """Origine publique canonique (PUBLIC_SITE_URL), sinon celle de la requête.
    La landing étant proxifiée par Vercel, request.base_url serait l'URL Railway."""
    return settings.public_site_url.rstrip("/") or str(request.base_url).rstrip("/")


def app_base() -> str:
    """Origine de la SPA (routes /register, /login, /join/…)."""
    return settings.app_url.rstrip("/")

MONTHS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]


def date_fr(d: date) -> str:
    return f"{d.day} {MONTHS_FR[d.month - 1]} {d.year}"


templates.env.filters["date_fr"] = date_fr


def date_en(d: date) -> str:
    return d.strftime("%B ") + f"{d.day}, {d.year}"


templates.env.filters["date_en"] = date_en


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
def landing(request: Request):
    return templates.TemplateResponse(request, "landing.html", {})


@router.get("/en", response_class=HTMLResponse, include_in_schema=False)
def landing_en(request: Request):
    """Landing anglaise, orientée parents américains (garde alternée, fêtes US)."""
    return templates.TemplateResponse(request, "landing_en.html", {})


@router.get("/blog", response_class=HTMLResponse, include_in_schema=False)
def blog_index(request: Request):
    return templates.TemplateResponse(request, "blog_index.html", {"articles": load_articles()})


@router.get("/blog/{slug}", response_class=HTMLResponse, include_in_schema=False)
def blog_post(request: Request, slug: str):
    article = next((a for a in load_articles() if a.slug == slug), None)
    if article is None:
        raise HTTPException(status_code=404, detail="Article introuvable")
    return templates.TemplateResponse(
        request, "blog_post.html", {"article": article, "body": render_article(article)}
    )


@router.get("/en/blog", response_class=HTMLResponse, include_in_schema=False)
def blog_index_en(request: Request):
    return templates.TemplateResponse(request, "blog_index_en.html", {"articles": load_articles(CONTENT_DIR_EN)})


@router.get("/en/blog/{slug}", response_class=HTMLResponse, include_in_schema=False)
def blog_post_en(request: Request, slug: str):
    article = next((a for a in load_articles(CONTENT_DIR_EN) if a.slug == slug), None)
    if article is None:
        raise HTTPException(status_code=404, detail="Article not found")
    return templates.TemplateResponse(
        request, "blog_post_en.html", {"article": article, "body": render_article(article)}
    )


# ---------------------------------------------------------------- outils gratuits
TOOL_PATH = "/outils/vacances-garde-alternee"
TOOL_TITLE = "Qui a les enfants pendant les vacances ?"
TOOL_CTA = "/register?lang=fr&utm_source=outil&utm_medium=web&utm_campaign=toussaint-2026"

def tool_cta_href(form: dict | None) -> str:
    """Lien d'inscription ; avec un calcul fait, la zone et la règle de vacances sont
    passées pour pré-remplir l'onboarding (l'inscrit n'a pas à les refaire)."""
    if not form:
        return TOOL_CTA
    return f"{TOOL_CTA}&zone={form['zone']}&vac_mode={form['mode']}"


# Rattachement des académies (métropole) aux zones de vacances.
ZONE_ACADEMIES = {
    "A": "Besançon, Bordeaux, Clermont-Ferrand, Dijon, Grenoble, Limoges, Lyon, Poitiers",
    "B": "Aix-Marseille, Amiens, Lille, Nancy-Metz, Nantes, Nice, Normandie, Orléans-Tours, "
         "Reims, Rennes, Strasbourg",
    "C": "Créteil, Montpellier, Paris, Toulouse, Versailles",
}

TOOL_FAQ = [
    (
        "Comment sont partagées les vacances « par moitié » ?",
        "La période officielle (du premier au dernier jour sans école) est coupée en deux. "
        "Si elle compte un nombre impair de jours, le jour supplémentaire revient à la "
        "première moitié. Le jour de passage est le premier jour de la seconde moitié : "
        "pour une Toussaint de 16 jours commençant un samedi, c'est le dimanche de la "
        "semaine suivante.",
    ),
    (
        "Qui a la première moitié les années paires ?",
        "C'est votre jugement ou votre convention parentale qui le dit, par exemple "
        "« le père a la première moitié les années paires ». L'attribution s'inverse "
        "les années impaires. Pour les vacances à cheval sur deux années (Noël), "
        "c'est l'année du premier jour des vacances qui compte.",
    ),
    (
        "Les vacances de la Toussaint dépendent-elles de la zone ?",
        "Non : la Toussaint, Noël et l'été sont communs aux zones A, B et C. Seules les "
        "vacances d'hiver et de printemps sont décalées selon la zone de l'école de l'enfant.",
    ),
    (
        "À quelle heure se fait le passage de bras ?",
        "Le calcul se fait en journées entières. L'heure (samedi midi, dimanche 18 h…) "
        "est celle prévue par votre accord ; à défaut, mettez-vous d'accord par écrit.",
    ),
    (
        "Mes données sont-elles enregistrées ?",
        "Non. L'outil ne demande ni compte ni e-mail, et les prénoms éventuellement "
        "saisis restent dans votre navigateur.",
    ),
]


def _tool_form(params) -> tuple[dict, bool]:
    """Valeurs du formulaire (défauts si absent/invalide) et présence d'une demande."""
    default = vacation_tool.default_option()
    options = {o["value"]: o for o in vacation_tool.period_options()}
    zone = params.get("zone", "")
    vac = params.get("vacances", "")
    mode = params.get("mode", "")
    even_first = params.get("even_first", "")
    submitted = (
        zone in vacation_tool.ZONES and vac in options
        and mode in vacation_tool.MODES and even_first in vacation_tool.PARENTS
    )
    form = {
        "zone": zone if zone in vacation_tool.ZONES else "",
        "vacances": vac if vac in options else default["value"],
        "mode": mode if mode in vacation_tool.MODES else "split_half",
        "even_first": even_first if even_first in vacation_tool.PARENTS else "A",
    }
    return form, submitted


@router.get("/outils", include_in_schema=False)
def tools_index():
    return RedirectResponse(TOOL_PATH, status_code=301)


def _quick_answer(db: Session, vacances: str) -> dict | None:
    """Résultat « moitié / moitié » quand la période a les mêmes dates dans les trois
    zones, sinon None (la zone est alors nécessaire). Jamais d'erreur : en cas de
    données indisponibles, la page garde simplement le formulaire."""
    try:
        period, year = vacances.rsplit("-", 1)
        results = [
            vacation_tool.vacation_split(db, zone, period, int(year), "split_half", "A")
            for zone in vacation_tool.ZONES
        ]
    except (ValueError, PublicDataUnavailable, vacation_tool.PeriodNotPublished):
        return None
    if len({(r["period"]["start"], r["period"]["end"]) for r in results}) != 1:
        return None
    return {**results[0], "value": vacances}


@router.get(TOOL_PATH, response_class=HTMLResponse, include_in_schema=False)
def tool_vacation_split(request: Request, db: Session = Depends(get_db)):
    """Outil SSR : fonctionne sans JS (formulaire GET), amélioré par outil-vacances.js."""
    form, submitted = _tool_form(request.query_params)
    result, error = None, None
    if submitted:
        try:
            rate_limit("vacation_tool", 30, MINUTE)(request)
            period, year = form["vacances"].rsplit("-", 1)
            result = vacation_tool.vacation_split(
                db, form["zone"], period, int(year), form["mode"], form["even_first"]
            )
        except HTTPException:
            error = "Trop de demandes d'affilée : réessayez dans une minute."
        except PublicDataUnavailable:
            error = ("Le calendrier scolaire officiel est momentanément indisponible. "
                     "Réessayez dans quelques minutes.")
        except vacation_tool.PeriodNotPublished:
            error = ("Les dates officielles de ces vacances ne sont pas encore publiées "
                     "pour cette zone. Choisissez une autre période.")
    year = None
    if result is not None:
        # Vue « toute l'année » : les autres vacances de la même année scolaire,
        # avec la même règle (données en cache, déjà chargées pour la période).
        try:
            year = vacation_tool.year_overview(
                db, form["zone"], result["period"]["school_year"], form["mode"], form["even_first"]
            )
        except PublicDataUnavailable:
            year = None
    quick = None
    if not submitted and "vacances" in request.query_params:
        # Arrivée depuis une annonce ou un lien (?vacances=… sans zone) : si les dates
        # sont communes aux trois zones (Toussaint, Noël, été), la réponse s'affiche
        # tout de suite, avec la règle la plus courante (moitié / moitié).
        quick = _quick_answer(db, form["vacances"])
        if quick is None and not form["zone"]:
            error = "Choisissez la zone scolaire de l'école de l'enfant (A, B ou C)."
    return templates.TemplateResponse(
        request,
        "outil_vacances.html",
        {
            "form": form,
            "options": vacation_tool.period_options(),
            "result": result,
            "year": year,
            "quick": quick,
            "error": error,
            "zones": ZONE_ACADEMIES,
            "mode_labels": vacation_tool.MODE_LABELS,
            "faq": TOOL_FAQ,
            "cta_href": tool_cta_href(form if submitted else None),
            "cta_base": TOOL_CTA,
            "tool_title": TOOL_TITLE,
            "canonical": f"{site_base(request)}{TOOL_PATH}",
        },
    )


NOEL_PATH = "/outils/noel-garde-alternee"
NOEL_CTA = "/register?lang=fr&utm_source=noel&utm_medium=web&utm_campaign=noel-2026"
NOEL_FAQ = [
    (
        "Qui a les enfants à Noël en garde alternée ?",
        "Le plus souvent, les vacances de Noël sont partagées par moitié : le parent qui a la "
        "première moitié les années paires a les enfants du début des vacances jusqu'au milieu, "
        "donc le 24 et le 25 décembre ; l'autre parent a la seconde moitié, avec le Nouvel An. "
        "L'ordre s'inverse l'année suivante.",
    ),
    (
        "Pour Noël, quelle année compte : celle du 24 décembre ou celle de la rentrée ?",
        "C'est l'année du premier jour des vacances qui compte : les vacances qui commencent en "
        "décembre 2026 suivent la règle des années paires, même si elles se terminent en 2027.",
    ),
    (
        "Peut-on alterner le réveillon et le jour de Noël indépendamment des vacances ?",
        "Oui, si vous êtes d'accord ou si votre convention le prévoit : beaucoup de parents "
        "séparent le 24 au soir et le 25, ou alternent chaque année qui a le réveillon. Alternly "
        "permet de régler ces jours à part, ils passent alors avant le partage des vacances.",
    ),
    (
        "Les dates de Noël sont-elles les mêmes dans toutes les zones ?",
        "Oui, les vacances de Noël sont communes aux zones A, B et C.",
    ),
]


def christmas_year(today: date | None = None) -> int:
    """Année des prochaines vacances de Noël (celles en cours jusqu'au 6 janvier)."""
    today = today or date.today()
    return today.year - 1 if today.month == 1 and today.day <= 6 else today.year


@router.get(NOEL_PATH, response_class=HTMLResponse, include_in_schema=False)
def tool_christmas(request: Request, db: Session = Depends(get_db)):
    """Page de campagne « Qui a les enfants à Noël ? » : dates officielles et les
    partages les plus courants, calculés par le moteur de garde (dates communes aux zones)."""
    year = christmas_year()
    splits: dict[str, dict | None] = {}
    for mode in ("split_half", "alternate_full", "weekly"):
        try:
            splits[mode] = vacation_tool.vacation_split(db, "A", "noel", year, mode, "A")
        except (PublicDataUnavailable, vacation_tool.PeriodNotPublished):
            splits[mode] = None
    return templates.TemplateResponse(
        request,
        "outil_noel.html",
        {
            "year": year,
            "splits": splits,
            "faq": NOEL_FAQ,
            "cta_href": NOEL_CTA,
            "tool_href": f"{TOOL_PATH}?vacances=noel-{year}",
            "canonical": f"{site_base(request)}{NOEL_PATH}",
        },
    )


# ---------------------------------------------------------------- calculateur pension
PENSION_TOOL_PATH = "/outils/revalorisation-pension-alimentaire"
PENSION_TOOL_TITLE = "Calculer la revalorisation d'une pension alimentaire"
PENSION_TOOL_CTA = "/register?lang=fr&utm_source=outil-pension&utm_medium=web&utm_campaign=pension"
PENSION_TOOL_FAQ = [
    (
        "Quelle est la formule de revalorisation d'une pension alimentaire ?",
        "Nouveau montant = montant fixé par la décision × nouvel indice ÷ indice de référence. "
        "L'indice de référence est celui en vigueur à la date de la décision (ou celui qu'elle cite) ; "
        "le nouvel indice est le dernier publié par l'INSEE avant la date de revalorisation.",
    ),
    (
        "Quel indice INSEE utiliser ?",
        "Celui que cite votre jugement ou votre convention, le plus souvent l'indice des prix à la "
        "consommation (ensemble des ménages, France, hors tabac). Utilisez toujours la même série "
        "pour l'indice de référence et le nouvel indice.",
    ),
    (
        "Qui doit faire le calcul ?",
        "Le parent qui verse la pension doit appliquer la revalorisation à la date prévue, sans "
        "attendre que l'autre parent la réclame.",
    ),
    (
        "La revalorisation est-elle rétroactive ?",
        "Les sommes non revalorisées restent dues, dans la limite de la prescription. En cas de "
        "doute sur un rattrapage, rapprochez-vous de l'ARIPA (CAF ou MSA) ou d'un avocat.",
    ),
]


def _decimal(value: str | None) -> Decimal | None:
    """« 1 234,56 » / « 1234.56 » → Decimal positif, sinon None."""
    if not value:
        return None
    try:
        number = Decimal(value.replace("\u202f", "").replace("\xa0", "").replace(" ", "").replace(",", "."))
    except InvalidOperation:
        return None
    return number if number.is_finite() and 0 < number < 1_000_000 else None


def _euros(amount: Decimal) -> str:
    """Decimal → « 1 234,56 € » (format français)."""
    whole, cents = f"{amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):.2f}".split(".")
    groups = f"{int(whole):,}".replace(",", "\u202f")
    return f"{groups},{cents}\u00a0€"


def _index_label(value: Decimal) -> str:
    return f"{value.normalize():f}".replace(".", ",")


@router.get(PENSION_TOOL_PATH, response_class=HTMLResponse, include_in_schema=False)
def tool_pension(request: Request):
    """Calculateur public : montant × nouvel indice ÷ indice de référence (sans inscription)."""
    params = request.query_params
    raw = {k: params.get(k, "").strip()[:20] for k in ("montant", "indice_base", "indice_nouveau")}
    submitted = any(raw.values())
    amount, base, new = (_decimal(raw[k]) for k in ("montant", "indice_base", "indice_nouveau"))
    result = error = None
    if submitted:
        if amount is None or base is None or new is None:
            error = "Renseignez les trois valeurs avec des nombres positifs (ex. 200 ; 112,03 ; 118,52)."
        else:
            revalued = (amount * new / base).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            diff = revalued - amount
            result = {
                "amount": _euros(amount),
                "base": _index_label(base),
                "new": _index_label(new),
                "revalued": _euros(revalued),
                "diff": ("+" if diff >= 0 else "−") + _euros(abs(diff)),
                "percent": f"{(diff / amount * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}".replace(".", ","),
                "yearly": _euros(abs(diff) * 12),
            }
    return templates.TemplateResponse(
        request,
        "outil_pension.html",
        {
            "form": raw,
            "result": result,
            "error": error,
            "faq": PENSION_TOOL_FAQ,
            "cta_href": PENSION_TOOL_CTA,
            "tool_title": PENSION_TOOL_TITLE,
            "canonical": f"{site_base(request)}{PENSION_TOOL_PATH}",
        },
    )


# ---------------------------------------------------------------- pages par fonctionnalité
def _feature_page(key: str):
    page = FEATURE_PAGES[key]

    def view(request: Request):
        return templates.TemplateResponse(request, "page_feature.html", {"page": page})

    view.__name__ = f"feature_{key}"
    return view


for _key, _page in FEATURE_PAGES.items():
    router.add_api_route(
        _page["path"], _feature_page(_key), methods=["GET"], response_class=HTMLResponse, include_in_schema=False
    )


@router.get("/tarifs", response_class=HTMLResponse, include_in_schema=False)
def pricing_page(request: Request):
    return templates.TemplateResponse(request, "tarifs.html", {"faq": PRICING_FAQ})


# Crawlers de moteurs de réponse IA : on les autorise explicitement (visibilité AEO).
_AI_AGENTS = [
    "GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User",
    "ClaudeBot", "Claude-Web", "Google-Extended", "Applebot-Extended", "CCBot",
]


@router.get("/terms", response_class=HTMLResponse, include_in_schema=False)
@router.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
@router.get("/refund", response_class=HTMLResponse, include_in_schema=False)
def legal_page(request: Request):
    slug = request.url.path.strip("/")
    page = LEGAL_PAGES[slug]
    return templates.TemplateResponse(
        request,
        "legal.html",
        {
            "page_title": page["title"],
            "eyebrow": page["eyebrow"],
            "body": page["body"],
            "updated": LEGAL_UPDATED,
        },
    )


@router.get("/en/terms", response_class=HTMLResponse, include_in_schema=False)
@router.get("/en/privacy", response_class=HTMLResponse, include_in_schema=False)
@router.get("/en/refund", response_class=HTMLResponse, include_in_schema=False)
def legal_page_en(request: Request):
    slug = request.url.path.rsplit("/", 1)[-1]
    page = LEGAL_PAGES_EN[slug]
    return templates.TemplateResponse(
        request,
        "legal_en.html",
        {
            "page_title": page["title"],
            "eyebrow": page["eyebrow"],
            "body": page["body"],
            "updated": LEGAL_UPDATED_EN,
        },
    )


@router.get("/robots.txt", response_class=PlainTextResponse, include_in_schema=False)
def robots(request: Request):
    base = site_base(request)
    lines = ["User-agent: *", "Allow: /", "Disallow: /app", "Disallow: /api", ""]
    for agent in _AI_AGENTS:
        lines += [f"User-agent: {agent}", "Allow: /", ""]
    lines += [f"Sitemap: {base}/sitemap.xml"]
    return "\n".join(lines) + "\n"


@router.get("/sitemap.xml", include_in_schema=False)
def sitemap(request: Request):
    base = site_base(request)
    entries = [(f"{base}/", None, "1.0"), (f"{base}/en", None, "0.9"), (f"{base}/blog", None, "0.7"),
               (f"{base}{TOOL_PATH}", None, "0.8"), (f"{base}{NOEL_PATH}", None, "0.8"),
               (f"{base}{PENSION_TOOL_PATH}", None, "0.8"), (f"{base}/tarifs", None, "0.7")]
    entries += [(f"{base}{p['path']}", None, "0.7") for p in FEATURE_PAGES.values()]
    for a in load_articles():
        entries.append((f"{base}/blog/{a.slug}", a.date.isoformat(), "0.6"))
    entries.append((f"{base}/en/blog", None, "0.7"))
    for a in load_articles(CONTENT_DIR_EN):
        entries.append((f"{base}/en/blog/{a.slug}", a.date.isoformat(), "0.6"))
    for slug in ("terms", "privacy", "refund"):
        entries.append((f"{base}/{slug}", None, "0.3"))
        entries.append((f"{base}/en/{slug}", None, "0.3"))
    items = "\n".join(
        "  <url><loc>{}</loc>{}<priority>{}</priority></url>".format(
            loc, f"<lastmod>{lastmod}</lastmod>" if lastmod else "", prio
        )
        for loc, lastmod, prio in entries
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{items}\n</urlset>\n"
    )
    return Response(content=xml, media_type="application/xml")


@router.get("/llms.txt", response_class=PlainTextResponse, include_in_schema=False)
def llms_txt(request: Request):
    """Résumé structuré pour les moteurs de réponse IA (convention llms.txt)."""
    base = site_base(request)
    articles = load_articles()
    guides = "\n".join(f"- [{a.title}]({base}/blog/{a.slug}) : {a.description}" for a in articles)
    guides_en = "\n".join(
        f"- [{a.title}]({base}/en/blog/{a.slug}) : {a.description}" for a in load_articles(CONTENT_DIR_EN)
    )
    return f"""# Alternly

> Alternly est le calendrier de garde alternée pensé pour la France : il transforme un accord ou un jugement de garde en calendrier clair, partagé et à jour entre les deux parents séparés.

## Ce que fait Alternly
- Calendrier de garde automatique : rythmes semaine/semaine, 2-2-3, un week-end sur deux, ou personnalisé, généré des années à l'avance.
- Vacances scolaires officielles (zones A, B, C) avec partage par moitié ou alternance complète, et inversion automatique années paires/impaires (Noël inclus).
- Échanges de jours : un parent propose, l'autre accepte, refuse ou contre-propose ; historique conservé.
- Dépenses partagées : suivi de qui a payé quoi, solde entre parents (50/50 ou part ajustée), contestations et remboursements.
- Mur de communication : infos, tâches à cocher (avec échéance visible sur le calendrier) et questions entre parents.
- Notifications e-mail et synchronisation avec Google Agenda / Apple Calendar.
- Journal de garde privé et horodaté, exportable en PDF ({base}/journal-de-garde).
- Suivi de la pension alimentaire mois par mois et revalorisation annuelle selon l'indice INSEE ({base}/pension-alimentaire).
- Demande de remboursement des frais en PDF, même si l'autre parent n'utilise pas Alternly ({base}/depenses-partagees).
- Page professionnels (avocats, médiateurs) : {base}/professionnels.

## Tarif
- Le calendrier de garde est entièrement gratuit.
- Premium (dépenses partagées, mur de communication, journal de garde, pension alimentaire, notifications e-mail, synchronisation) : 69 € par an et par foyer, ou 8,99 € par mois. Un seul parent paie et tout le foyer en profite. Détails : {base}/tarifs

## Confidentialité
- Données hébergées en Union européenne, minimisation stricte (le prénom de l'enfant suffit).
- Alternly organise le quotidien ; il ne remplace ni une décision de justice ni un conseil juridique.

## Outils gratuits (sans inscription)
- [{TOOL_TITLE}]({base}{TOOL_PATH}) : zone scolaire, période (Toussaint, Noël, hiver, printemps, été) et règle de partage (moitié/moitié, vacances entières, juillet/août ou une semaine sur deux, années paires/impaires) → dates officielles et jour de passage entre les parents.
- [Qui a les enfants à Noël ?]({base}{NOEL_PATH}) : vacances de Noël de l'année, qui a le réveillon, le 25 et le Nouvel An selon la règle de partage, jour de passage.
- [{PENSION_TOOL_TITLE}]({base}{PENSION_TOOL_PATH}) : montant fixé par la décision × nouvel indice INSEE ÷ indice de référence → nouveau montant mensuel, avec le détail du calcul.

## Réponses rapides (garde alternée en France)
- Vacances de la Toussaint 2026 : du samedi 17 octobre au lundi 2 novembre 2026, zones A, B et C. Avec un partage par moitié, passage de bras le dimanche 25 octobre ; le parent « années paires » a la première moitié.
- Vacances de Noël 2026 : du samedi 19 décembre 2026 au lundi 4 janvier 2027, zones A, B et C. Avec un partage par moitié (année de référence = année du début des vacances, donc paire), le parent « années paires » a du 19 au 26 décembre (Noël), l'autre parent du 27 décembre au 3 janvier (Nouvel An) ; passage le dimanche 27 décembre. Page : {base}{NOEL_PATH} ; guide : {base}/blog/vacances-noel-2026-garde-alternee
- Vacances d'été 2027 : à partir du samedi 3 juillet 2027. 2027 est une année impaire : avec un partage par moitié, le parent « années impaires » part en premier ; variantes courantes : juillet/août alternés, quinzaines. Guide : {base}/blog/vacances-ete-garde-alternee-juillet-aout
- Pension alimentaire en résidence alternée (table de référence du ministère de la Justice, indicative) : (revenu net mensuel du débiteur − minimum vital ≈ 650 €, montant du RSA personne seule) × 9 % pour 1 enfant, 7,8 % par enfant pour 2, 6,7 % par enfant pour 3. Exemple : 2 000 € nets, 1 enfant → ≈ 121 €/mois. Guide : {base}/blog/calcul-pension-alimentaire-garde-alternee-exemples
- Rythmes de garde alternée les plus utilisés : semaine/semaine, 2-2-3 (jeunes enfants), 2-2-5-5 ; garde classique : un week-end sur deux et la moitié des vacances.

## Guides
{guides}

## Guides en anglais (parents américains)
{guides_en}

## Liens
- Site : {base}/
- Fonctionnalités : {base}/#fonctionnalites
- Tarifs : {base}/#tarifs
- Créer un compte : {app_base()}/register
"""
