from functools import cache

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from backend.settings import settings


@cache
def pool():
    return ConnectionPool(
        settings().database_url,
        kwargs={"row_factory": dict_row},
        min_size=0,
        max_size=8,
        open=True,
    )


def save_user(db, user):
    db.execute(
        """INSERT INTO users (github_id, name, email) VALUES (%s, %s, %s)
        ON CONFLICT (github_id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email""",
        (user.githubId, user.name, user.email),
    )
