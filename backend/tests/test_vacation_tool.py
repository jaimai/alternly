"""Outil public « Qui a les enfants pendant les vacances ? » : API, page SSR, SEO."""
from datetime import date, timedelta

import httpx
import pytest

from app.config import settings
from app.services import public_holidays, vacation_tool
from app.services.blog import load_articles
from app.services.custody_engine import EngineRule, EngineVacationRule, Period, resolve_calendar
from tests.test_rules import setup_family

URL = "/api/public/vacation-split"
PAGE = "/outils/vacances-garde-alternee"


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    """Date de référence figée : fenêtre = années scolaires 2026-2027 et 2027-2028."""
    monkeypatch.setattr(vacation_tool, "today", lambda: date(2026, 9, 27))
    vacation_tool.cache.clear()
    yield
    vacation_tool.cache.clear()


def split(client, **params):
    base = {"zone": "B", "period": "toussaint", "year": 2026, "mode": "split_half", "even_first": "A"}
    base.update(params)
    return client.get(URL, params=base)


def engine_days(period: Period, mode: str, even_first: str) -> dict[str, str]:
    """Référence : moteur appelé sur une plage plus large avec un rythme de base réel."""
    rule = EngineRule(pattern="alternate_weeks", start_date=date(2026, 1, 5), reference_parent="B", other_parent="A")
    days = resolve_calendar(
        rule, EngineVacationRule(mode=mode, even_year_first_half_parent=even_first), [], [],
        [period], period.start - timedelta(days=7), period.end + timedelta(days=7),
    )
    return {d.day.isoformat(): d.parent for d in days if period.start <= d.day <= period.end}


def timeline(body) -> dict[str, str]:
    return {d["date"]: d["parent"] for d in body["timeline"]}


class TestVacationSplitApi:
    def test_toussaint_2026_split_half(self, client):
        resp = split(client)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        p = body["period"]
        # dates officielles (fixture au format data.education.gouv.fr, bornes incluses)
        assert (p["start"], p["end"], p["days"], p["resume"]) == ("2026-10-17", "2026-11-01", 16, "2026-11-02")
        assert p["label"] == "Vacances de la Toussaint" and p["school_year"] == "2026-2027"
        assert body["year_parity"] == "paire"
        segs = [(s["parent"], s["start"], s["end"], s["days"]) for s in body["segments"]]
        assert segs == [("A", "2026-10-17", "2026-10-24", 8), ("B", "2026-10-25", "2026-11-01", 8)]
        assert body["handover"] == {"date": "2026-10-25", "label": "dim. 25 oct."}
        assert body["segments"][0]["start_label"] == "sam. 17 oct."
        assert body["segments"][1]["end_label"] == "dim. 1er nov."
        assert resp.headers["Cache-Control"].startswith("public")

    @pytest.mark.parametrize("mode", ["split_half", "alternate_full"])
    @pytest.mark.parametrize("even_first", ["A", "B"])
    @pytest.mark.parametrize("period,year", [("toussaint", 2026), ("toussaint", 2027), ("noel", 2026), ("hiver", 2027), ("ete", 2027)])
    def test_matches_engine(self, client, mode, even_first, period, year):
        body = split(client, mode=mode, even_first=even_first, period=period, year=year).json()
        p = body["period"]
        ref = Period(p["label"], date.fromisoformat(p["start"]), date.fromisoformat(p["end"]))
        assert timeline(body) == engine_days(ref, mode, even_first)

    def test_even_odd_years_and_modes(self, client):
        odd = split(client, year=2027).json()
        assert odd["year_parity"] == "impaire"
        assert [s["parent"] for s in odd["segments"]] == ["B", "A"]
        flipped = split(client, even_first="B").json()
        assert [s["parent"] for s in flipped["segments"]] == ["B", "A"]
        full_even = split(client, mode="alternate_full").json()
        assert [(s["parent"], s["days"]) for s in full_even["segments"]] == [("A", 16)]
        assert full_even["handover"] is None
        full_odd = split(client, mode="alternate_full", year=2027).json()
        assert [s["parent"] for s in full_odd["segments"]] == ["B"]

    def test_noel_parity_uses_start_year(self, client):
        body = split(client, period="noel", year=2026).json()
        assert body["period"]["start"] == "2026-12-19" and body["period"]["end"] == "2027-01-03"
        assert body["year_parity"] == "paire"
        assert body["segments"][0]["parent"] == "A"
        assert timeline(body)["2027-01-03"] == "B"

    def test_zones_differ_for_hiver_and_printemps(self, client):
        for period in ("hiver", "printemps"):
            starts = {z: split(client, zone=z, period=period, year=2027).json()["period"]["start"] for z in "ABC"}
            assert len(set(starts.values())) == 3, starts
        assert split(client, zone="A", period="hiver", year=2027).json()["period"]["start"] == "2027-02-07"
        assert split(client, zone="C", period="hiver", year=2027).json()["period"]["start"] == "2027-02-21"
        # Toussaint identique partout
        assert len({split(client, zone=z).json()["period"]["start"] for z in "ABC"}) == 1

    def test_summer_end_from_next_rentree(self, client):
        body = split(client, period="ete", year=2027).json()
        assert body["period"]["start"] == "2027-07-04" and body["period"]["end"] == "2027-08-31"

    def test_same_result_as_household_calendar(self, client, auth_headers):
        """Même moteur que l'app : un foyer réel donne la même répartition."""
        headers1, user1, headers2, user2, h = setup_family(client, auth_headers)
        client.put(
            f"/api/households/{h['id']}/custody-rule",
            json={"pattern": "alternate_weeks", "start_date": "2026-01-05", "reference_parent_id": user1["id"]},
            headers=headers1,
        )
        client.put(
            f"/api/households/{h['id']}/vacation-rule",
            json={"mode": "split_half", "even_year_first_half_parent_id": user1["id"]},
            headers=headers1,
        )
        cal = client.get(
            f"/api/households/{h['id']}/calendar",
            params={"start": "2026-10-17", "end": "2026-11-01"}, headers=headers1,
        ).json()
        to_letter = {user1["id"]: "A", user2["id"]: "B"}
        app_days = {d["date"]: to_letter[d["parent_id"]] for d in cal["days"]}
        assert timeline(split(client, zone=h["school_zone"]).json()) == app_days

    @pytest.mark.parametrize("params", [
        {"zone": "D"}, {"period": "paques"}, {"mode": "moitie"}, {"even_first": "C"},
        {"year": "abc"}, {"year": 2031}, {"year": 2025},
    ])
    def test_invalid_params_422(self, client, params):
        assert split(client, **params).status_code == 422

    def test_missing_zone_422(self, client):
        assert client.get(URL, params={"period": "toussaint", "year": 2026}).status_code == 422

    def test_gov_data_unavailable_503(self, client, monkeypatch):
        monkeypatch.setattr(public_holidays, "_transport", httpx.MockTransport(lambda r: httpx.Response(500)))
        resp = split(client)
        assert resp.status_code == 503
        assert "indisponible" in resp.json()["detail"]

    def test_not_published_404(self, client, monkeypatch):
        monkeypatch.setattr(
            public_holidays, "_transport", httpx.MockTransport(lambda r: httpx.Response(200, json={"results": []}))
        )
        assert split(client, year=2027).status_code == 404

    def test_cached(self, client, monkeypatch):
        assert split(client).status_code == 200
        monkeypatch.setattr(public_holidays, "_transport", httpx.MockTransport(lambda r: httpx.Response(500)))
        assert split(client).status_code == 200  # servi depuis le cache

    def test_rate_limited(self, client, monkeypatch):
        monkeypatch.setattr(settings, "rate_limit_enabled", True)
        codes = [split(client).status_code for _ in range(31)]
        assert codes[:30] == [200] * 30
        assert codes[30] == 429

    def test_no_auth_required(self, client):
        assert split(client).status_code == 200


class TestToolPage:
    def test_renders_without_params(self, client):
        resp = client.get(PAGE)
        assert resp.status_code == 200
        html = resp.text
        assert "<h1>Qui a les enfants" in html
        assert '<form class="tool-form" method="get"' in html
        assert '"@type": "FAQPage"' in html
        assert '<link rel="canonical" href="' in html and PAGE in html
        # défaut : la prochaine période (Toussaint 2026 au 27/09/2026)
        assert '<option value="toussaint-2026" selected' in html
        assert "Votre résultat s'affichera ici" in html
        assert "utm_campaign=toussaint-2026" in html
        assert "/static/outil-vacances.js" in html
        # les prénoms ne sont jamais envoyés : champs sans attribut name
        assert 'id="f-name-a" type="text"' in html and 'name="parent_a"' not in html

    def test_renders_result_with_params(self, client):
        resp = client.get(PAGE, params={"zone": "B", "vacances": "toussaint-2026", "mode": "split_half", "even_first": "A"})
        assert resp.status_code == 200
        html = resp.text
        assert "Du sam. 17 oct. au sam. 24 oct." in html
        assert "Du dim. 25 oct. au dim. 1er nov." in html
        assert "Passage de bras&nbsp;: dim. 25 oct.</strong>" in html
        assert "lun. 2 nov." in html
        assert html.count('class="tl-day') == 16

    def test_missing_zone_message(self, client):
        html = client.get(PAGE, params={"vacances": "toussaint-2026", "mode": "split_half", "even_first": "A"}).text
        assert "Choisissez la zone scolaire" in html

    def test_gov_unavailable_graceful(self, client, monkeypatch):
        monkeypatch.setattr(public_holidays, "_transport", httpx.MockTransport(lambda r: httpx.Response(500)))
        resp = client.get(PAGE, params={"zone": "B", "vacances": "toussaint-2026", "mode": "split_half", "even_first": "A"})
        assert resp.status_code == 200
        assert "momentanément indisponible" in resp.text

    def test_outils_redirects(self, client):
        resp = client.get("/outils", follow_redirects=False)
        assert resp.status_code == 302 and resp.headers["location"] == PAGE

    def test_linked_from_landing_footer_and_guides(self, client):
        assert PAGE in client.get("/").text
        assert f'href="{PAGE}"' in client.get("/blog").text  # pied de page « Outils »
        for slug in (
            "partage-vacances-scolaires-annees-paires-impaires",
            "zones-abc-calendrier-scolaire-parents-separes",
            "noel-fetes-anniversaires-garde-alternee",
            "vacances-toussaint-2026-garde-alternee",
        ):
            assert f"({PAGE}" in next(a for a in load_articles() if a.slug == slug).body_md, slug


class TestSeo:
    def test_sitemap_and_llms(self, client):
        assert f"{PAGE}</loc>" in client.get("/sitemap.xml").text
        assert PAGE in client.get("/llms.txt").text

    def test_toussaint_guide_published(self, client):
        slugs = [a.slug for a in load_articles()]
        assert "vacances-toussaint-2026-garde-alternee" in slugs
        assert len(slugs) == 11
        resp = client.get("/blog/vacances-toussaint-2026-garde-alternee")
        assert resp.status_code == 200 and "Toussaint 2026" in resp.text
