#!/usr/bin/env python3
"""Crée / met à jour les tableaux de bord, insights, actions et cohortes PostHog d'Alternly.

« Dashboards as code » : idempotent par nom (liste puis création ou mise à jour).
Script autonome (bibliothèque standard uniquement).

Variables d'environnement :
  POSTHOG_PERSONAL_API_KEY  clé personnelle (phx_…) — scopes : insight, dashboard,
                            action, cohort en écriture ; project en lecture
  POSTHOG_PROJECT_ID        identifiant numérique du projet (URL : /project/<id>/)
  POSTHOG_APP_HOST          défaut https://eu.posthog.com

Usage :
  python scripts/posthog_setup.py --dry-run   # affiche les payloads, aucun appel réseau
  python scripts/posthog_setup.py             # applique
Voir docs/analytics.md.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

LANDING_PATHS = ["/", "/en"]

# ---------------------------------------------------------------------------- client REST


class PostHogAPI:
    def __init__(self, host: str, project_id: str, api_key: str, dry_run: bool) -> None:
        self.base = f"{host.rstrip('/')}/api/projects/{project_id}"
        self.api_key = api_key
        self.dry_run = dry_run
        self._fake_id = 0

    def _request(self, method: str, url: str, payload: dict | None = None) -> Any:
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            raise SystemExit(f"Erreur PostHog {e.code} sur {method} {url} :\n{detail}") from None

    def list_all(self, resource: str, extra: str = "") -> list[dict]:
        if self.dry_run:
            return []
        out: list[dict] = []
        url: str | None = f"{self.base}/{resource}/?limit=200{extra}"
        while url:
            page = self._request("GET", url)
            out.extend(page.get("results", []))
            url = page.get("next")
        return [r for r in out if not r.get("deleted")]

    def upsert(self, resource: str, payload: dict, existing: list[dict]) -> dict:
        """Crée la ressource, ou la met à jour si une ressource du même nom existe."""
        match = next((r for r in existing if r.get("name") == payload["name"]), None)
        if self.dry_run:
            self._fake_id += 1
            verb = "PATCH" if match else "POST"
            print(f"\n### {verb} {resource} — {payload['name']}")
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            return {"id": self._fake_id, **payload}
        if match:
            res = self._request("PATCH", f"{self.base}/{resource}/{match['id']}/", payload)
            print(f"  ↻ {resource} mis à jour : {payload['name']}")
        else:
            res = self._request("POST", f"{self.base}/{resource}/", payload)
            print(f"  + {resource} créé : {payload['name']}")
        existing.append(res)
        return res


# ---------------------------------------------------------------------------- briques de requêtes


def ev(event: str, math: str = "total", props: list[dict] | None = None, name: str | None = None, **extra) -> dict:
    node = {"kind": "EventsNode", "event": event, "name": name or event, "math": math}
    if props:
        node["properties"] = props
    node.update(extra)
    return node


def action(action_id: int, name: str, math: str = "total") -> dict:
    return {"kind": "ActionsNode", "id": action_id, "name": name, "math": math}


def prop(key: str, value: Any, operator: str = "exact", type_: str = "event") -> dict:
    return {"key": key, "value": value, "operator": operator, "type": type_}


def trends(series: list[dict], *, interval: str = "day", date_from: str = "-30d", breakdown: str | None = None,
           breakdown_type: str = "event", display: str = "ActionsLineGraph", formula: str | None = None) -> dict:
    source: dict[str, Any] = {
        "kind": "TrendsQuery",
        "series": series,
        "interval": interval,
        "dateRange": {"date_from": date_from},
        "filterTestAccounts": True,
        "trendsFilter": {"display": display},
    }
    if formula:
        source["trendsFilter"]["formula"] = formula
    if breakdown:
        source["breakdownFilter"] = {"breakdown": breakdown, "breakdown_type": breakdown_type, "breakdown_limit": 15}
    return {"kind": "InsightVizNode", "source": source}


def funnel(series: list[dict], *, window_days: int = 14, date_from: str = "-90d", viz: str = "steps",
           breakdown: str | None = None, group_index: int | None = None) -> dict:
    source: dict[str, Any] = {
        "kind": "FunnelsQuery",
        "series": series,
        "dateRange": {"date_from": date_from},
        "filterTestAccounts": True,
        "funnelsFilter": {
            "funnelVizType": viz,
            "funnelOrderType": "ordered",
            "funnelWindowInterval": window_days,
            "funnelWindowIntervalUnit": "day",
        },
    }
    if breakdown:
        source["breakdownFilter"] = {"breakdown": breakdown, "breakdown_type": "event"}
    if group_index is not None:
        # Agrégé par foyer (groupe « household ») : les étapes sont faites par des parents différents.
        source["aggregation_group_type_index"] = group_index
    return {"kind": "InsightVizNode", "source": source}


def retention(target_event: str, returning: dict, *, periods: int = 8) -> dict:
    return {
        "kind": "InsightVizNode",
        "source": {
            "kind": "RetentionQuery",
            "dateRange": {"date_from": f"-{periods}w"},
            "filterTestAccounts": True,
            "retentionFilter": {
                "targetEntity": {"id": target_event, "name": target_event, "type": "events"},
                "returningEntity": returning,
                "retentionType": "retention_first_time",
                "totalIntervals": periods,
                "period": "Week",
            },
        },
    }


def stickiness(series: list[dict], *, date_from: str = "-30d") -> dict:
    return {
        "kind": "InsightVizNode",
        "source": {
            "kind": "StickinessQuery",
            "series": series,
            "interval": "day",
            "dateRange": {"date_from": date_from},
            "filterTestAccounts": True,
        },
    }


# ---------------------------------------------------------------------------- définitions

# Actions (composites réutilisables dans les insights).
ACTIVE_EVENTS = [
    "exchange_proposed", "exchange_accepted", "exchange_refused", "change_request_created",
    "expense_added", "settlement_recorded", "wall_post_created", "wall_reply_created",
    "task_completed", "calendar_navigated", "notification_opened", "history_viewed",
]
ACTIONS = [
    {
        "name": "Action clé (utilisateur actif)",
        "description": "Toute action produit significative dans l'app (hors simple page vue).",
        "steps": [{"event": e} for e in ACTIVE_EVENTS],
    },
    {
        "name": "Visite de la landing",
        "description": "Page vue sur la landing FR (/) ou EN (/en).",
        "steps": [
            {"event": "$pageview", "url": "^https?://[^/]+/(en)?/?(\\?.*)?$", "url_matching": "regex"},
        ],
    },
]


def cohorts() -> list[dict]:
    def behavioral(event: str, days: int = 3650) -> dict:
        return {
            "key": event, "type": "behavioral", "value": "performed_event", "event_type": "events",
            "time_value": days, "time_interval": "day", "negation": False,
        }

    def person(key: str, value: Any) -> dict:
        return {"key": key, "type": "person", "value": value, "operator": "exact", "negation": False}

    def filters(*values: dict) -> dict:
        return {"properties": {"type": "OR", "values": [{"type": "AND", "values": list(values)}]}}

    return [
        {"name": "Foyers activés",
         "description": "Parents ayant rejoint un foyer par invitation : foyer à deux parents (partner_joined).",
         "filters": filters(behavioral("partner_joined")), "is_static": False},
        {"name": "Premium", "description": "Accès premium actif (propriété is_premium).",
         "filters": filters(person("is_premium", [True])), "is_static": False},
        {"name": "Inscrits Google", "description": "Compte créé ou relié via « Continuer avec Google ».",
         "filters": filters(person("auth_method", ["google"])), "is_static": False},
        {"name": "US users", "description": "Foyer aux États-Unis (propriété country = US).",
         "filters": filters(person("country", ["US"])), "is_static": False},
    ]


def dashboards(action_ids: dict[str, int], household: int) -> list[dict]:
    active = action(action_ids["Action clé (utilisateur actif)"], "Action clé (utilisateur actif)")
    landing_pv = ev("$pageview", "dau", [prop("$pathname", LANDING_PATHS)], name="Visiteurs landing")
    return [
        {
            "name": "Acquisition",
            "description": "D'où viennent les visiteurs et combien s'inscrivent.",
            "insights": [
                ("Visiteurs uniques landing par source UTM", trends([landing_pv], breakdown="utm_source")),
                ("Visiteurs uniques landing par domaine référent", trends([landing_pv], breakdown="$referring_domain")),
                ("Visiteurs uniques landing par langue", trends([landing_pv], breakdown="site_lang")),
                ("Clics CTA landing par emplacement", trends([ev("landing_cta_clicked")], breakdown="location")),
                ("Inscriptions par méthode", trends([ev("user_signed_up")], interval="week", date_from="-90d", breakdown="method")),
                ("Inscriptions par langue", trends([ev("user_signed_up")], interval="week", date_from="-90d", breakdown="locale")),
                ("Foyers créés par pays", trends([ev("household_created")], interval="week", date_from="-90d", breakdown="country")),
                ("Articles de blog vus", trends([ev("blog_article_viewed")], date_from="-90d", breakdown="slug", display="ActionsBarValue")),
                ("Funnel landing → CTA → inscription", funnel([
                    ev("$pageview", props=[prop("$pathname", LANDING_PATHS)], name="Landing vue"),
                    ev("landing_cta_clicked"),
                    ev("signed_up"),
                ], window_days=1, date_from="-30d")),
            ],
        },
        {
            "name": "Activation",
            "description": "De l'inscription au foyer à deux parents actif.",
            "insights": [
                ("Funnel inscription → onboarding (14 j)", funnel([
                    ev("signed_up"), ev("onboarding_completed"), ev("invite_created"),
                ], window_days=14)),
                ("Funnel activation par foyer (14 j)", funnel([
                    ev("household_created"), ev("onboarding_completed"), ev("invite_created"), ev("partner_joined"),
                ], window_days=14, group_index=household)),
                ("Temps d'activation (foyer créé → 2e parent)", funnel([
                    ev("household_created"), ev("partner_joined"),
                ], window_days=30, viz="time_to_convert", group_index=household)),
                ("% foyers à deux parents", trends(
                    [ev("household_created"), ev("partner_joined")],
                    date_from="-90d", formula="B / A * 100", display="BoldNumber",
                )),
                ("Premier échange proposé sous 7 jours", funnel([
                    ev("signed_up"), ev("exchange_proposed"),
                ], window_days=7)),
                ("Étapes d'onboarding", trends([ev("onboarding_step_completed")], breakdown="step", display="ActionsBarValue")),
            ],
        },
        {
            "name": "Engagement & rétention",
            "description": "Usage récurrent et fonctionnalités utilisées.",
            "insights": [
                ("DAU / WAU / MAU", trends([
                    ev("$pageview", "dau", name="DAU"),
                    ev("$pageview", "weekly_active", name="WAU"),
                    ev("$pageview", "monthly_active", name="MAU"),
                ], date_from="-90d")),
                ("Stickiness (jours actifs / mois)", stickiness([active])),
                ("Rétention hebdo : inscription → action clé", retention(
                    "signed_up", {"id": action_ids["Action clé (utilisateur actif)"], "type": "actions",
                                  "name": "Action clé (utilisateur actif)"},
                )),
                ("Usage des fonctionnalités", trends([
                    ev("exchange_proposed"), ev("expense_added"), ev("wall_post_created"),
                    ev("ical_link_generated"), ev("history_viewed"),
                ], interval="week", date_from="-90d")),
                ("Synchro agenda réelle (appels iCal estimés)", trends(
                    [ev("ical_feed_polled")], interval="week", date_from="-90d", formula="A * 20",
                )),
                ("Notifications ouvertes par type", trends([ev("notification_opened")], breakdown="type")),
            ],
        },
        {
            "name": "Monétisation",
            "description": "Du paywall à l'abonnement, churn et mix d'offres.",
            "insights": [
                ("Funnel paywall → abonnement", funnel([
                    ev("paywall_viewed"), ev("checkout_opened"), ev("checkout_completed"), ev("subscription_activated"),
                ], window_days=7)),
                ("Paywall vu par fonctionnalité", trends([ev("paywall_viewed")], breakdown="feature")),
                ("Nouveaux abonnements par offre (proxy MRR)", trends(
                    [ev("subscription_activated")], interval="week", date_from="-180d", breakdown="plan",
                )),
                ("Revenu des nouveaux abonnements", trends(
                    [ev("subscription_activated", "sum", math_property="amount")],
                    interval="month", date_from="-365d", breakdown="currency",
                )),
                ("Churn : résiliations", trends([ev("subscription_canceled")], interval="week", date_from="-180d")),
                ("Impayés", trends([ev("subscription_past_due")], interval="week", date_from="-180d")),
                ("Mix d'offres", trends([ev("subscription_activated")], date_from="-365d", breakdown="plan", display="ActionsPie")),
            ],
        },
        {
            "name": "Santé technique",
            "description": "Erreurs front et serveur, logs, synchro iCal.",
            "insights": [
                ("Exceptions par type", trends([ev("$exception")], breakdown="$exception_types")),
                ("Exceptions front par page", trends([ev("$exception", props=[prop("$lib", ["web"])])], breakdown="$pathname")),
                ("Erreurs API (serveur) par route", trends(
                    [ev("$exception", props=[prop("$lib", ["posthog-python"])])], breakdown="path",
                )),
                ("Logs serveur par niveau", trends([ev("server_log")], breakdown="level")),
                ("Appels du flux iCal (échantillon 1/20)", trends([ev("ical_feed_polled")])),
            ],
        },
    ]


# ---------------------------------------------------------------------------- main


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="affiche les payloads sans appeler PostHog")
    args = parser.parse_args()

    host = os.environ.get("POSTHOG_APP_HOST", "https://eu.posthog.com")
    project_id = os.environ.get("POSTHOG_PROJECT_ID", "")
    api_key = os.environ.get("POSTHOG_PERSONAL_API_KEY", "")
    if not args.dry_run and not (project_id and api_key):
        print("POSTHOG_PERSONAL_API_KEY et POSTHOG_PROJECT_ID sont requis (ou --dry-run).", file=sys.stderr)
        return 2
    api = PostHogAPI(host, project_id or "<project_id>", api_key, args.dry_run)

    print("Actions…")
    existing_actions = api.list_all("actions")
    action_ids = {a["name"]: api.upsert("actions", a, existing_actions)["id"] for a in ACTIONS}

    print("Cohortes…")
    existing_cohorts = api.list_all("cohorts")
    for c in cohorts():
        api.upsert("cohorts", c, existing_cohorts)

    household = 0
    if not args.dry_run:
        types = api._request("GET", f"{api.base}/groups_types/") or []
        found = next((t for t in types if t.get("group_type") == "household"), None)
        if found is None:
            print("  ! type de groupe « household » encore inconnu (aucun événement reçu) : index 0 supposé.")
        else:
            household = found["group_type_index"]

    print("Tableaux de bord…")
    existing_dashboards = api.list_all("dashboards")
    existing_insights = api.list_all("insights", "&basic=true")
    for d in dashboards(action_ids, household):
        dash = api.upsert("dashboards", {"name": d["name"], "description": d["description"]}, existing_dashboards)
        for name, query in d["insights"]:
            api.upsert("insights", {
                "name": name,
                "query": query,
                "dashboards": [dash["id"]],
                "saved": True,
            }, existing_insights)

    print("\nTerminé." if not args.dry_run else "\n(dry-run : rien n'a été envoyé)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
