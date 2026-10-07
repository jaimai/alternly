"""Gabarits des e-mails de cycle de vie (FR / EN) et jetons de désinscription.

Même charte que les autres e-mails (services/email.py : vert #1f4d3f, carte
#f4f1ea, bouton pilule), avec une version texte et un lien de désinscription
en pied de page. Vouvoiement en français. Tout texte saisi par un parent
(prénoms) est échappé avant interpolation HTML.

Chaque gabarit renvoie un `Email` (sujet, html, texte) ; `unsubscribe_url` est
fourni par l'appelant (lien signé propre au destinataire).
"""
import base64
import hashlib
import hmac
import html as html_lib
import re
from dataclasses import dataclass
from datetime import date

from ..config import settings
from .email import _lang, first_name, join_names
from .vacation_tool import fmt_day as _fmt_day_fr

GREEN = "#1f4d3f"
INK = "#24312b"
SOFT = "#5d6b63"
CARD = "#f4f1ea"


@dataclass
class Email:
    subject: str
    html: str
    text: str


# ---------------------------------------------------------------- désinscription


def _unsubscribe_sig(user_id: int) -> str:
    mac = hmac.new(settings.secret_key.encode(), f"unsubscribe:{user_id}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")[:32]


def unsubscribe_token(user_id: int) -> str:
    """Jeton signé (HMAC de SECRET_KEY), sans expiration : un lien de désinscription
    doit rester valable dans un vieil e-mail. Ne donne accès qu'à la désinscription."""
    return f"{user_id}.{_unsubscribe_sig(user_id)}"


def verify_unsubscribe_token(token: str | None) -> int | None:
    """Identifiant utilisateur si le jeton est authentique, sinon None."""
    if not token or "." not in token:
        return None
    raw_id, _, sig = token.partition(".")
    if not raw_id.isdigit() or len(raw_id) > 12:
        return None
    user_id = int(raw_id)
    return user_id if hmac.compare_digest(sig, _unsubscribe_sig(user_id)) else None


def unsubscribe_url(user_id: int) -> str:
    # Servi par l'API ; en production PUBLIC_SITE_URL (alternly.com) relaie /api/email/* vers Railway.
    return f"{settings.public_site_url.rstrip('/')}/api/email/unsubscribe?token={unsubscribe_token(user_id)}"


# ---------------------------------------------------------------- dates


_EN_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_day(d: date, locale: str | None = "fr") -> str:
    """fr : « sam. 17 oct. » ; en : « Sat, Oct 17 »."""
    if _lang(locale) == "en":
        return f"{_EN_DAYS[d.weekday()]}, {_EN_MONTHS[d.month - 1]} {d.day}"
    return _fmt_day_fr(d)


_FR_DAYS_LONG = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
_FR_MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
                   "septembre", "octobre", "novembre", "décembre"]
_EN_DAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_EN_MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
                   "September", "October", "November", "December"]


def fmt_day_long(d: date, locale: str | None = "fr") -> str:
    """fr : « jeudi 8 octobre » ; en : « Thursday, October 8 »."""
    if _lang(locale) == "en":
        return f"{_EN_DAYS_LONG[d.weekday()]}, {_EN_MONTHS_LONG[d.month - 1]} {d.day}"
    return f"{_FR_DAYS_LONG[d.weekday()]} {d.day} {_FR_MONTHS_LONG[d.month - 1]}"


def fmt_range(start: date, end: date, locale: str | None = "fr") -> str:
    en = _lang(locale) == "en"
    if start == end:
        return f"on {fmt_day(start, locale)}" if en else f"le {fmt_day(start, locale)}"
    if en:
        return f"from {fmt_day(start, locale)} to {fmt_day(end, locale)}"
    return f"du {fmt_day(start, locale)} au {fmt_day(end, locale)}"


# ---------------------------------------------------------------- mise en page


def _url(path: str) -> str:
    return f"{settings.app_url.rstrip('/')}{path}"


def _btn(label: str, path: str, primary: bool = True) -> str:
    style = (
        f"background:{GREEN};color:#ffffff;border:2px solid {GREEN}"
        if primary
        else f"background:#ffffff;color:{GREEN};border:2px solid {GREEN}"
    )
    return (
        f'<a href="{_url(path)}" style="display:inline-block;{style};padding:11px 20px;'
        'border-radius:999px;text-decoration:none;font-weight:600;margin:0 8px 10px 0">'
        f"{label}</a>"
    )


_TAGS = re.compile(r"<[^>]+>")
_LINK = re.compile(r'<a href="([^"]+)"[^>]*>(.*?)</a>')
_BLOCK_TAGS = ("<p ", "<p>", "<ol", "<ul", "<table")


def _plain(fragment: str) -> str:
    """HTML (simple) → texte : balises retirées, entités décodées."""
    fragment = _LINK.sub(r"\2 (\1)", fragment.replace("<br/>", "\n"))
    return html_lib.unescape(_TAGS.sub("", fragment)).strip()


def _dot(sentence: str) -> str:
    """Point final, sans doubler celui d'une abréviation (« 17 oct. »)."""
    return sentence if sentence.endswith(".") else sentence + "."


_FOOTER = {
    "fr": (
        "Vous recevez cet e-mail car vous avez un compte Alternly.",
        "Se désabonner de ces e-mails",
    ),
    "en": (
        "You are receiving this email because you have an Alternly account.",
        "Unsubscribe from these emails",
    ),
}


def _render(
    lang: str,
    subject: str,
    heading: str,
    blocks: list[str],
    buttons: list[tuple[str, str]],
    unsub_url: str,
    after: list[str] | None = None,
) -> Email:
    """`blocks` : fragments HTML déjà échappés (paragraphes, listes <ol>/<ul>, tableaux).
    `buttons` : (libellé, chemin de l'app), le premier en bouton plein.
    `after` : paragraphes discrets sous les boutons (mention Premium…)."""
    after = after or []
    body = "".join(b if b.startswith(_BLOCK_TAGS) else f'<p style="margin:0 0 16px">{b}</p>' for b in blocks)
    btns = "".join(_btn(label, path, i == 0) for i, (label, path) in enumerate(buttons))
    extra = "".join(f'<p style="margin:12px 0 0;font-size:0.9rem;color:{SOFT}">{a}</p>' for a in after)
    why, unsub_label = _FOOTER[lang]
    html = (
        f'<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;'
        f'color:{INK};line-height:1.6;padding:8px;font-size:16px">'
        f'<p style="font-size:1.3rem;font-weight:600;margin:0 0 16px">altern<span style="color:{GREEN}">ly</span></p>'
        f'<div style="background:{CARD};border-radius:16px;padding:22px">'
        f'<h1 style="font-size:1.25rem;line-height:1.35;margin:0 0 14px;color:{GREEN}">{heading}</h1>'
        f"{body}"
        f'<div style="margin:20px 0 0">{btns}</div>'
        f"{extra}"
        "</div>"
        f'<p style="color:{SOFT};font-size:0.8rem;margin-top:20px">{why} '
        f'<a href="{unsub_url}" style="color:{SOFT}">{unsub_label}</a>.</p>'
        "</div>"
    )
    text_parts = [_plain(heading), ""]
    for b in blocks:
        if b.startswith("<ol") or b.startswith("<ul"):
            items = re.findall(r"<li[^>]*>(.*?)</li>", b, flags=re.S)
            for i, it in enumerate(items, 1):
                bullet = f"{i}." if b.startswith("<ol") else "-"
                text_parts.append(f"{bullet} {_plain(it)}")
            text_parts.append("")
        elif b.startswith("<table"):
            for row in re.findall(r"<tr[^>]*>(.*?)</tr>", b, flags=re.S):
                cells = [_plain(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)]
                text_parts.append(" · ".join(c for c in cells if c))
            text_parts.append("")
        else:
            text_parts += [_plain(b), ""]
    for label, path in buttons:
        text_parts.append(f"{_plain(label)} : {_url(path)}" if lang == "fr" else f"{_plain(label)}: {_url(path)}")
    for a in after:
        text_parts += ["", _plain(a)]
    text_parts += ["", "—", why, f"{unsub_label} : {unsub_url}" if lang == "fr" else f"{unsub_label}: {unsub_url}"]
    return Email(subject=subject, html=html, text="\n".join(text_parts).strip() + "\n")


def _list(items: list[str], ordered: bool = False) -> str:
    tag = "ol" if ordered else "ul"
    lis = "".join(f'<li style="margin:0 0 8px">{it}</li>' for it in items)
    return f'<{tag} style="margin:0 0 16px;padding-left:22px">{lis}</{tag}>'


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def _kids(children: list[str], lang: str) -> str:
    return html_lib.escape(join_names(children, lang))


# ---------------------------------------------------------------- J0 : bienvenue


def welcome_email(display_name: str, locale: str | None, unsub_url: str) -> Email:
    lang = _lang(locale)
    who = html_lib.escape(first_name(display_name))
    if lang == "en":
        steps = [
            "<strong>Set your custody schedule</strong>: alternating weeks, 2-2-3, every other "
            "weekend or custom. Holidays and school breaks are handled for you.",
            "<strong>Invite your co-parent</strong>: free for them, same calendar for both of you, "
            "and swaps proposed and accepted in the app.",
            "<strong>Sync your calendar</strong>: Google Calendar, Apple Calendar or Outlook, so "
            "you never have to copy anything by hand (Premium).",
        ]
        return _render(
            lang, "Welcome to Alternly", f"Welcome to Alternly, {who}!",
            [
                "Alternly keeps your children's custody calendar in one place, for you and your "
                "co-parent: weeks, school breaks, holidays and swaps, worked out automatically.",
                "Getting started takes three steps:",
                _list(steps, ordered=True),
            ],
            [("Open Alternly", "/app")], unsub_url,
        )
    steps = [
        "<strong>Posez votre règle de garde</strong> : semaine sur deux, 2-2-3, un week-end sur "
        "deux ou sur mesure. Les vacances scolaires de votre zone et les jours fériés sont pris en compte.",
        "<strong>Invitez l'autre parent</strong> : c'est gratuit pour lui ou elle, vous voyez le "
        "même calendrier et vous proposez des échanges dans l'app.",
        "<strong>Synchronisez votre agenda</strong> : Google Agenda, Apple Calendrier ou Outlook, "
        "pour ne plus rien recopier à la main (Premium).",
    ]
    return _render(
        lang, "Bienvenue sur Alternly", f"Bienvenue sur Alternly, {who} !",
        [
            "Alternly réunit le calendrier de garde de vos enfants au même endroit, pour vous et "
            "l'autre parent : les semaines, les vacances scolaires, les jours fériés et les "
            "échanges, calculés automatiquement.",
            "Pour bien démarrer, trois étapes :",
            _list(steps, ordered=True),
        ],
        [("Ouvrir Alternly", "/app")], unsub_url,
    )


def welcome_partner_email(
    inviter_name: str,
    children: list[str],
    my_periods: list[tuple[date, date]],
    locale: str | None,
    unsub_url: str,
) -> Email:
    """J0 du parent invité : son planning (prochaines périodes) + synchro d'agenda."""
    lang = _lang(locale)
    inviter = html_lib.escape(first_name(inviter_name))
    kids = _kids(children, lang)
    periods = _list([_cap(fmt_range(s, e, lang)) for s, e in my_periods[:3]]) if my_periods else ""
    if lang == "en":
        for_kids = f" for {kids}" if kids else ""
        blocks = [
            f"You have joined the shared custody calendar that {inviter} set up{for_kids}. "
            "You both now see exactly the same schedule, in real time."
        ]
        if periods:
            blocks += [f"Your next days with {kids or 'the children'}:", periods]
        blocks += [
            "To always have it at hand, sync it with your own calendar (Google, Apple, Outlook) "
            "from the settings. Need to switch days? Propose a swap in the app: "
            f"{inviter} accepts or declines it in one tap.",
        ]
        return _render(
            lang, f"Welcome to {first_name(inviter_name)}'s household",
            f"Welcome to {inviter}'s household", blocks,
            [("See my calendar", "/app"), ("Sync my calendar", "/settings")], unsub_url,
        )
    for_kids = f" pour {kids}" if kids else ""
    blocks = [
        f"Vous avez rejoint le calendrier de garde partagé que {inviter} a mis en place{for_kids}. "
        "Vous voyez désormais tous les deux exactement le même planning, en temps réel."
    ]
    if periods:
        blocks += [f"Vos prochains jours avec {kids or 'les enfants'} :", periods]
    blocks += [
        "Pour l'avoir toujours sous la main, synchronisez-le avec votre agenda (Google, Apple, "
        "Outlook) depuis les réglages. Besoin d'intervertir des jours ? Proposez un échange dans "
        f"l'app : {inviter} l'accepte ou le refuse en un geste.",
    ]
    return _render(
        lang, f"Bienvenue dans le foyer de {first_name(inviter_name)}",
        f"Bienvenue dans le foyer de {inviter}", blocks,
        [("Voir mon calendrier", "/app"), ("Synchroniser mon agenda", "/settings")], unsub_url,
    )


# ---------------------------------------------------------------- J1 : règle de garde


def rule_missing_email(locale: str | None, unsub_url: str) -> Email:
    lang = _lang(locale)
    if lang == "en":
        return _render(
            lang, "Just your custody schedule left to set", "Just your custody schedule left to set",
            [
                "Your Alternly account is ready, but your calendar is still empty. Pick your "
                "custody pattern (alternating weeks, 2-2-3, every other weekend or custom) and "
                "Alternly works out the whole year for you, school breaks and holidays included.",
                "It takes about two minutes.",
            ],
            [("Set my custody schedule", "/onboarding")], unsub_url,
        )
    return _render(
        lang, "Il ne manque que votre règle de garde", "Il ne manque que votre règle de garde",
        [
            "Votre compte Alternly est créé, mais votre calendrier est encore vide. Choisissez "
            "votre rythme de garde (semaine sur deux, 2-2-3, un week-end sur deux ou sur mesure) : "
            "Alternly calcule ensuite toute l'année, vacances scolaires et jours fériés compris.",
            "Cela prend environ deux minutes.",
        ],
        [("Choisir ma règle de garde", "/onboarding")], unsub_url,
    )


# ---------------------------------------------------------------- J3 : inviter l'autre parent


def invite_tips_email(locale: str | None, unsub_url: str) -> Email:
    lang = _lang(locale)
    quote_style = f'style="margin:0 0 16px;padding:10px 14px;border-left:3px solid {GREEN};background:#ffffff;border-radius:8px"'
    if lang == "en":
        tips = [
            "<strong>Talk about what's in it for them</strong>: their days visible in advance, "
            "without having to ask.",
            "<strong>Reassure</strong>: it's free for them, no credit card, and either of you "
            "can leave the household at any time.",
            "<strong>Keep it neutral</strong>: a practical tool for the kids, not a new rule. "
            "A short message is enough, for example:",
        ]
        return _render(
            lang, "How to introduce Alternly to your co-parent", "How to introduce Alternly to your co-parent",
            [
                "Alternly really pays off once you both see the same calendar. A few tips so "
                "the invitation lands well:",
                _list(tips),
                f"<p {quote_style}>“I've put our custody schedule on Alternly, it saves us the "
                "back-and-forth messages. You can see your next days here:”</p>",
                "<strong>Pick the right channel</strong>: WhatsApp, text or email. The invitation "
                "link shows the schedule right away, even before creating an account.",
            ],
            [("Invite my co-parent", "/settings#invite")], unsub_url,
        )
    tips = [
        "<strong>Parlez de ce qu'il ou elle y gagne</strong> : ses jours visibles à l'avance, "
        "sans avoir à vous les demander.",
        "<strong>Rassurez</strong> : c'est gratuit pour l'autre parent, sans carte bancaire, et "
        "chacun peut quitter le foyer à tout moment.",
        "<strong>Restez neutre</strong> : un outil pratique pour les enfants, pas une nouvelle "
        "règle. Un message court suffit, par exemple :",
    ]
    return _render(
        lang, "Comment présenter Alternly à l'autre parent", "Comment présenter Alternly à l'autre parent",
        [
            "Alternly prend tout son sens quand vous voyez tous les deux le même calendrier. "
            "Quelques conseils pour que l'invitation soit bien reçue :",
            _list(tips),
            f"<p {quote_style}>« J'ai mis notre planning de garde sur Alternly, ça évite les "
            "allers-retours de messages. Tu peux voir tes prochains jours ici : »</p>",
            "<strong>Choisissez le bon canal</strong> : WhatsApp, SMS ou e-mail. Le lien "
            "d'invitation affiche directement le planning, avant même de créer un compte.",
        ],
        [("Inviter l'autre parent", "/settings#invite")], unsub_url,
    )


# ---------------------------------------------------------------- J7 : valeur


def value_email(premium: bool, locale: str | None, unsub_url: str) -> Email:
    """Synchro d'agenda + échanges de jours. La synchro est Premium : les foyers
    gratuits reçoivent une mention douce de Premium plutôt qu'un lien inutilisable."""
    lang = _lang(locale)
    if lang == "en":
        sync = (
            "<strong>Sync your calendar.</strong> Subscribe Google Calendar, Apple Calendar or "
            "Outlook to your custody calendar: days and handovers show up there and update on their own."
        )
        swaps = (
            "<strong>Propose day swaps.</strong> Something came up, a weekend to move? Tap a day "
            "in the calendar and propose a swap: your co-parent accepts or declines, and the "
            "schedule updates for both of you, with a clear history."
        )
        subject = "Two tips to save time with Alternly"
        if premium:
            return _render(
                lang, subject, "Your calendar, everywhere you go", [sync, swaps],
                [("Sync my calendar", "/settings"), ("Open the calendar", "/app")], unsub_url,
            )
        return _render(
            lang, subject, "Get more out of your calendar", [swaps],
            [("Open the calendar", "/app")], unsub_url,
            after=[
                "If you ever want more, Alternly Premium adds calendar sync, shared expenses and "
                "a family wall to organise the kids' life together. One subscription covers the "
                "whole household, and the calendar itself stays free. "
                f'<a href="{_url("/settings")}" style="color:{GREEN}">Discover Premium</a>'
            ],
        )
    sync = (
        "<strong>Synchronisez votre agenda.</strong> Abonnez Google Agenda, Apple Calendrier ou "
        "Outlook à votre calendrier de garde : les jours et les passages de relais s'y affichent "
        "et se mettent à jour tout seuls."
    )
    swaps = (
        "<strong>Proposez des échanges de jours.</strong> Un imprévu, un week-end à décaler ? "
        "Touchez un jour du calendrier et proposez un échange : l'autre parent l'accepte ou le "
        "refuse, et le planning se met à jour pour vous deux, avec un historique clair."
    )
    subject = "Deux astuces pour gagner du temps avec Alternly"
    if premium:
        return _render(
            lang, subject, "Votre calendrier, partout avec vous", [sync, swaps],
            [("Synchroniser mon agenda", "/settings"), ("Ouvrir le calendrier", "/app")], unsub_url,
        )
    return _render(
        lang, subject, "Tirez le meilleur de votre calendrier", [swaps],
        [("Ouvrir le calendrier", "/app")], unsub_url,
        after=[
            "Si un jour vous souhaitez aller plus loin, Alternly Premium ajoute la synchronisation "
            "avec votre agenda, le suivi des dépenses partagées et un mur pour organiser la vie "
            "des enfants à deux. Un seul abonnement couvre tout le foyer, et le calendrier reste "
            f'gratuit. <a href="{_url("/settings")}" style="color:{GREEN}">Découvrir Premium</a>'
        ],
    )


def solo_value_email(locale: str | None, unsub_url: str) -> Email:
    """J7 d'un foyer encore solo : les échanges de jours n'ont de sens qu'à deux,
    on remet donc l'invitation de l'autre parent au centre."""
    lang = _lang(locale)
    if lang == "en":
        return _render(
            lang,
            "Your calendar is ready, but only you can see it",
            "Your calendar is ready, but only you can see it",
            [
                "Your custody schedule is set up, school breaks included. For now, though, "
                "you're the only one who sees it.",
                _list([
                    "<strong>Your co-parent sees their days ahead</strong>, without asking you.",
                    "<strong>Day swaps happen in the app</strong>: proposed, accepted, done, "
                    "with a clear history instead of scattered messages.",
                    "<strong>Nothing to set up for them</strong>: the calendar is already "
                    "filled in, and it's free for them.",
                ]),
                "Sharing takes ten seconds: WhatsApp, text, email or a QR code.",
            ],
            [("Invite my co-parent", "/settings#invite"), ("Open the calendar", "/app")], unsub_url,
        )
    return _render(
        lang,
        "Votre calendrier est prêt, mais vous êtes seul·e à le voir",
        "Votre calendrier est prêt, mais vous êtes seul·e à le voir",
        [
            "Votre rythme de garde est en place, vacances scolaires comprises. Pour l'instant, "
            "vous êtes toutefois le seul parent à le voir.",
            _list([
                "<strong>L'autre parent voit ses jours à l'avance</strong>, sans avoir à vous "
                "les demander.",
                "<strong>Les échanges de jours se font dans l'app</strong> : proposés, acceptés, "
                "c'est fait, avec un historique clair plutôt que des messages éparpillés.",
                "<strong>Rien à configurer pour lui ou elle</strong> : le calendrier est déjà "
                "rempli, et c'est gratuit pour l'autre parent.",
            ]),
            "Le partage prend dix secondes : WhatsApp, SMS, e-mail ou QR code.",
        ],
        [("Inviter l'autre parent", "/settings#invite"), ("Ouvrir le calendrier", "/app")], unsub_url,
    )


# ---------------------------------------------------------------- offre de bienvenue


def discount_email(code: str, percent: int, until: date, locale: str | None, unsub_url: str) -> Email:
    """Offre de bienvenue (une seule fois) : -X % sur la première année Premium.
    Le lien ouvre directement le choix de l'offre avec le code appliqué."""
    lang = _lang(locale)
    path = f"/app?offre={code}"
    yearly = 69 * (100 - percent) / 100
    if lang == "en":
        price = f"€{yearly:.2f}"
        return _render(
            lang,
            f"{percent}% off your first year of Alternly Premium",
            f"A welcome offer: {percent}% off your first year",
            [
                "You've started using Alternly to organise your custody calendar. If shared expenses, "
                "the family wall and calendar sync could help, here's a little push to try Premium.",
                f"With the code <strong>{code}</strong>, your first year is <strong>{price}</strong> "
                "instead of €69. One subscription covers the whole household: both parents get access.",
                f"This offer is valid until <strong>{fmt_day_long(until, 'en')}</strong>.",
            ],
            [("Use my offer", path)],
            unsub_url,
            after=["The custody calendar stays free, with or without Premium."],
        )
    price = f"{yearly:.2f}".replace(".", ",") + " €"
    return _render(
        lang,
        f"-{percent} % sur votre première année Alternly Premium",
        f"Une offre de bienvenue : -{percent} % la première année",
        [
            "Vous avez commencé à organiser votre garde avec Alternly. Si le suivi des dépenses "
            "partagées, le mur et la synchronisation avec votre agenda peuvent vous aider, voici un "
            "petit coup de pouce pour essayer Premium.",
            f"Avec le code <strong>{code}</strong>, votre première année revient à <strong>{price}</strong> "
            "au lieu de 69 €. Un seul abonnement couvre tout le foyer : les deux parents en profitent.",
            f"Offre valable jusqu'au <strong>{fmt_day_long(until, 'fr')}</strong>.",
        ],
        [("Profiter de l'offre", path)],
        unsub_url,
        after=["Le calendrier de garde reste gratuit, avec ou sans Premium."],
    )


# ---------------------------------------------------------------- rappel de vacances scolaires

# Libellés officiels (FR) → libellé anglais ; les congés saisis à la main (US) restent tels quels.
_HOLIDAY_EN = {
    "toussaint": "Fall break (Toussaint)",
    "noël": "Christmas break",
    "hiver": "Winter break",
    "printemps": "Spring break",
    "été": "Summer break",
}


def holiday_key(label: str) -> str:
    """Clé stable (analytics) : toussaint | noel | hiver | printemps | ete | other."""
    low = label.lower()
    for kw, key in (("toussaint", "toussaint"), ("noël", "noel"), ("hiver", "hiver"),
                    ("printemps", "printemps"), ("été", "ete")):
        if kw in low:
            return key
    return "other"


def holiday_label(label: str, locale: str | None) -> str:
    if _lang(locale) == "en":
        low = label.lower()
        for kw, en in _HOLIDAY_EN.items():
            if kw in low:
                return en
    return label


@dataclass
class Segment:
    who: str          # prénom affichable, ou « vous » / « you » (non échappé)
    is_me: bool
    start: date
    end: date


def holiday_reminder_email(
    label: str,
    period_start: date,
    days_until: int,
    children: list[str],
    segments: list[Segment],
    handover_time: str,
    other_name: str | None,
    teaser: bool,
    locale: str | None,
    unsub_url: str,
) -> Email:
    """« Vacances de la Toussaint dans 10 jours : Léo et Lina seront chez vous du … au …,
    puis chez Alex du … au … ». `teaser` : version offerte aux foyers gratuits (une fois)."""
    lang = _lang(locale)
    en = lang == "en"
    name = holiday_label(label, lang)
    esc_name = html_lib.escape(name)
    kids = _kids(children, lang)
    many = len(children) != 1
    other = html_lib.escape(first_name(other_name)) if other_name else None

    def chez(seg: Segment) -> str:
        if en:
            return "with you" if seg.is_me else f"with {html_lib.escape(seg.who)}"
        return "chez vous" if seg.is_me else f"chez {html_lib.escape(seg.who)}"

    parts = [f"{chez(s)} {fmt_range(s.start, s.end, lang)}" for s in segments]
    handovers = [s.start for s in segments[1:]]
    at = f" at {handover_time}" if en else f" à {handover_time}"
    rows = "".join(
        f'<tr><td style="padding:6px 10px 6px 0;font-weight:600;color:{GREEN}">'
        f"{'You' if en and s.is_me else ('Vous' if s.is_me else html_lib.escape(s.who))}</td>"
        f'<td style="padding:6px 0">{fmt_range(s.start, s.end, lang)}</td></tr>'
        for s in segments
    )
    table = f'<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;font-size:0.95rem">{rows}</table>'

    if en:
        subject = f"{name} in {days_until} days"
        heading = f"{esc_name}: who has the kids?"
        subj_kids = kids or "The children"
        verb = "will be"
        if len(segments) == 1:
            main = f"{subj_kids} {verb} {chez(segments[0])} for the whole break ({fmt_range(segments[0].start, segments[0].end, lang)})."
        else:
            main = _dot(f"{subj_kids} {verb} " + ", then ".join(parts))
        blocks = [f"The break starts on {fmt_day(period_start, lang)}. {main}", table]
        if handovers:
            days_txt = ", ".join(fmt_day(d, lang) for d in handovers)
            blocks.append(f"Handover{'s' if len(handovers) > 1 else ''}: {days_txt}{at}.")
        if other:
            blocks.append(f"Something in the way? Propose a swap to {other} now: it leaves you both time to plan.")
        buttons = [("See the calendar", "/app")]
        if other:
            buttons.append(("Propose a swap", f"/app?propose={period_start.isoformat()}"))
        after = []
        if teaser:
            after.append(
                "This first reminder is on us. With Alternly Premium, you get it before every "
                "school break, along with swap reminders. "
                f'<a href="{_url("/settings")}" style="color:{GREEN}">Discover Premium</a>'
            )
        return _render(lang, subject, heading, blocks, buttons, unsub_url, after)

    subject = f"{name} dans {days_until} jours"
    heading = f"{esc_name} : qui a les enfants ?"
    subj_kids = kids or "Les enfants"
    verb = "seront" if many else "sera"
    if len(segments) == 1:
        main = f"{subj_kids} {verb} {chez(segments[0])} pendant toutes les vacances ({fmt_range(segments[0].start, segments[0].end, lang)})."
    else:
        main = _dot(f"{subj_kids} {verb} " + ", puis ".join(parts))
    blocks = [f"{_dot(f'Les vacances commencent le {fmt_day(period_start, lang)}')} {main}", table]
    if handovers:
        days_txt = ", ".join(fmt_day(d, lang) for d in handovers)
        plural = "Passages de relais" if len(handovers) > 1 else "Passage de relais"
        blocks.append(f"{plural} : {days_txt}{at}.")
    if other:
        blocks.append(
            f"Un empêchement ? Proposez un échange à {other} dès maintenant : cela vous laisse "
            "à tous les deux le temps de vous organiser."
        )
    buttons = [("Voir le calendrier", "/app")]
    if other:
        buttons.append(("Proposer un échange", f"/app?propose={period_start.isoformat()}"))
    after = []
    if teaser:
        after.append(
            "Ce premier rappel vous est offert. Avec Alternly Premium, vous le recevez avant "
            "chaque période de vacances, ainsi que les rappels d'échanges. "
            f'<a href="{_url("/settings")}" style="color:{GREEN}">Découvrir Premium</a>'
        )
    return _render(lang, subject, heading, blocks, buttons, unsub_url, after)
