import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import rate_limit, users
from app.main import app

PASSWORD = "a-valid-password"


class SingleSessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        for patcher in (
            patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db"),
            patch.dict(os.environ, {"APP_ENV": "development", "ALLOW_SIGNUP": "true"}),
            patch.object(users, "SESSION_CACHE_SECONDS", 0),
            patch("app.main.asyncio.sleep", new=AsyncMock()),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        users._session_cache.clear()
        rate_limit.reset_memory()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("203.0.113.5", 1)), base_url="https://techprep.test",
        )
        self.addAsyncCleanup(self.client.aclose)
        users.create_user("alice", PASSWORD, "alice@example.com")

    async def login(self, kind=None):
        headers = {"X-Client-Kind": kind} if kind else {}
        response = await self.client.post("/api/v1/login", json={"username": "alice", "password": PASSWORD}, headers=headers)
        self.assertEqual(response.status_code, 200)
        return {"Authorization": "Bearer " + response.json()["token"]}

    async def status(self, headers):
        return (await self.client.get("/api/v1/me", headers=headers)).status_code

    async def test_new_login_signs_out_the_older_device(self):
        first = await self.login("desktop")
        self.assertEqual(await self.status(first), 200)
        second = await self.login("desktop")
        self.assertEqual(await self.status(first), 401)
        self.assertEqual(await self.status(second), 200)

    async def test_website_login_does_not_interrupt_the_desktop_call(self):
        desktop = await self.login("desktop")
        web = await self.login()
        self.assertEqual(await self.status(desktop), 200)
        self.assertEqual(await self.status(web), 200)
        await self.login()
        self.assertEqual(await self.status(web), 401)
        self.assertEqual(await self.status(desktop), 200)

    async def test_signed_out_message_explains_why(self):
        first = await self.login("desktop")
        await self.login("desktop")
        response = await self.client.get("/api/v1/me", headers=first)
        self.assertIn("another device", response.json()["detail"])

    async def test_other_users_are_unaffected(self):
        users.create_user("bob", PASSWORD, "bob@example.com")
        alice = await self.login("desktop")
        await self.client.post("/api/v1/login", json={"username": "bob", "password": PASSWORD}, headers={"X-Client-Kind": "desktop"})
        self.assertEqual(await self.status(alice), 200)

    async def test_forged_session_id_is_rejected(self):
        from app import auth
        await self.login("desktop")
        forged = {"Authorization": "Bearer " + auth.issue_token("alice", "desktop", "guess")}
        self.assertEqual(await self.status(forged), 401)

    async def test_password_change_signs_out_every_device(self):
        desktop = await self.login("desktop")
        web = await self.login()
        users.set_password("alice", "another-password")
        self.assertEqual(await self.status(desktop), 401)
        self.assertEqual(await self.status(web), 401)

    async def test_signup_starts_a_session_too(self):
        response = await self.client.post(
            "/api/v1/signup", json={"username": "carol", "password": PASSWORD, "email": "carol@example.com"},
            headers={"X-Client-Kind": "desktop"},
        )
        first = {"Authorization": "Bearer " + response.json()["token"]}
        self.assertEqual(await self.status(first), 200)
        await self.client.post("/api/v1/login", json={"username": "carol", "password": PASSWORD}, headers={"X-Client-Kind": "desktop"})
        self.assertEqual(await self.status(first), 401)


if __name__ == "__main__":
    unittest.main()
