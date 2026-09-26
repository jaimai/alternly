"""Micro-migrations idempotentes exécutées au démarrage.

Pas d'Alembic au MVP : on ajoute les colonnes manquantes via ALTER TABLE
(standard SQLite/Postgres) uniquement quand elles n'existent pas déjà, et les
index manquants via CREATE INDEX IF NOT EXISTS (create_all n'en ajoute pas aux
tables existantes).
"""
from datetime import timedelta

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .config import settings
from .models import utcnow

# table -> {colonne: clause DDL de type}
_ADD_COLUMNS: dict[str, dict[str, str]] = {
    "schedule_exceptions": {
        "status": "VARCHAR",
        "resolved_by": "INTEGER",
        "resolved_at": "DATETIME",
        "response_note": "VARCHAR",
        "replaces_id": "INTEGER",
        "reminder_sent_at": "DATETIME",
    },
    "users": {
        "email_opt_in": "BOOLEAN",
        "onboarding_seen": "BOOLEAN",
        "token_version": "INTEGER",
        "deleted_at": "DATETIME",
        "trial_ends_at": "DATETIME",
        "stripe_customer_id": "VARCHAR",
        "stripe_subscription_id": "VARCHAR",
        "subscription_status": "VARCHAR",
        "current_period_end": "DATETIME",
        "cancel_at_period_end": "BOOLEAN",
    },
}

# Index sur les clés étrangères filtrées à chaque requête (noms = convention
# SQLAlchemy `index=True` : ix_<table>_<colonne>, donc no-op sur base neuve).
_INDEXES: list[tuple[str, str]] = [
    ("children", "household_id"),
    ("schedule_exceptions", "household_id"),
    ("expenses", "household_id"),
    ("settlements", "household_id"),
    ("wall_posts", "household_id"),
    ("invitations", "household_id"),
    ("household_members", "user_id"),
    ("notifications", "user_id"),
    ("wall_replies", "post_id"),
    ("password_reset_tokens", "user_id"),
    ("users", "stripe_customer_id"),
    ("audit_log", "household_id"),
    ("change_requests", "household_id"),
]


def run_migrations(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    postgres = engine.dialect.name == "postgresql"
    with engine.begin() as conn:
        for table, columns in _ADD_COLUMNS.items():
            if table not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl_type in columns.items():
                if name in present:
                    continue
                if postgres and ddl_type == "DATETIME":
                    ddl_type = "TIMESTAMP"  # DATETIME n'existe pas en Postgres
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {ddl_type}'))
        # Les exceptions présentes avant l'ajout du cycle de vie étaient appliquées.
        if "schedule_exceptions" in existing_tables:
            conn.execute(
                text("UPDATE schedule_exceptions SET status = 'accepted' WHERE status IS NULL")
            )
            conn.execute(
                text("UPDATE schedule_exceptions SET response_note = '' WHERE response_note IS NULL")
            )
        # Les comptes existants reçoivent les e-mails par défaut.
        # TRUE (et non 1) : Postgres est strict sur le type booléen, SQLite l'accepte aussi.
        if "users" in existing_tables:
            conn.execute(text("UPDATE users SET email_opt_in = TRUE WHERE email_opt_in IS NULL"))
            # Comptes existants : déjà onboardés, on ne leur montre pas le tour.
            conn.execute(text("UPDATE users SET onboarding_seen = TRUE WHERE onboarding_seen IS NULL"))
            conn.execute(text("UPDATE users SET token_version = 0 WHERE token_version IS NULL"))
            conn.execute(text("UPDATE users SET cancel_at_period_end = FALSE WHERE cancel_at_period_end IS NULL"))
            # Comptes antérieurs à la facturation : essai complet à partir du
            # déploiement, soit max(created_at + essai, maintenant + essai) —
            # created_at ≤ maintenant, donc maintenant + essai. Les nouveaux
            # comptes reçoivent trial_ends_at à l'inscription (jamais NULL).
            conn.execute(
                text("UPDATE users SET trial_ends_at = :t WHERE trial_ends_at IS NULL"),
                {"t": utcnow() + timedelta(days=settings.trial_days)},
            )
        for table, column in _INDEXES:
            if table in existing_tables:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_{column} ON {table} ({column})"))
