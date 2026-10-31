import hashlib
import json
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from . import settings, subscriptions
from .auth import require_auth

ROOT = Path(__file__).resolve().parents[3]
INSTALLER = ROOT / "desktop" / "release" / "TechPrep-Setup.exe"
CA_CERTIFICATE = ROOT / ".certs" / "ca.crt"
INSTALLER_NAME = "TechPrep-Setup.exe"
MANIFEST_NAME = "desktop-release.json"
MAC_INSTALLER = ROOT / "desktop" / "release" / "TechPrep.dmg"
MAC_INSTALLER_NAME = "TechPrep.dmg"
MAC_MANIFEST_NAME = "desktop-release-mac.json"
router = APIRouter(prefix="/api/v1/downloads", dependencies=[Depends(require_auth), Depends(subscriptions.require_subscription)])
HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
UNAVAILABLE = "The Windows installer is not available yet. Please try again later."
MAC_UNAVAILABLE = "The macOS installer is not available yet. Please try again later."
_verified: dict[tuple[str, int, int], str] = {}
_verified_mac: dict[tuple[str, int, int], str] = {}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def production_installer() -> Path:
    """Returns the published installer only when its signed-release manifest matches it exactly."""
    directory = Path(os.environ["DESKTOP_RELEASE_DIR"])
    installer, manifest_path = directory / INSTALLER_NAME, directory / MANIFEST_NAME
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        stat = installer.stat()
    except (OSError, ValueError):
        raise HTTPException(503, UNAVAILABLE) from None
    expected_server = settings.public_origin(os.environ["APP_PUBLIC_URL"])
    try:
        valid = (
            isinstance(manifest, dict)
            and manifest.get("schema") == 1
            and manifest.get("file") == INSTALLER_NAME
            and manifest.get("signed") is True
            and manifest.get("size") == stat.st_size
            and settings.public_origin(manifest.get("serverUrl", "")) == expected_server
            and isinstance(manifest.get("sha256"), str)
            and len(manifest["sha256"]) == 64
        )
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(503, UNAVAILABLE)
    # Hashing an ~80 MB file per request is wasteful; re-hash only when the file changes.
    key = (str(installer), stat.st_size, stat.st_mtime_ns)
    if _verified.get(key) != manifest["sha256"].lower():
        if _sha256(installer) != manifest["sha256"].lower():
            raise HTTPException(503, UNAVAILABLE)
        _verified.clear()
        _verified[key] = manifest["sha256"].lower()
    return installer


@router.get("/windows")
def windows_installer() -> FileResponse:
    if settings.production():
        installer = production_installer()
    elif INSTALLER.is_file():
        installer = INSTALLER
    else:
        raise HTTPException(503, UNAVAILABLE)
    return FileResponse(
        installer,
        filename=INSTALLER_NAME,
        media_type="application/octet-stream",
        headers=HEADERS,
    )


def production_mac_installer() -> tuple[Path, bool]:
    """Returns the published macOS installer only when its release manifest matches it exactly.

    Until the project can afford Apple Developer Program notarization, an honestly-labelled
    unsigned release (``signed: false, notarized: false``) is also accepted; the manifest's
    ``signed`` flag is returned alongside the path so callers can tell users what to expect.
    """
    directory = Path(os.environ["DESKTOP_RELEASE_DIR"])
    installer, manifest_path = directory / MAC_INSTALLER_NAME, directory / MAC_MANIFEST_NAME
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        stat = installer.stat()
    except (OSError, ValueError):
        raise HTTPException(503, MAC_UNAVAILABLE) from None
    expected_server = settings.public_origin(os.environ["APP_PUBLIC_URL"])
    try:
        valid = (
            isinstance(manifest, dict)
            and manifest.get("schema") == 1
            and manifest.get("file") == MAC_INSTALLER_NAME
            and isinstance(manifest.get("signed"), bool)
            and isinstance(manifest.get("notarized"), bool)
            and manifest.get("size") == stat.st_size
            and settings.public_origin(manifest.get("serverUrl", "")) == expected_server
            and isinstance(manifest.get("sha256"), str)
            and len(manifest["sha256"]) == 64
        )
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(503, MAC_UNAVAILABLE)
    # Hashing a large file per request is wasteful; re-hash only when the file changes.
    key = (str(installer), stat.st_size, stat.st_mtime_ns)
    if _verified_mac.get(key) != manifest["sha256"].lower():
        if _sha256(installer) != manifest["sha256"].lower():
            raise HTTPException(503, MAC_UNAVAILABLE)
        _verified_mac.clear()
        _verified_mac[key] = manifest["sha256"].lower()
    return installer, bool(manifest["signed"])


@router.get("/mac")
def mac_installer() -> FileResponse:
    signed = False
    if settings.production():
        installer, signed = production_mac_installer()
    elif MAC_INSTALLER.is_file():
        installer = MAC_INSTALLER
    else:
        raise HTTPException(503, MAC_UNAVAILABLE)
    return FileResponse(
        installer,
        filename=MAC_INSTALLER_NAME,
        media_type="application/x-apple-diskimage",
        headers={**HEADERS, "X-Techprep-Mac-Signed": "true" if signed else "false"},
    )


@router.get("/ca")
def ca_certificate() -> FileResponse:
    # Production uses a publicly trusted certificate; never ask users to trust a private CA.
    if settings.production() or not CA_CERTIFICATE.is_file():
        raise HTTPException(404, "This server has no local CA certificate to download.")
    return FileResponse(
        CA_CERTIFICATE,
        filename="TechPrep-Local-CA.crt",
        media_type="application/x-x509-ca-cert",
        headers=HEADERS,
    )
