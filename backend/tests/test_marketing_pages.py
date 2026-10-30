"""Pages par fonctionnalité, tarifs et calculateur de revalorisation de pension."""
import pytest

from app.marketing_pages import FEATURE_PAGES

CALC = "/outils/revalorisation-pension-alimentaire"


@pytest.mark.parametrize("path", [p["path"] for p in FEATURE_PAGES.values()] + ["/tarifs", CALC])
def test_pages_render_with_seo_basics(client, path):
    resp = client.get(path)
    assert resp.status_code == 200, path
    html = resp.text
    assert '<link rel="canonical"' in html and path in html
    assert '"@type": "FAQPage"' in html
    assert "class=\"icon" in html or path == CALC


def test_pages_listed_in_sitemap_and_footer(client):
    sitemap = client.get("/sitemap.xml").text
    footer = client.get("/").text
    for path in [p["path"] for p in FEATURE_PAGES.values()] + ["/tarifs", CALC]:
        assert path in sitemap
        assert f'href="{path}"' in footer


def test_pricing_page_shows_household_price(client):
    html = client.get("/tarifs").text
    assert "69" in html and "par foyer" in html


class TestPensionCalculator:
    def test_computes_revalued_amount(self, client):
        html = client.get(CALC, params={"montant": "200", "indice_base": "112,03", "indice_nouveau": "118,52"}).text
        # 200 × 118,52 ÷ 112,03 = 211,586… → 211,59 €
        assert "211,59" in html
        assert "200,00 € × 118,52 ÷ 112,03" in html

    def test_accepts_spaces_and_dots(self, client):
        html = client.get(CALC, params={"montant": "1 200.50", "indice_base": "100", "indice_nouveau": "110"}).text
        assert "1 320,55" in html

    def test_rejects_invalid_values(self, client):
        html = client.get(CALC, params={"montant": "abc", "indice_base": "0", "indice_nouveau": "-3"}).text
        assert "nombres positifs" in html

    def test_empty_form_shows_placeholder(self, client):
        assert "Votre résultat s'affichera ici" in client.get(CALC).text


def test_no_emoji_left_on_landings(client):
    import re

    emoji = re.compile("[\U0001F300-\U0001FAFF☀-➿\U0001F1E6-\U0001F1FF]")
    for path in ("/", "/en"):
        assert not emoji.search(client.get(path).text), path
