"""Provision the fixed TypeSafe smoke-test identity in a local database."""

import os
from urllib.parse import urlsplit

from dotenv import load_dotenv

from backend.api_keys import KEY_PATTERN, hash_key
from backend.auth import User
from backend.db import pool, save_user
from backend.settings import settings

TEST_USER = User(
    githubId="system-one-smoke-test",
    email="system-one-smoke@example.invalid",
    name="System One Smoke Test",
)
TEST_KEY_ID = "4b0ff728-caa4-4859-9c02-d575b3565461"


def main():
    load_dotenv()
    config = settings()
    if urlsplit(config.database_url).hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("The smoke test requires a local DATABASE_URL.")
    if not config.allows_github(TEST_USER.githubId):
        raise SystemExit(
            "Add system-one-smoke-test to the local ALLOWED_GITHUB_USER_IDS to run this test."
        )
    key = os.environ.get("SYSTEM_ONE_TEST_API_KEY", "")
    if not KEY_PATTERN.fullmatch(key):
        raise SystemExit(
            "Set SYSTEM_ONE_TEST_API_KEY to oes_ plus 43 base64url characters."
        )
    with pool() as connections, connections.connection() as db:
        save_user(db, TEST_USER)
        updated = db.execute(
            """INSERT INTO api_keys (id, user_id, name, prefix, key_hash)
            VALUES (%(key_id)s, %(user_id)s, %(name)s, %(prefix)s, %(key_hash)s)
            ON CONFLICT (id) DO UPDATE SET prefix = EXCLUDED.prefix, key_hash = EXCLUDED.key_hash
            WHERE api_keys.user_id = EXCLUDED.user_id""",
            {
                "key_id": TEST_KEY_ID,
                "user_id": TEST_USER.githubId,
                "name": "System One smoke test",
                "prefix": key[:12],
                "key_hash": hash_key(key),
            },
        )
        if not updated.rowcount:
            raise SystemExit("The smoke-test key ID belongs to another user.")


if __name__ == "__main__":
    main()
