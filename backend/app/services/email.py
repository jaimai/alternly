"""Envoi d'e-mails transactionnels via l'API Resend.

Sans `resend_api_key`, `send_email` est un no-op : l'application tourne
normalement, seuls les e-mails ne partent pas. Aucune erreur réseau ne doit
remonter dans une requête utilisateur (fire-and-forget).
"""
import html
import logging

import httpx

from ..config import settings

logger = logging.getLogger("coparent.email")

RESEND_ENDPOINT = "https://api.resend.com/emails"

# Injectable en test (httpx.MockTransport) ; None → transport réseau réel.
_transport: httpx.BaseTransport | None = None


def send_email(to: str, subject: str, html: str) -> bool:
    """Envoie un e-mail. Retourne True si accepté par Resend, False sinon."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY absente — e-mail « %s » vers %s non envoyé", subject, to)
        return False
    try:
        with httpx.Client(transport=_transport, timeout=10) as client:
            resp = client.post(
                RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={"from": settings.email_from, "to": [to], "subject": subject, "html": html},
            )
        if resp.status_code >= 400:
            logger.warning("Resend a répondu %s pour l'e-mail vers %s : %s", resp.status_code, to, resp.text)
            return False
        return True
    except httpx.HTTPError as exc:  # réseau indisponible, timeout…
        logger.warning("Échec d'envoi e-mail vers %s : %s", to, exc)
        return False


def _button(label: str, path: str) -> str:
    url = f"{settings.app_url.rstrip('/')}{path}"
    return (
        f'<a href="{url}" style="display:inline-block;background:#1f4d3f;color:#fff;'
        f'padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">{label}</a>'
    )


def _layout(intro: str, cta_label: str, cta_path: str) -> str:
    return (
        '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;'
        'color:#24312b;line-height:1.6">'
        '<p style="font-size:1.3rem;font-weight:600">altern<span style="color:#1f4d3f">ly</span></p>'
        f"<p>{intro}</p>"
        f'<p style="margin:24px 0">{_button(cta_label, cta_path)}</p>'
        '<p style="color:#5d6b63;font-size:0.85rem">Vous recevez cet e-mail car votre coparent utilise '
        "Alternly. Vous pouvez couper ces e-mails dans vos réglages.</p>"
        "</div>"
    )


def _fmt_range(date_start: str, date_end: str) -> str:
    return date_start if date_start == date_end else f"du {date_start} au {date_end}"


def exchange_proposed_email(payload: dict) -> tuple[str, str]:
    """(sujet, html) pour une nouvelle proposition d'échange reçue."""
    period = _fmt_range(payload["date_start"], payload["date_end"])
    # `note` est saisie librement par un parent → échapper avant interpolation HTML.
    raw_note = payload.get("note")
    note = f" Note : « {html.escape(raw_note)} »." if raw_note else ""
    intro = (
        f"Votre coparent vous propose un échange de garde ({period})." + note +
        " Ouvrez Alternly pour l'accepter ou le refuser."
    )
    return "Nouvelle proposition d'échange de garde", _layout(intro, "Voir la proposition", "/")


def exchange_reminder_email(payload: dict) -> tuple[str, str]:
    """(sujet, html) pour le rappel la veille de l'expiration."""
    period = _fmt_range(payload["date_start"], payload["date_end"])
    intro = (
        f"Une proposition d'échange de garde ({period}) attend toujours votre réponse et "
        "expirera demain si elle n'est pas traitée."
    )
    return "Rappel : une proposition d'échange expire demain", _layout(intro, "Répondre maintenant", "/")
