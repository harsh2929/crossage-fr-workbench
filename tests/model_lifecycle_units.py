"""Unit and integration tests for the unified model lifecycle gate."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import hashlib
import json
import os
import tempfile
import time

from crossage_fr.model_lifecycle import (
    ModelLifecycleGateError,
    ModelLifecycleIntegrityError,
    ModelLifecycleStore,
    evaluate_component,
    evaluate_model_lifecycle,
    load_policy,
)


ROOT = Path(__file__).resolve().parents[1]


def _component(policy: dict, component_id: str) -> dict:
    return next(item for item in policy["components"] if item["id"] == component_id)


def _runtime_inventory(policy: dict, fingerprint: str = "a" * 64) -> dict[str, dict[str, object]]:
    return {
        component["id"]: {
            "installed": True,
            "available": True,
            "verified": True,
            "version": "test-v1",
            "fingerprint": fingerprint,
            "reason": "verified fixture",
        }
        for component in policy["components"]
    }


def _expect(exc_type: type[BaseException], callback, contains: str = "") -> None:
    try:
        callback()
    except exc_type as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"Expected {contains!r} in {exc!r}") from exc
        return
    raise AssertionError(f"Expected {exc_type.__name__}")


def _payload_digest(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def test_bundled_policy_and_evidence_pass() -> None:
    policy = load_policy()
    assert policy["version"] == "2026-07-13.3", policy
    assert len(policy["components"]) == 9, policy
    report = evaluate_model_lifecycle(
        policy=policy,
        resource_root=ROOT,
        runtime_inventory=_runtime_inventory(policy),
    )
    assert report["ready"] is True, report
    assert report["counts"]["passed"] == 9, report
    assert report["counts"]["blocked"] == 0, report
    assert report["counts"]["datasetManifestsVerified"] == 9, report
    assert all(row["baseline"]["passed"] for row in report["components"]), report
    assert all(row["baseline"]["integrity"] for row in report["components"]), report
    dataset_rows = [dataset for row in report["components"] for dataset in row["datasets"]]
    assert all(dataset["verification"] for dataset in dataset_rows), dataset_rows
    assert sum("report-binding" in dataset["verification"] for dataset in dataset_rows) == 5, dataset_rows


def test_candidate_comparison_rejects_regression_and_fixture_drift() -> None:
    policy = load_policy()
    component = _component(policy, "photo-ocr")
    baseline_path = ROOT / component["baseline"]["reportPath"]
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        passing = root / "passing.json"
        passing.write_text(json.dumps(baseline), encoding="utf-8")
        result = evaluate_component(component, resource_root=ROOT, candidate_report_path=passing)
        assert result["candidate"]["passed"] is True, result

        regression = deepcopy(baseline)
        regression["performance"]["warmP95Ms"] = baseline["performance"]["warmP95Ms"] * 1.5
        regression_path = root / "regression.json"
        regression_path.write_text(json.dumps(regression), encoding="utf-8")
        result = evaluate_component(component, resource_root=ROOT, candidate_report_path=regression_path)
        assert result["candidate"]["passed"] is False, result
        assert any("regressed" in item for item in result["candidate"]["failures"]), result

        drift = deepcopy(baseline)
        drift["fixtures"]["bilingualSha256"] = "0" * 64
        drift_path = root / "fixture-drift.json"
        drift_path.write_text(json.dumps(drift), encoding="utf-8")
        result = evaluate_component(component, resource_root=ROOT, candidate_report_path=drift_path)
        assert result["candidate"]["passed"] is False, result
        assert any("bilingualSha256" in item for item in result["candidate"]["failures"]), result

        non_finite = deepcopy(baseline)
        non_finite["performance"]["warmP95Ms"] = float("nan")
        non_finite_path = root / "non-finite.json"
        non_finite_path.write_text(json.dumps(non_finite), encoding="utf-8")
        result = evaluate_component(component, resource_root=ROOT, candidate_report_path=non_finite_path)
        assert result["candidate"]["passed"] is False, result
        assert any("finite" in item for item in result["candidate"]["failures"]), result

        culling_component = _component(policy, "face-quality")
        culling_baseline_path = ROOT / culling_component["baseline"]["reportPath"]
        fixture_drift = json.loads(culling_baseline_path.read_text(encoding="utf-8"))
        fixture_drift["fixture"]["preparedManifestSha256"] = "0" * 64
        fixture_drift_path = root / "culling-fixture-drift.json"
        fixture_drift_path.write_text(json.dumps(fixture_drift), encoding="utf-8")
        result = evaluate_component(culling_component, resource_root=ROOT, candidate_report_path=fixture_drift_path)
        assert result["candidate"]["passed"] is False, result
        assert any("dataset or fixture binding drifted" in item for item in result["candidate"]["failures"]), result


def test_policy_rejects_unbound_dataset_claims() -> None:
    policy = load_policy()
    unbound = deepcopy(policy)
    dataset = _component(unbound, "face-quality")["datasets"][0]
    dataset.pop("reportJsonPath", None)
    with tempfile.TemporaryDirectory() as tmp:
        policy_path = Path(tmp) / "policy.json"
        policy_path.write_text(json.dumps(unbound), encoding="utf-8")
        _expect(ModelLifecycleIntegrityError, lambda: load_policy(policy_path), "no verifiable artifact or report binding")


def test_runtime_integrity_and_promoted_fingerprint_drift_fail_closed() -> None:
    policy = load_policy()
    inventory = _runtime_inventory(policy)
    inventory["photo-vlm"]["verified"] = False
    inventory["photo-vlm"]["reason"] = "catalog hash mismatch"
    report = evaluate_model_lifecycle(policy=policy, resource_root=ROOT, runtime_inventory=inventory)
    assert report["ready"] is False, report
    assert any("catalog hash mismatch" in blocker for blocker in report["blockers"]), report

    inventory = _runtime_inventory(policy)
    inventory["photo-vlm"]["fingerprint"] = ""
    report = evaluate_model_lifecycle(policy=policy, resource_root=ROOT, runtime_inventory=inventory)
    assert report["ready"] is False, report
    assert any("fingerprint is missing or invalid" in blocker for blocker in report["blockers"]), report

    accepted = {
        "accepted": {
            "photo-ocr": {
                "runtimeFingerprint": "b" * 64,
                "reportSha256": _component(policy, "photo-ocr")["baseline"]["reportSha256"],
            }
        }
    }
    report = evaluate_model_lifecycle(
        policy=policy,
        resource_root=ROOT,
        runtime_inventory=_runtime_inventory(policy, "a" * 64),
        accepted_state=accepted,
    )
    assert report["ready"] is False, report
    assert any("fingerprint drifted" in blocker for blocker in report["blockers"]), report


def test_staging_promotion_rollback_and_state_tamper() -> None:
    policy = load_policy()
    component = _component(policy, "photo-ocr")
    baseline_path = ROOT / component["baseline"]["reportPath"]
    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp) / "workspace"
        workspace.mkdir()
        store = ModelLifecycleStore(workspace, policy=policy, resource_root=ROOT)
        staged = store.stage_candidate("photo-ocr", baseline_path)
        assert staged["reportSha256"] == component["baseline"]["reportSha256"], staged
        _expect(ModelLifecycleGateError, lambda: store.promote_candidate("photo-ocr", runtime_fingerprint="a" * 64, confirm=False), "confirmation")
        promoted = store.promote_candidate("photo-ocr", runtime_fingerprint="a" * 64, confirm=True)
        assert promoted["runtimeFingerprint"] == "a" * 64, promoted

        candidate = json.loads(baseline_path.read_text(encoding="utf-8"))
        candidate["generatedAt"] = "2026-07-13T23:59:59Z"
        candidate_path = Path(tmp) / "candidate-v2.json"
        candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
        store.stage_candidate("photo-ocr", candidate_path)
        promoted_v2 = store.promote_candidate("photo-ocr", runtime_fingerprint="b" * 64, confirm=True)
        assert promoted_v2["reportSha256"] != promoted["reportSha256"], promoted_v2
        rolled_back = store.rollback_baseline("photo-ocr", confirm=True)
        assert rolled_back["restored"]["reportSha256"] == promoted["reportSha256"], rolled_back
        assert rolled_back["restored"]["runtimeFingerprint"] == "a" * 64, rolled_back

        state = store.read()
        assert any(item.get("reportSha256") == promoted_v2["reportSha256"] for item in state["history"]), state
        accepted_report = store.root / state["accepted"]["photo-ocr"]["reportPath"]
        accepted_bytes = accepted_report.read_bytes()
        accepted_report.write_bytes(accepted_bytes + b"\n")
        _expect(ModelLifecycleIntegrityError, store.status, "integrity")
        accepted_report.write_bytes(accepted_bytes)

        state_path = workspace / "model-lifecycle" / "state.json"
        envelope = json.loads(state_path.read_text(encoding="utf-8"))
        envelope["payload"]["accepted"]["photo-ocr"]["runtimeFingerprint"] = "f" * 64
        state_path.write_text(json.dumps(envelope), encoding="utf-8")
        _expect(ModelLifecycleIntegrityError, store.read, "integrity")
        assert state["accepted"]["photo-ocr"]["runtimeFingerprint"] == "a" * 64, state


def test_candidate_staging_rejects_a_drifted_accepted_baseline() -> None:
    policy = load_policy()
    component = deepcopy(_component(policy, "face-quality"))
    source = ROOT / component["baseline"]["reportPath"]
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "resources"
        root.mkdir()
        baseline = root / "face-quality-baseline.json"
        baseline.write_bytes(source.read_bytes())
        component["baseline"]["reportPath"] = baseline.name
        component["baseline"]["reportSha256"] = "0" * 64
        custom_policy = deepcopy(policy)
        custom_policy["components"] = [component if item["id"] == component["id"] else item for item in custom_policy["components"]]
        workspace = Path(tmp) / "workspace"
        workspace.mkdir()
        store = ModelLifecycleStore(workspace, policy=custom_policy, resource_root=root)
        _expect(
            ModelLifecycleIntegrityError,
            lambda: store.stage_candidate("face-quality", baseline),
            "accepted model evaluation baseline failed",
        )


def test_configuration_history_returns_previous_distinct_routes() -> None:
    policy = load_policy()
    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp) / "workspace"
        workspace.mkdir()
        store = ModelLifecycleStore(workspace, policy=policy, resource_root=ROOT)
        first = {
            "modelPack": "antelopev2",
            "modelRoot": "/models/a",
            "visionModelTier": "auto",
            "safeModeMultimodal": True,
        }
        second = {
            "modelPack": "buffalo_l",
            "modelRoot": "/models/a",
            "visionModelTier": "quality",
            "safeModeMultimodal": False,
        }
        store.record_configuration(first, reason="initial")
        store.record_configuration(first, reason="duplicate")
        store.record_configuration(second, reason="upgrade")
        assert store.status()["state"]["configurationHistory"] == 2
        previous = store.previous_configuration(second)
        assert previous["configuration"] == first, previous
        _expect(ModelLifecycleGateError, lambda: ModelLifecycleStore(Path(tmp) / "empty", policy=policy, resource_root=ROOT).previous_configuration(first), "No previous")


def test_policy_upgrade_migrates_only_valid_configuration_history() -> None:
    policy = load_policy()
    component = _component(policy, "photo-ocr")
    baseline_path = ROOT / component["baseline"]["reportPath"]
    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp) / "workspace"
        workspace.mkdir()
        store = ModelLifecycleStore(workspace, policy=policy, resource_root=ROOT)
        configuration = {
            "modelPack": "antelopev2",
            "modelRoot": "/models/verified",
            "visionModelTier": "quality",
            "safeModeMultimodal": True,
        }
        store.record_configuration(configuration, reason="before policy update")
        store.stage_candidate("photo-ocr", baseline_path)
        store.promote_candidate("photo-ocr", runtime_fingerprint="a" * 64, confirm=True)
        store.stage_candidate("photo-ocr", baseline_path)

        envelope = json.loads(store.path.read_text(encoding="utf-8"))
        envelope["payload"]["policyVersion"] = "2026-06-01.9"
        envelope["payload"]["policySha256"] = "f" * 64
        envelope["payloadSha256"] = _payload_digest(envelope["payload"])
        store.path.write_text(json.dumps(envelope), encoding="utf-8")

        migrated = store.read()
        assert migrated["policyVersion"] == policy["version"], migrated
        assert migrated["policySha256"] == policy["policySha256"], migrated
        assert migrated["accepted"] == {}, migrated
        assert migrated["staged"] == {}, migrated
        assert migrated["history"] == [], migrated
        assert migrated["configurationHistory"][0]["configuration"] == configuration, migrated
        assert len(migrated["policyMigrations"]) == 1, migrated
        migration = migrated["policyMigrations"][0]
        assert migration["discardedAccepted"] == 1, migration
        assert migration["discardedStaged"] == 1, migration
        assert store.status()["state"]["policyMigrations"] == 1


def test_state_lock_fails_closed_and_recovers_abandoned_owner() -> None:
    policy = load_policy()
    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp) / "workspace"
        workspace.mkdir()
        store = ModelLifecycleStore(
            workspace,
            policy=policy,
            resource_root=ROOT,
            lock_timeout_seconds=0.1,
        )
        store.root.mkdir(parents=True)
        store.lock_path.write_text(json.dumps({"pid": os.getpid(), "token": "active"}), encoding="utf-8")
        _expect(ModelLifecycleIntegrityError, store.read, "busy")
        assert store.lock_path.is_file()

        store.lock_path.write_text(json.dumps({"pid": 2**30, "token": "abandoned"}), encoding="utf-8")
        stale = time.time() - 60
        os.utime(store.lock_path, (stale, stale))
        assert store.read()["policySha256"] == policy["policySha256"]
        assert not store.lock_path.exists()


def test_desktop_api_exposes_runtime_gate_and_baseline_lifecycle() -> None:
    from crossage_fr.api_server import DesktopApi

    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        registry = str(base / "registry")
        import os

        os.environ["VINTRACE_REGISTRY_HOME"] = registry
        os.environ["CROSSAGE_REGISTRY_HOME"] = registry
        api = DesktopApi(base / "workspace")
        status = api.handle("model_lifecycle_status", {})
        assert status["policyVersion"] == "2026-07-13.3", status
        assert status["counts"]["components"] == 9, status
        assert status["counts"]["blocked"] == 0, status
        evaluated = api.handle("run_model_lifecycle_evaluation", {})
        assert evaluated["ready"] is True, evaluated

        policy = load_policy()
        ocr_report = ROOT / _component(policy, "photo-ocr")["baseline"]["reportPath"]
        staged = api.handle("stage_model_lifecycle_candidate", {
            "componentId": "photo-ocr",
            "reportPath": str(ocr_report),
        })
        assert staged["staged"]["componentId"] == "photo-ocr", staged
        promoted = api.handle("promote_model_lifecycle_candidate", {
            "componentId": "photo-ocr",
            "confirm": True,
        })
        assert promoted["promoted"]["runtimeFingerprint"], promoted
        assert promoted["status"]["counts"]["blocked"] == 0, promoted
        rolled_back = api.handle("rollback_model_lifecycle_baseline", {
            "componentId": "photo-ocr",
            "confirm": True,
        })
        assert rolled_back["value"]["rolledBack"] is True, rolled_back


if __name__ == "__main__":
    test_bundled_policy_and_evidence_pass()
    test_candidate_comparison_rejects_regression_and_fixture_drift()
    test_policy_rejects_unbound_dataset_claims()
    test_runtime_integrity_and_promoted_fingerprint_drift_fail_closed()
    test_staging_promotion_rollback_and_state_tamper()
    test_candidate_staging_rejects_a_drifted_accepted_baseline()
    test_configuration_history_returns_previous_distinct_routes()
    test_policy_upgrade_migrates_only_valid_configuration_history()
    test_state_lock_fails_closed_and_recovers_abandoned_owner()
    test_desktop_api_exposes_runtime_gate_and_baseline_lifecycle()
    print("model lifecycle units ok")
