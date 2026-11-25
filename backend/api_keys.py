import hashlib
import re
import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError

from backend.auth import SessionUser, User
from backend.contracts import ApiKey, ApiKeyName, CreatedApiKey, DeletedApiKey
from backend.db import pool, save_user
from backend.settings import settings

router = APIRouter(prefix="/api/api-keys", tags=["API keys"])
COLUMNS = 'id, name, prefix, created_at AS "createdAt"'
KEY_PATTERN = re.compile(r"oes_[A-Za-z0-9_-]{43}")


def hash_key(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


def get_api_user(
    request: Request,
    key: Annotated[
        str | None,
        Depends(APIKeyHeader(name="X-API-Key", scheme_name="ApiKey", auto_error=False)),
    ],
    auth: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(HTTPBearer(scheme_name="TypeSafeBearer", auto_error=False)),
    ],
) -> User:
    if (
        key is None
        and auth
        and request.url.path in {"/api/v1/models", "/api/v1/systemone"}
    ):
        key = auth.credentials
    if key and KEY_PATTERN.fullmatch(key):
        with pool().connection() as db:
            row = db.execute(
                """SELECT u.github_id AS "githubId", u.name, u.email FROM api_keys k
                   JOIN users u ON u.github_id = k.user_id WHERE k.key_hash = %(key_hash)s""",
                {"key_hash": hash_key(key)},
            ).fetchone()
        if row and settings().allows_github(row["githubId"]):
            try:
                return User.model_validate(row)
            except ValidationError:
                pass
    raise HTTPException(401, "An active API key is required")


ApiUser = Annotated[User, Depends(get_api_user)]


@router.get("", operation_id="listApiKeys")
def list_keys(user: SessionUser) -> list[ApiKey]:
    with pool().connection() as db:
        return db.execute(
            f"SELECT {COLUMNS} FROM api_keys WHERE user_id = %(user_id)s ORDER BY created_at DESC",
            {"user_id": user.githubId},
        ).fetchall()


@router.post("", operation_id="createApiKey", status_code=201)
def create_key(user: SessionUser, data: ApiKeyName) -> CreatedApiKey:
    secret = f"oes_{secrets.token_urlsafe(32)}"
    with pool().connection() as db:
        save_user(db, user)
        row = db.execute(
            f"""INSERT INTO api_keys (user_id, name, prefix, key_hash)
            VALUES (%(user_id)s, %(name)s, %(prefix)s, %(key_hash)s)
            RETURNING {COLUMNS}""",
            {
                "user_id": user.githubId,
                "name": data.name,
                "prefix": secret[:12],
                "key_hash": hash_key(secret),
            },
        ).fetchone()
    if row is None:
        raise RuntimeError("The API key was not created.")
    return CreatedApiKey.model_validate({**row, "secret": secret})


@router.get("/{key_id}", operation_id="getApiKey")
def get_key(user: SessionUser, key_id: UUID) -> ApiKey:
    with pool().connection() as db:
        row = db.execute(
            f"SELECT {COLUMNS} FROM api_keys WHERE user_id = %(user_id)s AND id = %(key_id)s",
            {"user_id": user.githubId, "key_id": key_id},
        ).fetchone()
    if not row:
        raise HTTPException(404, "API key not found.")
    return ApiKey(**row)


@router.delete("/{key_id}", operation_id="revokeApiKey")
def revoke_key(user: SessionUser, key_id: UUID) -> DeletedApiKey:
    with pool().connection() as db:
        deleted = db.execute(
            "DELETE FROM api_keys WHERE user_id = %(user_id)s AND id = %(key_id)s",
            {"user_id": user.githubId, "key_id": key_id},
        )
        if not deleted.rowcount:
            raise HTTPException(404, "API key not found.")
    return DeletedApiKey(deleted=True)
