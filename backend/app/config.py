from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./coparent.db"
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60 * 24 * 30

    # Notifications e-mail (Resend). Vide → envoi désactivé (no-op).
    resend_api_key: str = ""
    # Domaine d'envoi vérifié chez Resend : hōnō.com (forme ASCII/IDNA obligatoire),
    # alias dédié à Alternly. Surchargeable par EMAIL_FROM.
    email_from: str = "Alternly <alternly@xn--hn-vrab.com>"
    # Boîte qui reçoit les signalements « Signaler un problème / Une idée ».
    # Vide → signalements enregistrés en base seulement (table feedback).
    feedback_email: str = ""
    # URL publique du site (Vercel sert la landing en / et l'app). Utilisée pour
    # les liens absolus des e-mails et le canonical/OG (la landing est proxifiée,
    # donc request.url refléterait l'URL interne Railway).
    app_url: str = "http://localhost:5173"
    # Connexion « Continuer avec Google » : ID client OAuth (type Application Web).
    # Vide → fonctionnalité désactivée. Pas de secret : on vérifie seulement le jeton d'identité.
    google_client_id: str = ""
    # ID clients OAuth Google de l'app mobile (iOS, Android), séparés par des virgules :
    # leurs jetons d'identité sont acceptés en plus de ceux de google_client_id.
    google_mobile_client_ids: str = ""
    # « Se connecter avec Apple » : audiences acceptées (identifiant de bundle iOS),
    # séparées par des virgules. Ajouter host.exp.Exponent pour tester dans Expo Go.
    # Vide → désactivé. Pas de secret : on vérifie seulement le jeton d'identité.
    apple_client_ids: str = "com.alternly.app"
    public_site_url: str = "http://localhost:8000"
    # Origines autorisées à appeler l'API (CORS), séparées par des virgules.
    cors_origins: str = "http://localhost:5173"
    # Secret protégeant l'endpoint cron des rappels. Vide → endpoint désactivé.
    cron_secret: str = ""
    # Service Expo qui relaie les notifications push vers APNs / FCM (modifiable pour un faux service en recette).
    push_api_url: str = "https://exp.host/--/api/v2/push/send"
    # Limitation de débit anti-abus (mémoire du processus, voir ratelimit.py).
    rate_limit_enabled: bool = True
    # Suivi d'erreurs Sentry. DSN vide → désactivé.
    sentry_dsn: str = ""
    sentry_environment: str = "production"
    sentry_traces_sample_rate: float = 0.0
    # Mesure d'audience / analytics produit PostHog (région UE). Jeton de projet
    # (phc_…, public par conception). Vide → tout est désactivé (no-op).
    posthog_token: str = ""
    posthog_host: str = "https://eu.i.posthog.com"
    # Transfère les logs WARNING+ du serveur en événements `server_log` (désactivé par défaut).
    posthog_server_logs: bool = False

    # Paiement Paddle (Merchant of Record). Durée de l'essai gratuit en jours.
    trial_days: int = 14
    paddle_webhook_secret: str = ""  # vérifie la signature des webhooks Paddle
    paddle_api_key: str = ""  # appels API serveur (gestion d'abonnement)
    paddle_env: str = "sandbox"  # sandbox | production → base de l'API Paddle
    paddle_price_annual: str = ""   # price_id de l'offre annuelle
    paddle_price_monthly: str = ""  # price_id de l'offre mensuelle
    # Essai affiché si l'API Paddle est injoignable (sinon lu sur le prix annuel Paddle).
    annual_trial_days: int = 0
    # Offre de bienvenue envoyée aux parents intéressés qui n'ont pas souscrit
    # (code créé dans Paddle → Catalog → Discounts). Vide → offre désactivée.
    discount_code: str = "BIENVENUE20"
    discount_percent: int = 20
    discount_valid_days: int = 7

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @field_validator("secret_key")
    @classmethod
    def _default_secret(cls, v: str) -> str:
        # `SECRET_KEY=` vide (copie brute de .env.example) → clé de dev ; refusée hors SQLite.
        return v or "dev-secret-change-me"

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

# Garde-fou : une base non-SQLite signale un déploiement réel — une clé de
# signature JWT faible ou connue y rendrait tous les comptes usurpables.
WEAK_SECRET_KEYS = {"dev-secret-change-me", "change-me-in-production", "changeme", "secret"}

if not settings.is_sqlite and (settings.secret_key in WEAK_SECRET_KEYS or len(settings.secret_key) < 32):
    raise RuntimeError(
        "SECRET_KEY absente, connue ou trop courte (< 32 caractères) hors environnement SQLite local "
        "(voir .env.example)"
    )
