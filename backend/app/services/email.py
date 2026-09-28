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


def mask_email(address: str) -> str:
    """Adresse masquée pour les logs (RGPD) : jean.dupont@x.fr → j***@x.fr."""
    local, sep, domain = address.partition("@")
    return f"{local[:1]}***{sep}{domain}" if sep else "***"


def send_email(to: str, subject: str, html: str) -> bool:
    """Envoie un e-mail. Retourne True si accepté par Resend, False sinon."""
    if not settings.resend_api_key:
        logger.info("RESEND_API_KEY absente — e-mail « %s » vers %s non envoyé", subject, mask_email(to))
        return False
    try:
        with httpx.Client(transport=_transport, timeout=10) as client:
            resp = client.post(
                RESEND_ENDPOINT,
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={"from": settings.email_from, "to": [to], "subject": subject, "html": html},
            )
        if resp.status_code >= 400:
            logger.warning(
                "Resend a répondu %s pour l'e-mail vers %s : %s", resp.status_code, mask_email(to), resp.text
            )
            return False
        return True
    except httpx.HTTPError as exc:  # réseau indisponible, timeout…
        logger.warning("Échec d'envoi e-mail vers %s : %s", mask_email(to), exc)
        return False


def _lang(locale: str | None) -> str:
    return "en" if locale == "en" else "fr"


def _button(label: str, path: str) -> str:
    url = f"{settings.app_url.rstrip('/')}{path}"
    return (
        f'<a href="{url}" style="display:inline-block;background:#1f4d3f;color:#fff;'
        f'padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">{label}</a>'
    )


_FOOTER_NOTIFS = {
    "fr": (
        "Vous recevez cet e-mail car votre coparent utilise Alternly. "
        "Vous pouvez couper ces e-mails dans vos réglages."
    ),
    "en": (
        "You are receiving this email because your co-parent uses Alternly. "
        "You can turn these emails off in your settings."
    ),
}


def _layout(intro: str, cta_label: str, cta_path: str, footer: str) -> str:
    return (
        '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;'
        'color:#24312b;line-height:1.6">'
        '<p style="font-size:1.3rem;font-weight:600">altern<span style="color:#1f4d3f">ly</span></p>'
        f"<p>{intro}</p>"
        f'<p style="margin:24px 0">{_button(cta_label, cta_path)}</p>'
        f'<p style="color:#5d6b63;font-size:0.85rem">{footer}</p>'
        "</div>"
    )


def _fmt_range(date_start: str, date_end: str, lang: str = "fr") -> str:
    if date_start == date_end:
        return date_start
    return f"{date_start} to {date_end}" if lang == "en" else f"du {date_start} au {date_end}"


def exchange_proposed_email(payload: dict, locale: str | None = "fr") -> tuple[str, str]:
    """(sujet, html) pour une nouvelle proposition d'échange reçue."""
    lang = _lang(locale)
    period = _fmt_range(payload["date_start"], payload["date_end"], lang)
    # `note` est saisie librement par un parent → échapper avant interpolation HTML.
    raw_note = payload.get("note")
    if lang == "en":
        note = f" Note: “{html.escape(raw_note)}”." if raw_note else ""
        intro = (
            f"Your co-parent is proposing a custody swap ({period})." + note +
            " Open Alternly to accept or decline it."
        )
        return "New custody swap proposal", _layout(intro, "View the proposal", "/app", _FOOTER_NOTIFS["en"])
    note = f" Note : « {html.escape(raw_note)} »." if raw_note else ""
    intro = (
        f"Votre coparent vous propose un échange de garde ({period})." + note +
        " Ouvrez Alternly pour l'accepter ou le refuser."
    )
    return "Nouvelle proposition d'échange de garde", _layout(intro, "Voir la proposition", "/app", _FOOTER_NOTIFS["fr"])


def exchange_reminder_email(payload: dict, locale: str | None = "fr") -> tuple[str, str]:
    """(sujet, html) pour le rappel la veille de l'expiration."""
    lang = _lang(locale)
    period = _fmt_range(payload["date_start"], payload["date_end"], lang)
    if lang == "en":
        intro = (
            f"A custody swap proposal ({period}) is still waiting for your answer and "
            "will expire tomorrow if it is not handled."
        )
        return (
            "Reminder: a swap proposal expires tomorrow",
            _layout(intro, "Answer now", "/app", _FOOTER_NOTIFS["en"]),
        )
    intro = (
        f"Une proposition d'échange de garde ({period}) attend toujours votre réponse et "
        "expirera demain si elle n'est pas traitée."
    )
    return (
        "Rappel : une proposition d'échange expire demain",
        _layout(intro, "Répondre maintenant", "/app", _FOOTER_NOTIFS["fr"]),
    )


def password_reset_email(token: str, locale: str | None = "fr") -> tuple[str, str]:
    """(sujet, html) pour la réinitialisation du mot de passe (lien valable 1 h, usage unique).
    Lien vers la route SPA /reset-password (jeton token_urlsafe : sûr tel quel dans une URL)."""
    path = f"/reset-password?token={token}"
    if _lang(locale) == "en":
        intro = (
            "Hello,<br/>You asked to reset the password of your Alternly account. "
            "Click the button below to choose a new one. This link is valid for "
            "<strong>one hour</strong> and can only be used once."
        )
        footer = (
            "Didn't request this? Just ignore this email: "
            "your current password stays unchanged."
        )
        return "Reset your Alternly password", _layout(intro, "Choose a new password", path, footer)
    intro = (
        "Bonjour,<br/>Vous avez demandé à réinitialiser le mot de passe de votre compte Alternly. "
        "Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien est valable "
        "<strong>une heure</strong> et ne peut servir qu'une seule fois."
    )
    footer = (
        "Vous n'êtes pas à l'origine de cette demande ? Ignorez simplement cet e-mail : "
        "votre mot de passe actuel reste inchangé."
    )
    return (
        "Réinitialisation de votre mot de passe Alternly",
        _layout(intro, "Choisir un nouveau mot de passe", path, footer),
    )


# ---------------------------------------------------------------- invitation du coparent


def first_name(display_name: str | None) -> str:
    """Prénom affichable (premier mot du nom saisi)."""
    return (display_name or "").strip().split(" ")[0] or (display_name or "")


def join_names(names: list[str], locale: str | None = "fr") -> str:
    """« Léo, Lina et Tom » / « Leo, Lina and Tom »."""
    names = [n for n in names if n]
    if not names:
        return ""
    if len(names) == 1:
        return names[0]
    conj = " and " if _lang(locale) == "en" else " et "
    return ", ".join(names[:-1]) + conj + names[-1]


_INVITE_TRUST = {
    "fr": [
        "Gratuit pour vous, sans carte bancaire",
        "Vous voyez exactement le même calendrier, en temps réel",
        "Les échanges se proposent et s'acceptent à deux",
        "Vous pouvez quitter le foyer à tout moment",
        "Données hébergées dans l'Union européenne",
    ],
    "en": [
        "Free for you, no credit card",
        "You both see exactly the same calendar, in real time",
        "Swaps are proposed and accepted by both of you",
        "You can leave the household at any time",
        "Data hosted in the European Union",
    ],
}


def _invite_layout(heading: str, intro: str, cta_label: str, cta_path: str, footer: str, lang: str) -> str:
    bullets = "".join(
        f'<li style="margin:4px 0;padding-left:22px;position:relative">'
        f'<span style="position:absolute;left:0;color:#1f4d3f;font-weight:700">✓</span>{b}</li>'
        for b in _INVITE_TRUST[lang]
    )
    return (
        '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;'
        'color:#24312b;line-height:1.6;padding:8px">'
        '<p style="font-size:1.3rem;font-weight:600;margin:0 0 16px">altern<span style="color:#1f4d3f">ly</span></p>'
        '<div style="background:#f4f1ea;border-radius:16px;padding:24px">'
        f'<h1 style="font-size:1.25rem;margin:0 0 12px;color:#1f4d3f">{heading}</h1>'
        f"<p style=\"margin:0 0 20px\">{intro}</p>"
        f'<p style="margin:0 0 20px">{_button(cta_label, cta_path)}</p>'
        f'<ul style="list-style:none;padding:0;margin:0;font-size:0.92rem">{bullets}</ul>'
        "</div>"
        f'<p style="color:#5d6b63;font-size:0.8rem;margin-top:20px">{footer}</p>'
        "</div>"
    )


def _join_path(token: str, lang: str) -> str:
    # ?lang= : la page /join s'affiche dans la langue de l'e-mail.
    return f"/join/{token}?lang={lang}"


def invitation_email(
    inviter_name: str, children: list[str], token: str, locale: str | None = "fr", reminder: bool = False
) -> tuple[str, str]:
    """(sujet, html) de l'invitation envoyée par Alternly à l'autre parent.
    Le nom de l'inviteur et les prénoms sont saisis librement → échappés."""
    lang = _lang(locale)
    who = html.escape(first_name(inviter_name))
    kids = html.escape(join_names(children, lang))
    path = _join_path(token, lang)
    if lang == "en":
        for_kids = f" for {kids}" if kids else ""
        heading = f"{who} invited you to your shared custody calendar"
        intro = (
            f"{who} set up the custody calendar{for_kids} on Alternly: weeks, school breaks and "
            "handovers in one place, visible to both of you. You can see your upcoming days "
            "before creating your account."
        )
        if reminder:
            subject = f"Reminder: {first_name(inviter_name)} is waiting for you on Alternly"
            intro = f"Just a gentle reminder. {intro}"
        else:
            subject = f"{first_name(inviter_name)} invited you to share the custody calendar"
        footer = (
            f"You are receiving this email because {who} entered your address on Alternly. "
            "We will not email you again unless you create an account."
        )
        return subject, _invite_layout(heading, intro, "See the calendar", path, footer, lang)
    for_kids = f" pour {kids}" if kids else ""
    heading = f"{who} vous invite sur votre calendrier de garde partagé"
    intro = (
        f"{who} a mis en place le calendrier de garde{for_kids} sur Alternly : les semaines, "
        "les vacances et les échanges au même endroit, visibles par vous deux. Vous pouvez voir "
        "vos prochains jours avant même de créer votre compte."
    )
    if reminder:
        subject = f"Petit rappel : {first_name(inviter_name)} vous attend sur Alternly"
        intro = f"Un petit rappel, sans insister. {intro}"
    else:
        subject = f"{first_name(inviter_name)} vous invite à partager le calendrier de garde"
    footer = (
        f"Vous recevez cet e-mail car {who} a saisi votre adresse sur Alternly. "
        "Nous ne vous écrirons plus sans que vous ayez créé de compte."
    )
    return subject, _invite_layout(heading, intro, "Voir le calendrier", path, footer, lang)


_FOOTER_ACCOUNT = {
    "fr": "Vous pouvez couper ces e-mails dans vos réglages Alternly.",
    "en": "You can turn these emails off in your Alternly settings.",
}


def inviter_reminder_email(day: int, locale: str | None = "fr") -> tuple[str, str]:
    """(sujet, html) : relance de l'inviteur, invitation non acceptée après `day` jours."""
    lang = _lang(locale)
    if lang == "en":
        intro = (
            "Your co-parent hasn't joined your Alternly calendar yet. A message often gets lost: "
            "resend the invitation in one tap, by WhatsApp, text or email. Once they join, "
            "you both see the same schedule and can propose swaps."
        )
        if day >= 5:
            intro = "Still no answer? " + intro
        return (
            "Your co-parent hasn't joined yet",
            _layout(intro, "Resend the invitation", "/settings#invite", _FOOTER_ACCOUNT["en"]),
        )
    intro = (
        "L'autre parent n'a pas encore rejoint votre calendrier Alternly. Un message se perd "
        "facilement : renvoyez l'invitation en un geste, par WhatsApp, SMS ou e-mail. Une fois "
        "inscrit·e, vous verrez tous les deux le même planning et pourrez proposer des échanges."
    )
    if day >= 5:
        intro = "Toujours pas de réponse ? " + intro
    return (
        "L'autre parent n'a pas encore rejoint Alternly",
        _layout(intro, "Renvoyer l'invitation", "/settings#invite", _FOOTER_ACCOUNT["fr"]),
    )


def invite_nudge_email(locale: str | None = "fr") -> tuple[str, str]:
    """(sujet, html) : onboarding terminé mais aucune invitation créée après 24 h."""
    if _lang(locale) == "en":
        intro = (
            "Your custody calendar is ready. It becomes really useful once your co-parent sees it "
            "too: same schedule for both of you, swaps proposed and accepted in the app, no more "
            "back-and-forth messages. Inviting them takes 10 seconds (WhatsApp, text or email)."
        )
        return (
            "Invite your co-parent to your calendar",
            _layout(intro, "Invite my co-parent", "/settings#invite", _FOOTER_ACCOUNT["en"]),
        )
    intro = (
        "Votre calendrier de garde est prêt. Il devient vraiment utile quand l'autre parent le voit "
        "aussi : le même planning pour vous deux, des échanges proposés et acceptés dans l'app, "
        "moins d'allers-retours de messages. L'inviter prend 10 secondes (WhatsApp, SMS ou e-mail)."
    )
    return (
        "Invitez l'autre parent sur votre calendrier",
        _layout(intro, "Inviter l'autre parent", "/settings#invite", _FOOTER_ACCOUNT["fr"]),
    )
