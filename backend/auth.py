from time import time
from typing import Annotated, Literal

import jwt
from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, ValidationError
from starlette.datastructures import URL

from backend.settings import settings

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
COOKIE = "sheep.session"
SESSION_TTL = 14 * 24 * 60 * 60


class User(BaseModel):
    model_config = ConfigDict(strict=True)

    name: str
    email: str
    githubId: str


class SessionClaims(BaseModel):
    model_config = ConfigDict(strict=True)

    user: User
    iat: int
    exp: int
    version: Literal["1"]


def public_origin(request: Request) -> str:
    config = settings()
    origins = [*config.auth_origins, *([config.app_url] if config.app_url else [])]
    forwarded = request.headers.get("x-sheep-origin")
    if forwarded is not None:
        if forwarded in origins:
            return forwarded
        raise HTTPException(400, "Unrecognized frontend origin")
    host = request.headers.get("host")
    for origin in origins:
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
        jwt.encode(claims.model_dump(), settings().signing_key(), algorithm="HS256"),
        max_age=SESSION_TTL,
        secure=origin.startswith("https://"),
        httponly=True,
        samesite="lax",
    )


def clear_session(response: Response, origin: str) -> None:
    response.delete_cookie(
        cookie_name(COOKIE, origin), secure=origin.startswith("https://"), httponly=True
    )


def verify_user(request: Request) -> User | None:
    origin = public_origin(request)
    check_origin(request, origin)
    token = request.cookies.get(cookie_name(COOKIE, origin))
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            settings().signing_key(),
            algorithms=["HS256"],
            options={"require": ["iat", "exp"]},
        )
        user = SessionClaims.model_validate(payload).user
        return user if settings().allows_github(user.githubId) else None
    except (jwt.InvalidTokenError, ValidationError):
        return None


def get_user(user: Annotated[User | None, Depends(verify_user)]) -> User:
    if user is None:
        raise HTTPException(401, "Sign in required")
    return user


SessionUser = Annotated[User, Depends(get_user)]
