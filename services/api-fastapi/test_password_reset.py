import os
import re
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import mailer, rate_limit, subscriptions, users
from app.main import app

ENV = {
    "APP_ENV": "development", "ALLOW_SIGNUP": "true", "SMTP_HOST": "smtp.test", "MAIL_FROM": "TechPrep <no-reply@test>",
    "APP_PUBLIC_URL": "https://techprep.test",
}
PASSWORD = "a-valid-password"


class PasswordResetTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        for patcher in (
            patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db"),
            patch.dict(os.environ, ENV),
            patch("app.main.asyncio.sleep", new=AsyncMock()),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        rate_limit.reset_memory()
        self.sent = []
        sender = patch.object(mailer, "send", side_effect=lambda *args: self.sent.append(args))
        sender.start()
        self.addCleanup(sender.stop)
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("203.0.113.5", 1)), base_url="https://techprep.test",
        )
        self.assertTrue(users.create_user("alice", PASSWORD, "alice@example.com"))

    async def asyncTearDown(self):
        await self.client.aclose()

    async def forgot(self, email):
        return await self.client.post("/api/v1/forgot-password", json={"email": email})

    def token_from_mail(self):
        return re.search(r"#reset=([\w-]+)", self.sent[-1][2]).group(1)

    async def test_reset_link_is_emailed_and_sets_a_new_password(self):
        response = await self.forgot("Alice@Example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.sent), 1)
        to, subject, body = self.sent[0]
        self.assertEqual(to, "alice@example.com")
        self.assertIn("https://techprep.test/#reset=", body)
        reset = await self.client.post("/api/v1/reset-password", json={"token": self.token_from_mail(), "password": "brand-new-password"})
        self.assertEqual(reset.status_code, 200)
        self.assertIsNone(users.verify_user("alice", PASSWORD))
        self.assertEqual(users.verify_user("alice", "brand-new-password"), "alice")

    async def test_token_works_once_and_only_its_hash_is_stored(self):
        await self.forgot("alice@example.com")
        token = self.token_from_mail()
        with users.connect() as conn:
            stored = conn.execute("SELECT token_hash FROM password_resets").fetchall()
        self.assertEqual(len(stored), 1)
        self.assertNotIn(token, stored[0][0])
        first = await self.client.post("/api/v1/reset-password", json={"token": token, "password": "brand-new-password"})
        again = await self.client.post("/api/v1/reset-password", json={"token": token, "password": "another-new-password"})
        self.assertEqual((first.status_code, again.status_code), (200, 400))
        self.assertEqual(users.verify_user("alice", "brand-new-password"), "alice")

    async def test_expired_and_unknown_tokens_are_rejected(self):
        await self.forgot("alice@example.com")
        token = self.token_from_mail()
        with patch("app.users.time.time", return_value=time.time() + users.RESET_TTL_SECONDS + 5):
            expired = await self.client.post("/api/v1/reset-password", json={"token": token, "password": "brand-new-password"})
        unknown = await self.client.post("/api/v1/reset-password", json={"token": "x" * 43, "password": "brand-new-password"})
        self.assertEqual((expired.status_code, unknown.status_code), (400, 400))
        self.assertEqual(users.verify_user("alice", PASSWORD), "alice")

    async def test_a_new_request_invalidates_the_previous_link(self):
        await self.forgot("alice@example.com")
        old = self.token_from_mail()
        await self.forgot("alice@example.com")
        reset = await self.client.post("/api/v1/reset-password", json={"token": old, "password": "brand-new-password"})
        self.assertEqual(reset.status_code, 400)

    async def test_weak_password_does_not_spend_the_token(self):
        await self.forgot("alice@example.com")
        token = self.token_from_mail()
        weak = await self.client.post("/api/v1/reset-password", json={"token": token, "password": "short"})
        self.assertEqual(weak.status_code, 422)
        ok = await self.client.post("/api/v1/reset-password", json={"token": token, "password": "brand-new-password"})
        self.assertEqual(ok.status_code, 200)

    async def test_response_does_not_reveal_whether_an_email_is_registered(self):
        known = await self.forgot("alice@example.com")
        unknown = await self.forgot("nobody@example.com")
        invalid = await self.forgot("not-an-email")
        self.assertEqual({known.status_code, unknown.status_code, invalid.status_code}, {200})
        self.assertEqual(known.json(), unknown.json())
        self.assertEqual(known.json(), invalid.json())
        self.assertEqual(len(self.sent), 1)

    async def test_requests_are_throttled_per_address_and_per_email(self):
        for _ in range(3):
            await self.forgot("alice@example.com")
        self.assertEqual(len(self.sent), 3)
        await self.forgot("alice@example.com")
        self.assertEqual(len(self.sent), 3)
        for index in range(7):
            await self.forgot(f"other{index}@example.com")
        self.assertEqual((await self.forgot("alice@example.com")).status_code, 429)

    async def test_unavailable_without_mail_settings(self):
        with patch.dict(os.environ, {"SMTP_HOST": ""}):
            self.assertEqual((await self.forgot("alice@example.com")).status_code, 503)
            self.assertFalse((await self.client.get("/api/v1/config")).json()["password_reset_enabled"])
        self.assertTrue((await self.client.get("/api/v1/config")).json()["password_reset_enabled"])

    async def test_mail_failure_is_logged_and_hidden_from_the_caller(self):
        with patch.object(mailer, "send", side_effect=OSError("smtp down")), self.assertLogs("techprep", "ERROR"):
            self.assertEqual((await self.forgot("alice@example.com")).status_code, 200)

    async def test_signup_requires_a_valid_unique_email(self):
        body = {"username": "bobby", "password": PASSWORD}
        self.assertEqual((await self.client.post("/api/v1/signup", json=body)).status_code, 422)
        self.assertEqual((await self.client.post("/api/v1/signup", json={**body, "email": "nope"})).status_code, 422)
        self.assertEqual((await self.client.post("/api/v1/signup", json={**body, "email": "ALICE@example.com"})).status_code, 409)
        self.assertEqual((await self.client.post("/api/v1/signup", json={**body, "email": "bob@example.com"})).status_code, 200)
        self.assertEqual(users.get_email("bobby"), "bob@example.com")

    async def test_adding_a_recovery_email_needs_the_current_password(self):
        users.create_user("legacy", PASSWORD)
        headers = {"Authorization": f"Bearer {self.token('legacy')}"}
        wrong = await self.client.put("/api/v1/me/email", json={"email": "l@example.com", "password": "wrong-password"}, headers=headers)
        self.assertEqual(wrong.status_code, 403)
        taken = await self.client.put("/api/v1/me/email", json={"email": "alice@example.com", "password": PASSWORD}, headers=headers)
        self.assertEqual(taken.status_code, 409)
        done = await self.client.put("/api/v1/me/email", json={"email": "L@Example.com", "password": PASSWORD}, headers=headers)
        self.assertEqual(done.json(), {"email": "l@example.com"})
        self.assertEqual((await self.client.get("/api/v1/me", headers=headers)).json()["email"], "l@example.com")

    def token(self, name):
        from app import auth
        return auth.issue_token(name)


class DatabaseLayerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        patcher = patch.object(users, "DB_PATH", Path(self.directory.name) / "users.db")
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_schema_runs_once_per_database_and_uses_wal(self):
        with patch.object(users, "_apply_schema", wraps=users._apply_schema) as apply:
            for _ in range(5):
                with users.connect() as conn:
                    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        self.assertEqual(mode, "wal")
        self.assertEqual(apply.call_count, 1)

    def test_requests_run_no_ddl(self):
        users.create_user("someone", PASSWORD)
        statements = []
        original = users.sqlite3.connect

        def traced(*args, **kwargs):
            conn = original(*args, **kwargs)
            conn.set_trace_callback(statements.append)
            return conn

        with patch.object(users.sqlite3, "connect", traced):
            subscriptions.get_active_subscription("someone")
            users.record_token_usage("someone", 1, 1)
            rate_limit.consume("auth", "client", 5, 60)
        joined = " ".join(statements).upper()
        for word in ("CREATE ", "ALTER ", "PRAGMA TABLE_INFO"):
            self.assertNotIn(word, joined)

    def test_legacy_database_gets_an_email_column(self):
        path = Path(self.directory.name) / "legacy.db"
        with sqlite3.connect(path) as conn:
            conn.execute("CREATE TABLE users (username TEXT PRIMARY KEY COLLATE NOCASE, salt BLOB NOT NULL, hash BLOB NOT NULL)")
            conn.execute("INSERT INTO users VALUES ('old', x'00', x'00')")
        with patch.object(users, "DB_PATH", path):
            self.assertIsNone(users.get_email("old"))
            self.assertTrue(users.set_email("old", "old@example.com"))
            self.assertEqual(users.get_user_by_email("OLD@example.com"), "old")

    def test_in_memory_limit_counts_per_user_and_window(self):
        rate_limit.reset_memory()
        with patch("app.rate_limit.time.time", return_value=1000):
            rate_limit.consume_memory("ai", "u", 2, 60)
            rate_limit.consume_memory("ai", "u", 2, 60)
            with self.assertRaises(Exception) as error:
                rate_limit.consume_memory("ai", "u", 2, 60)
            self.assertEqual(error.exception.status_code, 429)
            rate_limit.consume_memory("ai", "other", 2, 60)
        with patch("app.rate_limit.time.time", return_value=1061):
            rate_limit.consume_memory("ai", "u", 2, 60)


class CallWindowTests(unittest.TestCase):
    def test_no_write_when_the_call_window_is_already_open(self):
        monthly = {"id": 1, "plan_id": "monthly", "call_time_remaining_seconds": 100}
        hourly = {"id": 2, "plan_id": "hourly_call", "session_start": 5}
        with patch.object(subscriptions, "activate_monthly_call_if_needed") as month, \
                patch.object(subscriptions, "activate_call_session_if_needed") as hour, \
                patch.object(subscriptions, "get_active_subscription") as lookup:
            subscriptions.start_ai_call("u", monthly)
            subscriptions.start_ai_call("u", hourly)
        month.assert_not_called()
        hour.assert_not_called()
        lookup.assert_not_called()

    def test_first_request_opens_the_window(self):
        with patch.object(subscriptions, "activate_monthly_call_if_needed") as month, \
                patch.object(subscriptions, "activate_call_session_if_needed") as hour:
            subscriptions.start_ai_call("u", {"id": 1, "plan_id": "monthly", "call_time_remaining_seconds": 0})
            subscriptions.start_ai_call("u", {"id": 2, "plan_id": "hourly_call", "session_start": None})
        month.assert_called_once_with(1)
        hour.assert_called_once_with("u")


if __name__ == "__main__":
    unittest.main()
