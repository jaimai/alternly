from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.templating import Jinja2Templates

from ..config import settings
from ..legal import PAGES as LEGAL_PAGES
from ..legal import UPDATED as LEGAL_UPDATED
from ..services.blog import load_articles, render_article

router = APIRouter(tags=["marketing"])

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
# URL publique du site (Vercel). La landing et l'app sont sous la même origine :
# les liens « se connecter/s'inscrire » sont donc relatifs (/login, /register).
# `site_url` sert au canonical/OG (la landing est proxifiée par Vercel).
templates.env.globals["site_url"] = settings.public_site_url.rstrip("/")

MONTHS_FR = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]


def date_fr(d: date) -> str:
    return f"{d.day} {MONTHS_FR[d.month - 1]} {d.year}"


templates.env.filters["date_fr"] = date_fr


@router.get("/", response_class=HTMLResponse, include_in_schema=False)
def landing(request: Request):
    return templates.TemplateResponse(request, "landing.html", {})


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


@router.get("/robots.txt", response_class=PlainTextResponse, include_in_schema=False)
def robots(request: Request):
    base = str(request.base_url).rstrip("/")
    lines = ["User-agent: *", "Allow: /", "Disallow: /app", "Disallow: /api", ""]
    for agent in _AI_AGENTS:
        lines += [f"User-agent: {agent}", "Allow: /", ""]
    lines += [f"Sitemap: {base}/sitemap.xml"]
    return "\n".join(lines) + "\n"


@router.get("/sitemap.xml", include_in_schema=False)
def sitemap(request: Request):
    base = str(request.base_url).rstrip("/")
    entries = [(f"{base}/", None, "1.0"), (f"{base}/blog", None, "0.7")]
    for a in load_articles():
        entries.append((f"{base}/blog/{a.slug}", a.date.isoformat(), "0.6"))
    for slug in ("terms", "privacy", "refund"):
        entries.append((f"{base}/{slug}", None, "0.3"))
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
    base = str(request.base_url).rstrip("/")
    articles = load_articles()
    guides = "\n".join(f"- [{a.title}]({base}/blog/{a.slug}) : {a.description}" for a in articles)
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

## Guides
{guides}

## Liens
- Site : {base}/
- Fonctionnalités : {base}/#fonctionnalites
- Tarifs : {base}/#tarifs
- Créer un compte : {base}/app/register
"""
