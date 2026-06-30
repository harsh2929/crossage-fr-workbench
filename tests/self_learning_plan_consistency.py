from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from crossage_fr.experiments import self_learning_audit
import release_check


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def ready_audit() -> dict:
    audit = self_learning_audit.self_learning_rd_audit()
    for item in audit["requirements"]:
        item["ok"] = True
        item["status"] = "satisfied"
        item["blockers"] = []
    audit["ok"] = True
    audit["status"] = "satisfied"
    audit["blockers"] = []
    return audit


def write_ready_audit(path: Path) -> Path:
    from self_learning_audit_units import write_phase5_decision, write_phase6_readiness

    phase5_path = write_phase5_decision(path.parent / "phase5-decision.json")
    phase6_path, _legal_path, _runtime_path = write_phase6_readiness(path.parent / "phase6")
    written = self_learning_audit.write_self_learning_rd_audit(
        path,
        phase5_decision_path=phase5_path,
        phase6_readiness_path=phase6_path,
    )
    return Path(written["auditPath"])


def check_all_items(markdown: str, checked: bool) -> str:
    next_markdown = markdown
    marker = "- [x]" if checked else "- [ ]"
    for item in self_learning_audit.PLAN_CHECKLIST_ITEMS:
        text = item["text"]
        next_markdown = next_markdown.replace(f"- [ ] {text}", f"{marker} {text}")
        next_markdown = next_markdown.replace(f"- [x] {text}", f"{marker} {text}")
    return next_markdown


def main() -> None:
    plan_path = repo_root() / "docs" / "2026-self-learning-loop-plan.md"
    default_audit_path = repo_root() / "benchmarks" / "evidence" / "self-learning-rd" / "self_learning_rd_audit.json"
    current = self_learning_audit.plan_checklist_consistency(plan_path, audit=default_audit_path)
    assert current["ok"] is True, current
    assert {item["requirementId"] for item in current["items"]} == {
        item["requirementId"] for item in self_learning_audit.PLAN_CHECKLIST_ITEMS
    }
    assert {
        item["requirementId"]
        for item in current["items"]
        if item["checked"] is True
    } == {
        "phase5.trainingArtifacts",
        "phase5.runtimeStudy",
        "phase5.measurableGain",
        "phase5.packagingImpact",
        "phase6.gpuRuntimeStudy",
    }, current
    release_posture = release_check.run_self_learning_r_and_d_check()
    assert release_posture["ok"] is True, release_posture
    assert release_posture["auditOk"] is False, release_posture
    assert release_posture["auditStatus"] == "blocked", release_posture
    assert release_posture["notProductionAuthorization"] is True, release_posture
    assert release_posture["blockedRequirements"] == ["phase6.legalReview"], release_posture
    assert release_posture["satisfiedRequirements"] == [
        "phase5.trainingArtifacts",
        "phase5.runtimeStudy",
        "phase5.measurableGain",
        "phase5.packagingImpact",
        "phase6.gpuRuntimeStudy",
    ], release_posture

    with tempfile.TemporaryDirectory(prefix="vintrace-self-learning-plan-") as raw:
        root = Path(raw)
        markdown = plan_path.read_text(encoding="utf-8")

        premature_path = root / "premature-plan.md"
        premature_text = markdown.replace(
            "- [ ] Legal review for derivative weights and model licenses.",
            "- [x] Legal review for derivative weights and model licenses.",
        )
        premature_path.write_text(premature_text, encoding="utf-8")
        premature = self_learning_audit.plan_checklist_consistency(premature_path, audit=default_audit_path)
        assert premature["ok"] is False, premature
        assert "plan-checklist-premature:phase6.legalReview" in premature["blockers"], premature
        premature_posture = release_check.run_self_learning_r_and_d_check(plan_path=premature_path)
        assert premature_posture["ok"] is False, premature_posture
        assert "plan-checklist-premature:phase6.legalReview" in premature_posture["planBlockers"], premature_posture

        missing_path = root / "missing-plan.md"
        missing_path.write_text(
            markdown.replace("- [x] GPU/runtime feasibility study.", "- GPU/runtime feasibility study."),
            encoding="utf-8",
        )
        missing = self_learning_audit.plan_checklist_consistency(missing_path, audit=default_audit_path)
        assert missing["ok"] is False, missing
        assert "plan-checklist-missing:phase6.gpuRuntimeStudy" in missing["blockers"], missing

        invalid_audit_path = root / "invalid-audit.json"
        invalid_audit_path.write_text("{", encoding="utf-8")
        invalid_audit = self_learning_audit.plan_checklist_consistency(plan_path, audit=invalid_audit_path)
        assert invalid_audit["ok"] is False, invalid_audit
        assert any(blocker.startswith("plan-audit-invalid:self-learning-audit-invalid-json") for blocker in invalid_audit["blockers"]), invalid_audit
        invalid_release_posture = release_check.run_self_learning_r_and_d_check(audit=invalid_audit_path)
        assert invalid_release_posture["ok"] is False, invalid_release_posture
        assert any(error.startswith("self-learning-audit-invalid-json") for error in invalid_release_posture["semanticErrors"]), invalid_release_posture
        assert any(
            blocker.startswith("plan-audit-invalid:self-learning-audit-invalid-json")
            for blocker in invalid_release_posture["planBlockers"]
        ), invalid_release_posture
        invalid_bytes_audit_path = root / "invalid-bytes-audit.json"
        invalid_bytes_audit_path.write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_audit = self_learning_audit.plan_checklist_consistency(plan_path, audit=invalid_bytes_audit_path)
        assert invalid_bytes_audit["ok"] is False, invalid_bytes_audit
        assert any(
            blocker.startswith("plan-audit-invalid:self-learning-audit-invalid-json")
            for blocker in invalid_bytes_audit["blockers"]
        ), invalid_bytes_audit
        invalid_bytes_release_posture = release_check.run_self_learning_r_and_d_check(audit=invalid_bytes_audit_path)
        assert invalid_bytes_release_posture["ok"] is False, invalid_bytes_release_posture
        assert any(
            error.startswith("self-learning-audit-invalid-json")
            for error in invalid_bytes_release_posture["semanticErrors"]
        ), invalid_bytes_release_posture

        missing_audit_path = root / "missing-audit.json"
        missing_audit = self_learning_audit.plan_checklist_consistency(plan_path, audit=missing_audit_path)
        assert missing_audit["ok"] is False, missing_audit
        assert any(blocker.startswith("plan-audit-invalid:self-learning-audit-file-missing") for blocker in missing_audit["blockers"]), missing_audit
        missing_release_posture = release_check.run_self_learning_r_and_d_check(audit=missing_audit_path)
        assert missing_release_posture["ok"] is False, missing_release_posture
        assert any(error.startswith("self-learning-audit-file-missing") for error in missing_release_posture["semanticErrors"]), missing_release_posture
        assert any(
            blocker.startswith("plan-audit-invalid:self-learning-audit-file-missing")
            for blocker in missing_release_posture["planBlockers"]
        ), missing_release_posture

        audit_directory_path = root / "audit-directory.json"
        audit_directory_path.mkdir()
        unreadable_audit = self_learning_audit.plan_checklist_consistency(plan_path, audit=audit_directory_path)
        assert unreadable_audit["ok"] is False, unreadable_audit
        assert any(
            blocker.startswith("plan-audit-invalid:self-learning-audit-unreadable")
            for blocker in unreadable_audit["blockers"]
        ), unreadable_audit
        unreadable_release_posture = release_check.run_self_learning_r_and_d_check(audit=audit_directory_path)
        assert unreadable_release_posture["ok"] is False, unreadable_release_posture
        assert any(
            error.startswith("self-learning-audit-unreadable")
            for error in unreadable_release_posture["semanticErrors"]
        ), unreadable_release_posture
        assert any(
            blocker.startswith("plan-audit-invalid:self-learning-audit-unreadable")
            for blocker in unreadable_release_posture["planBlockers"]
        ), unreadable_release_posture

        complete_audit_path = write_ready_audit(root / "ready-audit.json")

        stale_path = root / "stale-plan.md"
        stale_path.write_text(markdown, encoding="utf-8")
        stale = self_learning_audit.plan_checklist_consistency(stale_path, audit=complete_audit_path)
        assert stale["ok"] is False, stale
        assert "plan-checklist-stale-unchecked:phase6.legalReview" in stale["blockers"], stale

        complete_path = root / "complete-plan.md"
        complete_path.write_text(check_all_items(markdown, checked=True), encoding="utf-8")
        complete = self_learning_audit.plan_checklist_consistency(complete_path, audit=complete_audit_path)
        assert complete["ok"] is True, complete

        env_names = ("VINTRACE_SELF_LEARNING_AUDIT", "VINTRACE_PHASE5_DECISION", "VINTRACE_PHASE6_READINESS")
        old_env = {name: os.environ.get(name) for name in env_names}
        try:
            os.environ["VINTRACE_SELF_LEARNING_AUDIT"] = str(complete_audit_path)
            os.environ.pop("VINTRACE_PHASE5_DECISION", None)
            os.environ.pop("VINTRACE_PHASE6_READINESS", None)
            env_audit_posture = release_check.run_self_learning_r_and_d_check(plan_path=complete_path)
            assert env_audit_posture["ok"] is True, env_audit_posture
            assert env_audit_posture["satisfiedRequirements"] == self_learning_audit.REQUIREMENT_IDS, env_audit_posture

            source_audit = json.loads(complete_audit_path.read_text(encoding="utf-8"))
            os.environ.pop("VINTRACE_SELF_LEARNING_AUDIT", None)
            os.environ["VINTRACE_PHASE5_DECISION"] = source_audit["sourceReports"]["phase5Decision"]["path"]
            os.environ["VINTRACE_PHASE6_READINESS"] = source_audit["sourceReports"]["phase6Readiness"]["path"]
            env_source_posture = release_check.run_self_learning_r_and_d_check(plan_path=complete_path)
            assert env_source_posture["ok"] is True, env_source_posture
            assert env_source_posture["satisfiedRequirements"] == self_learning_audit.REQUIREMENT_IDS, env_source_posture
        finally:
            for name, value in old_env.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value

        forged_audit_path = root / "forged-ready-audit.json"
        forged_audit_path.write_text(json.dumps(ready_audit(), indent=2, sort_keys=True), encoding="utf-8")
        forged_complete = self_learning_audit.plan_checklist_consistency(complete_path, audit=forged_audit_path)
        assert forged_complete["ok"] is False, forged_complete
        assert any(blocker.startswith("plan-audit-invalid:") for blocker in forged_complete["blockers"]), forged_complete
        assert "plan-checklist-premature:phase5.trainingArtifacts" in forged_complete["blockers"], forged_complete

        false_auth = json.loads(complete_audit_path.read_text(encoding="utf-8"))
        false_auth["notProductionAuthorization"] = False
        false_auth_posture = release_check.run_self_learning_r_and_d_check(plan_path=complete_path, audit=false_auth)
        assert false_auth_posture["ok"] is False, false_auth_posture
        assert "self-learning-audit-authorization-scope-invalid" in false_auth_posture["semanticErrors"], false_auth_posture

    print("self-learning plan consistency ok")


if __name__ == "__main__":
    main()
