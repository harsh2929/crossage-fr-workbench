"""APL-RAW-01: high-fidelity RAW decode params (DHT demosaic + explicit sRGB).

Proves the RAW decode now selects LibRaw's DHT demosaic (user_qual 11) and an
explicit sRGB output color space when the installed rawpy/LibRaw supports them
(the research-backed 99.9th-percentile color-fidelity settings), and degrades to
LibRaw defaults when those options are unavailable.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_raw_fidelity_units.py
"""

from __future__ import annotations

from crossage_fr.ingest.image_io import _raw_postprocess_kwargs


def test_raw_postprocess_prefers_dht_and_srgb_when_available() -> None:
    import rawpy

    kwargs = _raw_postprocess_kwargs(rawpy)
    assert kwargs["use_camera_wb"] is True, kwargs
    assert kwargs["no_auto_bright"] is False, kwargs
    assert kwargs["output_bps"] == 8, kwargs
    assert kwargs["demosaic_algorithm"] == rawpy.DemosaicAlgorithm.DHT, kwargs
    assert kwargs["output_color"] == rawpy.ColorSpace.sRGB, kwargs


def test_raw_postprocess_degrades_to_defaults_without_advanced_options() -> None:
    class _Stub:  # a LibRaw build / stub lacking the advanced enums
        pass

    kwargs = _raw_postprocess_kwargs(_Stub())
    assert "demosaic_algorithm" not in kwargs, kwargs
    assert "output_color" not in kwargs, kwargs
    assert kwargs == {"use_camera_wb": True, "no_auto_bright": False, "output_bps": 8}, kwargs


if __name__ == "__main__":
    test_raw_postprocess_prefers_dht_and_srgb_when_available()
    test_raw_postprocess_degrades_to_defaults_without_advanced_options()
    print("all photo_raw_fidelity_units tests passed")
