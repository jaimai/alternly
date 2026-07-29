from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./coparent.db"
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60 * 24 * 30

    # Notifications e-mail (Resend). Vide → envoi désactivé (no-op).
    resend_api_key: str = ""
    email_from: str = "Alternly <no-reply@alternly.com>"
    # URL publique du site (Vercel sert la landing en / et l'app). Utilisée pour
    # les liens absolus des e-mails et le canonical/OG (la landing est proxifiée,
    # donc request.url refléterait l'URL interne Railway).
    app_url: str = "http://localhost:5173"
    public_site_url: str = "http://localhost:8000"
    # Origines autorisées à appeler l'API (CORS), séparées par des virgules.
    cors_origins: str = "http://localhost:5173"
    # Secret protégeant l'endpoint cron des rappels. Vide → endpoint désactivé.
    cron_secret: str = ""

    # Paiement Paddle (Merchant of Record). Durée de l'essai gratuit en jours.
    trial_days: int = 14
    paddle_webhook_secret: str = ""  # vérifie la signature des webhooks Paddle
    paddle_api_key: str = ""  # appels API serveur (gestion d'abonnement)
    paddle_env: str = "sandbox"  # sandbox | production → base de l'API Paddle
    paddle_price_annual: str = ""   # price_id de l'offre annuelle
    paddle_price_monthly: str = ""  # price_id de l'offre mensuelle

    @property
    def paddle_api_base(self) -> str:
        return (
            "https://api.paddle.com"
            if self.paddle_env == "production"
            else "https://sandbox-api.paddle.com"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

# Garde-fou : une base non-SQLite signale un déploiement réel — la clé de
# signature JWT par défaut y rendrait tous les comptes usurpables.
if settings.secret_key == "dev-secret-change-me" and not settings.database_url.startswith("sqlite"):
    raise RuntimeError("SECRET_KEY doit être définie (voir .env.example) hors environnement SQLite local")
