from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

try:
    from .settings import DATABASE_PATH
except ImportError:
    from settings import DATABASE_PATH


DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# Seconds a writer waits for another writer's lock before giving up.
BUSY_TIMEOUT_MS = 5000

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": BUSY_TIMEOUT_MS / 1000},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record):
    """Enforce foreign keys, use WAL (readers do not block the writer) and wait on locks."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    finally:
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
