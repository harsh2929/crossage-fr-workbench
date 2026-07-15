from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

from PIL import Image

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReviewCandidate


UNKNOWN = "Unmatched cluster frozen-relationship"
MEMBERSHIPS = {
    "unknown-1.png": (UNKNOWN, "Alice"),
    "unknown-2.png": (UNKNOWN, "Alice", "Bob"),
    "unknown-3.png": (UNKNOWN, "Bob"),
    "sam-1.png": ("Sam", "Alice"),
    "sam-2.png": ("Sam", "Alice", "Bob"),
    "sam-3.png": ("Sam", "Bob"),
    "jordan-1.png": ("Jordan", "Alice"),
    "jordan-2.png": ("Jordan",),
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rpc_row(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") == request_id and "ok" in row:
            return row


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    row = rpc_row(process, request_id, command, params)
    if not row.get("ok"):
        raise AssertionError(row)
    result = row.get("result", {})
    return result if isinstance(result, dict) else {}


def rpc_error(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> str:
    row = rpc_row(process, request_id, command, params)
    if row.get("ok"):
        raise AssertionError(f"Expected {command} to fail: {row}")
    return json.dumps(row.get("error", row), ensure_ascii=False).casefold()


def wait_ready(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during startup: {process.poll()}")
        row = json.loads(line)
        if row.get("ready") is True:
            return
        if row.get("ready") is False:
            raise AssertionError(row)


def start_backend(executable: Path, workspace: Path, registry: Path) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update({
        "VINTRACE_WORKSPACE": str(workspace),
        "CROSSAGE_WORKSPACE": str(workspace),
        "VINTRACE_REGISTRY_HOME": str(registry),
        "CROSSAGE_REGISTRY_HOME": str(registry),
        "CROSSAGE_FORCE_FALLBACK": "1",
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "NO_PROXY": "*",
        "no_proxy": "*",
        "HTTP_PROXY": "",
        "HTTPS_PROXY": "",
        "ALL_PROXY": "",
        "http_proxy": "",
        "https_proxy": "",
        "all_proxy": "",
    })
    process = subprocess.Popen(
        [str(executable), "--workspace", str(workspace)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )
    wait_ready(process)
    return process


def stop_backend(process: subprocess.Popen[str]) -> None:
    if process.stdin is not None:
        process.stdin.close()
    try:
        process.wait(timeout=12)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def seed_workspace(workspace: Path, registry: Path, media: Path) -> dict[str, str]:
    os.environ["VINTRACE_REGISTRY_HOME"] = str(registry)
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(registry)
    paths: dict[str, Path] = {}
    for index, filename in enumerate(MEMBERSHIPS):
        path = media / filename
        Image.new("RGB", (48, 36), (40 + index * 17, 75 + index * 9, 130)).save(path)
        paths[filename] = path

    api = DesktopApi(workspace, actor="frozen-relationship-fixture")
    api.handle("set_consent", {"value": True, "source": "frozen-relationship-fixture"})
    imported = api.import_photos({
        "sourcePaths": [str(path) for path in paths.values()],
        "storageMode": "referenced",
        "sourceLabel": "Frozen relationship acceptance",
    })
    assert imported.get("importedCount") == len(paths), imported
    candidates: dict[str, ReviewCandidate] = {}
    for asset_index, (filename, people) in enumerate(MEMBERSHIPS.items()):
        for face_index, person_name in enumerate(people):
            candidate_id = f"frozen-relationship-{asset_index}-{face_index}"
            unknown = person_name.startswith("Unmatched cluster")
            candidates[candidate_id] = ReviewCandidate(
                candidate_id=candidate_id,
                source_path=str(paths[filename]),
                person_name=person_name,
                best_ref_id=None,
                best_ref_path=None,
                score=0.20 if unknown else 0.98,
                band="" if unknown else "manual assignment",
                quality=0.94,
                model_name="frozen-relationship-fixture",
                status="pending" if unknown else "accepted",
                created_at=f"2026-07-13T00:00:{asset_index:02d}Z",
            )
    api.project.candidates = candidates
    api.project.db.upsert_candidates(candidates.values())
    api.project.save(snapshot_candidates=True, flush_candidate_index=True)
    return {str(path): sha256_file(path) for path in paths.values()}


def main() -> None:
    executable = Path(str(os.environ.get("VINTRACE_RELATIONSHIP_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_RELATIONSHIP_TEST_EXECUTABLE must point to the frozen backend.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-photo-relationships-") as temp_value:
        root = Path(temp_value)
        workspace = root / "workspace"
        registry = root / "registry"
        media = root / "relationship-media"
        media.mkdir()
        original_hashes = seed_workspace(workspace, registry, media)

        process = start_backend(executable, workspace, registry)
        try:
            found = rpc(process, "suggest", "suggest_photo_relationship_names", {"limit": 20}).get("value", {})
            assert found.get("available") is True and found.get("offline") is True, found
            assert found.get("reviewRequired") is True and found.get("autoApplied") == 0, found
            assert len(found.get("suggestions", [])) == 1, found
            suggestion = found["suggestions"][0]
            assert suggestion.get("sourceCluster") == UNKNOWN and suggestion.get("targetPerson") == "Sam", suggestion
            assert suggestion.get("reviewRequired") is True and suggestion.get("autoApply") is False, suggestion
            assert suggestion.get("undoAvailable") is True and suggestion.get("directCooccurrenceCount") == 0, suggestion
            assert [row.get("personName") for row in suggestion.get("sharedRelationships", [])] == ["Alice", "Bob"], suggestion
            assert str(media) not in json.dumps(found) and "sourcePath" not in json.dumps(found), found

            manipulated = rpc_error(
                process,
                "manipulated",
                "review_photo_relationship_name_suggestion",
                {
                    "suggestionId": suggestion["suggestionId"],
                    "sourceCluster": suggestion["sourceCluster"],
                    "targetPerson": "Jordan",
                    "decision": "applied",
                    "confirm": True,
                    "idempotencyKey": "frozen-relationship-manipulated",
                },
            )
            assert "stale" in manipulated, manipulated
            unconfirmed = rpc_error(
                process,
                "unconfirmed",
                "review_photo_relationship_name_suggestion",
                {
                    "suggestionId": suggestion["suggestionId"],
                    "sourceCluster": suggestion["sourceCluster"],
                    "targetPerson": suggestion["targetPerson"],
                    "decision": "applied",
                    "idempotencyKey": "frozen-relationship-apply-v1",
                },
            )
            assert "confirm=true" in unconfirmed, unconfirmed
            applied = rpc(
                process,
                "apply",
                "review_photo_relationship_name_suggestion",
                {
                    "suggestionId": suggestion["suggestionId"],
                    "sourceCluster": suggestion["sourceCluster"],
                    "targetPerson": suggestion["targetPerson"],
                    "decision": "applied",
                    "confirm": True,
                    "idempotencyKey": "frozen-relationship-apply-v1",
                },
            ).get("value", {})
            assert applied.get("applied") is True and applied.get("idempotentReplay") is False, applied
            assert applied.get("renamed", {}).get("candidates") == 3, applied
            assert applied.get("renamed", {}).get("identityMerged") is True, applied
            assert applied.get("operation", {}).get("operationType") == "person_label_merge", applied
            assert applied.get("operation", {}).get("canUndo") is True and applied.get("operationId"), applied
            operation_id = str(applied["operationId"])
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry)
        try:
            replay = rpc(
                reopened,
                "replay",
                "review_photo_relationship_name_suggestion",
                {
                    "suggestionId": suggestion["suggestionId"],
                    "sourceCluster": suggestion["sourceCluster"],
                    "targetPerson": suggestion["targetPerson"],
                    "decision": "applied",
                    "confirm": True,
                    "idempotencyKey": "frozen-relationship-apply-v1",
                },
            ).get("value", {})
            assert replay.get("applied") is True and replay.get("idempotentReplay") is True, replay
            assert replay.get("operationId") == operation_id, replay
            assert rpc(reopened, "after-apply", "suggest_photo_relationship_names", {}).get("value", {}).get("suggestions") == []

            merged_pending = rpc(
                reopened,
                "merged-candidates",
                "ordered_review_candidates",
                {"status": "pending", "limit": 20},
            )
            assert sum(item.get("personName") == "Sam" for item in merged_pending.get("items", [])) == 3, merged_pending
            undone = rpc(
                reopened,
                "undo",
                "undo_photo_operation",
                {"operationId": operation_id},
            ).get("value", {})
            assert undone.get("undone") is True and int(undone.get("restored", 0) or 0) >= 6, undone
            restored_pending = rpc(
                reopened,
                "restored-candidates",
                "ordered_review_candidates",
                {"status": "pending", "limit": 20},
            )
            assert sum(item.get("personName") == UNKNOWN for item in restored_pending.get("items", [])) == 3, restored_pending
            assert {path: sha256_file(Path(path)) for path in original_hashes} == original_hashes
        finally:
            stop_backend(reopened)

        print(json.dumps({
            "frozen": True,
            "offline": True,
            "pathFreeSuggestion": True,
            "explainableEvidence": True,
            "manipulatedReviewRejected": True,
            "explicitConfirmation": True,
            "identityMerge": True,
            "idempotentReplayAfterRestart": True,
            "undoAfterRestart": True,
            "originalsUnchanged": True,
        }, sort_keys=True))


if __name__ == "__main__":
    main()
