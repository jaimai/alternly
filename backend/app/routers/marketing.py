from datetime import date
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
    return RedirectResponse(TOOL_PATH, status_code=302)


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
    elif "vacances" in request.query_params and not form["zone"]:
        error = "Choisissez la zone scolaire de l'école de l'enfant (A, B ou C)."
    return templates.TemplateResponse(
        request,
        "outil_vacances.html",
        {
            "form": form,
            "options": vacation_tool.period_options(),
            "result": result,
            "error": error,
            "zones": ZONE_ACADEMIES,
            "faq": TOOL_FAQ,
            "cta_href": TOOL_CTA,
            "tool_title": TOOL_TITLE,
            "canonical": f"{site_base(request)}{TOOL_PATH}",
        },
    )


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
               (f"{base}{TOOL_PATH}", None, "0.8")]
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

## Tarif
- Le calendrier de garde est entièrement gratuit.
- Premium (dépenses partagées, mur de communication, notifications e-mail, synchronisation) : 69 € par an et par foyer, ou 8,99 € par mois. Un seul parent paie et tout le foyer en profite.

## Confidentialité
- Données hébergées en Union européenne, minimisation stricte (le prénom de l'enfant suffit).
- Alternly organise le quotidien ; il ne remplace ni une décision de justice ni un conseil juridique.

## Outils gratuits (sans inscription)
- [{TOOL_TITLE}]({base}{TOOL_PATH}) : zone scolaire, période (Toussaint, Noël, hiver, printemps, été) et règle de partage (moitié/moitié ou vacances entières, années paires/impaires) → dates officielles et jour de passage entre les parents.

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
