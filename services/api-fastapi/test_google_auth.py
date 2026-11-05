import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import google_auth, rate_limit, users
from app.main import app


class GoogleSignInTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        for patcher in (
            patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db"),
            patch.dict(os.environ, {"APP_ENV": "development", "GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com"}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        rate_limit.reset_memory()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("203.0.113.5", 1)), base_url="https://techprep.test",
        )
        self.addAsyncCleanup(self.client.aclose)

    async def google_login(self, email):
        with patch.object(google_auth, "verify", return_value=email):
            return await self.client.post("/api/v1/auth/google", json={"credential": "x" * 30})

    async def test_config_reports_the_client_id_when_configured(self):
        response = await self.client.get("/api/v1/config")
        self.assertEqual(response.json()["google_client_id"], "test-client-id.apps.googleusercontent.com")

    async def test_config_hides_google_sign_in_when_unconfigured(self):
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": ""}):
            response = await self.client.get("/api/v1/config")
        self.assertIsNone(response.json()["google_client_id"])

    async def test_first_sign_in_creates_an_account_and_a_session(self):
        response = await self.google_login("newperson@example.com")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["token"])
        self.assertEqual(users.get_email(body["user"]), "newperson@example.com")

    async def test_returning_user_signs_back_into_the_same_account(self):
        first = await self.google_login("sameuser@example.com")
        second = await self.google_login("sameuser@example.com")
        self.assertEqual(first.json()["user"], second.json()["user"])

    async def test_unverifiable_credential_is_rejected(self):
        with patch.object(google_auth, "verify", return_value=None):
            response = await self.client.post("/api/v1/auth/google", json={"credential": "x" * 30})
        self.assertEqual(response.status_code, 401)

    async def test_disabled_when_client_id_is_not_set(self):
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": ""}):
            response = await self.client.post("/api/v1/auth/google", json={"credential": "x" * 30})
        self.assertEqual(response.status_code, 503)

    async def test_logged_in_user_can_reach_me(self):
        response = await self.google_login("profile@example.com")
        token = response.json()["token"]
        me = await self.client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["email"], "profile@example.com")


class GoogleDesktopSignInTests(unittest.IsolatedAsyncioTestCase):
    """The desktop app cannot embed Google's sign-in (Google blocks it in embedded browsers), so it
    hands the flow to the system browser and redeems a one-time handoff code for a session."""

    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        for patcher in (
            patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db"),
            patch.dict(os.environ, {
                "APP_ENV": "development",
                "GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com",
                "GOOGLE_CLIENT_SECRET": "test-client-secret",
            }),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        rate_limit.reset_memory()
        from app import main as main_module
        main_module._google_desktop_states.clear()
        main_module._google_desktop_handoffs.clear()
        self.main_module = main_module
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("203.0.113.5", 1)), base_url="https://techprep.test",
        )
        self.addAsyncCleanup(self.client.aclose)

    async def test_config_reports_desktop_signin_only_when_secret_is_set(self):
        response = await self.client.get("/api/v1/config")
        self.assertTrue(response.json()["google_desktop_signin"])
        with patch.dict(os.environ, {"GOOGLE_CLIENT_SECRET": ""}):
            response = await self.client.get("/api/v1/config")
        self.assertFalse(response.json()["google_desktop_signin"])

    async def test_start_redirects_to_google_with_a_fresh_state(self):
        response = await self.client.get("/api/v1/auth/google/desktop/start", follow_redirects=False)
        self.assertEqual(response.status_code, 307)
        location = response.headers["location"]
        self.assertTrue(location.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
        self.assertIn("state=", location)
        self.assertEqual(len(self.main_module._google_desktop_states), 1)

    async def test_start_is_disabled_without_a_client_secret(self):
        with patch.dict(os.environ, {"GOOGLE_CLIENT_SECRET": ""}):
            response = await self.client.get("/api/v1/auth/google/desktop/start", follow_redirects=False)
        self.assertEqual(response.status_code, 503)

    async def test_callback_rejects_an_unknown_state(self):
        response = await self.client.get("/api/v1/auth/google/desktop/callback?state=bogus&code=abc")
        self.assertEqual(response.status_code, 200)
        self.assertIn("expired", response.text)
        self.assertNotIn("techprep://", response.text)

    async def test_callback_issues_a_handoff_code_on_success(self):
        self.main_module._google_desktop_states["valid-state"] = time.time()
        with patch.object(google_auth, "exchange_code", return_value="id-token"), \
             patch.object(google_auth, "verify", return_value="deskuser@example.com"):
            response = await self.client.get("/api/v1/auth/google/desktop/callback?state=valid-state&code=auth-code")
        self.assertEqual(response.status_code, 200)
        self.assertIn("techprep://auth-callback?code=", response.text)
        self.assertEqual(len(self.main_module._google_desktop_handoffs), 1)
        # The state is single-use.
        self.assertEqual(len(self.main_module._google_desktop_states), 0)

    async def test_exchange_creates_a_session_and_the_code_is_single_use(self):
        self.main_module._google_desktop_handoffs["the-handoff-code"] = ("deskuser@example.com", time.time())
        first = await self.client.post("/api/v1/auth/google/desktop/exchange", json={"code": "the-handoff-code"},
                                        headers={"X-Client-Kind": "desktop"})
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json()["token"])
        self.assertEqual(users.get_email(first.json()["user"]), "deskuser@example.com")
        second = await self.client.post("/api/v1/auth/google/desktop/exchange", json={"code": "the-handoff-code"})
        self.assertEqual(second.status_code, 400)

    async def test_exchange_rejects_an_unknown_code(self):
        response = await self.client.post("/api/v1/auth/google/desktop/exchange", json={"code": "nope-nope-nope"})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
