from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile

from crossage_fr.mobile_companion import (
    MOBILE_ALLOWED_TOOLS,
    MOBILE_UNPAIRED_TOKEN_HASH,
    MobilePairingError,
    exchange_mobile_pairing,
    mobile_asset_media_type,
    mobile_security_headers,
    resolve_mobile_asset,
)


def account(pairing_code: str, *, now: int, **updates):
    value = {
        "accountId": "mobile-test_device_01",
        "displayName": "Test phone",
        "clientType": "mobile",
        "readOnly": True,
        "tokenSha256": MOBILE_UNPAIRED_TOKEN_HASH,
        "pairingCodeSha256": hashlib.sha256(pairing_code.encode("utf-8")).hexdigest(),
        "scopes": ["images:read", "images:preview"],
        "allowedTools": sorted(MOBILE_ALLOWED_TOOLS),
        "createdAt": "2026-07-13T12:00:00Z",
        "pairingExpiresAt": now + 600,
        "expiresAt": now + 86_400,
        "disabled": False,
    }
    value.update(updates)
    return value


def write_accounts(path: Path, accounts: list[dict]) -> None:
    path.write_text(json.dumps({"version": 2, "accounts": accounts}), encoding="utf-8")
    path.chmod(0o600)


def expect_pairing_error(callback, code: str) -> None:
    try:
        callback()
    except MobilePairingError as exc:
        assert exc.code == code, exc
    else:
        raise AssertionError(f"Expected {code}")


def main() -> None:
    now = 1_783_947_600
    pairing_code = "a" * 43
    with tempfile.TemporaryDirectory(prefix="vintrace-mobile-units-") as tmp:
        root = Path(tmp)
        credentials = root / "mobile-companions.json"
        write_accounts(credentials, [account(pairing_code, now=now)])

        token, descriptor = exchange_mobile_pairing(credentials, pairing_code, now=now)
        assert len(token) >= 40 and token != pairing_code
        assert descriptor == {
            "accountId": "mobile-test_device_01",
            "label": "Test phone",
            "readOnly": True,
            "allowPreviews": True,
            "expiresAt": now + 86_400,
            "expiresInSeconds": 86_400,
        }
        updated = json.loads(credentials.read_text(encoding="utf-8"))["accounts"][0]
        assert updated["tokenSha256"] == hashlib.sha256(token.encode("utf-8")).hexdigest()
        assert "pairingCodeSha256" not in updated and "pairingExpiresAt" not in updated
        assert updated["credentialVersion"] == 1 and updated["pairedAt"].endswith("Z")
        assert token not in credentials.read_text(encoding="utf-8")
        expect_pairing_error(
            lambda: exchange_mobile_pairing(credentials, pairing_code, now=now),
            "mobile_pairing_invalid",
        )

        write_accounts(credentials, [account(pairing_code, now=now, pairingExpiresAt=now)])
        expect_pairing_error(
            lambda: exchange_mobile_pairing(credentials, pairing_code, now=now),
            "mobile_pairing_invalid",
        )
        write_accounts(credentials, [account(pairing_code, now=now, disabled=True)])
        expect_pairing_error(
            lambda: exchange_mobile_pairing(credentials, pairing_code, now=now),
            "mobile_pairing_invalid",
        )
        write_accounts(credentials, [account(pairing_code, now=now, scopes=["images:write"])])
        expect_pairing_error(
            lambda: exchange_mobile_pairing(credentials, pairing_code, now=now),
            "mobile_pairing_invalid",
        )
        write_accounts(credentials, [account(pairing_code, now=now)])
        lock = Path(f"{credentials}.lock")
        lock.write_text("busy", encoding="ascii")
        expect_pairing_error(
            lambda: exchange_mobile_pairing(credentials, pairing_code, now=now),
            "mobile_credentials_busy",
        )
        lock.unlink()

        assets = root / "mobile-assets"
        assets.mkdir()
        (assets / "index.html").write_text("<!doctype html><title>Vintrace</title>", encoding="utf-8")
        (assets / "app.js").write_text("console.log('ok')", encoding="utf-8")
        previous = os.environ.get("VINTRACE_MOBILE_ASSETS_DIR")
        os.environ["VINTRACE_MOBILE_ASSETS_DIR"] = str(assets)
        try:
            assert resolve_mobile_asset("").name == "index.html"
            assert resolve_mobile_asset("app.js").name == "app.js"
            assert mobile_asset_media_type(assets / "manifest.webmanifest") == "application/manifest+json"
            for invalid in ("../secret", "nested/../../secret", "unknown.exe"):
                try:
                    resolve_mobile_asset(invalid)
                except FileNotFoundError:
                    pass
                else:
                    raise AssertionError(f"Unsafe mobile asset path accepted: {invalid}")
        finally:
            if previous is None:
                os.environ.pop("VINTRACE_MOBILE_ASSETS_DIR", None)
            else:
                os.environ["VINTRACE_MOBILE_ASSETS_DIR"] = previous

        headers = mobile_security_headers(document=True)
        assert headers["Cache-Control"] == "private, no-store"
        assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
        assert headers["Permissions-Policy"].startswith("camera=()")

    print("mobile companion pairing, assets, and security headers ok")


if __name__ == "__main__":
    main()
