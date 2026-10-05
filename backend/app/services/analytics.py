"""Analytics produit côté serveur (PostHog, région UE).

Enveloppe mince autour du client Python PostHog :

- no-op complet sans `POSTHOG_TOKEN` (dev, tests) ;
- jamais bloquant : le client met les événements en file et les envoie par lots
  depuis un thread d'arrière-plan ; `shutdown()` vide la file à l'arrêt ;
- consentement (RGPD / ePrivacy) : un utilisateur n'est rattaché à ses événements
  (distinct_id = son id, groupe « household ») que s'il a accepté la mesure
  d'audience (`users.analytics_consent is True`). Sinon l'événement part avec un
  identifiant aléatoire à usage unique et `$process_person_profile: false` : aucun
  profil, aucun identifiant persistant, seulement des compteurs agrégés ;
- jamais de texte libre ni de donnée d'identification (e-mail, nom, libellés,
  notes, messages) dans les propriétés : les appelants ne passent que des
  énumérations, booléens et nombres.
"""
from __future__ import annotations

import logging
import random
import re
import threading
import time
import uuid
from collections import deque
from contextvars import ContextVar
from typing import Any

from ..config import settings

log = logging.getLogger("coparent.analytics")

# Segments d'URL portant un secret (flux iCal, invitation) : jamais envoyés tels quels.
_SECRET_PATH = re.compile(r"(/(?:api/)?(?:ical|invitations|join)/)[^/?#]+")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")

# Chemin (nettoyé) de la requête en cours, pour contextualiser logs et exceptions.
current_path: ContextVar[str | None] = ContextVar("analytics_current_path", default=None)

_client = None
_client_lock = threading.Lock()


def enabled() -> bool:
    return bool(settings.posthog_token)


def scrub_path(path: str) -> str:
    return _SECRET_PATH.sub(r"\1[filtré]", path.split("?", 1)[0])


def _get_client():
    """Client PostHog paresseux (créé au premier événement), ou None si désactivé."""
    global _client
    if not enabled():
        return None
    if _client is None:
        with _client_lock:
            if _client is None:
                from posthog import Posthog

                _client = Posthog(
                    settings.posthog_token,
                    host=settings.posthog_host,
                    # IP du serveur Railway : la géolocalisation n'aurait aucun sens.
                    disable_geoip=True,
                    # Un souci réseau vers PostHog ne doit jamais faire échouer une requête.
                    on_error=lambda err, _batch: log.debug("PostHog: envoi échoué (%s)", err),
                    max_retries=2,
                    timeout=5,
                    # Suivi d'erreurs : exceptions non gérées hors requête (tâches de fond,
                    # threads) ; jamais les variables locales (données personnelles).
                    enable_exception_autocapture=True,
                    capture_exception_code_variables=False,
                )
    return _client


def _send(distinct_id: str, event: str, properties: dict[str, Any], groups: dict[str, str] | None) -> None:
    """Point d'envoi unique (remplacé par un espion dans les tests)."""
    client = _get_client()
    if client is None:
        return
    client.capture(event, distinct_id=distinct_id, properties=properties, groups=groups or None)


def capture(
    distinct_id: str | None,
    event: str,
    properties: dict[str, Any] | None = None,
    groups: dict[str, str] | None = None,
) -> None:
    """Envoie un événement. `distinct_id=None` → événement anonyme sans profil."""
    if not enabled():
        return
    props = dict(properties or {})
    if distinct_id is None:
        distinct_id = str(uuid.uuid4())
        props["$process_person_profile"] = False
        groups = None
    try:
        _send(distinct_id, event, props, groups)
    except Exception:  # l'analytics ne casse jamais une requête
        log.debug("PostHog: capture impossible", exc_info=True)


def capture_for_user(
    user,
    event: str,
    properties: dict[str, Any] | None = None,
    household_id: int | None = None,
) -> None:
    """Événement lié à un utilisateur, en respectant son choix de consentement.

    Consentement donné → rattaché à l'utilisateur (distinct_id = id) et à son foyer.
    Sinon → anonyme (identifiant aléatoire, pas de profil, pas de groupe).
    """
    if not enabled():
        return
    if user is not None and getattr(user, "analytics_consent", None) is True:
        groups = {"household": str(household_id)} if household_id is not None else None
        capture(str(user.id), event, properties, groups)
    else:
        capture(None, event, properties)


def capture_for_member(db, member, event: str, properties: dict[str, Any] | None = None) -> None:
    """Variante pour un membre de foyer (HouseholdMember) : charge l'utilisateur."""
    if not enabled():
        return
    from ..models import User

    capture_for_user(db.get(User, member.user_id), event, properties, household_id=member.household_id)


def capture_sampled(event: str, properties: dict[str, Any] | None = None, rate: int = 20) -> None:
    """Événement anonyme échantillonné (1 sur `rate`) pour les appels très fréquents."""
    if not enabled() or random.randrange(rate) != 0:
        return
    capture(None, event, {**(properties or {}), "sample_rate": rate})


def capture_exception(exc: BaseException, properties: dict[str, Any] | None = None) -> None:
    """Remonte une exception serveur (suivi d'erreurs PostHog), sans données de requête."""
    client = _get_client()
    if client is None:
        return
    props = {
        "$process_person_profile": False,
        "path": current_path.get(),
        **(properties or {}),
    }
    try:
        client.capture_exception(exc, distinct_id=str(uuid.uuid4()), properties=props)
    except Exception:
        log.debug("PostHog: capture d'exception impossible", exc_info=True)


def shutdown() -> None:
    """Vide la file et arrête le thread d'envoi (arrêt de l'application)."""
    global _client
    if _client is not None:
        try:
            _client.shutdown()
        except Exception:
            log.debug("PostHog: arrêt en erreur", exc_info=True)
        _client = None


# ---------------------------------------------------------------- logs serveur


class PostHogLogHandler(logging.Handler):
    """Transfère les logs WARNING+ en événements `server_log` (débit borné).

    Activé seulement avec POSTHOG_SERVER_LOGS=true. Le message est tronqué et
    débarrassé des adresses e-mail ; aucune donnée de requête n'est jointe.
    """

    def __init__(self, max_per_minute: int = 30) -> None:
        super().__init__(level=logging.WARNING)
        self.max_per_minute = max_per_minute
        self._sent: deque[float] = deque()
        self._lock = threading.Lock()

    def _allow(self) -> bool:
        now = time.monotonic()
        with self._lock:
            while self._sent and now - self._sent[0] > 60:
                self._sent.popleft()
            if len(self._sent) >= self.max_per_minute:
                return False
            self._sent.append(now)
            return True

    def emit(self, record: logging.LogRecord) -> None:
        # Pas de boucle : les logs du client PostHog lui-même (et de son transport) sont ignorés.
        if record.name.startswith(("posthog", "urllib3", "requests", "coparent.analytics")):
            return
        if not self._allow():
            return
        try:
            message = _EMAIL.sub("[e-mail]", record.getMessage())[:500]
            capture(None, "server_log", {
                "level": record.levelname,
                "logger": record.name,
                "message": message,
                "path": current_path.get(),
                "exception_type": record.exc_info[0].__name__ if record.exc_info and record.exc_info[0] else None,
            })
        except Exception:
            self.handleError(record)


_log_handler: PostHogLogHandler | None = None


def install_log_handler() -> None:
    """Branche le handler sur le logger racine (idempotent), si activé par la config."""
    global _log_handler
    if not (enabled() and settings.posthog_server_logs) or _log_handler is not None:
        return
    _log_handler = PostHogLogHandler()
    logging.getLogger().addHandler(_log_handler)
