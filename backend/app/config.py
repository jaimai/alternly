from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./coparent.db"
    secret_key: str = "dev-secret-change-me"
    access_token_expire_minutes: int = 60 * 24 * 30

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

# Garde-fou : une base non-SQLite signale un déploiement réel — la clé de
# signature JWT par défaut y rendrait tous les comptes usurpables.
if settings.secret_key == "dev-secret-change-me" and not settings.database_url.startswith("sqlite"):
    raise RuntimeError("SECRET_KEY doit être définie (voir .env.example) hors environnement SQLite local")
