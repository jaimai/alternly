"""Offre de bienvenue BIENVENUE20 : paywall vu sans souscription (48 h après),
ou parent actif à J+10–14 qui n'a jamais vu le paywall. Une seule fois."""
from datetime import timedelta

from app.models import User, utcnow
from app.services import lifecycle
from tests.test_invitation_loop import solo_household
from tests.test_lifecycle import age_user, events, kinds, make_premium, props, sent  # noqa: F401


def see_paywall(db, user_id, hours_ago):
    u = db.get(User, user_id)
    u.paywall_seen_at = utcnow() - timedelta(hours=hours_ago)
    db.commit()


def run(db, box=None):
    if box is not None:
        box.clear()  # ignore l'e-mail de bienvenue envoyé à l'inscription
    return lifecycle.run_discount(db, utcnow())


def test_paywall_seen_48h_ago_gets_offer(client, auth_headers, db_session, sent, events):
    _, user, _ = solo_household(client, auth_headers)
    age_user(db_session, user["id"], 5)
    see_paywall(db_session, user["id"], 50)
    assert run(db_session, sent) == {"discount": 1}
    (mail,) = sent
    assert mail["subject"] == "-20 % sur votre première année Alternly Premium"
    assert "BIENVENUE20" in mail["html"] and "55,20 €" in mail["html"]
    assert "/app?offre=BIENVENUE20" in mail["html"] and "/app?offre=BIENVENUE20" in mail["text"]
    assert "discount" in kinds(db_session, user["id"])
    assert any(e[1] == "lifecycle_email_sent" and props(e) == {"kind": "discount", "reason": "paywall"} for e in events)
    # Une seule fois.
    sent.clear()
    assert run(db_session) == {"discount": 0} and sent == []


def test_not_before_48h_nor_before_day_3(client, auth_headers, db_session, sent):
    _, user, _ = solo_household(client, auth_headers)
    age_user(db_session, user["id"], 5)
    see_paywall(db_session, user["id"], 20)  # trop récent
    assert run(db_session) == {"discount": 0}
    age_user(db_session, user["id"], 2)  # compte trop jeune
    see_paywall(db_session, user["id"], 50)
    assert run(db_session) == {"discount": 0}


def test_subscribers_and_old_paywall_views_excluded(client, auth_headers, db_session, sent):
    _, user, _ = solo_household(client, auth_headers)
    age_user(db_session, user["id"], 40)
    see_paywall(db_session, user["id"], 24 * 35)  # vu il y a plus de 30 jours
    assert run(db_session) == {"discount": 0}
    see_paywall(db_session, user["id"], 50)
    make_premium(db_session, user["id"])
    assert run(db_session) == {"discount": 0}


def test_active_parent_without_paywall_at_day_10(client, auth_headers, db_session, sent, events):
    _, user, _ = solo_household(client, auth_headers)  # règle de garde posée
    age_user(db_session, user["id"], 11)
    assert run(db_session) == {"discount": 1}
    assert any(props(e).get("reason") == "active" for e in events if e[1] == "lifecycle_email_sent")


def test_inactive_parent_without_rule_gets_nothing(client, auth_headers, db_session, sent):
    _, user, _ = solo_household(client, auth_headers, with_rule=False)
    age_user(db_session, user["id"], 11)
    assert run(db_session) == {"discount": 0}


def test_opt_out_and_disabled_code(client, auth_headers, db_session, sent, monkeypatch):
    _, user, _ = solo_household(client, auth_headers)
    age_user(db_session, user["id"], 5)
    see_paywall(db_session, user["id"], 50)
    monkeypatch.setattr(lifecycle.settings, "discount_code", "")
    assert run(db_session) == {"discount": 0}
    monkeypatch.setattr(lifecycle.settings, "discount_code", "BIENVENUE20")
    u = db_session.get(User, user["id"])
    u.email_opt_in = False
    db_session.commit()
    assert run(db_session) == {"discount": 0}


def test_english_offer(client, auth_headers, db_session, sent):
    _, user, _ = solo_household(client, auth_headers)
    u = db_session.get(User, user["id"])
    u.locale = "en"
    db_session.commit()
    age_user(db_session, user["id"], 5)
    see_paywall(db_session, user["id"], 50)
    run(db_session, sent)
    assert sent[0]["subject"] == "20% off your first year of Alternly Premium"
    assert "€55.20" in sent[0]["html"]


def test_paywall_seen_endpoint_is_idempotent(client, auth_headers, db_session):
    headers, user = auth_headers()
    assert client.post("/api/billing/paywall-seen", headers=headers).status_code == 200
    first = db_session.get(User, user["id"]).paywall_seen_at
    assert first is not None
    client.post("/api/billing/paywall-seen", headers=headers)
    db_session.expire_all()
    assert db_session.get(User, user["id"]).paywall_seen_at == first
    assert client.post("/api/billing/paywall-seen").status_code == 401
