from base64 import urlsafe_b64encode
from hashlib import sha256
from hmac import compare_digest
from secrets import token_urlsafe
from time import time
from typing import Annotated
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from httpx import AsyncClient
from pydantic import (
    BaseModel,
    ConfigDict,
    PositiveInt,
    SecretStr,
    TypeAdapter,
    ValidationError,
)

from backend.auth import (
    User,
    check_origin,
    clear_session,
    cookie_name,
    issue_session,
    public_origin,
)
from backend.frontend import ROOT
from backend.settings import settings

CALLBACK = "/auth/callback/github"
STATE_COOKIE = "sheep.oauth_state"
STATE_TTL = 600
STATE_AUDIENCE = "github-oauth"
NO_STORE = {"Cache-Control": "no-store"}

auth_app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)


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
    name: str | None


class GitHubEmail(BaseModel):
    model_config = ConfigDict(strict=True)

    email: str
    primary: bool
    verified: bool


@auth_app.get("/login")
def login(request: Request) -> Response:
    public_origin(request)
    return FileResponse(ROOT / "backend/login.html", headers=NO_STORE)


@auth_app.post("/start")
def start(request: Request) -> Response:
    origin = public_origin(request)
    check_origin(request, origin)
    config = settings()
    if not config.github_client_id:
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
        jwt.encode(  # pyright: ignore[reportUnknownMemberType] - third-party key types
            {**state.model_dump(), "aud": STATE_AUDIENCE},
            config.auth_secret.get_secret_value(),
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
            emails_reply = await client.get(
                "https://api.github.com/user/emails", headers=headers
            )
            emails = TypeAdapter(list[GitHubEmail]).validate_json(
                emails_reply.raise_for_status().content
            )
    except (httpx.HTTPError, ValidationError) as exc:
        raise HTTPException(502, "GitHub sign-in failed") from exc

    email = next(
        (item.email for item in emails if item.primary and item.verified), None
    )
    if email is None:
        raise HTTPException(401, "GitHub sign-in requires a verified primary email")
    # Map trusted GitHub data to User here to add fields to the session JWT.
    return User(
        id=str(profile.id),
        name=profile.name or profile.login,
        email=email,
        githubLogin=profile.login,
        githubId=str(profile.id),
    )


@auth_app.get("/callback/github")
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
        payload = jwt.decode(  # pyright: ignore[reportUnknownMemberType] - third-party key types
            cookie,
            settings().auth_secret.get_secret_value(),
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
    response = RedirectResponse("/", status_code=303, headers=NO_STORE)
    response.delete_cookie(
        name, path=CALLBACK, secure=origin.startswith("https://"), httponly=True
    )
    issue_session(response, origin, user)
    return response


@auth_app.post("/sign-out")
def sign_out(request: Request) -> Response:
    origin = public_origin(request)
    check_origin(request, origin)
    response = RedirectResponse("/auth/login", status_code=303, headers=NO_STORE)
    clear_session(response, origin)
    return response
