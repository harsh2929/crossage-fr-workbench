from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import socket
import tempfile
from time import perf_counter
from typing import Any

from crossage_fr.photo_relationships import (
    PHOTO_RELATIONSHIP_GRAPH_VERSION,
    rank_relationship_name_suggestions,
)
from crossage_fr.store.workspace_db import WorkspaceDb


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "benchmarks" / "results" / "photo-relationship-benchmark-20260713.json"
UNKNOWN = "Unmatched cluster benchmark-a"
SPECIAL_MEMBERSHIPS = (
    (UNKNOWN, "Alice", "Taylor"),
    (UNKNOWN, "Alice", "Bob"),
    (UNKNOWN, "Bob"),
    ("Sam", "Alice"),
    ("Sam", "Alice", "Bob"),
    ("Sam", "Bob"),
    ("Taylor",),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _seed_catalog(db: WorkspaceDb, *, asset_count: int, named_people: int) -> dict[str, int]:
    now = "2026-07-13T00:00:00Z"
    inserted_people = 0
    with db.connect() as conn:
        asset_rows: list[tuple[Any, ...]] = []
        people_rows: list[tuple[Any, ...]] = []

        def flush() -> None:
            nonlocal inserted_people
            if asset_rows:
                conn.executemany(
                    """
                    INSERT INTO photo_assets(
                        asset_id, source_path, source_kind, file_signature_json,
                        media_kind, mime_type, capture_date, added_at, updated_at
                    ) VALUES(?, ?, 'referenced', '{}', 'image', 'image/jpeg', ?, ?, ?)
                    """,
                    asset_rows,
                )
                asset_rows.clear()
            if people_rows:
                conn.executemany(
                    """
                    INSERT INTO photo_asset_people(
                        asset_id, candidate_id, person_name, status, score,
                        quality, band, source, metadata_json, updated_at
                    ) VALUES(?, ?, ?, ?, ?, 0.95, ?, 'relationship-benchmark', '{}', ?)
                    """,
                    people_rows,
                )
                inserted_people += len(people_rows)
                people_rows.clear()

        for index in range(asset_count):
            asset_id = f"relationship-benchmark-{index:06d}"
            asset_rows.append((
                asset_id,
                f"/benchmark/library/asset-{index:06d}.jpg",
                f"2024-01-{(index % 28) + 1:02d}T12:00:00Z",
                now,
                now,
            ))
            if index < len(SPECIAL_MEMBERSHIPS):
                memberships = SPECIAL_MEMBERSHIPS[index]
            else:
                noise_index = index - len(SPECIAL_MEMBERSHIPS)
                left_index = noise_index % named_people
                right_index = (noise_index * 37 + 13) % named_people
                if right_index == left_index:
                    right_index = (right_index + 1) % named_people
                memberships = (
                    f"Noise person {left_index:04d}",
                    f"Noise person {right_index:04d}",
                )
            for face_index, person_name in enumerate(memberships):
                unknown = person_name.startswith("Unmatched cluster")
                people_rows.append((
                    asset_id,
                    f"relationship-face-{index:06d}-{face_index}",
                    person_name,
                    "pending" if unknown else "accepted",
                    0.20 if unknown else 0.99,
                    "" if unknown else "manual assignment",
                    now,
                ))
            if len(asset_rows) >= 5000:
                flush()
        flush()
        table_counts = {
            "assets": int(conn.execute("SELECT COUNT(*) FROM photo_assets").fetchone()[0]),
            "peopleRows": int(conn.execute("SELECT COUNT(*) FROM photo_asset_people").fetchone()[0]),
        }
    return {**table_counts, "insertedPeopleRows": inserted_people}


def _timed_graph(db: WorkspaceDb) -> tuple[dict[str, list[dict[str, Any]]], float]:
    started = perf_counter()
    graph = db.photo_relationship_graph(confident_threshold=0.82)
    return graph, round((perf_counter() - started) * 1000.0, 3)


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark relationship naming on a production SQLite catalog graph.")
    parser.add_argument("--assets", type=int, default=100_000)
    parser.add_argument("--named-people", type=int, default=1_000)
    parser.add_argument("--query-budget-ms", type=float, default=5_000.0)
    parser.add_argument("--rank-budget-ms", type=float, default=1_500.0)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    asset_count = max(len(SPECIAL_MEMBERSHIPS), int(args.assets))
    named_people = max(2, int(args.named_people))
    output = args.output.expanduser().resolve()

    original_socket_connect = socket.socket.connect
    original_create_connection = socket.create_connection
    outbound_attempts: list[str] = []

    def block_socket_connect(_socket: socket.socket, address: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError("Relationship-graph evaluation must remain offline.")

    def block_create_connection(address: Any, *_args: Any, **_kwargs: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError("Relationship-graph evaluation must remain offline.")

    try:
        socket.socket.connect = block_socket_connect
        socket.create_connection = block_create_connection
        with tempfile.TemporaryDirectory(prefix="vintrace-photo-relationship-benchmark-") as temp_value:
            temp = Path(temp_value)
            db = WorkspaceDb(temp / "workspace.sqlite3")
            seed_started = perf_counter()
            catalog = _seed_catalog(db, asset_count=asset_count, named_people=named_people)
            seed_ms = round((perf_counter() - seed_started) * 1000.0, 3)

            graph, cold_query_ms = _timed_graph(db)
            repeat_graphs: list[dict[str, list[dict[str, Any]]]] = []
            warm_query_ms: list[float] = []
            for _ in range(3):
                repeated, elapsed = _timed_graph(db)
                repeat_graphs.append(repeated)
                warm_query_ms.append(elapsed)

            rank_started = perf_counter()
            ranked = rank_relationship_name_suggestions(graph["nodes"], graph["edges"])
            rank_ms = round((perf_counter() - rank_started) * 1000.0, 3)
            reverse_ranked = rank_relationship_name_suggestions(
                reversed(graph["nodes"]),
                reversed(graph["edges"]),
            )
            suggestions = ranked.get("suggestions", [])
            top = suggestions[0] if suggestions else {}
            shared_names = [
                str(row.get("personName", "") or "")
                for row in top.get("sharedRelationships", [])
                if isinstance(row, dict)
            ]
            public_result = {
                "graphVersion": ranked.get("graphVersion"),
                "graphHash": ranked.get("graphHash"),
                "graphStats": ranked.get("graphStats"),
                "minimums": ranked.get("minimums"),
                "suggestions": suggestions,
            }
            serialized_public = json.dumps(public_result, ensure_ascii=True, sort_keys=True)
            query_peak_ms = max([cold_query_ms, *warm_query_ms])
            checks = {
                "catalogScale": catalog["assets"] == asset_count and catalog["peopleRows"] >= asset_count * 2,
                "productionSqlGraph": len(graph["nodes"]) >= named_people + 5 and bool(graph["edges"]),
                "expectedTopIdentity": top.get("sourceCluster") == UNKNOWN and top.get("targetPerson") == "Sam",
                "explainableEvidence": shared_names == ["Alice", "Bob"] and int(top.get("relationshipSupport", 0) or 0) >= 4,
                "directCooccurrenceVeto": int(ranked.get("graphStats", {}).get("blockedByDirectCooccurrence", 0) or 0) >= 3,
                "reviewOnly": (
                    top.get("reviewRequired") is True
                    and top.get("autoApply") is False
                    and top.get("undoAvailable") is True
                ),
                "deterministicSql": all(repeated == graph for repeated in repeat_graphs),
                "deterministicRanking": reverse_ranked == ranked,
                "pathFreeResult": str(temp) not in serialized_public and "sourcePath" not in serialized_public,
                "offline": not outbound_attempts,
                "queryBudget": query_peak_ms <= float(args.query_budget_ms),
                "rankBudget": rank_ms <= float(args.rank_budget_ms),
            }
            report = {
                "schemaVersion": 1,
                "benchmarkId": "vintrace-photo-relationship-graph-v1",
                "version": PHOTO_RELATIONSHIP_GRAPH_VERSION,
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "platform": platform.platform(),
                "dataset": {
                    "synthetic": True,
                    "assets": catalog["assets"],
                    "peopleRows": catalog["peopleRows"],
                    "namedNoisePeople": named_people,
                    "fixture": "deterministic sparse social graph with a held-out unnamed cluster",
                },
                "budgets": {
                    "queryMs": float(args.query_budget_ms),
                    "rankMs": float(args.rank_budget_ms),
                },
                "timing": {
                    "seedMs": seed_ms,
                    "coldQueryMs": cold_query_ms,
                    "warmQueryMs": warm_query_ms,
                    "peakQueryMs": query_peak_ms,
                    "rankMs": rank_ms,
                },
                "result": public_result,
                "checks": checks,
                "outboundAttempts": outbound_attempts,
                "passed": all(checks.values()),
            }
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(json.dumps({
                "report": str(output),
                "sha256": sha256_file(output),
                "dataset": report["dataset"],
                "timing": report["timing"],
                "checks": checks,
                "passed": report["passed"],
            }, indent=2, sort_keys=True))
            if not report["passed"]:
                raise SystemExit(1)
    finally:
        socket.socket.connect = original_socket_connect
        socket.create_connection = original_create_connection


if __name__ == "__main__":
    main()
