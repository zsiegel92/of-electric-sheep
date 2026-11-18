from base64 import urlsafe_b64encode
from hashlib import sha256
from secrets import token_hex
from typing import Annotated
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import httpx
from fastapi import Depends, FastAPI
from pydantic import PostgresDsn, SecretStr

from backend.auth import User, get_user, require_auth
from backend.oauth import auth_app
from backend.settings import Settings


class SessionCookieTest(IsolatedAsyncioTestCase):
    async def test_github_oauth_issues_a_verified_session(self) -> None:
        origin = "https://sheep.example.com"
        redirect_uri = f"{origin}/auth/callback/github"
        config = Settings(
            auth_secret=SecretStr(token_hex(32)),
            auth_origins=[origin],
            database_url=PostgresDsn("postgresql://localhost/test"),
            github_client_id="test-client",
            github_client_secret=SecretStr(token_hex(32)),
            _env_file=None,  # pyright: ignore[reportCallIssue] - pydantic-settings runtime option
        )
        app = FastAPI(dependencies=[Depends(require_auth)])
        app.mount("/auth", auth_app)

        @app.get("/api/me")
        def me(user: Annotated[User, Depends(get_user)]) -> User:
            return user

        provider_calls: list[str] = []
        challenge = ""

        def github(request: httpx.Request) -> httpx.Response:
            provider_calls.append(request.url.path)
            if request.url.path == "/login/oauth/access_token":
                form = parse_qs(request.content.decode())
                verifier = form["code_verifier"][0]
                digest = urlsafe_b64encode(sha256(verifier.encode()).digest())
                self.assertEqual(challenge, digest.rstrip(b"=").decode())  # noqa: PT009
                self.assertEqual(form["redirect_uri"], [redirect_uri])  # noqa: PT009
                return httpx.Response(200, json={"access_token": "mock-token"})
            self.assertEqual(request.headers["Authorization"], "Bearer mock-token")  # noqa: PT009
            if request.url.path == "/user":
                return httpx.Response(
                    200, json={"id": 123, "login": "sheep", "name": None}
                )
            self.assertEqual(request.url.path, "/user/emails")  # noqa: PT009
            return httpx.Response(
                200,
                json=[
                    {"email": "sheep@example.com", "primary": True, "verified": True}
                ],
            )

        provider = httpx.AsyncClient(transport=httpx.MockTransport(github))
        browser = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=origin
        )
        self.addAsyncCleanup(browser.aclose)
        self.addAsyncCleanup(provider.aclose)
        with (
            patch("backend.auth.settings", return_value=config),
            patch("backend.oauth.settings", return_value=config),
            patch("backend.oauth.AsyncClient", return_value=provider),
        ):
            self.assertEqual((await browser.get("/api/me")).status_code, 401)  # noqa: PT009
            headers = {"Origin": origin}
            start = await browser.post("/auth/start", headers=headers)
            self.assertEqual(start.status_code, 303)  # noqa: PT009
            params = parse_qs(urlsplit(start.headers["location"]).query)
            self.assertEqual(params["redirect_uri"], [redirect_uri])  # noqa: PT009
            challenge = params["code_challenge"][0]

            callback = await browser.get(
                redirect_uri, params={"code": "mock-code", "state": "A" * 43}
            )
            self.assertEqual(callback.status_code, 401)  # noqa: PT009
            self.assertEqual(provider_calls, [])  # noqa: PT009

            callback = await browser.get(
                redirect_uri, params={"code": "mock-code", "state": params["state"][0]}
            )
            self.assertEqual(callback.status_code, 303)  # noqa: PT009
            session = browser.cookies["__Secure-sheep.session"]
            cookie = callback.headers.get_list("set-cookie")[-1]
            self.assertIn("HttpOnly", cookie)  # noqa: PT009
            self.assertIn("Secure", cookie)  # noqa: PT009

            viewer = await browser.get("/api/me")
            self.assertEqual(viewer.status_code, 200)  # noqa: PT009
            self.assertEqual(  # noqa: PT009
                User.model_validate_json(viewer.content),
                User(
                    id="123",
                    name="sheep",
                    email="sheep@example.com",
                    githubLogin="sheep",
                    githubId="123",
                ),
            )
            payload, signature = session.rsplit(".", 1)
            replacement = "B" if signature.startswith("A") else "A"
            browser.cookies.set(
                "__Secure-sheep.session",
                payload + "." + replacement + signature[1:],
                domain="sheep.example.com",
                path="/",
            )
            self.assertEqual((await browser.get("/api/me")).status_code, 401)  # noqa: PT009
            logout = await browser.post("/auth/sign-out", headers=headers)
            self.assertEqual(logout.status_code, 303)  # noqa: PT009
            self.assertNotIn("__Secure-sheep.session", browser.cookies)  # noqa: PT009
