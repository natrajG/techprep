import os
import tempfile
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


if __name__ == "__main__":
    unittest.main()
