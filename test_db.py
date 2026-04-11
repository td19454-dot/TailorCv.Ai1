"""Quick Neon Postgres connection tester.

Run: `python test_db.py`

Expects env var `DATABASE_URL` (e.g. postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require)
and a table `ytable(id, full_name, email, password)` already created.
"""

import os
import sys

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv


def main() -> int:
    # Load local .env if present
    load_dotenv()

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set; add it to your .env", file=sys.stderr)
        return 1

    try:
        conn = psycopg2.connect(db_url, cursor_factory=RealDictCursor)
        conn.autocommit = True
    except Exception as e:
        print(f"Failed to connect: {e}", file=sys.stderr)
        return 1

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database() AS db, current_user AS user, version() AS version")
            meta = cur.fetchone()
            print("Connected:")
            print(meta)

            cur.execute("SELECT id, full_name, email FROM users LIMIT 5")
            rows = cur.fetchall()
            print("Sample rows from users table:")
            for r in rows:
                print(r)

    except Exception as e:
        print(f"Query failed: {e}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
