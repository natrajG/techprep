import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import auth, downloads
from app.main import app


class DownloadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )
        self.headers = {"Authorization": f"Bearer {auth.issue_token('download-test')}"}

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_authentication_required_for_both_downloads(self):
        for target in ("windows", "ca"):
            for headers in ({}, {"Authorization": "Bearer invalid"}):
                response = await self.client.get(f"/api/v1/downloads/{target}", headers=headers)
                self.assertEqual(response.status_code, 401)

    async def test_missing_files_are_explicit_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            for target, setting, status in (
                ("windows", "INSTALLER", 503), ("ca", "CA_CERTIFICATE", 404)
            ):
                with patch.object(downloads, setting, missing):
                    response = await self.client.get(
                        f"/api/v1/downloads/{target}", headers=self.headers
                    )
                self.assertEqual(response.status_code, status)
                self.assertIn("detail", response.json())

    async def test_files_are_authenticated_attachments_without_caching(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "artifact"
            file.write_bytes(b"download contents")
            for target, setting, filename in (
                ("windows", "INSTALLER", "TechPrep-Setup.exe"),
                ("ca", "CA_CERTIFICATE", "TechPrep-Local-CA.crt"),
            ):
                with patch.object(downloads, setting, file):
                    response = await self.client.get(
                        f"/api/v1/downloads/{target}", headers=self.headers
                    )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, b"download contents")
                self.assertIn(filename, response.headers["content-disposition"])
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    async def test_private_keys_are_not_download_targets(self):
        for target in ("ca-key.pem", "server-key.pem"):
            response = await self.client.get(
                f"/api/v1/downloads/{target}", headers=self.headers
            )
            self.assertEqual(response.status_code, 404)
