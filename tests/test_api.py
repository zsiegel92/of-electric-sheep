"""Exercise the HTTP contracts against Atlas-migrated Postgres and a fake TypeSafe."""

import json
import os
import subprocess
import unittest
from contextlib import ExitStack
from email import policy
from email.parser import BytesParser
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import httpx
import inngest
import zstandard
from fastapi import Response
from fastapi.testclient import TestClient

from backend.auth import COOKIE, User, issue_session
from backend.db import pool
from backend.jobs import TRACE_COMPLETED, persist_trace
from backend.jobs import client as inngest_client
from backend.main import app
from backend.migrate import dev_database, with_search_path
from backend.oauth import CALLBACK
from backend.pipelines import hash_pipeline
from backend.settings import settings
from backend.traces import DecisionTraceRecord

ORIGIN = "http://localhost:5173"
ORIGIN_HEADER = {"Origin": ORIGIN}
USER = User(name="Fixture User", email="fixture@example.test", githubId="fixture-owner")
OTHER = User(name="Other User", email="other@example.test", githubId="fixture-other")


def mock_typesafe(request):
    if request.headers["authorization"] != "Bearer upstream-fixture-key":
        return httpx.Response(401)
    if request.method == "GET":
        return httpx.Response(
            200,
            json={
                "models": [
                    {"name": "fixture", "description": "", "release_date": "2026-01-01"}
                ],
            },
        )
    if request.headers["content-type"].startswith("multipart/form-data"):
        headers = f"Content-Type: {request.headers['content-type']}\r\n\r\n".encode()
        parts = list(
            BytesParser(policy=policy.default)
            .parsebytes(headers + request.content)
            .iter_parts()
        )
        request_body = parts[0].get_payload(decode=True)
        assert isinstance(request_body, bytes)
        payload = json.loads(request_body)
        assert parts[1].get_payload(decode=True) == b"\x89PNG\r\n\x1a\nfixture"
        assert payload["assets"]["<image:" + "a" * 32 + ">"]["part"] == "asset-0"
        assert request.headers["typesafe-danger-zone-images"] == "true"
    else:
        payload = json.loads(request.content)
    if payload["state"] == "fail":
        return httpx.Response(429)

    return httpx.Response(
        200,
        json={
            "model": payload["model"],
            "answers": {
                name: {"type": "noul", "noul": 0.88 if "primary" in name else 0.42}
                for name in payload["questions"]
            },
            "usage": {"input_tokens": 2, "output_tokens": 4},
        },
    )


def signed_client(user):
    client = TestClient(app, base_url=ORIGIN)
    response = Response()
    issue_session(response, ORIGIN, user)
    cookie = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
    client.cookies.set(COOKIE, cookie, domain="localhost.local")
    return client


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        resources = ExitStack()
        cls.addClassCleanup(resources.close)
        db_url = resources.enter_context(dev_database())
        subprocess.run(
            [os.environ.get("ATLAS", "atlas"), "migrate", "apply", "--env", "sqlmodel"],
            env={**os.environ, "SHEEP_ATLAS_DATABASE": with_search_path(db_url)},
            check=True,
            stdout=subprocess.DEVNULL,
        )
        resources.enter_context(
            patch.dict(
                os.environ,
                {
                    "DATABASE_URL": db_url,
                    "AUTH_SECRET": "development-test-signing-key-not-from-dotenv",
                    "AUTH_ORIGINS": json.dumps([ORIGIN]),
                    "ALLOWED_GITHUB_USER_IDS": f"{USER.githubId},{OTHER.githubId}",
                    "TYPESAFE_BASE_URL": "https://fixture.example",
                    "TYPESAFE_API_KEY": "upstream-fixture-key",
                    "LANGFUSE_PUBLIC_KEY": "",
                    "LANGFUSE_SECRET_KEY": "",
                    "GITHUB_CLIENT_ID": "test-client",
                    "GITHUB_CLIENT_SECRET": "test-secret",
                },
            )
        )
        settings.cache_clear()
        resources.callback(settings.cache_clear)
        resources.callback(pool.cache_clear)
        resources.callback(pool().close)
        upstream = resources.enter_context(
            httpx.Client(transport=httpx.MockTransport(mock_typesafe))
        )
        resources.enter_context(
            patch("backend.system_one.upstream_client", return_value=upstream)
        )

    def setUp(self):
        self.frontend = signed_client(USER)
        self.addCleanup(self.frontend.close)
        self.trace_events: list[inngest.Event] = []
        self.enterContext(
            patch.object(
                inngest_client, "send_sync", side_effect=self.deliver_trace_event
            )
        )
        key = self.frontend.post(
            "/api/api-keys", json={"name": self._testMethodName}, headers=ORIGIN_HEADER
        )
        self.assertEqual(key.status_code, 201, key.text)
        self.key = key.json()
        self.bearer = {"Authorization": f"Bearer {self.key['secret']}"}

    def deliver_trace_event(self, event: inngest.Event) -> list[str]:
        self.assertEqual(event.name, TRACE_COMPLETED)
        self.trace_events.append(event)
        record = DecisionTraceRecord.model_validate(event.data)
        self.assertEqual(event.id, f"decision-trace-{record.traceId}")
        persist_trace(record)
        return [record.traceId]

    def test_oauth_and_key_access(self):
        with TestClient(app, base_url=ORIGIN) as anonymous:
            self.assertEqual(anonymous.get("/api/pipelines").status_code, 401)
            self.assertEqual(anonymous.post("/api/auth/start").status_code, 403)
            start = anonymous.post(
                "/api/auth/start", headers=ORIGIN_HEADER, follow_redirects=False
            )
            self.assertEqual(start.status_code, 303)
            self.assertIn("code_challenge_method=S256", start.headers["location"])
            self.assertEqual(anonymous.get("/api/v1/models").status_code, 401)
        self.assertEqual(self.frontend.get("/api/session").json(), USER.model_dump())
        self.assertEqual(self.frontend.get("/api/openapi.json").status_code, 200)
        self.assertEqual(
            self.frontend.get("/api/v1/models", headers=self.bearer).json()["models"][
                0
            ]["name"],
            "fixture",
        )
        key_path = f"/api/api-keys/{self.key['id']}"
        self.assertEqual(self.frontend.delete(key_path).status_code, 403)
        self.assertEqual(
            self.frontend.delete(key_path, headers=ORIGIN_HEADER).json(),
            {"deleted": True},
        )
        self.assertEqual(
            self.frontend.get("/api/v1/models", headers=self.bearer).status_code, 401
        )
        signed_out = self.frontend.post(
            "/api/auth/sign-out", headers=ORIGIN_HEADER, follow_redirects=False
        )
        self.assertEqual(signed_out.headers["location"], "/sign-in")
        self.assertEqual(self.frontend.get("/api/session").status_code, 401)

    def test_github_callback_with_public_or_private_email(self):
        for email_kind in (
            "public",
            "private",
            "permission_denied",
            "forbidden_account",
        ):
            github_id = 9876 if email_kind == "forbidden_account" else 1234
            requested_paths = []

            def github(
                request,
                email_kind=email_kind,
                github_id=github_id,
                requested_paths=requested_paths,
            ):
                path = request.url.path
                requested_paths.append(path)
                if path == "/login/oauth/access_token":
                    return httpx.Response(200, json={"access_token": "fixture-token"})
                if path == "/user":
                    email = "public@example.test" if email_kind == "public" else None
                    return httpx.Response(
                        200, json={"id": github_id, "login": "fixture", "email": email}
                    )
                if path == "/user/emails" and email_kind == "permission_denied":
                    return httpx.Response(403)
                if path == "/user/emails" and email_kind == "private":
                    return httpx.Response(
                        200,
                        json=[
                            {
                                "email": "other@example.test",
                                "primary": True,
                                "verified": False,
                            },
                            {
                                "email": "private@example.test",
                                "primary": True,
                                "verified": True,
                            },
                        ],
                    )
                raise AssertionError(f"Unexpected GitHub call to {path}")

            with (
                self.subTest(email_kind=email_kind),
                TestClient(app, base_url=ORIGIN) as browser,
                patch.object(settings(), "allowed_github_user_ids", "1234"),
                patch(
                    "backend.oauth.AsyncClient",
                    return_value=httpx.AsyncClient(
                        transport=httpx.MockTransport(github)
                    ),
                ),
            ):
                start = browser.post(
                    "/api/auth/start", headers=ORIGIN_HEADER, follow_redirects=False
                )
                state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
                callback = browser.get(
                    CALLBACK,
                    params={"code": "fixture-code", "state": state},
                    follow_redirects=False,
                )
                if email_kind == "permission_denied":
                    self.assertEqual(callback.status_code, 502)
                    self.assertIn("Email addresses", callback.json()["detail"])
                elif email_kind == "forbidden_account":
                    self.assertEqual(callback.status_code, 403)
                else:
                    self.assertEqual(callback.status_code, 303, callback.text)
                    self.assertEqual(
                        browser.get("/api/session").json()["email"],
                        f"{email_kind}@example.test",
                    )
                self.assertEqual(
                    "/user/emails" in requested_paths,
                    email_kind in {"private", "permission_denied"},
                )

    def test_compressed_multipart_and_failed_trace(self):
        reference = "<image:" + "a" * 32 + ">"
        image_request = {
            "model": "image-test",
            "state": reference,
            "questions": {
                "visible": {"type": "noul", "instructions": "Is the object visible?"}
            },
            "assets": {reference: {"type": "image", "part": "upload"}},
        }
        body = httpx.Request(
            "POST",
            ORIGIN,
            files={
                "request": (None, json.dumps(image_request), "application/json"),
                "upload": ("upload.png", b"\x89PNG\r\n\x1a\nfixture", "image/png"),
            },
        )
        compressed = zstandard.ZstdCompressor().compress(body.read())
        headers = {
            **self.bearer,
            "Content-Encoding": "zstd",
            "Content-Type": body.headers["content-type"],
            "typesafe-danger-zone-images": "true",
        }
        decision = self.frontend.post(
            "/api/v1/systemone", content=compressed, headers=headers
        )
        self.assertEqual(decision.status_code, 200, decision.text)
        trace_id = decision.json()["traceId"]
        trace = self.frontend.get(f"/api/traces/{trace_id}").json()["trace"]
        self.assertEqual(trace["state"], reference)
        self.assertFalse(trace["failed"])
        self.assertEqual(
            self.frontend.post(
                "/api/v1/systemone", content=b"bad zstd", headers=headers
            ).status_code,
            400,
        )

        failure = self.frontend.post(
            "/api/v1/systemone",
            json={
                "model": "fail-test",
                "state": "fail",
                "questions": image_request["questions"],
            },
            headers=self.bearer,
        )
        self.assertEqual(failure.status_code, 429)
        failed_pipeline = next(
            item
            for item in self.frontend.get("/api/pipelines").json()
            if item["model"] == "fail-test"
        )
        failed_traces = self.frontend.get(
            f"/api/pipelines/{failed_pipeline['id']}/traces"
        ).json()["traces"]
        self.assertTrue(failed_traces[0]["failed"])
        self.assertEqual(failed_traces[0]["model"], "fail-test")
        self.assertEqual(
            [event.data["failed"] for event in self.trace_events], [False, True]
        )

    def test_inngest_endpoint_is_internal(self):
        self.assertEqual(self.frontend.get("/api/inngest").json()["function_count"], 1)
        paths = self.frontend.get("/api/openapi.json").json()["paths"]
        self.assertNotIn("/api/inngest", paths)

    def test_trace_event_truncates_oversized_state_and_can_be_retried(self):
        decision = self.frontend.post(
            "/api/v1/systemone",
            json={
                "model": "large-state",
                "state": "x" * (260 * 1024),
                "questions": {
                    "matched": {"type": "noul", "instructions": "Does it match?"}
                },
            },
            headers=self.bearer,
        )
        self.assertEqual(decision.status_code, 200, decision.text)
        (event,) = self.trace_events
        self.assertTrue(event.data["payloadTruncated"])
        self.assertNotIn("state", event.data)
        persist_trace(DecisionTraceRecord.model_validate(event.data))
        detail = self.frontend.get(f"/api/traces/{decision.json()['traceId']}").json()
        self.assertTrue(detail["trace"]["payloadTruncated"])
        self.assertIn("matched", detail["trace"]["answers"])

    def test_pipeline_versions_trace_annotations_and_export(self):
        definition = {
            "model": "group-test",
            "questions": {
                "source": {"type": "noul", "instructions": "Source question"}
            },
        }
        for index in range(11):
            response = self.frontend.post(
                "/api/v1/systemone",
                json={**definition, "state": ["context", index]},
                headers=self.bearer,
            )
            self.assertEqual(response.status_code, 200, response.text)
        source = next(
            item
            for item in self.frontend.get("/api/pipelines").json()
            if item["model"] == "group-test"
        )
        source_id = source["id"]
        versions = self.frontend.get(
            "/api/pipelines/versions", params=[("ids", source_id)]
        ).json()
        self.assertEqual(len(versions), 1)

        result = self.frontend.post(
            "/api/pipelines/evolve",
            headers=ORIGIN_HEADER,
            json={
                "sourceId": source_id,
                "draft": {
                    "model": "group-test",
                    "displayName": "Updated",
                    "baseUrl": None,
                    "uiIgnored": False,
                    "questions": {
                        "primary": {"type": "noul", "instructions": "New question"}
                    },
                    "options": {"headers": {}},
                },
            },
        )
        self.assertEqual(result.status_code, 200, result.text)
        primary_id = result.json()["pipelineId"]
        promote = self.frontend.post(
            "/api/pipelines/primary",
            headers=ORIGIN_HEADER,
            json={"pipelineId": primary_id},
        )
        self.assertEqual(promote.status_code, 204, promote.text)
        alias = self.frontend.put(
            "/api/pipelines/question-alias",
            headers=ORIGIN_HEADER,
            json={
                "pipelineId": primary_id,
                "questionName": "primary",
                "alias": "Friendly question",
            },
        )
        self.assertEqual(alias.json(), "Friendly question")
        versions = self.frontend.get(
            "/api/pipelines/versions", params=[("ids", source_id)]
        ).json()
        self.assertEqual({item["id"] for item in versions}, {source_id, primary_id})

        replay = self.frontend.post(
            "/api/pipelines/run",
            headers=ORIGIN_HEADER,
            json={"pipelineId": source_id, "state": "text", "exact": False},
        ).json()
        self.assertEqual(replay["answers"]["source"]["noul"], 0.88)
        self.assertEqual(
            replay["traceAnnotation"],
            {
                "pipelineId": primary_id,
                "questionLinks": [["source", "primary"]],
            },
        )
        exact = self.frontend.post(
            "/api/system-one/decide-by-pipeline",
            headers={"X-API-Key": self.key["secret"], "x-use-exact-pipeline": "true"},
            json={"pipelineId": source_id, "state": "text"},
        ).json()
        self.assertEqual(exact["answers"]["source"]["noul"], 0.42)

        trace_id = replay["traceId"]
        annotation = self.frontend.put(
            "/api/traces/annotation",
            headers=ORIGIN_HEADER,
            json={
                "pipelineId": primary_id,
                "traceId": trace_id,
                "questionName": "primary",
                "choiceKey": "true",
            },
        )
        self.assertEqual(annotation.status_code, 204, annotation.text)
        exported = self.frontend.get(
            f"/api/traces/{primary_id}/export?status=annotated"
        )
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertEqual(
            json.loads(exported.text)["annotations"],
            [{"questionName": "primary", "choiceKey": "true"}],
        )

        page_url = f"/api/pipelines/{source_id}/traces"
        page = self.frontend.get(page_url, params={"order": "least-single"}).json()
        next_page = self.frontend.get(
            page_url,
            params={
                "cursor": page["next"],
                "until": page["until"],
                "order": "least-single",
            },
        ).json()
        self.assertEqual((len(page["traces"]), len(next_page["traces"])), (10, 2))
        self.assertTrue(
            {trace["traceId"] for trace in page["traces"]}.isdisjoint(
                trace["traceId"] for trace in next_page["traces"]
            )
        )
        with signed_client(OTHER) as other:
            self.assertEqual(other.get(f"/api/traces/{trace_id}").status_code, 404)
            self.assertEqual(
                other.get(f"/api/traces/{primary_id}/export").status_code, 404
            )

    def test_definition_hash_matches_existing_js_wire_format(self):
        definition = {
            "model": "fixture",
            "questions": {
                "a": {
                    "type": "choice",
                    "instructions": {"b": "🌅", "a": 1e-7},
                    "criteria": {"10": None, "2": "two", "000": ["text", 1e21]},
                }
            },
            "options": {"headers": {}},
        }
        # SHA-256 of the former JS canonicalize()/JSON.stringify() output.
        self.assertEqual(
            hash_pipeline(definition),
            "f6bead275d833d2fcf321d7483943885bc72320780ac1016e50b6545c658f4b7",
        )
