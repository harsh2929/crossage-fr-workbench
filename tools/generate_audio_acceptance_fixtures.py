#!/usr/bin/env python3
"""Regenerate project-owned deterministic audio acceptance fixtures."""

from __future__ import annotations

from pathlib import Path
import math
import struct
import wave


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tests" / "fixtures" / "audio" / "synthetic-chime.wav"
SAMPLE_RATE = 16_000
DURATION_SECONDS = 6


def chime_sample(time_seconds: float) -> float:
    value = 0.0
    for start, frequency in ((0.2, 659.25), (0.7, 523.25), (2.5, 659.25), (3.0, 523.25)):
        elapsed = time_seconds - start
        if elapsed < 0:
            continue
        envelope = math.exp(-2.2 * elapsed)
        phase = 2.0 * math.pi * frequency * elapsed
        value += envelope * (
            math.sin(phase)
            + 0.35 * math.sin(2.0 * phase)
            + 0.15 * math.sin(3.0 * phase)
        )
    return value


def main() -> None:
    samples = [chime_sample(index / SAMPLE_RATE) for index in range(SAMPLE_RATE * DURATION_SECONDS)]
    peak = max(abs(sample) for sample in samples) or 1.0
    pcm = b"".join(
        struct.pack("<h", max(-32768, min(32767, round(sample * 0.28 * 32767 / peak))))
        for sample in samples
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm)
    print(OUTPUT)


if __name__ == "__main__":
    main()
