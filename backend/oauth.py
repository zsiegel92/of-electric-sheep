import logging
from base64 import urlsafe_b64encode
from hashlib import sha256
from hmac import compare_digest
from secrets import token_urlsafe
from time import time
from typing import Annotated
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from httpx import AsyncClient
from pydantic import (
    BaseModel,
    ConfigDict,
    PositiveInt,
    SecretStr,
    TypeAdapter,
    ValidationError,
)
from starlette.concurrency import run_in_threadpool

from backend.auth import (
    User,
    check_origin,
    clear_session,
    cookie_name,
    issue_session,
    public_origin,
)
from backend.db import pool, save_user
from backend.settings import settings

CALLBACK = "/api/auth/callback/github"
STATE_COOKIE = "sheep.oauth_state"
STATE_TTL = 600
STATE_AUDIENCE = "github-oauth"
NO_STORE = {"Cache-Control": "no-store"}
LOG = logging.getLogger(__name__)

auth_router = APIRouter(prefix="/api/auth", include_in_schema=False)


class OAuthState(BaseModel):
    model_config = ConfigDict(strict=True)

    nonce: str
    verifier: str
    origin: str
    exp: int


class GitHubToken(BaseModel):
    access_token: SecretStr


class GitHubProfile(BaseModel):
    model_config = ConfigDict(strict=True)

    id: PositiveInt
    login: str
    name: str | None = None
    email: str | None = None


class GitHubEmail(BaseModel):
    model_config = ConfigDict(strict=True)

    email: str
    primary: bool
    verified: bool


@auth_router.post("/start")
def start(request: Request) -> Response:
    origin = public_origin(request)
    check_origin(request, origin)
    config = settings()
    if (
        not config.github_client_id
        or not config.github_client_secret.get_secret_value()
    ):
        raise HTTPException(
            503, "Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to enable sign-in"
        )

    state = OAuthState(
        nonce=token_urlsafe(32),
        verifier=token_urlsafe(32),
        origin=origin,
        exp=int(time()) + STATE_TTL,
    )
    challenge = urlsafe_b64encode(sha256(state.verifier.encode()).digest()).rstrip(b"=")
    params = urlencode(
        {
            "client_id": config.github_client_id,
            "redirect_uri": origin + CALLBACK,
            "scope": "read:user user:email",
            "state": state.nonce,
            "code_challenge": challenge.decode(),
            "code_challenge_method": "S256",
        }
    )
    response = RedirectResponse(
        f"https://github.com/login/oauth/authorize?{params}",
        status_code=303,
        headers=NO_STORE,
    )
    response.set_cookie(
        cookie_name(STATE_COOKIE, origin),
        jwt.encode(
            {**state.model_dump(), "aud": STATE_AUDIENCE},
            config.signing_key(),
            algorithm="HS256",
        ),
        max_age=STATE_TTL,
        path=CALLBACK,
        secure=origin.startswith("https://"),
        httponly=True,
        samesite="lax",
    )
    return response


async def github_user(code: str, state: OAuthState) -> User:
    config = settings()
    step = "token exchange"
    try:
        async with AsyncClient(timeout=10, trust_env=False) as client:
            exchange = await client.post(
                "https://github.com/login/oauth/access_token",
                data={
                    "client_id": config.github_client_id,
                    "client_secret": config.github_client_secret.get_secret_value(),
                    "code": code,
                    "redirect_uri": state.origin + CALLBACK,
                    "code_verifier": state.verifier,
                },
                headers={"Accept": "application/json"},
            )
            token = GitHubToken.model_validate_json(exchange.raise_for_status().content)
            step = "profile lookup"
            headers = {
                "Authorization": f"Bearer {token.access_token.get_secret_value()}",
                "Accept": "application/vnd.github+json",
            }
            profile_reply = await client.get(
                "https://api.github.com/user", headers=headers
            )
            profile = GitHubProfile.model_validate_json(
                profile_reply.raise_for_status().content
            )
            github_id = str(profile.id)
            if not config.allows_github(github_id):
                raise HTTPException(
                    403, "This GitHub account is not allowed to sign in."
                )

            email = profile.email
            if not email:
                step = "email lookup"
                emails_reply = await client.get(
                    "https://api.github.com/user/emails", headers=headers
                )
                if (
                    emails_reply.status_code == 403
                    and emails_reply.headers.get("x-ratelimit-remaining") != "0"
                ):
                    raise HTTPException(
                        502,
                        "GitHub denied access to your private email. "
                        "Grant the GitHub App read access to Email addresses.",
                    )
                emails = TypeAdapter(list[GitHubEmail]).validate_json(
                    emails_reply.raise_for_status().content
                )
                email = next(
                    (item.email for item in emails if item.primary and item.verified),
                    None,
                )
    except (httpx.HTTPError, ValidationError) as exc:
        LOG.warning("GitHub sign-in failed during %s (%s)", step, type(exc).__name__)
        raise HTTPException(502, f"GitHub sign-in failed during {step}.") from exc

    if not email:
        raise HTTPException(401, "GitHub sign-in requires a verified primary email")
    # Map trusted GitHub data to User here to add fields to the session JWT.
    return User(
        name=profile.name or profile.login,
        email=email,
        githubId=github_id,
    )


@auth_router.get("/callback/github")
async def callback(
    request: Request,
    code: Annotated[str | None, Query(min_length=1, max_length=2048)] = None,
    state: Annotated[str | None, Query(pattern=r"^[A-Za-z0-9_-]{43}$")] = None,
) -> Response:
    origin = public_origin(request)
    name = cookie_name(STATE_COOKIE, origin)
    cookie = request.cookies.get(name)
    if code is None or state is None or cookie is None:
        raise HTTPException(401, "Missing GitHub authorization or OAuth state")
    try:
        payload = jwt.decode(
            cookie,
            settings().signing_key(),
            algorithms=["HS256"],
            audience=STATE_AUDIENCE,
            options={"require": ["exp"]},
        )
        pending = OAuthState.model_validate(payload)
    except (jwt.InvalidTokenError, ValidationError) as exc:
        raise HTTPException(401, "Invalid OAuth state") from exc
    if pending.origin != origin or not compare_digest(state, pending.nonce):
        raise HTTPException(401, "Invalid OAuth state")

    user = await github_user(code, pending)
    await run_in_threadpool(store_user, user)
    response = RedirectResponse("/", status_code=303, headers=NO_STORE)
    response.delete_cookie(
        name, path=CALLBACK, secure=origin.startswith("https://"), httponly=True
    )
    issue_session(response, origin, user)
    return response


def store_user(user: User) -> None:
    with pool().connection() as db:
        save_user(db, user)


@auth_router.post("/sign-out")
def sign_out(request: Request) -> Response:
    origin = public_origin(request)
    check_origin(request, origin)
    response = RedirectResponse("/sign-in", status_code=303, headers=NO_STORE)
    clear_session(response, origin)
    return response
