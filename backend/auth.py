from time import time
from typing import Annotated, Literal

import jwt
from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, ValidationError
from starlette.datastructures import URL

from backend.settings import settings

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
COOKIE = "sheep.session"
SESSION_TTL = 3600


class User(BaseModel):
    model_config = ConfigDict(strict=True)

    id: str
    name: str
    email: str
    # Populated by github_user in backend/oauth.py.
    githubLogin: str  # noqa: N815 - matches the JWT and JSON field name
    githubId: str  # noqa: N815 - matches the JWT and JSON field name


class SessionClaims(BaseModel):
    model_config = ConfigDict(strict=True)

    user: User
    iat: int
    exp: int
    version: Literal["1"]


def public_origin(request: Request) -> str:
    host = request.headers.get("host")
    for origin in settings().auth_origins:
        if URL(origin).netloc == host:
            return origin
    raise HTTPException(400, "Unrecognized host")


def cookie_name(name: str, origin: str) -> str:
    return f"__Secure-{name}" if origin.startswith("https://") else name


def check_origin(request: Request, origin: str) -> None:
    if request.method not in SAFE_METHODS and request.headers.get("origin") != origin:
        raise HTTPException(403, "Invalid request origin")


def issue_session(response: Response, origin: str, user: User) -> None:
    now = int(time())
    claims = SessionClaims(user=user, iat=now, exp=now + SESSION_TTL, version="1")
    response.set_cookie(
        cookie_name(COOKIE, origin),
        jwt.encode(  # pyright: ignore[reportUnknownMemberType] - third-party key types
            claims.model_dump(),
            settings().auth_secret.get_secret_value(),
            algorithm="HS256",
        ),
        max_age=SESSION_TTL,
        secure=origin.startswith("https://"),
        httponly=True,
        samesite="lax",
    )


def clear_session(response: Response, origin: str) -> None:
    response.delete_cookie(
        cookie_name(COOKIE, origin),
        secure=origin.startswith("https://"),
        httponly=True,
    )


def verify_user(request: Request) -> User | None:
    origin = public_origin(request)
    check_origin(request, origin)
    token = request.cookies.get(cookie_name(COOKIE, origin))
    if not token:
        return None
    try:
        payload = jwt.decode(  # pyright: ignore[reportUnknownMemberType] - third-party key types
            token,
            settings().auth_secret.get_secret_value(),
            algorithms=["HS256"],
            options={"require": ["iat", "exp"]},
        )
        return SessionClaims.model_validate(payload).user
    except (jwt.InvalidTokenError, ValidationError):
        return None


def require_auth(
    request: Request, user: Annotated[User | None, Depends(verify_user)]
) -> None:
    if user is not None:
        return
    if request.method in SAFE_METHODS and not request.url.path.startswith("/api/"):
        raise HTTPException(307, headers={"Location": "/auth/login"})
    raise HTTPException(401, "Sign in required")


def get_user(user: Annotated[User | None, Depends(verify_user)]) -> User:
    if user is None:
        raise HTTPException(401, "Sign in required")
    return user
