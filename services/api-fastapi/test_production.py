import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from app import auth, downloads, rate_limit, settings, users
from app.main import app

PRODUCTION = {
    "APP_ENV": "production",
    "APP_PUBLIC_URL": "https://techprep-demo.duckdns.org",
    "AUTH_SECRET": "test-only-long-secret-not-for-deployment",
    "APP_USERNAME": "operator",
    "APP_PASSWORD": "test-only-password",
    "OPENAI_API_KEY": "test-only",
    "USERS_DB": "/data/users.db",
    "DESKTOP_RELEASE_DIR": "/releases",
}


class SettingsTests(unittest.TestCase):
    def test_development_does_not_require_production_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            settings.validate()
            self.assertTrue(users.signup_enabled())
            self.assertEqual(users.minimum_password(), 8)

    def test_production_configuration_and_private_pilot_defaults(self):
        with patch.dict(os.environ, PRODUCTION, clear=True):
            settings.validate()
            self.assertFalse(users.signup_enabled())
            self.assertEqual(users.minimum_password(), 12)
            self.assertIsNotNone(users.validate("username", "eightchr"))

    def test_missing_configuration_fails_closed(self):
        for key in PRODUCTION.keys() - {"APP_ENV"}:
            env = {k: v for k, v in PRODUCTION.items() if k != key}
            with self.subTest(key=key), patch.dict(os.environ, env, clear=True):
                with self.assertRaises(ValueError):
                    settings.validate()

    def test_unsafe_public_urls_are_rejected(self):
        for url in (
            "", "http://techprep.duckdns.org", "https://127.0.0.1", "https://192.168.1.1",
            "https://localhost", "https://app.local", "https://[::1]", "https://user:pw@site.com",
            "https://site.com/path", "https://site.com/?token=bad", "https://site.com/#fragment",
            "https://site.com:5173",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                settings.public_origin(url)
        self.assertEqual(settings.public_origin("https://techprep.duckdns.org/"), "https://techprep.duckdns.org")

    def test_weak_credentials_and_invalid_limits_are_rejected(self):
        for key, value in (
            ("AUTH_SECRET", "replace-this-secret-with-a-random-value"),
            ("AUTH_SECRET", "short"),
            ("APP_PASSWORD", "short"),
            ("AUTH_RATE_LIMIT_ATTEMPTS", "0"),
            ("AI_REQUESTS_PER_MINUTE", "-1"),
            ("AUTH_TOKEN_TTL_HOURS", "0"),
            ("ALLOW_SIGNUP", "maybe"),
            ("STORE_APP_PUBLISHED", "maybe"),
            ("USERS_DB", "relative.db"),
        ):
            with self.subTest(key=key), patch.dict(os.environ, {**PRODUCTION, key: value}, clear=True):
                with self.assertRaises(ValueError):
                    settings.validate()


class RateLimitTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.db_patch = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)

    def test_counter_is_persisted_and_expires(self):
        with patch("app.rate_limit.time.time", return_value=1000):
            rate_limit.consume("auth", "client", 2, 60)
            rate_limit.consume("auth", "client", 2, 60)
            with self.assertRaises(HTTPException) as error:
                rate_limit.consume("auth", "client", 2, 60)
            self.assertEqual(error.exception.status_code, 429)
            self.assertEqual(error.exception.headers["Retry-After"], "60")
            rate_limit.consume("auth", "another-client", 2, 60)
            rate_limit.consume("ai", "client", 2, 60)
        with patch("app.rate_limit.time.time", return_value=1060):
            rate_limit.consume("auth", "client", 2, 60)
        with users.connect() as conn:
            rows = conn.execute("SELECT key, attempts FROM rate_limits").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][1], 1)
        self.assertNotIn("client", rows[0][0])

    def test_existing_account_storage_still_works(self):
        self.assertTrue(users.create_user("SomeUser", "test-password"))
        self.assertFalse(users.create_user("someuser", "test-password"))
        self.assertEqual(users.verify_user("someuser", "test-password"), "SomeUser")
        self.assertIsNone(users.verify_user("someuser", "wrong"))


class ProductionEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.env = patch.dict(os.environ, {
            **PRODUCTION, "AUTH_RATE_LIMIT_ATTEMPTS": "1", "AI_REQUESTS_PER_MINUTE": "1",
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.db = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        self.db.start()
        self.addCleanup(self.db.stop)
        rate_limit.reset_memory()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("203.0.113.1", 5000)),
            base_url="https://techprep-demo.duckdns.org",
        )

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_public_config_does_not_expose_secrets_and_disables_signup(self):
        response = await self.client.get("/api/v1/config")
        self.assertEqual(response.json(), {
            "signup_enabled": False, "minimum_password": 12, "password_reset_enabled": False,
            "local_network": False, "store_url": None,
        })
        signup = await self.client.post("/api/v1/signup", json={
            "username": "newuser", "password": "a-valid-password", "email": "new@example.com",
        })
        self.assertEqual(signup.status_code, 403)

    async def test_store_link_appears_only_after_publication(self):
        self.assertIsNone((await self.client.get("/api/v1/config")).json()["store_url"])
        with patch.dict(os.environ, {"STORE_APP_PUBLISHED": "true"}):
            response = await self.client.get("/api/v1/config")
        self.assertEqual(response.json()["store_url"], "https://apps.microsoft.com/detail/9N36X6C5706B")

    async def login(self, username, password, address="203.0.113.1"):
        client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=(address, 5000)), base_url="https://techprep-demo.duckdns.org",
        )
        async with client:
            return await client.post("/api/v1/login", json={"username": username, "password": password})

    async def test_failed_logins_are_locked_out_durably(self):
        name = PRODUCTION["APP_USERNAME"]
        with patch("app.main.asyncio.sleep", new=AsyncMock()):
            self.assertEqual((await self.login(name, "wrong-password")).status_code, 401)
            locked = await self.login(name, "wrong-password")
        self.assertEqual(locked.status_code, 429)
        self.assertIn("retry-after", locked.headers)
        self.assertEqual((await self.login(name, PRODUCTION["APP_PASSWORD"])).status_code, 429)

    async def test_successful_logins_never_lock_an_account(self):
        for _ in range(5):
            self.assertEqual((await self.login(PRODUCTION["APP_USERNAME"], PRODUCTION["APP_PASSWORD"])).status_code, 200)

    async def test_users_sharing_an_address_do_not_lock_each_other_out(self):
        with patch("app.main.asyncio.sleep", new=AsyncMock()):
            await self.login("alice", "wrong-password")
            self.assertEqual((await self.login("alice", "wrong-password")).status_code, 429)
            self.assertEqual((await self.login("bob", "wrong-password")).status_code, 401)
        self.assertEqual((await self.login(PRODUCTION["APP_USERNAME"], PRODUCTION["APP_PASSWORD"])).status_code, 200)

    async def test_the_lockout_is_per_address_so_an_attacker_cannot_lock_out_the_owner(self):
        name = PRODUCTION["APP_USERNAME"]
        with patch("app.main.asyncio.sleep", new=AsyncMock()):
            await self.login(name, "wrong-password", address="198.51.100.9")
            self.assertEqual((await self.login(name, "wrong-password", address="198.51.100.9")).status_code, 429)
        self.assertEqual((await self.login(name, PRODUCTION["APP_PASSWORD"])).status_code, 200)

    async def test_one_address_cannot_try_unlimited_accounts(self):
        with patch.dict(os.environ, {"AUTH_RATE_LIMIT_IP_ATTEMPTS": "3"}), patch("app.main.asyncio.sleep", new=AsyncMock()):
            for index in range(3):
                self.assertEqual((await self.login(f"user{index}", "wrong-password")).status_code, 401)
            self.assertEqual((await self.login("user9", "wrong-password")).status_code, 429)

    def publish(self, contents=b"MZ signed installer", **changes):
        releases = Path(self.directory.name) / "releases"
        releases.mkdir(exist_ok=True)
        (releases / "TechPrep-Setup.exe").write_bytes(contents)
        manifest = {
            "schema": 1, "file": "TechPrep-Setup.exe", "version": "0.2.0", "signed": True,
            "size": len(contents), "sha256": hashlib.sha256(contents).hexdigest(),
            "serverUrl": PRODUCTION["APP_PUBLIC_URL"] + "/",
            **changes,
        }
        (releases / "desktop-release.json").write_text(json.dumps(manifest))
        os.environ["DESKTOP_RELEASE_DIR"] = str(releases)
        downloads._verified.clear()
        return releases

    async def download(self, target="windows"):
        headers = {"Authorization": f"Bearer {auth.issue_token('download-user')}"}
        return await self.client.get(f"/api/v1/downloads/{target}", headers=headers)

    async def test_production_serves_only_a_verified_signed_release(self):
        self.publish()
        response = await self.download()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"MZ signed installer")

    async def test_production_rejects_unsigned_mismatched_or_missing_releases(self):
        os.environ["DESKTOP_RELEASE_DIR"] = str(Path(self.directory.name) / "empty")
        self.assertEqual((await self.download()).status_code, 503)
        for changes in (
            {"signed": False}, {"signed": "true"}, {"sha256": "0" * 64}, {"size": 1},
            {"serverUrl": "https://other.duckdns.org/"}, {"serverUrl": "https://192.168.0.109:5173/"},
            {"file": "Other.exe"}, {"schema": 2},
        ):
            with self.subTest(changes=changes):
                self.publish(**changes)
                self.assertEqual((await self.download()).status_code, 503)
        releases = self.publish()
        (releases / "desktop-release.json").write_text("not json")
        self.assertEqual((await self.download()).status_code, 503)

    async def test_replaced_installer_is_rehashed(self):
        releases = self.publish()
        self.assertEqual((await self.download()).status_code, 200)
        (releases / "TechPrep-Setup.exe").write_bytes(b"MZ tampered installe")
        self.assertEqual((await self.download()).status_code, 503)

    async def test_private_ca_is_never_offered_in_production(self):
        self.assertEqual((await self.download("ca")).status_code, 404)

    async def test_ai_quota_requires_auth_and_does_not_call_provider_when_exceeded(self):
        response = await self.client.post("/api/v1/answer", json={})
        self.assertEqual(response.status_code, 401)
        headers = {"Authorization": f"Bearer {auth.issue_token('quota-user')}"}
        response = await self.client.post("/api/v1/answer", json={}, headers=headers)
        self.assertEqual(response.status_code, 400)
        response = await self.client.post("/api/v1/answer", json={}, headers=headers)
        self.assertEqual(response.status_code, 429)

    async def test_answer_passes_only_bounded_recent_turns_to_chat(self):
        calls = []

        async def fake_stream(system, question, history, on_usage=None):
            calls.append((system, question, history))
            yield "```python\nprint('ok')\n```"

        headers = {"Authorization": "Bearer " + auth.issue_token("context-user")}
        history = [
            {"question": "Write a Python reverse string program without reverse()", "answer": "```python\nprint('ok')\n```"},
            {"question": "Can it handle Unicode?", "answer": "Yes."},
        ]
        with patch("app.llm.stream_chat", fake_stream):
            response = await self.client.post("/api/v1/answer", json={
                "question": "Explain the first program", "history": history,
            }, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls[0][1], "Explain the first program")
        self.assertIn("return only the working program", calls[0][0])
        self.assertEqual(calls[0][2], [
            {"role": "user", "content": history[0]["question"]},
            {"role": "assistant", "content": history[0]["answer"]},
            {"role": "user", "content": history[1]["question"]},
            {"role": "assistant", "content": history[1]["answer"]},
        ])
        self.assertIn("event: done", response.text)

        invalid = await self.client.post("/api/v1/answer", json={
            "question": "Explain it", "history": history + [history[0]],
        }, headers={"Authorization": "Bearer " + auth.issue_token("other-context-user")})
        self.assertEqual(invalid.status_code, 422)


class ProviderErrorTests(ProductionEndpointTests):
    async def test_provider_errors_are_not_shown_to_users_in_production(self):
        async def failing(*_args, **_kwargs):
            raise RuntimeError("provider secret detail sk-test")
            yield ""

        headers = {"Authorization": f"Bearer {auth.issue_token('error-user')}"}
        with patch("app.llm.stream_chat", failing), self.assertLogs("techprep", "ERROR"):
            response = await self.client.post("/api/v1/answer", json={"question": "Q?"}, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertIn("event: error", response.text)
        self.assertIn("temporarily unavailable", response.text)
        self.assertNotIn("secret detail", response.text)
