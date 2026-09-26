"""Abonnement Stripe : statut, Checkout, portail client et webhook.

Le webhook n'a ni authentification ni limitation de débit : il est authentifié
par la signature Stripe (en-tête Stripe-Signature) sur le corps brut.
"""
import json
from datetime import timedelta, timezone

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..db import get_db
from ..models import StripeEvent, User, utcnow
from ..schemas import BillingStatusOut, BillingUrlOut
from ..services import billing as billing_service

router = APIRouter(prefix="/api/billing", tags=["billing"])

UNAVAILABLE = "Paiement indisponible"
# Demande expresse d'exécution immédiate et renoncement au droit de rétractation
# (art. L. 221-25 et L. 221-28 du Code de la consommation), affichés sous le
# bouton de paiement Checkout : valider vaut accord exprès. Voir les CGV (§ 6).
WITHDRAWAL_NOTICE = (
    "En validant, vous demandez l'accès immédiat au service. Vous pouvez vous rétracter "
    "pendant 14 jours : seule la période déjà écoulée reste due (art. L. 221-25 du Code de la "
    "consommation). Vous renoncez à ce droit une fois le service pleinement exécuté "
    "(art. L. 221-28). Sans engagement : résiliable à tout moment depuis l'app."
)
# Règle Stripe : trial_end doit être au moins 48 h dans le futur.
_MIN_TRIAL_END = timedelta(hours=48)


def _require_enabled() -> None:
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail=UNAVAILABLE)


def _return_url(suffix: str = "") -> str:
    return f"{settings.app_url.rstrip('/')}/billing{suffix}"


@router.get("/status", response_model=BillingStatusOut)
def billing_status(user: User = Depends(get_current_user)):
    return billing_service.status_payload(user)


@router.post("/checkout", response_model=BillingUrlOut)
def create_checkout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _require_enabled()
    if billing_service.compute_status(user) in {"active", "past_due"}:
        raise HTTPException(status_code=409, detail="Vous avez déjà un abonnement en cours")
    try:
        if not user.stripe_customer_id:
            customer = stripe.Customer.create(
                email=user.email,
                name=user.display_name,
                metadata={"user_id": str(user.id)},
                api_key=settings.stripe_secret_key,
            )
            user.stripe_customer_id = customer.id
            db.commit()  # client Stripe créé une seule fois, même si la suite échoue
        subscription_data: dict = {"metadata": {"user_id": str(user.id)}}
        now = utcnow()
        # Payer pendant l'essai ne fait pas perdre les jours restants.
        if user.trial_ends_at is not None and user.trial_ends_at > now + _MIN_TRIAL_END:
            subscription_data["trial_end"] = int(user.trial_ends_at.replace(tzinfo=timezone.utc).timestamp())
        params: dict = {
            "mode": "subscription",
            "customer": user.stripe_customer_id,
            "client_reference_id": str(user.id),
            "line_items": [{"price": settings.stripe_price_id, "quantity": 1}],
            "success_url": _return_url("?success=1"),
            "cancel_url": _return_url(),
            "allow_promotion_codes": True,
            "locale": "fr",
            "subscription_data": subscription_data,
            "custom_text": {"submit": {"message": WITHDRAWAL_NOTICE}},
        }
        if settings.stripe_automatic_tax:
            params["automatic_tax"] = {"enabled": True}
            params["customer_update"] = {"address": "auto", "name": "auto"}
        session = stripe.checkout.Session.create(api_key=settings.stripe_secret_key, **params)
    except stripe.StripeError:
        raise HTTPException(status_code=502, detail=UNAVAILABLE)
    return {"url": session.url}


@router.post("/portal", response_model=BillingUrlOut)
def create_portal(user: User = Depends(get_current_user)):
    _require_enabled()
    if not user.stripe_customer_id:
        raise HTTPException(status_code=409, detail="Aucun abonnement à gérer")
    try:
        session = stripe.billing_portal.Session.create(
            customer=user.stripe_customer_id,
            return_url=_return_url(),
            api_key=settings.stripe_secret_key,
        )
    except stripe.StripeError:
        raise HTTPException(status_code=502, detail=UNAVAILABLE)
    return {"url": session.url}


def _process_event(db: Session, payload: bytes) -> dict:
    # Signature déjà vérifiée : on lit le JSON brut (indépendant de la version
    # de la bibliothèque et de ses objets).
    event = json.loads(payload)
    event_id = event.get("id")
    if not event_id:
        raise HTTPException(status_code=400, detail="Événement invalide")
    if db.get(StripeEvent, event_id) is not None:
        return {"received": True, "duplicate": True}
    billing_service.handle_event(db, event)
    db.add(StripeEvent(id=event_id, type=event.get("type") or ""))
    try:
        db.commit()
    except IntegrityError:  # même événement traité en parallèle
        db.rollback()
        return {"received": True, "duplicate": True}
    return {"received": True}


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail=UNAVAILABLE)
    payload = await request.body()  # corps brut : indispensable à la vérification de signature
    signature = request.headers.get("stripe-signature")
    try:
        stripe.Webhook.construct_event(payload, signature, settings.stripe_webhook_secret)
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Signature invalide")
    return await run_in_threadpool(_process_event, db, payload)
