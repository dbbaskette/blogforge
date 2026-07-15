import sqlalchemy as sa

from blogforge.db.sqlite_sync import add_missing_columns


def _users_metadata(*cols: sa.Column) -> sa.MetaData:  # type: ignore[type-arg]
    md = sa.MetaData()
    sa.Table("users", md, sa.Column("id", sa.Integer, primary_key=True), *cols)
    return md


def test_adds_a_missing_nullable_column_and_preserves_rows(tmp_path) -> None:  # type: ignore[no-untyped-def]
    # An existing DB built before the model gained `default_provider` — exactly
    # the drift that crashed the app at boot ("no such column").
    engine = sa.create_engine(f"sqlite:///{tmp_path}/t.db")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(320))")
        conn.exec_driver_sql("INSERT INTO users (id, email) VALUES (1, 'a@b.c')")

    md = _users_metadata(
        sa.Column("email", sa.String(320)),
        sa.Column("default_provider", sa.String(32), nullable=True),
    )
    with engine.begin() as conn:
        added = add_missing_columns(conn, md)

    assert added == ["users.default_provider"]
    assert "default_provider" in {c["name"] for c in sa.inspect(engine).get_columns("users")}
    with engine.begin() as conn:
        # Existing data survives; the new column reads as NULL.
        assert conn.exec_driver_sql("SELECT email FROM users WHERE id=1").scalar() == "a@b.c"
        assert conn.exec_driver_sql("SELECT default_provider FROM users").scalar() is None


def test_is_a_noop_when_the_schema_already_matches(tmp_path) -> None:  # type: ignore[no-untyped-def]
    engine = sa.create_engine(f"sqlite:///{tmp_path}/t.db")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(320))")
    md = _users_metadata(sa.Column("email", sa.String(320)))
    with engine.begin() as conn:
        assert add_missing_columns(conn, md) == []


def test_leaves_brand_new_tables_to_create_all(tmp_path) -> None:  # type: ignore[no-untyped-def]
    # The table doesn't exist yet: create_all makes it, the reconciler stays out.
    engine = sa.create_engine(f"sqlite:///{tmp_path}/t.db")
    md = _users_metadata(sa.Column("email", sa.String(320)))
    with engine.begin() as conn:
        assert add_missing_columns(conn, md) == []


def test_skips_a_not_null_column_instead_of_crashing(tmp_path) -> None:  # type: ignore[no-untyped-def]
    # SQLite cannot ADD a NOT NULL column to a populated table without a default.
    # Skip it (and warn) rather than take the app down at boot.
    engine = sa.create_engine(f"sqlite:///{tmp_path}/t.db")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        conn.exec_driver_sql("INSERT INTO users (id) VALUES (1)")
    md = _users_metadata(sa.Column("mandatory", sa.String(8), nullable=False))
    with engine.begin() as conn:
        assert add_missing_columns(conn, md) == []
    assert "mandatory" not in {c["name"] for c in sa.inspect(engine).get_columns("users")}


def test_adds_every_missing_column_across_tables(tmp_path) -> None:  # type: ignore[no-untyped-def]
    # The publish track adds four nullable columns to drafts at once.
    engine = sa.create_engine(f"sqlite:///{tmp_path}/t.db")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE drafts (id VARCHAR(36) PRIMARY KEY)")

    md = sa.MetaData()
    sa.Table(
        "drafts",
        md,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_slug", sa.String(256), nullable=True),
        sa.Column("published_sha", sa.String(64), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
    )
    with engine.begin() as conn:
        added = add_missing_columns(conn, md)
    assert added == [
        "drafts.published_at",
        "drafts.published_slug",
        "drafts.published_sha",
        "drafts.description",
    ]
