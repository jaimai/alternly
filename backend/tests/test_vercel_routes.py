"""Chaque page du site marketing doit être relayée par Vercel vers le backend.

Sur le domaine public, Vercel sert la SPA par défaut : une page ajoutée côté
FastAPI mais oubliée dans frontend/vercel.json affiche « Page introuvable »."""
import json
import re
from pathlib import Path

from app.routers.marketing import router

VERCEL = Path(__file__).resolve().parents[2] / "frontend" / "vercel.json"
RAILWAY = "web-production-d1aa3.up.railway.app"


def _proxied_patterns() -> list[re.Pattern]:
    routes = json.loads(VERCEL.read_text())["routes"]
    return [re.compile(f"^{r['src']}$") for r in routes if RAILWAY in r.get("dest", "")]


def test_every_marketing_page_is_proxied_by_vercel():
    patterns = _proxied_patterns()
    paths = sorted({re.sub(r"\{[^}]+\}", "exemple", route.path) for route in router.routes})
    missing = [p for p in paths if not any(rx.match(p) for rx in patterns)]
    assert missing == [], f"Pages absentes de frontend/vercel.json : {missing}"


def test_tarif_singular_redirects_to_tarifs():
    routes = json.loads(VERCEL.read_text())["routes"]
    redirect = next(r for r in routes if r.get("src") == "/tarif")
    assert redirect["status"] == 308 and redirect["headers"]["Location"] == "/tarifs"
