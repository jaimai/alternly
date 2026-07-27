"""Micro-migrations idempotentes exécutées au démarrage.

Pas d'Alembic au MVP : on ajoute les colonnes manquantes via ALTER TABLE
(standard SQLite/Postgres) uniquement quand elles n'existent pas déjà.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# table -> {colonne: clause DDL de type}
_ADD_COLUMNS: dict[str, dict[str, str]] = {
    "schedule_exceptions": {
        "status": "VARCHAR",
        "resolved_by": "INTEGER",
        "resolved_at": "TIMESTAMP",
        "response_note": "VARCHAR",
        "replaces_id": "INTEGER",
        "reminder_sent_at": "TIMESTAMP",
    },
    "users": {
        "email_opt_in": "BOOLEAN",
        "onboarding_seen": "BOOLEAN",
        "subscription_status": "VARCHAR",
        "trial_ends_at": "TIMESTAMP",
        "subscription_ends_at": "TIMESTAMP",
        "paddle_customer_id": "VARCHAR",
        "paddle_subscription_id": "VARCHAR",
        "is_placeholder": "BOOLEAN",
    },
    "expenses": {
        "settled_at": "TIMESTAMP",
        "settled_by": "INTEGER",
    },
}


def run_migrations(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, columns in _ADD_COLUMNS.items():
            if table not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl_type in columns.items():
                if name in present:
                    continue
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
            # Comptes antérieurs à Paddle : accès accordé (pré-lancement).
            conn.execute(
                text("UPDATE users SET subscription_status = 'active' WHERE subscription_status IS NULL")
            )
            # Comptes réels existants : ce ne sont pas des parents fantômes.
            conn.execute(text("UPDATE users SET is_placeholder = FALSE WHERE is_placeholder IS NULL"))
