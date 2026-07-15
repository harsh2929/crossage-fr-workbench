from __future__ import annotations

import json

from crossage_fr.api_server import (
    PRODUCTION_MACOS_SIGNING_ENV,
    PRODUCTION_WINDOWS_SIGNING_ENV,
    release_signing_environment_readiness,
)


def complete_environment() -> dict[str, str]:
    values = {name: f"secret-{name}" for name in (*PRODUCTION_MACOS_SIGNING_ENV, *PRODUCTION_WINDOWS_SIGNING_ENV)}
    values["AZURE_ARTIFACT_SIGNING_ENDPOINT"] = "https://eus.codesigning.azure.net/"
    return values


def test_exact_production_contract() -> None:
    empty = release_signing_environment_readiness({})
    assert empty["macos"]["ready"] is False
    assert empty["macos"]["missing"] == list(PRODUCTION_MACOS_SIGNING_ENV)
    assert empty["windows"]["ready"] is False
    assert empty["windows"]["missing"] == list(PRODUCTION_WINDOWS_SIGNING_ENV)
    assert empty["windows"]["endpointValid"] is False

    legacy = release_signing_environment_readiness(
        {
            "CSC_LINK": "legacy-certificate",
            "APPLE_ID": "operator@example.invalid",
            "APPLE_APP_SPECIFIC_PASSWORD": "legacy-password",
            "APPLE_TEAM_ID": "ABCDEFGHIJ",
        }
    )
    assert legacy["macos"]["ready"] is False
    assert legacy["macos"]["missing"] == list(PRODUCTION_MACOS_SIGNING_ENV)

    missing_password = complete_environment()
    missing_password.pop("MACOS_CERTIFICATE_PASSWORD")
    mac = release_signing_environment_readiness(missing_password)["macos"]
    assert mac["ready"] is False
    assert mac["missing"] == ["MACOS_CERTIFICATE_PASSWORD"]

    complete = release_signing_environment_readiness(complete_environment())
    assert complete["macos"]["ready"] is True
    assert complete["windows"]["ready"] is True
    assert complete["windows"]["endpointValid"] is True


def test_azure_endpoint_is_fail_closed_and_redacted() -> None:
    invalid_endpoints = (
        "http://eus.codesigning.azure.net/",
        "https:///missing-host",
        "https://operator:secret@eus.codesigning.azure.net/",
        "https://eus.codesigning.azure.net/?profile=unsafe",
        "https://eus.codesigning.azure.net/#unsafe",
        "https://[::1",
        "https://eus.codesigning.azure.net:bad/",
        "https://eus.codesigning.azure.net:70000/",
        "https://eus.codesigning.azure.net/\nunsafe",
        "https://eus.codesigning.azure.net\\@evil.example/",
    )
    for endpoint in invalid_endpoints:
        values = complete_environment()
        values["AZURE_ARTIFACT_SIGNING_ENDPOINT"] = endpoint
        report = release_signing_environment_readiness(values)
        assert report["windows"]["ready"] is False, endpoint
        assert report["windows"]["endpointValid"] is False, endpoint
        assert report["windows"]["errors"], endpoint

    sentinel = "must-not-leak-secret-value"
    values = complete_environment()
    values["MACOS_CERTIFICATE"] = sentinel
    values["AZURE_CLIENT_ID"] = sentinel
    serialized = json.dumps(release_signing_environment_readiness(values), sort_keys=True)
    assert sentinel not in serialized


def main() -> None:
    test_exact_production_contract()
    test_azure_endpoint_is_fail_closed_and_redacted()
    print("release readiness units ok")


if __name__ == "__main__":
    main()
