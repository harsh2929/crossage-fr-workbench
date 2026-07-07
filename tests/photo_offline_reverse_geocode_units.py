"""APL-PLACE-01: fully-offline reverse geocoding (no network).

Integrates the bundled-GeoNames `reverse_geocode` gazetteer as an `offline`
provider so GPS-only photos resolve a place name with zero network access
(works even under noNetworkIntelligence). This blocks sockets while resolving a
known coordinate and asserts the place name comes back from local data only.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_offline_reverse_geocode_units.py
"""

from __future__ import annotations

import os
import socket
import tempfile

from photo_folders_units import _api


def test_offline_reverse_geocode_resolves_without_network() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        import reverse_geocode  # warm the local gazetteer (file read, not network)
        _ = reverse_geocode.get((37.7749, -122.4194))

        os.environ["CROSSAGE_REVERSE_GEOCODE_PROVIDER"] = "offline"
        orig_socket = socket.socket
        orig_conn = socket.create_connection

        def _blocked(*_a, **_k):
            raise AssertionError("network access attempted during offline reverse geocode")

        socket.socket = _blocked  # type: ignore[assignment]
        socket.create_connection = _blocked  # type: ignore[assignment]
        try:
            result = api._photo_reverse_geocode_provider_lookup(37.7749, -122.4194)
            paris = api._photo_reverse_geocode_provider_lookup(48.8566, 2.3522)
        finally:
            socket.socket = orig_socket  # type: ignore[assignment]
            socket.create_connection = orig_conn  # type: ignore[assignment]
            os.environ.pop("CROSSAGE_REVERSE_GEOCODE_PROVIDER", None)

        assert result["ok"] is True, result
        assert "San Francisco" in result["label"], result
        assert result["provider"] == "offline-gazetteer", result
        assert result["attribution"], result
        assert "Paris" in paris["label"], paris


if __name__ == "__main__":
    test_offline_reverse_geocode_resolves_without_network()
    print("all photo_offline_reverse_geocode_units tests passed")
