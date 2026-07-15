from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any
import argparse
import hashlib
import json
import math
import os
import platform
import socket
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _pseudonym(dataset_id: str, identity: str) -> str:
    digest = hashlib.sha256(f"{dataset_id}\0{identity}".encode("utf-8")).hexdigest()[:16]
    return f"benchmark-person-{digest}"


def _relative_private_path(workspace: Path, value: str | Path) -> str:
    try:
        return str(Path(value).expanduser().resolve().relative_to(workspace.resolve()))
    except (OSError, ValueError):
        return ""


def _write_json(path: Path, value: dict[str, Any]) -> None:
    from crossage_fr.workspace_registry import atomic_write_text, restrict_file_mode

    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_text(path, json.dumps(value, indent=2, sort_keys=True) + "\n")
    restrict_file_mode(path, 0o600)


def _secure_purge_tree(root: Path) -> dict[str, int]:
    from crossage_fr.store.workspace_encryption import secure_remove_file

    candidate = root.expanduser()
    if candidate.is_symlink():
        raise ValueError("The private benchmark purge target cannot be a symbolic link.")
    target = candidate.resolve()
    if not target.exists():
        return {"files": 0, "bytes": 0}
    if target.is_symlink() or not target.is_dir():
        raise ValueError("The private benchmark purge target must be an ordinary directory.")
    files = 0
    removed_bytes = 0
    for current, dirnames, filenames in os.walk(target, topdown=False, followlinks=False):
        current_path = Path(current)
        for filename in filenames:
            path = current_path / filename
            try:
                removed_bytes += int(path.stat().st_size) if not path.is_symlink() else 0
            except OSError:
                pass
            if path.is_symlink():
                path.unlink(missing_ok=True)
            else:
                secure_remove_file(path)
            files += 1
        for dirname in dirnames:
            path = current_path / dirname
            if path.is_symlink():
                path.unlink(missing_ok=True)
            else:
                path.rmdir()
    target.rmdir()
    return {"files": files, "bytes": removed_bytes}


def _secure_remove_private_file(path: Path) -> bool:
    from crossage_fr.store.workspace_encryption import secure_remove_file

    if not path.exists() and not path.is_symlink():
        return False
    if path.is_symlink():
        path.unlink(missing_ok=True)
    else:
        secure_remove_file(path)
    return True


def _single_face(engine: Any, path: Path) -> Any:
    embeddings = list(engine.embed_image(path))
    if len(embeddings) != 1:
        raise ValueError(f"expected one face, found {len(embeddings)}")
    result = embeddings[0]
    if not result.vector or not all(math.isfinite(float(value)) for value in result.vector):
        raise ValueError("recognizer returned an invalid face vector")
    return result


def _select_pair(dataset_id: str, images: list[Path], helper: Any) -> tuple[Path, Path, int | None, int | None, str, str] | None:
    from crossage_fr.match.age_trajectory import age_bucket_for_years

    ordered = sorted(images, key=lambda path: str(path).casefold())
    if dataset_id in {"agedb", "fgnet"}:
        aged = [(helper._public_dataset_age_value(path), path) for path in ordered]
        aged = [(age, path) for age, path in aged if age is not None]
        if len(aged) < 2:
            return None
        aged.sort(key=lambda item: (int(item[0]), str(item[1]).casefold()))
        source_age, source = aged[0]
        candidate_age, candidate = aged[-1]
        source_bucket = age_bucket_for_years(source_age)
        target_bucket = age_bucket_for_years(candidate_age)
    else:
        if len(ordered) < 2:
            return None
        young = [path for path in ordered if helper._public_dataset_reference_age_bucket("calfw", path, path_index=0, path_count=2, endpoint_proxy=False) == "adolescent"]
        older = [path for path in ordered if helper._public_dataset_reference_age_bucket("calfw", path, path_index=1, path_count=2, endpoint_proxy=False) == "older-adult"]
        source = young[0] if young else ordered[0]
        candidate = older[-1] if older else ordered[-1]
        source_age = candidate_age = None
        source_bucket = "adolescent"
        target_bucket = "older-adult"
    if source.resolve() == candidate.resolve() or source_bucket == target_bucket or target_bucket == "unknown":
        return None
    return source, candidate, source_age, candidate_age, source_bucket, target_bucket


def _prepare_dataset(dataset_id: str, source: Path, workspace: Path) -> tuple[Path, dict[str, Any]]:
    from crossage_fr.dataset_benchmarks import prepare_fgnet_dataset

    if dataset_id != "fgnet":
        return source.resolve(), {"downloadPerformed": False, "sourceMutated": False}
    prepared = prepare_fgnet_dataset(
        source.resolve(),
        workspace / "private-benchmark" / "prepared-fgnet",
        terms_acknowledged=True,
    )
    return Path(str(prepared["folder"])).resolve(), prepared


def _new_state(
    *,
    dataset_id: str,
    source_dataset: Path,
    dataset_root: Path,
    preparation: dict[str, Any],
    project: Any,
    engine: Any,
    max_identities: int,
    negative_identities: int,
    generative_root: Path,
    seed: int,
    steps: int,
) -> tuple[dict[str, Any], list[str]]:
    from crossage_fr.benchmarks.public_dataset import PublicDatasetBenchmarkMixin
    from crossage_fr.benchmarks.synthetic_age_image import benchmark_case_id
    from crossage_fr.dataset_benchmarks import identity_media_index
    from crossage_fr.ingest.image_io import image_record_for_path, load_image
    from crossage_fr.models import ReferenceFace
    from crossage_fr.photo_generative import run_photo_generative_edit

    helper = PublicDatasetBenchmarkMixin()
    identities, truncated, entries_checked = identity_media_index(
        dataset_root,
        max_identities=max_identities + negative_identities + 100,
        include_videos=False,
    )
    selected: list[dict[str, Any]] = []
    errors: list[str] = []
    for identity in identities:
        pair = _select_pair(dataset_id, list(identity.images), helper)
        if pair is None:
            continue
        source, candidate, source_age, candidate_age, source_bucket, target_bucket = pair
        try:
            source_embedding = _single_face(engine, source)
            _single_face(engine, candidate)
        except Exception as exc:
            errors.append(f"positive source/candidate rejected: {exc}")
            continue
        source_hash = _sha256(source)
        candidate_hash = _sha256(candidate)
        person = _pseudonym(dataset_id, identity.identity)
        record = image_record_for_path(source, image=load_image(source), sha256=source_hash)
        ref_id = "ref_benchmark_" + hashlib.sha256(f"{person}\0{source_hash}".encode("utf-8")).hexdigest()[:20]
        ref = ReferenceFace(
            ref_id=ref_id,
            person_name=person,
            age_bucket=source_bucket,
            source_path=str(source.resolve()),
            capture_date=record.capture_date,
            quality=float(source_embedding.quality),
            model_name=str(source_embedding.model_name),
            vector=list(source_embedding.vector),
            source_hash=source_hash,
            pose_bucket=str(source_embedding.pose_bucket or "unknown"),
            capture_date_provenance=str(record.capture_date_provenance or "unknown"),
            derivation_provenance={
                "benchmarkOnly": True,
                "datasetId": dataset_id,
                "protocolVersion": "synthetic-age-image-eval-v1",
            },
        )
        project.references[ref_id] = ref
        project.vector_store.add(ref_id, ref.vector)
        selected.append(
            {
                "caseId": benchmark_case_id(dataset_id, source_hash, candidate_hash, target_bucket),
                "personName": person,
                "parentRefId": ref_id,
                "sourcePath": str(source.resolve()),
                "candidatePath": str(candidate.resolve()),
                "sourceHash": source_hash,
                "candidateHash": candidate_hash,
                "sourceAge": source_age,
                "candidateAge": candidate_age,
                "sourceAgeBucket": source_bucket,
                "targetAgeBucket": target_bucket,
                "expectedMatch": True,
                "artifactStatus": "not-generated",
            }
        )
        if len(selected) >= max_identities:
            break
    if len(selected) < 2:
        raise ValueError("The benchmark needs at least two one-face identities with distinct source and target age ranges.")
    project._invalidate_reference_indexes()
    project.save()

    enrolled_identities = {case["personName"] for case in selected}
    negatives: list[dict[str, Any]] = []
    selected_source_hashes = {case["sourceHash"] for case in selected}
    for identity in identities:
        person = _pseudonym(dataset_id, identity.identity)
        if person in enrolled_identities:
            continue
        for path in reversed(identity.images):
            try:
                _single_face(engine, path)
                candidate_hash = _sha256(path)
            except Exception:
                continue
            if candidate_hash in selected_source_hashes:
                continue
            negatives.append(
                {
                    "caseId": "ageimg_negative_" + hashlib.sha256(f"{dataset_id}\0{candidate_hash}".encode("utf-8")).hexdigest()[:24],
                    "candidatePath": str(path.resolve()),
                    "candidateHash": candidate_hash,
                    "expectedMatch": False,
                }
            )
            break
        if len(negatives) >= negative_identities:
            break

    state = {
        "schemaVersion": 1,
        "benchmarkVersion": "synthetic-age-image-eval-v1",
        "createdAt": _now(),
        "updatedAt": _now(),
        "datasetId": dataset_id,
        "sourceDatasetFolder": str(source_dataset.resolve()),
        "preparedDatasetFolder": str(dataset_root.resolve()),
        "datasetPreparation": preparation,
        "datasetInspection": {
            "identityCount": len(identities),
            "entriesChecked": entries_checked,
            "truncated": truncated,
        },
        "engineModel": str(getattr(engine, "model_name", "") or ""),
        "generativeRoot": str(generative_root.resolve()),
        "seed": seed,
        "steps": steps,
        "positiveCases": selected,
        "negativeCases": negatives,
    }

    original_connect = socket.socket.connect
    outbound_attempts: list[str] = []

    def block_outbound(sock: socket.socket, address: Any) -> None:
        outbound_attempts.append(repr(address))
        raise RuntimeError("Outbound network access is forbidden during the synthetic age-image benchmark.")

    socket.socket.connect = block_outbound
    try:
        for index, case in enumerate(state["positiveCases"]):
            result = project.generate_synthetic_age_image_reviews(
                case["personName"],
                [case["targetAgeBucket"]],
                engine,
                run_photo_generative_edit,
                acknowledge_ai_age_generation=True,
                source=f"synthetic-age-image-benchmark:{dataset_id}",
                generative_root=generative_root,
                seed=seed + index,
                steps=steps,
            )
            artifact: dict[str, Any] | None = None
            if result.get("artifacts"):
                artifact = result["artifacts"][0]
            elif result.get("rejectedArtifacts"):
                artifact = result["rejectedArtifacts"][0]
            elif result.get("skippedArtifacts"):
                artifact_id = str(result["skippedArtifacts"][0].get("artifactId", "") or "")
                artifact = project.db.learned_artifact_by_id(artifact_id)
            if artifact:
                payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
                metrics = artifact.get("metrics") if isinstance(artifact.get("metrics"), dict) else {}
                generated_path = ""
                try:
                    stored_path = str(payload.get("generatedPath", "") or "")
                    if stored_path:
                        generated_path = str(project._synthetic_age_image_path(stored_path, require_file=False))
                except (OSError, ValueError):
                    generated_path = ""
                case.update(
                    {
                        "artifactId": str(artifact.get("artifactId", artifact.get("artifact_id", "")) or ""),
                        "artifactStatus": str(artifact.get("status", "") or ""),
                        "reviewEligible": str(artifact.get("status", "") or "") == "staged",
                        "generatedPath": generated_path,
                        "generatedHash": str(payload.get("generatedHash", "") or ""),
                        "machineMetrics": metrics,
                    }
                )
            elif result.get("errors"):
                case["artifactStatus"] = "error"
                case["generationError"] = str(result["errors"][0].get("error", "") or "")[:600]
            state["updatedAt"] = _now()
            _write_json(project.root / "synthetic-age-image-benchmark-state.json", state)
    finally:
        socket.socket.connect = original_connect
    state["outboundSocketAttempts"] = outbound_attempts
    state["updatedAt"] = _now()
    return state, errors


def _review_template(state: dict[str, Any], workspace: Path) -> dict[str, Any]:
    from crossage_fr.benchmarks.synthetic_age_image import review_manifest_template

    staged = [case for case in state.get("positiveCases", []) if case.get("reviewEligible")]
    template = review_manifest_template(staged)
    template["privateAssets"] = [
        {
            "caseId": case["caseId"],
            "sourcePath": case["sourcePath"],
            "sourceSha256": case["sourceHash"],
            "generatedPath": case["generatedPath"],
            "generatedSha256": case["generatedHash"],
            "targetPath": case["candidatePath"],
            "targetSha256": case["candidateHash"],
            "targetAgeBucket": case["targetAgeBucket"],
        }
        for case in staged
    ]
    template["privacyNotice"] = (
        "This private local manifest contains biometric image paths. Do not publish it. The public benchmark report contains hashes and metrics only."
    )
    template["workspace"] = str(workspace.resolve())
    return template


def _apply_review(project: Any, engine: Any, state: dict[str, Any], review_path: Path) -> tuple[dict[str, dict[str, Any]], str]:
    from crossage_fr.benchmarks.synthetic_age_image import canonical_json_sha256, validate_review_manifest

    review = json.loads(review_path.read_text(encoding="utf-8"))
    if not isinstance(review, dict):
        raise ValueError("The review manifest must be a JSON object.")
    staged = [case for case in state.get("positiveCases", []) if case.get("reviewEligible") and case.get("artifactId")]
    decisions = validate_review_manifest(review, staged)
    for case in staged:
        decision = decisions[case["caseId"]]
        artifact = project.db.learned_artifact_by_id(case["artifactId"])
        if not artifact:
            raise ValueError("A reviewed benchmark artifact is missing from the isolated workspace.")
        payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
        status = str(artifact.get("status", "") or "")
        try:
            generated_path = project._synthetic_age_image_path(str(payload.get("generatedPath", "") or ""))
        except (FileNotFoundError, OSError, ValueError):
            generated_path = Path("")
        if status in {"staged", "promoted"} and (
            not generated_path.is_file() or _sha256(generated_path) != decision["generatedSha256"]
        ):
            raise ValueError("A reviewed benchmark image changed or disappeared before the decision was applied.")
        if decision["decision"] == "approve":
            if status == "staged":
                project.approve_synthetic_age_image_review(
                    case["artifactId"],
                    engine,
                    operator=str(decision["reviewer"]),
                    acknowledge_visual_review=True,
                )
            elif status != "promoted":
                raise ValueError("An approved review decision conflicts with the artifact status.")
            case["artifactStatus"] = "promoted"
        else:
            if status == "staged":
                project.reject_synthetic_age_image_review(case["artifactId"], reason=decision["reason"])
            elif status != "rejected":
                raise ValueError("A rejected review decision conflicts with the artifact status.")
            case["artifactStatus"] = "rejected"
        case["reviewDecision"] = {
            "decision": decision["decision"],
            "reviewedAt": decision["reviewedAt"],
            "reviewerRef": hashlib.sha256(str(decision["reviewer"]).encode("utf-8")).hexdigest()[:20],
            "perceivedAgeBucket": str(decision.get("perceivedAgeBucket", "") or ""),
        }
    state["reviewManifestSha256"] = canonical_json_sha256(review)
    state["updatedAt"] = _now()
    return decisions, state["reviewManifestSha256"]


def _evaluate(project: Any, engine: Any, state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], list[str]]:
    from crossage_fr.benchmarks.synthetic_age_image import compare_galleries, evaluate_gallery
    from crossage_fr.match.age_trajectory import is_generated_age_image_reference

    errors: list[str] = []
    cases: list[dict[str, Any]] = []
    for case in [*state.get("positiveCases", []), *state.get("negativeCases", [])]:
        path = Path(str(case.get("candidatePath", "") or "")).expanduser()
        expected_hash = str(case.get("candidateHash", "") or "")
        try:
            if not path.is_file() or _sha256(path) != expected_hash:
                raise ValueError("candidate changed after staging")
            embedding = _single_face(engine, path)
            cases.append(
                {
                    "caseId": case["caseId"],
                    "expectedMatch": bool(case.get("expectedMatch", False)),
                    "expectedPerson": str(case.get("personName", "") or "") if case.get("expectedMatch") else "",
                    "candidateVector": list(embedding.vector),
                }
            )
        except Exception as exc:
            errors.append(f"{case.get('caseId', 'unknown')}: {exc}")
    real_refs = [ref for ref in project.references.values() if not is_generated_age_image_reference(ref)]
    generated_refs = [ref for ref in project.references.values() if is_generated_age_image_reference(ref)]
    baseline_gallery = [
        {"refId": ref.ref_id, "personName": ref.person_name, "vector": ref.vector, "generated": False}
        for ref in real_refs
    ]
    augmented_gallery = [
        *baseline_gallery,
        *[
            {"refId": ref.ref_id, "personName": ref.person_name, "vector": ref.vector, "generated": True}
            for ref in generated_refs
        ],
    ]
    threshold = float(project.config.thresholds.likely)
    baseline = evaluate_gallery(cases, baseline_gallery, threshold=threshold)
    augmented = evaluate_gallery(cases, augmented_gallery, threshold=threshold)
    return baseline, augmented, compare_galleries(baseline, augmented), errors


def _public_case_rows(state: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for case in state.get("positiveCases", []):
        metrics = case.get("machineMetrics") if isinstance(case.get("machineMetrics"), dict) else {}
        rows.append(
            {
                "caseId": case.get("caseId"),
                "sourceSha256": case.get("sourceHash"),
                "candidateSha256": case.get("candidateHash"),
                "sourceAge": case.get("sourceAge"),
                "candidateAge": case.get("candidateAge"),
                "sourceAgeBucket": case.get("sourceAgeBucket"),
                "targetAgeBucket": case.get("targetAgeBucket"),
                "artifactStatus": case.get("artifactStatus"),
                "generatedSha256": case.get("generatedHash", ""),
                "machineMetrics": {
                    key: metrics.get(key)
                    for key in (
                        "faceCount",
                        "quality",
                        "targetIdentityCosine",
                        "parentCosine",
                        "nearestOtherCosine",
                        "identityMargin",
                        "reasons",
                    )
                },
                "reviewDecision": case.get("reviewDecision", {}),
            }
        )
    return rows


def _base_report(args: argparse.Namespace, status: dict[str, Any], reasons: list[str]) -> dict[str, Any]:
    from crossage_fr.benchmarks.synthetic_age_image import SYNTHETIC_AGE_IMAGE_BENCHMARK_VERSION
    from crossage_fr.match.age_trajectory import IMAGE_AGE_AUGMENTATION_METHOD_VERSION
    from crossage_fr.photo_generative import (
        CATALOG_SHA256,
        CATALOG_VERSION,
        QWEN_IMAGE_EDIT_MODEL_ID,
        QWEN_IMAGE_EDIT_REVISION,
        STABLE_DIFFUSION_CPP_REVISION,
        STABLE_DIFFUSION_CPP_RUNTIME_ID,
    )

    heavy = status.get("heavy") if isinstance(status.get("heavy"), dict) else {}
    return {
        "schemaVersion": 1,
        "benchmarkVersion": SYNTHETIC_AGE_IMAGE_BENCHMARK_VERSION,
        "methodVersion": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
        "generatedAt": _now(),
        "status": "incomplete",
        "reasons": reasons,
        "datasetId": args.dataset,
        "datasetTermsAcknowledged": bool(args.acknowledge_research_terms),
        "syntheticProcessingAuthorizationAttested": bool(args.acknowledge_synthetic_processing_authorization),
        "offlineInferenceRequired": True,
        "autoEnrollment": False,
        "humanVisualReviewRequired": True,
        "runtimeEvidence": {
            "platform": status.get("platform", platform.platform()),
            "python": platform.python_version(),
            "catalogVersion": CATALOG_VERSION,
            "catalogSha256": CATALOG_SHA256,
            "modelId": QWEN_IMAGE_EDIT_MODEL_ID,
            "modelRevision": QWEN_IMAGE_EDIT_REVISION,
            "modelLicense": "Apache-2.0",
            "runtimeId": STABLE_DIFFUSION_CPP_RUNTIME_ID,
            "runtimeRevision": STABLE_DIFFUSION_CPP_REVISION,
            "runtimeLicense": "MIT",
            "totalMemoryBytes": int(status.get("totalMemoryBytes", 0) or 0),
            "minimumMemoryBytes": int(heavy.get("minimumMemoryBytes", 0) or 0),
            "hardwareSupported": bool(heavy.get("hardwareSupported", False)),
            "platformSupported": bool(heavy.get("platformSupported", False)),
            "modelsAndRuntimeVerified": bool(heavy.get("ready", False)),
            "ageProgressReady": bool(status.get("modes", {}).get("age-progress", False)),
            "reason": str(heavy.get("reason", "") or ""),
        },
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    from crossage_fr.api_server import DesktopApi
    from crossage_fr.photo_generative import photo_generative_status

    workspace = Path(args.workspace_root).expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    os.environ["VINTRACE_REGISTRY_HOME"] = str(workspace / "registry")
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(workspace / "registry")
    os.environ["VINTRACE_FORCE_FALLBACK"] = "0"
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "0"
    from crossage_fr.photo_generative import resolve_generative_root

    generative_root = resolve_generative_root(args.generative_root or None)
    status = photo_generative_status(generative_root)
    reasons: list[str] = []
    if not args.acknowledge_research_terms:
        reasons.append("dataset-terms-not-acknowledged")
    if not args.acknowledge_synthetic_processing_authorization:
        reasons.append("synthetic-processing-authorization-not-attested")
    dataset_source = Path(args.folder).expanduser().resolve()
    if not dataset_source.is_dir():
        reasons.append("authorized-dataset-missing")
    if not bool(status.get("modes", {}).get("age-progress", False)):
        reasons.append("verified-qwen-age-runtime-unavailable")
    report = _base_report(args, status, reasons)
    if reasons:
        return report

    api = DesktopApi(workspace, actor="synthetic-age-image-benchmark")
    api.project.config.model_pack = args.model_pack
    api.project.config.model_root = str(Path(args.model_root).expanduser().resolve())
    api.project.save()
    try:
        engine = api._engine_instance()
    except Exception as exc:
        report["reasons"] = ["full-recognizer-unavailable"]
        report["recognizerError"] = str(exc)[:600]
        return report
    engine_model = str(getattr(engine, "model_name", "") or "")
    if not engine_model or engine_model.startswith("local-image-fingerprint"):
        report["reasons"] = ["full-recognizer-unavailable"]
        return report
    report["recognizerEvidence"] = {"engine": engine_model, "fullRecognizer": True, "modelPack": args.model_pack}

    state_path = workspace / "synthetic-age-image-benchmark-state.json"
    review_template_path = workspace / "synthetic-age-image-review.json"
    if state_path.is_file():
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(state, dict) or state.get("benchmarkVersion") != "synthetic-age-image-eval-v1":
            raise ValueError("The existing benchmark workspace has an incompatible state file.")
        if state.get("datasetId") != args.dataset or Path(str(state.get("sourceDatasetFolder", ""))).resolve() != dataset_source:
            raise ValueError("The existing benchmark workspace belongs to another dataset. Choose a new workspace root.")
        stage_errors: list[str] = []
    else:
        api.project.set_consent(
            True,
            source="synthetic-age-image-benchmark",
            operator=args.operator,
            note="Isolated, authorized research benchmark processing; never user enrollment.",
            scope=str(workspace),
            release={"aiDisclosureAcknowledged": True},
        )
        dataset_root, preparation = _prepare_dataset(args.dataset, dataset_source, workspace)
        state, stage_errors = _new_state(
            dataset_id=args.dataset,
            source_dataset=dataset_source,
            dataset_root=dataset_root,
            preparation=preparation,
            project=api.project,
            engine=engine,
            max_identities=max(2, min(20, int(args.max_identities))),
            negative_identities=max(1, min(20, int(args.negative_identities))),
            generative_root=generative_root,
            seed=max(0, int(args.seed)),
            steps=max(8, min(40, int(args.steps))),
        )
        _write_json(state_path, state)
    if not review_template_path.is_file():
        _write_json(review_template_path, _review_template(state, workspace))

    staged = [case for case in state.get("positiveCases", []) if case.get("artifactStatus") == "staged"]
    machine_rejected = [case for case in state.get("positiveCases", []) if case.get("artifactStatus") == "rejected"]
    generation_errors = [case for case in state.get("positiveCases", []) if case.get("artifactStatus") == "error"]
    report.update(
        {
            "datasetEvidence": {
                "folderName": dataset_source.name,
                "preparedByRunner": args.dataset == "fgnet",
                "inspection": state.get("datasetInspection", {}),
                "exactAgeMetadata": args.dataset in {"agedb", "fgnet"},
            },
            "privateReview": {
                "workspace": workspace.name,
                "stateFile": state_path.name,
                "templateFile": review_template_path.name,
                "privatePathsExcludedFromReport": True,
            },
            "cases": _public_case_rows(state),
            "generation": {
                "selected": len(state.get("positiveCases", [])),
                "negativeIdentities": len(state.get("negativeCases", [])),
                "stagedForHumanReview": len(staged),
                "machineRejected": len(machine_rejected),
                "errors": len(generation_errors),
                "stageWarnings": stage_errors,
                "outboundSocketAttempts": list(state.get("outboundSocketAttempts", [])),
            },
        }
    )
    if not args.review_decisions:
        report["status"] = "awaiting-human-review" if staged else "fail"
        report["reasons"] = ["human-review-manifest-not-complete"] if staged else ["no-generated-image-passed-machine-safety-gates"]
        report["gates"] = {
            "fullRecognizer": True,
            "verifiedQwenRuntime": True,
            "noPythonOutboundSockets": not state.get("outboundSocketAttempts"),
            "generatedImagesStaged": len(staged) >= 2,
            "negativeCasesPresent": len(state.get("negativeCases", [])) >= 1,
            "humanReviewComplete": False,
        }
        return report

    review_path = Path(args.review_decisions).expanduser().resolve()
    decisions, review_hash = _apply_review(api.project, engine, state, review_path)
    _write_json(state_path, state)
    baseline, augmented, comparison, evaluation_errors = _evaluate(api.project, engine, state)
    approved = sum(decision["decision"] == "approve" for decision in decisions.values())
    source_unchanged = all(
        Path(case["sourcePath"]).is_file() and _sha256(Path(case["sourcePath"])) == case["sourceHash"]
        for case in state.get("positiveCases", [])
    )
    gates = {
        "fullRecognizer": True,
        "verifiedQwenRuntime": True,
        "noPythonOutboundSockets": not state.get("outboundSocketAttempts"),
        "sameEvaluationSet": not evaluation_errors and baseline["evaluated"] == augmented["evaluated"],
        "sourceFilesUnchanged": source_unchanged,
        "humanReviewComplete": len(decisions) == len(staged),
        "reviewedImagesApproved": approved >= 2,
        "negativeCasesPresent": len(state.get("negativeCases", [])) >= 1,
        "generatedEvidenceUsedOnTruePositive": int(augmented.get("generatedBestTruePositives", 0)) > 0,
        "noCorrectnessRegressions": int(comparison.get("regressions", 0)) == 0,
        "noFalsePositiveIncrease": int(augmented.get("falsePositives", 0)) <= int(baseline.get("falsePositives", 0)),
        "noWrongIdentityIncrease": int(augmented.get("wrongIdentity", 0)) <= int(baseline.get("wrongIdentity", 0)),
        "precisionNonDecreasing": float(augmented.get("precision", 0.0)) + 1e-9 >= float(baseline.get("precision", 0.0)),
        "recallNonDecreasing": float(augmented.get("recall", 0.0)) + 1e-9 >= float(baseline.get("recall", 0.0)),
    }
    passed = all(gates.values())
    report.update(
        {
            "status": "pass" if passed else "fail",
            "reasons": [] if passed else [key for key, value in gates.items() if not value],
            "reviewEvidence": {
                "manifestSha256": review_hash,
                "reviewed": len(decisions),
                "approved": approved,
                "rejected": len(decisions) - approved,
            },
            "baseline": {key: value for key, value in baseline.items() if key != "labels"},
            "augmented": {key: value for key, value in augmented.items() if key != "labels"},
            "comparison": comparison,
            "evaluationErrors": evaluation_errors,
            "gates": gates,
            "cases": _public_case_rows(state),
            "limitations": [
                "This bounded isolated benchmark is recognition evidence, not a claim that a generated portrait predicts future appearance.",
                "CALFW has no exact age metadata in this layout and uses deterministic endpoint age-range proxies.",
                "FG-NET is never downloaded and must be supplied under an authorization that permits this synthetic-processing evaluation.",
                "Human review confirms visible target-age plausibility; the app does not infer a sensitive exact age from generated output.",
            ],
        }
    )
    if not args.retain_private_review_assets:
        api.project.clear_references()
        state_removed = _secure_remove_private_file(state_path)
        template_removed = _secure_remove_private_file(review_template_path)
        prepared_purge = _secure_purge_tree(workspace / "private-benchmark")
        report["privateReview"]["purgedAfterEvaluation"] = True
        report["privateReview"]["purgeEvidence"] = {
            "stateFileRemoved": state_removed,
            "reviewTemplateRemoved": template_removed,
            "preparedDatasetFilesRemoved": prepared_purge["files"],
            "preparedDatasetBytesRemoved": prepared_purge["bytes"],
        }
    else:
        report["privateReview"]["purgedAfterEvaluation"] = False
    return report


def markdown_report(report: dict[str, Any]) -> str:
    runtime = report.get("runtimeEvidence", {})
    generation = report.get("generation", {})
    lines = [
        "# Synthetic Age-Image Benchmark",
        "",
        f"- Protocol: `{report.get('benchmarkVersion', '')}`",
        f"- Method: `{report.get('methodVersion', '')}`",
        f"- Dataset: `{report.get('datasetId', '')}`",
        f"- Status: **{report.get('status', 'incomplete')}**",
        f"- Qwen age route ready: `{runtime.get('ageProgressReady', False)}`",
        f"- Hardware memory: `{runtime.get('totalMemoryBytes', 0)}` / required `{runtime.get('minimumMemoryBytes', 0)}` bytes",
        f"- Staged for visual review: `{generation.get('stagedForHumanReview', 0)}`",
        "",
    ]
    if report.get("reasons"):
        lines.append("Evidence gaps: " + ", ".join(f"`{value}`" for value in report["reasons"]))
        lines.append("")
    comparison = report.get("comparison") if isinstance(report.get("comparison"), dict) else {}
    if comparison:
        lines.extend(
            [
                "| Evaluated | Improvements | Regressions | Precision delta | Recall delta | Generated best TP |",
                "|---:|---:|---:|---:|---:|---:|",
                f"| {comparison.get('evaluated', 0)} | {comparison.get('improvements', 0)} | {comparison.get('regressions', 0)} | {comparison.get('precisionDelta', 0)} | {comparison.get('recallDelta', 0)} | {report.get('augmented', {}).get('generatedBestTruePositives', 0)} |",
                "",
            ]
        )
    lines.append("No private image paths or image bytes are included in this publication-safe summary.")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the two-phase, review-bound Qwen synthetic age-image recognition benchmark."
    )
    parser.add_argument("--dataset", choices=["agedb", "calfw", "fgnet"], required=True)
    parser.add_argument("--folder", required=True, help="Authorized local dataset folder.")
    parser.add_argument("--workspace-root", default="benchmarks/public-data/workspaces/synthetic-age-image")
    parser.add_argument("--generative-root", default="", help="Installed generative pack root; defaults to Vintrace's registry root.")
    parser.add_argument("--model-root", default=str(Path.home() / ".insightface"))
    parser.add_argument("--model-pack", choices=["antelopev2", "buffalo_l"], default="antelopev2")
    parser.add_argument("--max-identities", type=int, default=4)
    parser.add_argument("--negative-identities", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--acknowledge-research-terms", action="store_true")
    parser.add_argument("--acknowledge-synthetic-processing-authorization", action="store_true")
    parser.add_argument("--operator", default="benchmark operator")
    parser.add_argument("--review-decisions", default="", help="Completed hash-bound review manifest from phase one.")
    parser.add_argument("--retain-private-review-assets", action="store_true")
    parser.add_argument("--output", default="")
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    report = run(args)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    results_root = REPO_ROOT / "benchmarks" / "results"
    target = Path(args.output).expanduser().resolve() if args.output else results_root / f"synthetic-age-image-benchmark-{stamp}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    latest = target.parent / "synthetic-age-image-benchmark-latest.json"
    latest.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
    markdown = target.with_suffix(".md")
    markdown.write_text(markdown_report(report), encoding="utf-8")
    (target.parent / "synthetic-age-image-benchmark-latest.md").write_text(markdown.read_text(encoding="utf-8"), encoding="utf-8")
    print(json.dumps({"status": report["status"], "report": str(target), "sha256": _sha256(target)}, indent=2))
    if args.require_complete and report["status"] != "pass":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
