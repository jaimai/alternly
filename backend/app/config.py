from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./coparent.db"
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60 * 24 * 30

    # Notifications e-mail (Resend). Vide → envoi désactivé (no-op).
    resend_api_key: str = ""
    email_from: str = "Alternly <no-reply@alternly.com>"
    # URL publique de la SPA (hébergée sur Vercel) : liens de la landing, CTAs
    # e-mail, liens d'invitation. En dev : le serveur Vite.
    app_url: str = "http://localhost:5173"
    # Origines autorisées à appeler l'API (CORS), séparées par des virgules.
    cors_origins: str = "http://localhost:5173"
    # Secret protégeant l'endpoint cron des rappels. Vide → endpoint désactivé.
    cron_secret: str = ""
    # URL publique canonique du site marketing (ex. https://alternly.com), sans
    # slash final. Vide → déduite de la requête (dev). Sert au sitemap, robots,
    # llms.txt et balises canonical/og.
    site_url: str = ""

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @field_validator("secret_key")
    @classmethod
    def _default_secret(cls, v: str) -> str:
        # `SECRET_KEY=` vide (copie brute de .env.example) → clé de dev ; refusée hors SQLite.
        return v or "dev-secret-change-me"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

# Garde-fou : une base non-SQLite signale un déploiement réel — une clé de
# signature JWT faible ou connue y rendrait tous les comptes usurpables.
WEAK_SECRET_KEYS = {"dev-secret-change-me", "change-me-in-production", "changeme", "secret"}

if not settings.is_sqlite and (settings.secret_key in WEAK_SECRET_KEYS or len(settings.secret_key) < 32):
    raise RuntimeError(
        "SECRET_KEY absente, connue ou trop courte (< 32 caractères) hors environnement SQLite local "
        "(voir .env.example)"
    )
