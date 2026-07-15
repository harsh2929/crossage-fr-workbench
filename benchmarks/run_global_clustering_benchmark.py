"""Benchmark ML-08 global unmatched clustering beyond the former 20k flush cap."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import platform
import random
import sqlite3
import time
from typing import Any

import numpy as np

from crossage_fr.cluster.global_pass import GLOBAL_CLUSTER_VERSION, GlobalUnmatchedSpool


FORMER_OVERFLOW_CAP = 20_000


def _records(row_count: int, dimension: int, seed: int) -> list[dict[str, Any]]:
    rng = np.random.default_rng(seed)
    records: list[dict[str, Any]] = []
    per_model = row_count // 2
    model_counts = [per_model, row_count - per_model]
    for model_index, model_count in enumerate(model_counts):
        model_name = f"benchmark-model-{model_index + 1}"
        cluster_count = 45
        noise_count = max(45, model_count // 10)
        clustered_count = model_count - noise_count
        members_per_cluster, remainder = divmod(clustered_count, cluster_count)
        centers = rng.normal(size=(cluster_count, dimension)).astype("float32")
        centers /= np.linalg.norm(centers, axis=1, keepdims=True)
        model_vectors: list[np.ndarray] = []
        for cluster_index, center in enumerate(centers):
            member_count = members_per_cluster + (1 if cluster_index < remainder else 0)
            samples = center + rng.normal(scale=0.02, size=(member_count, dimension)).astype("float32")
            samples /= np.linalg.norm(samples, axis=1, keepdims=True)
            model_vectors.extend(samples)
        noise = rng.normal(size=(noise_count, dimension)).astype("float32")
        noise /= np.linalg.norm(noise, axis=1, keepdims=True)
        model_vectors.extend(noise)
        for index, vector in enumerate(model_vectors):
            token = f"{model_name}:{index}"
            records.append(
                {
                    "path": Path("/benchmark") / model_name / f"face-{index:06d}.jpg",
                    "model": model_name,
                    "vector": vector,
                    "sourceHash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
                }
            )
    return records


def _run_pass(records: list[dict[str, Any]], order: list[int], commit_every: int) -> dict[str, Any]:
    conn = sqlite3.connect(":memory:")
    spool = GlobalUnmatchedSpool(conn, "benchmark")
    started = time.perf_counter()
    for insertion_index, record_index in enumerate(order, start=1):
        record = records[record_index]
        spool.add(
            record["path"],
            0.9,
            record["model"],
            record["vector"],
            {"source_hash": record["sourceHash"], "media_kind": "image"},
            (0, 0, 112, 112),
        )
        if insertion_index % commit_every == 0:
            conn.commit()
    spool_seconds = time.perf_counter() - started

    cluster_started = time.perf_counter()
    assignments: dict[str, str | None] = {}
    model_names: dict[str, set[str]] = {}
    group_rows: list[dict[str, Any]] = []
    for group in spool.groups():
        result = spool.cluster_group(group, min_cluster_size=3)
        assignments.update(result.assignments)
        model_names[group.model_name] = {
            name for name in result.assignments.values() if name is not None
        }
        group_rows.append(
            {
                "model": group.model_name,
                "dimension": group.vector_dim,
                "rows": group.rows,
                "uniqueRows": group.unique_rows,
                "components": result.components,
                "noiseUnique": result.noise_unique,
            }
        )
    cluster_seconds = time.perf_counter() - cluster_started
    peak = spool.peak_count
    spool.close()
    cleanup_verified = not conn.execute(
        "SELECT 1 FROM sqlite_temp_master WHERE type = 'table' AND name = 'unmatched_cluster_spool'"
    ).fetchone()
    conn.close()
    return {
        "assignments": assignments,
        "modelNames": model_names,
        "groups": group_rows,
        "spoolPeak": peak,
        "spoolSeconds": round(spool_seconds, 6),
        "clusterSeconds": round(cluster_seconds, 6),
        "totalSeconds": round(spool_seconds + cluster_seconds, 6),
        "cleanupVerified": cleanup_verified,
    }


def run(row_count: int, dimension: int, seed: int) -> dict[str, Any]:
    if row_count <= FORMER_OVERFLOW_CAP:
        raise ValueError(f"row_count must exceed the former {FORMER_OVERFLOW_CAP:,}-row cap.")
    if dimension < 8:
        raise ValueError("dimension must be at least 8.")
    records = _records(row_count, dimension, seed)
    forward_order = list(range(len(records)))
    shuffled_order = list(forward_order)
    random.Random(seed + 1).shuffle(shuffled_order)
    forward = _run_pass(records, forward_order, commit_every=137)
    forward_batched = _run_pass(records, forward_order, commit_every=997)
    shuffled = _run_pass(records, shuffled_order, commit_every=137)

    forward_names = forward["modelNames"]
    model_name_sets = list(forward_names.values())
    model_isolated = all(
        model_name_sets[left].isdisjoint(model_name_sets[right])
        for left in range(len(model_name_sets))
        for right in range(left + 1, len(model_name_sets))
    )
    gates = {
        "exceedsFormerOverflowCap": len(records) > FORMER_OVERFLOW_CAP,
        "singleTerminalPopulation": forward["spoolPeak"] == len(records),
        "inputOrderInvariant": forward["assignments"] == shuffled["assignments"],
        "commitBatchInvariant": forward["assignments"] == forward_batched["assignments"],
        "modelSpacesIsolated": model_isolated,
        "stableHashedNames": all(
            name.startswith("Unmatched cluster ") and len(name.split()[-1]) == 16
            for name in forward["assignments"].values()
            if name is not None
        ),
        "tempSpoolCleaned": bool(
            forward["cleanupVerified"]
            and forward_batched["cleanupVerified"]
            and shuffled["cleanupVerified"]
        ),
    }
    passed = all(gates.values())
    return {
        "schemaVersion": 1,
        "recommendation": "ML-08",
        "implementationVersion": GLOBAL_CLUSTER_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "status": "pass" if passed else "fail",
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "numpy": np.__version__,
            "faissAvailable": importlib.util.find_spec("faiss") is not None,
        },
        "corpus": {
            "rows": len(records),
            "dimension": dimension,
            "models": 2,
            "seed": seed,
            "formerOverflowCap": FORMER_OVERFLOW_CAP,
            "generatedNumericEmbeddingsOnly": True,
        },
        "forward": {key: value for key, value in forward.items() if key not in {"assignments", "modelNames"}},
        "forwardAlternateCommitBatch": {
            key: value for key, value in forward_batched.items() if key not in {"assignments", "modelNames"}
        },
        "shuffled": {key: value for key, value in shuffled.items() if key not in {"assignments", "modelNames"}},
        "result": {
            "clusteredUniqueRows": sum(1 for name in forward["assignments"].values() if name is not None),
            "noiseUniqueRows": sum(1 for name in forward["assignments"].values() if name is None),
            "components": len({name for name in forward["assignments"].values() if name is not None}),
        },
        "gates": gates,
        "limitations": [
            "This is a deterministic scale/correctness benchmark over generated numeric embeddings, not an identity-quality benchmark.",
            "The exact kNN graph remains bounded by available CPU time and memory for a single recognizer model group.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=20_100)
    parser.add_argument("--dimension", type=int, default=512)
    parser.add_argument("--seed", type=int, default=20260712)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("benchmarks/results/global-clustering-benchmark-20260712.json"),
    )
    args = parser.parse_args()
    result = run(args.rows, args.dimension, args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": result["status"],
        "rows": result["corpus"]["rows"],
        "components": result["result"]["components"],
        "forwardSeconds": result["forward"]["totalSeconds"],
        "shuffledSeconds": result["shuffled"]["totalSeconds"],
        "output": str(args.output),
    }, sort_keys=True))
    if result["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
