from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import tempfile

from PIL import Image

import crossage_fr.api_server as api_server_module
from crossage_fr.api_server import DesktopApi
from crossage_fr.content_credentials import (
    C2PA_NATIVE_SDK_VERSION,
    C2PA_PYTHON_VERSION,
    CONTENT_CREDENTIAL_POLICY_VERSION,
    CONTENT_CREDENTIAL_SPEC_VERSION,
    ContentCredentialError,
    ContentCredentialService,
)
from crossage_fr.photo_generative import hash_file
from crossage_fr.store.workspace_encryption import WorkspaceEncryption, encode_workspace_key


def _image(path: Path, color: tuple[int, int, int], *, size: tuple[int, int] = (40, 28)) -> None:
    Image.new("RGB", size, color).save(path)


def _encrypted_service(root: Path) -> ContentCredentialService:
    return ContentCredentialService(
        root,
        WorkspaceEncryption(root, b"c" * 32),
        app_version="test",
    )


def _fake_local_edit(mode, source, target, params, *, root=None, timeout=None):
    del root, timeout
    source_path = Path(source)
    target_path = Path(target)
    with Image.open(source_path) as opened:
        image = opened.convert("RGB")
        if mode == "upscale":
            scale = int(params.get("scale", 2))
            image = image.resize((image.width * scale, image.height * scale))
        image.save(target_path, format="PNG")
    source_sha256 = hash_file(source_path)
    output_sha256 = hash_file(target_path)
    prompt = str(params.get("prompt", "") or "")
    provenance = {
        "schemaVersion": 1,
        "aiGenerated": True,
        "offlineInference": True,
        "catalogVersion": "test-catalog",
        "catalogSha256": "a" * 64,
        "mode": mode,
        "tier": "light",
        "sourceSha256": source_sha256,
        "outputSha256": output_sha256,
        "model": {"id": "fixture/model", "revision": "fixture-revision", "license": "Apache-2.0"},
        "runtime": {"id": "fixture/runtime", "revision": "fixture-runtime", "license": "MIT"},
        "parameters": {"scale": int(params.get("scale", 2)), "prompt": prompt},
    }
    return {
        "mode": mode,
        "tier": "light",
        "outputPath": str(target_path),
        "outputSha256": output_sha256,
        "sourceSha256": source_sha256,
        "width": image.width,
        "height": image.height,
        "durationSeconds": 0.001,
        "offlineInference": True,
        "aiGenerated": True,
        "provenance": provenance,
    }


def test_encrypted_identity_restart_and_private_manifest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        parent = root / "private-parent-name.jpg"
        output = root / "output.png"
        _image(parent, (210, 40, 30))
        _image(output, (20, 90, 220))
        secret_prompt = "private prompt that must never enter the manifest"
        service = _encrypted_service(root)
        status_before = service.status()
        assert status_before["available"] is True
        assert status_before["packageVersion"] == C2PA_PYTHON_VERSION
        assert status_before["nativeSdkVersion"] == C2PA_NATIVE_SDK_VERSION
        assert status_before["specVersion"] == CONTENT_CREDENTIAL_SPEC_VERSION
        assert status_before["identityReady"] is False

        result = service.sign_edited_asset(
            unsigned_path=output,
            destination_path=output,
            parent_path=parent,
            operation_kind="generative",
            provenance={
                "model": {"id": "fixture/model", "revision": "abc123", "license": "Apache-2.0"},
                "edit": {"mode": "cleanup", "tier": "light"},
                "prompt": secret_prompt,
                "hashes": {"promptSha256": hashlib.sha256(secret_prompt.encode()).hexdigest()},
            },
        )
        summary = result["contentCredentials"]
        assert result["modelOutputSha256"] != result["artifactSha256"]
        assert summary["assetSha256"] == result["artifactSha256"]
        assert summary["present"] and summary["embedded"] and summary["cryptographicallyValid"]
        assert summary["locallyTrusted"] is True and summary["globallyTrusted"] is False
        assert summary["trustScope"] == "workspace-local"
        assert summary["timestamped"] is False
        assert summary["topLevelAiEdit"] is True and summary["containsAiHistory"] is True
        assert summary["ingredientCount"] == 1
        assert summary["policyVersion"] == CONTENT_CREDENTIAL_POLICY_VERSION
        signed_bytes = output.read_bytes()
        assert secret_prompt.encode() not in signed_bytes
        assert str(parent).encode() not in signed_bytes

        identity_bytes = service.identity_path.read_bytes()
        assert WorkspaceEncryption.is_encrypted_bytes(identity_bytes)
        assert b"PRIVATE KEY" not in identity_bytes and b"CERTIFICATE" not in identity_bytes
        signer_id = service.status()["signerId"]
        restarted = _encrypted_service(root)
        assert restarted.status()["signerId"] == signer_id
        assert restarted.status()["identityEncrypted"] is True
        assert restarted.inspect(output)["locallyTrusted"] is True


def test_chain_semantics_ordinary_edits_and_tamper_detection() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        original = root / "original.jpg"
        generated = root / "generated.png"
        exported = root / "exported.jpg"
        ordinary = root / "ordinary.png"
        _image(original, (200, 30, 30))
        _image(generated, (30, 200, 30))
        _image(exported, (30, 30, 200))
        _image(ordinary, (120, 80, 40))
        service = _encrypted_service(root)
        generated_summary = service.sign_edited_asset(
            unsigned_path=generated,
            destination_path=generated,
            parent_path=original,
            operation_kind="generative",
            preceding_ordinary_edit=True,
        )["contentCredentials"]
        assert [row["action"] for row in generated_summary["actions"]] == [
            "c2pa.opened",
            "c2pa.edited",
            "c2pa.edited",
        ]
        assert "digitalSourceType" not in generated_summary["actions"][1]
        assert generated_summary["actions"][2]["digitalSourceType"].endswith(
            "compositeWithTrainedAlgorithmicMedia"
        )
        converted = service.sign_edited_asset(
            unsigned_path=exported,
            destination_path=exported,
            parent_path=generated,
            operation_kind="rendered-export",
        )["contentCredentials"]
        assert converted["topLevelAiEdit"] is False
        assert converted["containsAiHistory"] is True
        assert [row["action"] for row in converted["actions"]] == ["c2pa.opened", "c2pa.converted"]

        ordinary_summary = service.sign_edited_asset(
            unsigned_path=ordinary,
            destination_path=ordinary,
            parent_path=original,
            operation_kind="ordinary-edit",
        )["contentCredentials"]
        assert ordinary_summary["topLevelAiEdit"] is False
        assert ordinary_summary["containsAiHistory"] is False
        assert [row["action"] for row in ordinary_summary["actions"]] == ["c2pa.opened", "c2pa.edited"]
        assert all("digitalSourceType" not in row for row in ordinary_summary["actions"])

        with Image.open(exported) as opened:
            opened.convert("RGB").save(exported, format="JPEG")
        stripped = service.inspect(exported)
        assert stripped["present"] is False
        assert stripped["cryptographicallyValid"] is False


def test_atomic_failure_and_ephemeral_development_identity() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        parent = root / "parent.jpg"
        source = root / "source.png"
        destination = root / "destination.png"
        _image(parent, (1, 2, 3))
        _image(source, (4, 5, 6))
        destination.write_bytes(b"existing destination")
        service = _encrypted_service(root)
        original_context = service._context

        def fail_context(identity=None):
            del identity
            raise RuntimeError("forced context failure")

        service._context = fail_context  # type: ignore[method-assign]
        try:
            try:
                service.sign_edited_asset(
                    unsigned_path=source,
                    destination_path=destination,
                    parent_path=parent,
                    operation_kind="ordinary-edit",
                )
                raise AssertionError("signing failure replaced the destination")
            except ContentCredentialError:
                pass
        finally:
            service._context = original_context  # type: ignore[method-assign]
        assert destination.read_bytes() == b"existing destination"
        assert not list(root.glob(".*.c2pa-*.png"))

        development_root = root / "development"
        development = ContentCredentialService(
            development_root,
            WorkspaceEncryption(development_root),
            app_version="test",
        )
        dev_parent = development_root / "parent.jpg"
        dev_output = development_root / "output.png"
        development_root.mkdir()
        _image(dev_parent, (8, 9, 10))
        _image(dev_output, (11, 12, 13))
        development.sign_edited_asset(
            unsigned_path=dev_output,
            destination_path=dev_output,
            parent_path=dev_parent,
            operation_kind="ordinary-edit",
        )
        assert development.status()["identityStorage"] == "ephemeral-development-memory"
        assert development.identity_path.exists() is False


def test_workspace_key_rotation_reencrypts_signing_identity() -> None:
    names = (
        "VINTRACE_WORKSPACE_DB_KEY",
        "VINTRACE_WORKSPACE_DB_PREVIOUS_KEY",
        "VINTRACE_REQUIRE_DB_ENCRYPTION",
    )
    previous = {name: os.environ.get(name) for name in names}
    old_key = b"o" * 32
    new_key = b"n" * 32
    try:
        os.environ["VINTRACE_WORKSPACE_DB_KEY"] = encode_workspace_key(old_key)
        os.environ.pop("VINTRACE_WORKSPACE_DB_PREVIOUS_KEY", None)
        os.environ["VINTRACE_REQUIRE_DB_ENCRYPTION"] = "1"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / "workspace"
            parent = root / "parent.jpg"
            signed = root / "signed.png"
            _image(parent, (15, 25, 35))
            _image(signed, (45, 55, 65))
            api = DesktopApi(workspace)
            result = api._content_credentials.sign_edited_asset(
                unsigned_path=signed,
                destination_path=signed,
                parent_path=parent,
                operation_kind="generative",
            )
            signer_id = api._content_credentials.status()["signerId"]
            identity_path = api._content_credentials.identity_path
            before = identity_path.read_bytes()
            rotation = api.project.rotate_workspace_database_key(new_key, source="content-credentials-test")
            after = identity_path.read_bytes()
            assert rotation["migrationComplete"] is True
            assert before != after
            assert api.project.workspace_encryption.decrypt_bytes(
                after,
                role="c2pa-signing-identity-v1",
            )

            os.environ["VINTRACE_WORKSPACE_DB_KEY"] = encode_workspace_key(new_key)
            os.environ.pop("VINTRACE_WORKSPACE_DB_PREVIOUS_KEY", None)
            restarted = DesktopApi(workspace)
            assert restarted._content_credentials.status()["signerId"] == signer_id
            inspected = restarted._content_credentials.inspect(signed)
            assert inspected["manifestId"] == result["contentCredentials"]["manifestId"]
            assert inspected["locallyTrusted"] is True
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def test_import_original_export_and_rendered_export_contract() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        parent = root / "parent.jpg"
        inbound = root / "inbound.png"
        _image(parent, (220, 30, 50))
        _image(inbound, (20, 130, 210))
        api = DesktopApi(workspace)
        api._content_credentials.sign_edited_asset(
            unsigned_path=inbound,
            destination_path=inbound,
            parent_path=parent,
            operation_kind="generative",
        )
        inbound_bytes = inbound.read_bytes()
        imported = api.import_photos({"sourcePaths": [str(inbound)], "storageMode": "referenced"})
        assert imported["contentCredentials"] == {
            "policyVersion": CONTENT_CREDENTIAL_POLICY_VERSION,
            "originalBytesPreserved": True,
            "scannedCount": 1,
            "candidateCount": 1,
            "preservedCount": 1,
            "cryptographicallyValidCount": 1,
            "invalidCount": 0,
            "metadataWriteFailureCount": 0,
            "deferredCount": 0,
        }
        asset = api.project.db.photo_asset_by_path(str(inbound.resolve()))
        assert asset and asset["metadata"]["contentCredentials"]["locallyTrusted"] is True

        original_export = api.export_photo_selection(
            [str(inbound)],
            root / "original-export",
            export_variant="original",
        )
        original_row = original_export["items"][0]
        assert Path(original_row["targetPath"]).read_bytes() == inbound_bytes
        assert original_row["contentCredentialStatus"] == "preserved-original"
        assert original_export["counts"]["contentCredentialsPreserved"] == 1

        api.save_photo_edit_stack(
            {
                "assetId": asset["assetId"],
                "operations": [{"kind": "image_crop_rotate", "rotateDegrees": 90}],
            }
        )
        rendered_export = api.export_photo_selection(
            [str(inbound)],
            root / "rendered-export",
            export_variant="rendered",
            render_format="jpeg",
            allow_render_fallback=False,
        )
        rendered_row = rendered_export["items"][0]
        assert rendered_row["contentCredentialStatus"] == "signed"
        assert rendered_export["counts"]["contentCredentialsSigned"] == 1
        rendered_summary = rendered_row["contentCredentials"]
        assert rendered_summary["topLevelAiEdit"] is False
        assert rendered_summary["containsAiHistory"] is True
        assert [row["action"] for row in rendered_summary["actions"]] == ["c2pa.opened", "c2pa.edited"]

        original_sign = api._content_credentials.sign_edited_asset

        def fail_sign(**kwargs):
            del kwargs
            raise OSError("forced export signing failure")

        api._content_credentials.sign_edited_asset = fail_sign  # type: ignore[method-assign]
        try:
            fallback = api.export_photo_selection(
                [str(inbound)],
                root / "fallback-export",
                export_variant="rendered",
                render_format="jpeg",
                allow_render_fallback=True,
            )
            privacy_skip = api.export_photo_selection(
                [str(inbound)],
                root / "privacy-skip-export",
                export_variant="rendered",
                render_format="jpeg",
                strip_location=True,
                allow_render_fallback=True,
            )
        finally:
            api._content_credentials.sign_edited_asset = original_sign  # type: ignore[method-assign]
        fallback_row = fallback["items"][0]
        assert fallback["counts"]["rendered"] == 0
        assert fallback["counts"]["renderFallback"] == 1
        assert fallback["counts"]["contentCredentialsFailed"] == 1
        assert fallback_row["contentCredentialFailure"] == (
            "Content Credential signing failed: forced export signing failure"
        )
        assert fallback_row["contentCredentialStatus"] == "preserved-original-fallback"
        assert Path(fallback_row["targetPath"]).read_bytes() == inbound_bytes
        media_files = [path for path in Path(fallback["mediaPath"]).rglob("*") if path.is_file()]
        assert media_files == [Path(fallback_row["targetPath"])]
        privacy_row = privacy_skip["items"][0]
        assert privacy_skip["counts"]["copied"] == 0
        assert privacy_skip["counts"]["renderFallback"] == 0
        assert privacy_skip["counts"]["skipped"] == 1
        assert privacy_skip["counts"]["contentCredentialsFailed"] == 1
        assert privacy_row["result"].startswith("render_skipped_strip_location")
        assert privacy_row["targetPath"] == ""


def test_generative_apply_is_credentialed_and_fail_closed() -> None:
    original_runner = api_server_module.run_photo_generative_edit
    api_server_module.run_photo_generative_edit = _fake_local_edit
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workspace = root / "workspace"
            source = root / "source.jpg"
            _image(source, (50, 90, 140))
            api = DesktopApi(workspace)
            api.import_photos({"sourcePaths": [str(source)], "storageMode": "referenced"})
            asset = api.project.db.photo_asset_by_path(str(source.resolve()))
            assert asset
            preceding_operations = [{"kind": "image_crop_rotate", "rotateDegrees": 90}]
            api.save_photo_edit_stack(
                {"assetId": asset["assetId"], "operations": preceding_operations}
            )
            secret_prompt = "private generative instruction"
            preview = api.render_photo_generative_preview(
                {
                    "assetId": asset["assetId"],
                    "mode": "upscale",
                    "scale": 2,
                    "prompt": secret_prompt,
                }
            )
            original_sign = api._content_credentials.sign_edited_asset

            def fail_sign(**kwargs):
                del kwargs
                raise ContentCredentialError("forced apply signing failure")

            api._content_credentials.sign_edited_asset = fail_sign  # type: ignore[method-assign]
            try:
                try:
                    api.apply_photo_generative_edit(
                        {
                            "previewId": preview["previewId"],
                            "assetId": asset["assetId"],
                            "confirm": True,
                            "idempotencyKey": "failed-apply",
                        }
                    )
                    raise AssertionError("generative apply committed without a Content Credential")
                except ContentCredentialError:
                    pass
            finally:
                api._content_credentials.sign_edited_asset = original_sign  # type: ignore[method-assign]
            assert Path(preview["generativePreviewPath"]).is_file()
            assert not list((workspace / "photo-generative-artifacts").glob("*.png"))
            unchanged_stack = api.project.db.photo_edit_stack_by_asset(asset_id=asset["assetId"])
            assert unchanged_stack and unchanged_stack["operations"] == preceding_operations

            applied = api.apply_photo_generative_edit(
                {
                    "previewId": preview["previewId"],
                    "assetId": asset["assetId"],
                    "confirm": True,
                    "idempotencyKey": "successful-apply",
                }
            )
            operation = applied["stack"]["operations"][0]
            assert operation["schemaVersion"] == 2
            assert operation["modelOutputSha256"] == preview["generativePreviewSha256"]
            assert operation["artifactSha256"] != operation["modelOutputSha256"]
            assert operation["provenance"]["outputSha256"] == operation["modelOutputSha256"]
            assert "prompt" not in operation["provenance"]["parameters"]
            assert operation["provenance"]["parameters"]["promptSha256"] == hashlib.sha256(
                secret_prompt.encode()
            ).hexdigest()
            assert secret_prompt not in json.dumps(operation)
            artifact = Path(operation["artifactPath"])
            assert artifact.is_file() and hash_file(artifact) == operation["artifactSha256"]
            assert secret_prompt.encode() not in artifact.read_bytes()
            summary = operation["contentCredentials"]
            assert summary["present"] and summary["locallyTrusted"] and summary["topLevelAiEdit"]
            assert [row["action"] for row in summary["actions"]] == [
                "c2pa.opened",
                "c2pa.edited",
                "c2pa.edited",
            ]
            assert "digitalSourceType" not in summary["actions"][1]
            assert summary["actions"][2]["digitalSourceType"].endswith(
                "compositeWithTrainedAlgorithmicMedia"
            )
            assert applied["contentCredentials"]["manifestId"] == summary["manifestId"]
            assert applied["modelOutputSha256"] == operation["modelOutputSha256"]
            verified = api._photo_generated_artifact_operation(deepcopy(operation))
            assert verified and verified["contentCredentials"]["cryptographicallyValid"] is True
            stored_asset = api.project.db.photo_asset_by_id(asset["assetId"])
            assert stored_asset and stored_asset["metadata"]["editContentCredentials"]["manifestId"] == summary["manifestId"]

            inspected = api.inspect_photo_content_credentials({"assetId": asset["assetId"], "scope": "active"})
            assert inspected["metadataKey"] == "editContentCredentials"
            assert inspected["contentCredentials"]["locallyTrusted"] is True
            original_inspected = api.inspect_photo_content_credentials(
                {"assetId": asset["assetId"], "scope": "original"}
            )
            assert original_inspected["contentCredentials"]["validationState"] == "absent"
            stored_asset = api.project.db.photo_asset_by_id(asset["assetId"])
            assert stored_asset and stored_asset["metadata"]["contentCredentials"]["present"] is False
    finally:
        api_server_module.run_photo_generative_edit = original_runner


def main() -> None:
    test_encrypted_identity_restart_and_private_manifest()
    test_chain_semantics_ordinary_edits_and_tamper_detection()
    test_atomic_failure_and_ephemeral_development_identity()
    test_workspace_key_rotation_reencrypts_signing_identity()
    test_import_original_export_and_rendered_export_contract()
    test_generative_apply_is_credentialed_and_fail_closed()
    print("all content_credentials_units tests passed")


if __name__ == "__main__":
    main()
