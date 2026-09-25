import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
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
