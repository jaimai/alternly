from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.templating import Jinja2Templates

from ..services.blog import load_articles, render_article

router = APIRouter(tags=["marketing"])

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

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


@router.get("/robots.txt", response_class=PlainTextResponse, include_in_schema=False)
def robots(request: Request):
    base = str(request.base_url).rstrip("/")
    return f"User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\nSitemap: {base}/sitemap.xml\n"


@router.get("/sitemap.xml", include_in_schema=False)
def sitemap(request: Request):
    base = str(request.base_url).rstrip("/")
    urls = [f"{base}/", f"{base}/blog"] + [f"{base}/blog/{a.slug}" for a in load_articles()]
    items = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{items}\n</urlset>\n"
    )
    return Response(content=xml, media_type="application/xml")
