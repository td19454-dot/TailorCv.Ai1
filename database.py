import json
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker


load_dotenv()


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL", "").strip()
    # Render/local env values are sometimes copied with wrapping quotes.
    # SQLAlchemy cannot parse quoted URLs, so normalize here.
    database_url = database_url.strip("'\"")
    if not database_url:
        return "sqlite:///./users.db"

    # Render/Postgres URLs may come in the older postgres:// form.
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    # Name the driver explicitly. Only psycopg2-binary is installed, but
    # SQLAlchemy 2.1 made psycopg v3 the default for a bare "postgresql://",
    # so an unpinned install crashed the Render deploy at import with
    # "No module named 'psycopg'". Covers the bare and "+psycopg" forms.
    for prefix in ("postgresql://", "postgresql+psycopg://"):
        if database_url.startswith(prefix):
            database_url = "postgresql+psycopg2://" + database_url[len(prefix):]
            break

    return database_url


DATABASE_URL = get_database_url()
is_sqlite = DATABASE_URL.startswith("sqlite")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if is_sqlite else {},
    pool_pre_ping=not is_sqlite,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

IS_POSTGRES = engine.dialect.name == "postgresql"


def sync_embedding_vectors(db, rows) -> None:
    """After setting `row.embedding` (JSON-encoded floats) on a batch of
    JobListing rows, call this to also populate the native pgvector column
    (`embedding_vec`) so similarity search can use the HNSW index instead of
    pulling every row's embedding into Python and scoring it there — see
    main.py's _ensure_pgvector(). Not an ORM-mapped column (the `vector`
    Postgres type has no SQLite equivalent, and this app falls back to
    SQLite when DATABASE_URL isn't set), so this writes it via raw SQL and
    is a no-op entirely on SQLite, where job_dashboard.py's Python-side scan
    remains the only option."""
    if not IS_POSTGRES:
        return
    params = []
    for row in rows:
        if not row.embedding:
            continue
        try:
            vec = json.loads(row.embedding)
        except Exception:
            continue
        params.append({"row_id": row.id, "vec": "[" + ",".join(f"{x:.8f}" for x in vec) + "]"})
    if not params:
        return
    db.execute(
        text("UPDATE job_listings SET embedding_vec = CAST(:vec AS vector) WHERE id = :row_id"),
        params,
    )
