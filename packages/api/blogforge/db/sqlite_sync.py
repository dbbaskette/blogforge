"""Keep an existing SQLite file in step with the ORM models.

`Base.metadata.create_all` only CREATES tables - it can never add a column to a
table that already exists. On the SQLite path (local dev and the single-host
deploy) that means a model which gains a column leaves an existing database
silently behind, and the app then dies at boot on the first query touching it:

    sqlite3.OperationalError: no such column: users.default_provider

Alembic is not the answer here: those migrations are authored for Postgres, and
the SQLite path (including the test suite) is built from the models directly, so
there is no alembic_version to reason from. Instead, reconcile the gap that
actually bites - a newly added nullable column - by ALTERing it in.

Deliberately narrow. It only ADDs nullable columns. Drops, renames, type changes
and NOT NULL additions are reported, never guessed at: those need a real
migration (and Postgres).
"""

from __future__ import annotations

import logging

import sqlalchemy as sa
from sqlalchemy import Connection, MetaData

log = logging.getLogger(__name__)


def add_missing_columns(conn: Connection, metadata: MetaData) -> list[str]:
    """ALTER in any nullable model column missing from an already-existing table.

    Returns the "table.column" names added, in model order. Tables that do not
    exist yet are left alone - create_all builds those. A NOT NULL column is
    skipped with a warning: SQLite cannot add one to a populated table without a
    default, so silently guessing a value would be worse than saying so.
    """
    inspector = sa.inspect(conn)
    existing_tables = set(inspector.get_table_names())
    added: list[str] = []

    for table in metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        have = {c["name"] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name in have:
                continue
            if not col.nullable:
                log.warning(
                    "sqlite schema drift: %s.%s is NOT NULL and cannot be added in place; "
                    "add it with a migration",
                    table.name,
                    col.name,
                )
                continue
            coltype = col.type.compile(dialect=conn.dialect)
            conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {coltype}')
            added.append(f"{table.name}.{col.name}")
            log.info("sqlite schema drift: added %s.%s", table.name, col.name)

    return added
