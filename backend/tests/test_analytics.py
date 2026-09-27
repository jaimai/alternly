"""Analytics PostHog côté serveur : no-op sans jeton, consentement, événements métier."""
import json
import logging
import uuid

import pytest

from app.services import analytics, billing

from .test_billing import _signed


class Spy:
    def __init__(self):
        self.calls: list[dict] = []

    def __call__(self, distinct_id, event, properties, groups):
        self.calls.append({"distinct_id": distinct_id, "event": event, "properties": properties, "groups": groups})

    def events(self, name):
        return [c for c in self.calls if c["event"] == name]


@pytest.fixture
def spy(monkeypatch):
    s = Spy()
    monkeypatch.setattr(analytics.settings, "posthog_token", "phc_test")
    monkeypatch.setattr(analytics, "_send", s)
    return s


def _is_uuid(v: str) -> bool:
    try:
        uuid.UUID(v)
        return True
    except ValueError:
        return False


class TestWrapper:
    def test_noop_without_token(self, monkeypatch):
        s = Spy()
        monkeypatch.setattr(analytics, "_send", s)
        assert analytics.settings.posthog_token == ""
        analytics.capture("1", "evt")
        analytics.capture_sampled("evt", rate=1)
        analytics.capture_exception(RuntimeError("x"))
        assert s.calls == []
        assert analytics._get_client() is None

    def test_anonymous_event_has_no_profile_and_no_groups(self, spy):
        analytics.capture(None, "evt", {"a": 1}, groups={"household": "3"})
        call = spy.calls[0]
        assert _is_uuid(call["distinct_id"])
        assert call["properties"]["$process_person_profile"] is False
        assert call["groups"] is None

    def test_user_with_consent_is_identified(self, spy):
        class U:
            id = 42
            analytics_consent = True

        analytics.capture_for_user(U(), "evt", {"x": "y"}, household_id=7)
        call = spy.calls[0]
        assert call["distinct_id"] == "42"
        assert call["groups"] == {"household": "7"}
        assert "$process_person_profile" not in call["properties"]

    @pytest.mark.parametrize("consent", [None, False])
    def test_user_without_consent_is_anonymous(self, spy, consent):
        class U:
            id = 42
            analytics_consent = consent

        analytics.capture_for_user(U(), "evt", {"x": "y"}, household_id=7)
        call = spy.calls[0]
        assert call["distinct_id"] != "42" and _is_uuid(call["distinct_id"])
        assert call["groups"] is None
        assert call["properties"]["$process_person_profile"] is False

    def test_send_failure_never_raises(self, monkeypatch):
        monkeypatch.setattr(analytics.settings, "posthog_token", "phc_test")

        def boom(*a, **k):
            raise ConnectionError("down")

        monkeypatch.setattr(analytics, "_send", boom)
        analytics.capture("1", "evt")  # ne lève pas

    def test_scrub_path_hides_secrets(self):
        assert analytics.scrub_path("/api/ical/abcdef.ics") == "/api/ical/[filtré]"
        assert analytics.scrub_path("/api/invitations/tok123/accept") == "/api/invitations/[filtré]/accept"
        assert analytics.scrub_path("/join/tok?x=1") == "/join/[filtré]"

    def test_log_handler_rate_limited_and_scrubbed(self, spy):
        handler = analytics.PostHogLogHandler(max_per_minute=2)
        logger = logging.getLogger("coparent.test_analytics")
        for _ in range(5):
            handler.emit(logger.makeRecord(logger.name, logging.WARNING, __file__, 1,
                                           "échec pour jean@example.com", (), None))
        logs = spy.events("server_log")
        assert len(logs) == 2
        assert "jean@example.com" not in logs[0]["properties"]["message"]
        assert logs[0]["properties"]["level"] == "WARNING"


class TestConsentApi:
    def test_patch_me_analytics_consent(self, client, auth_headers):
        headers, user = auth_headers()
        assert user["analytics_consent"] is None
        assert user["auth_method"] == "email"
        r = client.patch("/api/auth/me", json={"analytics_consent": True}, headers=headers)
        assert r.status_code == 200 and r.json()["analytics_consent"] is True
        r = client.patch("/api/auth/me", json={"analytics_consent": False}, headers=headers)
        assert r.json()["analytics_consent"] is False
        # Un PATCH sans le champ ne touche pas au choix.
        r = client.patch("/api/auth/me", json={"locale": "en"}, headers=headers)
        assert r.json()["analytics_consent"] is False

    def test_register_with_consent_is_identified(self, client, spy):
        r = client.post("/api/auth/register", json={
            "email": "a@test.fr", "password": "motdepasse1", "display_name": "A",
            "analytics_consent": True, "via_invite": True,
        })
        assert r.status_code == 201
        uid = r.json()["user"]["id"]
        (ev,) = spy.events("user_signed_up")
        assert ev["distinct_id"] == str(uid)
        assert ev["properties"]["method"] == "email"
        assert ev["properties"]["via_invite"] is True
        # Jamais de donnée d'identification.
        assert "a@test.fr" not in json.dumps(ev)

    def test_register_without_consent_is_anonymous(self, client, spy):
        r = client.post("/api/auth/register", json={
            "email": "b@test.fr", "password": "motdepasse1", "display_name": "B",
        })
        uid = r.json()["user"]["id"]
        (ev,) = spy.events("user_signed_up")
        assert ev["distinct_id"] != str(uid)
        assert ev["properties"]["$process_person_profile"] is False

    def test_household_and_partner_events(self, client, auth_headers, spy):
        h1, u1 = auth_headers("p1@test.fr")
        client.patch("/api/auth/me", json={"analytics_consent": True}, headers=h1)
        hh = client.post("/api/households", json={"name": "Foyer", "school_zone": "A"}, headers=h1).json()
        (created,) = spy.events("household_created")
        assert created["distinct_id"] == str(u1["id"])
        assert created["groups"] == {"household": str(hh["id"])}
        assert created["properties"]["country"] == "FR"

        inv = client.post(f"/api/households/{hh['id']}/invitations", headers=h1).json()
        h2, _ = auth_headers("p2@test.fr", name="Alex")
        r = client.post(f"/api/invitations/{inv['token']}/accept", headers=h2)
        assert r.status_code == 200, r.text
        (joined,) = spy.events("partner_joined")
        assert joined["properties"]["$process_person_profile"] is False  # p2 n'a pas consenti


class TestBillingEvents:
    def _post(self, client, event):
        sig, raw = _signed(event, "sk_test")
        return client.post("/api/billing/webhook", content=raw, headers={"Paddle-Signature": sig})

    def test_webhook_emits_subscription_events(self, client, auth_headers, spy, monkeypatch):
        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        monkeypatch.setattr(billing.settings, "paddle_price_annual", "pri_annual")
        headers, user = auth_headers()
        client.patch("/api/auth/me", json={"analytics_consent": True}, headers=headers)
        data = {
            "id": "sub_1", "customer_id": "ctm_1", "status": "active", "currency_code": "EUR",
            "items": [{"price": {"id": "pri_annual", "unit_price": {"amount": "6900", "currency_code": "EUR"}}}],
            "current_billing_period": {"ends_at": "2027-07-24T00:00:00Z"},
            "custom_data": {"user_id": str(user["id"])},
        }
        r = self._post(client, {"event_id": "evt_1", "event_type": "subscription.activated",
                                "occurred_at": "2026-07-24T00:00:00Z", "data": data})
        assert r.status_code == 200, r.text
        (act,) = spy.events("subscription_activated")
        assert act["distinct_id"] == str(user["id"])
        assert act["properties"] == {"plan": "annual", "currency": "EUR", "amount": 69.0}

        # Même statut (mise à jour sans transition) : pas de nouvel événement.
        self._post(client, {"event_id": "evt_2", "event_type": "subscription.updated",
                            "occurred_at": "2026-07-25T00:00:00Z", "data": data})
        assert len(spy.events("subscription_activated")) == 1

        self._post(client, {"event_id": "evt_3", "event_type": "subscription.updated",
                            "occurred_at": "2026-07-26T00:00:00Z", "data": {**data, "status": "past_due"}})
        assert len(spy.events("subscription_past_due")) == 1

        self._post(client, {"event_id": "evt_4", "event_type": "transaction.completed",
                            "occurred_at": "2026-07-27T00:00:00Z",
                            "data": {"origin": "subscription_recurring", "subscription_id": "sub_1",
                                     "currency_code": "EUR", "items": data["items"],
                                     "details": {"totals": {"grand_total": "6900"}}}})
        assert len(spy.events("subscription_renewed")) == 1

        self._post(client, {"event_id": "evt_5", "event_type": "subscription.canceled",
                            "occurred_at": "2026-07-28T00:00:00Z", "data": {**data, "status": "canceled"}})
        assert len(spy.events("subscription_canceled")) == 1

    def test_duplicate_webhook_not_tracked_twice(self, client, auth_headers, spy, monkeypatch):
        monkeypatch.setattr(billing.settings, "paddle_webhook_secret", "sk_test")
        _, user = auth_headers()
        event = {"event_id": "evt_dup", "event_type": "subscription.activated",
                 "data": {"id": "sub_9", "status": "active", "custom_data": {"user_id": str(user["id"])}}}
        self._post(client, event)
        self._post(client, event)
        assert len(spy.events("subscription_activated")) == 1


class TestErrorTracking:
    def test_unhandled_exception_is_captured(self, client, monkeypatch):
        captured = []
        monkeypatch.setattr(analytics, "capture_exception", lambda exc, props=None: captured.append((exc, props)))
        from app.main import app

        @app.get("/api/__boom_test")
        def boom():
            raise RuntimeError("boom")

        try:
            with pytest.raises(RuntimeError):
                client.get("/api/__boom_test")
        finally:
            app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", "") != "/api/__boom_test"]
        assert captured and isinstance(captured[0][0], RuntimeError)
        assert captured[0][1] == {"method": "GET"}


class TestMarketingSnippet:
    def test_no_snippet_without_token(self, client):
        html = client.get("/").text
        assert "/static/analytics.js" not in html
        assert "data-consent-open" not in html

    @pytest.mark.parametrize("path,lang", [("/", "fr"), ("/en", "en"), ("/privacy", "fr"), ("/en/blog", "en")])
    def test_snippet_and_cookie_link_with_token(self, client, monkeypatch, path, lang):
        monkeypatch.setattr(analytics.settings, "posthog_token", "phc_public")
        html = client.get(path).text
        assert 'src="/static/analytics.js" data-key="phc_public"' in html
        assert f'data-lang="{lang}"' in html
        assert "data-consent-open" in html

    def test_static_script_served(self, client):
        r = client.get("/static/analytics.js")
        assert r.status_code == 200
        assert "alternly_consent" in r.text and "cookieless_mode" in r.text
