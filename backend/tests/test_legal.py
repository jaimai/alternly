"""Pages légales SSR, liens de pied de page, sitemap, polices auto-hébergées."""
import pytest

from app.config import settings

LEGAL = ["/mentions-legales", "/confidentialite", "/cgu"]


@pytest.mark.parametrize("path", LEGAL)
def test_legal_page_renders(client, path):
    resp = client.get(path)
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "<h1>" in resp.text
    assert "/static/marketing.css" in resp.text
    assert f"mailto:{settings.contact_email}" in resp.text


def test_legal_content_essentials(client):
    mentions = client.get("/mentions-legales").text
    for placeholder in ["[NOM DE L'ÉDITEUR]", "[SIRET]", "[DIRECTEUR DE LA PUBLICATION]", "[RÉGION RAILWAY"]:
        assert placeholder.replace("'", "&#39;") in mentions or placeholder in mentions
    privacy = client.get("/confidentialite").text
    for word in ["CNIL", "Resend", "Railway", "Vercel", "Stripe", "30 jours", "localStorage"]:
        assert word in privacy
    cgu = client.get("/cgu").text
    for word in ["39 €", "14 jours", "rétractation", "Résiliation"]:
        assert word in cgu


@pytest.mark.parametrize("path", ["/", "/blog", *LEGAL])
def test_footer_links(client, path):
    html = client.get(path).text
    for href in [*LEGAL, f"mailto:{settings.contact_email}"]:
        assert f'href="{href}"' in html


def test_no_google_fonts(client):
    html = client.get("/").text
    assert "fonts.googleapis.com" not in html
    assert "fonts.gstatic.com" not in html
    css = client.get("/static/marketing.css").text
    assert "@font-face" in css
    font = client.get("/static/fonts/fraunces-latin-opsz-normal.woff2")
    assert font.status_code == 200 and len(font.content) > 1000


def test_contact_email_setting(client, monkeypatch):
    from app.routers import marketing

    monkeypatch.setitem(marketing.templates.env.globals, "contact_email", "hello@exemple.fr")
    assert "mailto:hello@exemple.fr" in client.get("/cgu").text


def test_sitemap_lists_legal_pages(client):
    xml = client.get("/sitemap.xml").text
    for path in LEGAL:
        assert f"{path}</loc>" in xml
