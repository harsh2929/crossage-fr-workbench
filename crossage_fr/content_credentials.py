from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
from importlib import metadata as importlib_metadata
import json
import os
from pathlib import Path
import tempfile
import threading
from typing import Any, Iterable

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID, ObjectIdentifier

from crossage_fr.store.workspace_encryption import WorkspaceEncryption, WorkspaceEncryptionError


CONTENT_CREDENTIAL_POLICY_VERSION = "vintrace-c2pa-v1"
CONTENT_CREDENTIAL_SPEC_VERSION = "2.4"
C2PA_PYTHON_VERSION = "0.36.0"
C2PA_NATIVE_SDK_VERSION = "0.89.0"
CONTENT_CREDENTIAL_IDENTITY_ROLE = "c2pa-signing-identity-v1"
CONTENT_CREDENTIAL_IDENTITY_SCHEMA_VERSION = 1
CONTENT_CREDENTIAL_SUMMARY_SCHEMA_VERSION = 1
C2PA_CLAIM_SIGNING_OID = ObjectIdentifier("1.3.6.1.4.1.62558.2.1")
DOCUMENT_SIGNING_OID = ObjectIdentifier("1.3.6.1.5.5.7.3.36")
TRAINED_ALGORITHMIC_MEDIA_URI = (
    "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"
)
_C2PA_MARKERS = (b"c2pa", b"jumb", b"caBX", b"content credentials")
_MAX_ERROR_LENGTH = 320
_MAX_VALIDATION_CODES = 24


class ContentCredentialError(RuntimeError):
    pass


class ContentCredentialUnavailableError(ContentCredentialError):
    pass


@dataclass(frozen=True)
class _SigningIdentity:
    private_key: ec.EllipticCurvePrivateKey
    leaf_certificate: x509.Certificate
    root_certificate: x509.Certificate
    signer_id: str
    created_at: str
    persisted: bool

    @property
    def certificate_chain_pem(self) -> str:
        return (
            self.leaf_certificate.public_bytes(serialization.Encoding.PEM)
            + self.root_certificate.public_bytes(serialization.Encoding.PEM)
        ).decode("ascii")

    @property
    def root_certificate_pem(self) -> str:
        return self.root_certificate.public_bytes(serialization.Encoding.PEM).decode("ascii")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _clean_text(value: Any, limit: int = 160) -> str:
    return " ".join(str(value or "").split())[:limit]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _mime_type(path: Path) -> str:
    suffix = path.suffix.casefold()
    mapping = {
        ".avif": "image/avif",
        ".dng": "image/x-adobe-dng",
        ".gif": "image/gif",
        ".heic": "image/heic",
        ".heif": "image/heif",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".jxl": "image/jxl",
        ".m4v": "video/x-m4v",
        ".mov": "video/quicktime",
        ".mp4": "video/mp4",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".webp": "image/webp",
    }
    return mapping.get(suffix, "")


def _c2pa_module() -> Any:
    try:
        import c2pa  # type: ignore[import-not-found]
    except Exception as exc:
        raise ContentCredentialUnavailableError(
            "Content Credentials are unavailable because the C2PA runtime could not be loaded."
        ) from exc
    return c2pa


def _package_versions() -> tuple[str, str]:
    try:
        package_version = importlib_metadata.version("c2pa-python")
    except importlib_metadata.PackageNotFoundError:
        return "", ""
    try:
        native_version = str(_c2pa_module().sdk_version())
    except Exception:
        return package_version, ""
    return package_version, native_version


def _identity_payload(identity: _SigningIdentity) -> dict[str, Any]:
    private_key_pem = identity.private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    return {
        "schemaVersion": CONTENT_CREDENTIAL_IDENTITY_SCHEMA_VERSION,
        "algorithm": "ES256",
        "createdAt": identity.created_at,
        "signerId": identity.signer_id,
        "leafPrivateKeyPem": private_key_pem,
        "leafCertificatePem": identity.leaf_certificate.public_bytes(serialization.Encoding.PEM).decode("ascii"),
        "rootCertificatePem": identity.root_certificate.public_bytes(serialization.Encoding.PEM).decode("ascii"),
    }


def _validate_identity(identity: _SigningIdentity) -> None:
    if not isinstance(identity.private_key.curve, ec.SECP256R1):
        raise ContentCredentialError("The Content Credentials signing key does not use P-256.")
    leaf_public_key = identity.leaf_certificate.public_key()
    root_public_key = identity.root_certificate.public_key()
    if not isinstance(leaf_public_key, ec.EllipticCurvePublicKey) or not isinstance(
        root_public_key, ec.EllipticCurvePublicKey
    ):
        raise ContentCredentialError("The Content Credentials certificate chain has an invalid key type.")
    if identity.private_key.public_key().public_numbers() != leaf_public_key.public_numbers():
        raise ContentCredentialError("The Content Credentials signing key does not match its certificate.")
    if identity.leaf_certificate.issuer != identity.root_certificate.subject:
        raise ContentCredentialError("The Content Credentials certificate chain is invalid.")
    try:
        root_public_key.verify(
            identity.root_certificate.signature,
            identity.root_certificate.tbs_certificate_bytes,
            ec.ECDSA(identity.root_certificate.signature_hash_algorithm),
        )
        root_public_key.verify(
            identity.leaf_certificate.signature,
            identity.leaf_certificate.tbs_certificate_bytes,
            ec.ECDSA(identity.leaf_certificate.signature_hash_algorithm),
        )
    except Exception as exc:
        raise ContentCredentialError("The Content Credentials certificate chain failed verification.") from exc
    try:
        eku = identity.leaf_certificate.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    except x509.ExtensionNotFound as exc:
        raise ContentCredentialError("The Content Credentials certificate is missing its signing purpose.") from exc
    if C2PA_CLAIM_SIGNING_OID not in eku or DOCUMENT_SIGNING_OID not in eku:
        raise ContentCredentialError("The Content Credentials certificate has an invalid signing purpose.")
    try:
        root_constraints = identity.root_certificate.extensions.get_extension_for_class(x509.BasicConstraints).value
        leaf_constraints = identity.leaf_certificate.extensions.get_extension_for_class(x509.BasicConstraints).value
        root_usage = identity.root_certificate.extensions.get_extension_for_class(x509.KeyUsage).value
        leaf_usage = identity.leaf_certificate.extensions.get_extension_for_class(x509.KeyUsage).value
    except x509.ExtensionNotFound as exc:
        raise ContentCredentialError("The Content Credentials certificate chain is missing required constraints.") from exc
    if (
        not root_constraints.ca
        or root_constraints.path_length != 0
        or leaf_constraints.ca
        or not root_usage.key_cert_sign
        or not root_usage.digital_signature
        or not leaf_usage.digital_signature
    ):
        raise ContentCredentialError("The Content Credentials certificate chain has invalid constraints.")
    expected_id = hashlib.sha256(identity.leaf_certificate.public_bytes(serialization.Encoding.DER)).hexdigest()
    if identity.signer_id != expected_id:
        raise ContentCredentialError("The Content Credentials signer identifier is invalid.")
    now = datetime.now(timezone.utc)
    not_before = getattr(identity.leaf_certificate, "not_valid_before_utc", None)
    not_after = getattr(identity.leaf_certificate, "not_valid_after_utc", None)
    if not_before is None:
        not_before = identity.leaf_certificate.not_valid_before.replace(tzinfo=timezone.utc)
    if not_after is None:
        not_after = identity.leaf_certificate.not_valid_after.replace(tzinfo=timezone.utc)
    if now < not_before or now > not_after:
        raise ContentCredentialError("The Content Credentials signing certificate is outside its validity period.")


def _new_identity(*, persisted: bool) -> _SigningIdentity:
    now = datetime.now(timezone.utc)
    root_key = ec.generate_private_key(ec.SECP256R1())
    root_name = x509.Name(
        [
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Vintrace"),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "Workspace-local Content Credentials"),
            x509.NameAttribute(NameOID.COMMON_NAME, "Vintrace workspace root"),
        ]
    )
    root_public_key = root_key.public_key()
    root_certificate = (
        x509.CertificateBuilder()
        .subject_name(root_name)
        .issuer_name(root_name)
        .public_key(root_public_key)
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(root_public_key), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(root_public_key), critical=False)
        .sign(root_key, hashes.SHA256())
    )

    leaf_key = ec.generate_private_key(ec.SECP256R1())
    leaf_name = x509.Name(
        [
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Vintrace"),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "Workspace-local Content Credentials"),
            x509.NameAttribute(NameOID.COMMON_NAME, "Vintrace workspace signer"),
        ]
    )
    leaf_public_key = leaf_key.public_key()
    leaf_certificate = (
        x509.CertificateBuilder()
        .subject_name(leaf_name)
        .issuer_name(root_name)
        .public_key(leaf_public_key)
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.ExtendedKeyUsage([C2PA_CLAIM_SIGNING_OID, DOCUMENT_SIGNING_OID]),
            critical=True,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(leaf_public_key), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(root_public_key), critical=False)
        .sign(root_key, hashes.SHA256())
    )
    signer_id = hashlib.sha256(leaf_certificate.public_bytes(serialization.Encoding.DER)).hexdigest()
    identity = _SigningIdentity(
        private_key=leaf_key,
        leaf_certificate=leaf_certificate,
        root_certificate=root_certificate,
        signer_id=signer_id,
        created_at=_now_iso(),
        persisted=persisted,
    )
    _validate_identity(identity)
    return identity


def _identity_from_payload(payload: Any) -> _SigningIdentity:
    if not isinstance(payload, dict) or payload.get("schemaVersion") != CONTENT_CREDENTIAL_IDENTITY_SCHEMA_VERSION:
        raise ContentCredentialError("The Content Credentials signing identity has an unsupported format.")
    try:
        private_key = serialization.load_pem_private_key(
            str(payload.get("leafPrivateKeyPem", "")).encode("ascii"),
            password=None,
        )
        leaf_certificate = x509.load_pem_x509_certificate(
            str(payload.get("leafCertificatePem", "")).encode("ascii")
        )
        root_certificate = x509.load_pem_x509_certificate(
            str(payload.get("rootCertificatePem", "")).encode("ascii")
        )
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise ContentCredentialError("The Content Credentials signing identity is unreadable.") from exc
    if not isinstance(private_key, ec.EllipticCurvePrivateKey):
        raise ContentCredentialError("The Content Credentials signing identity has an invalid key type.")
    identity = _SigningIdentity(
        private_key=private_key,
        leaf_certificate=leaf_certificate,
        root_certificate=root_certificate,
        signer_id=str(payload.get("signerId", "")),
        created_at=_clean_text(payload.get("createdAt"), 80),
        persisted=True,
    )
    _validate_identity(identity)
    return identity


def _iter_validation_entries(value: Any, category: str = "") -> Iterable[tuple[str, dict[str, Any]]]:
    if isinstance(value, dict):
        for key, item in value.items():
            next_category = key if key in {"success", "failure", "informational"} else category
            yield from _iter_validation_entries(item, next_category)
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict) and item.get("code") and category:
                yield category, item
            else:
                yield from _iter_validation_entries(item, category)


def _recursive_values(value: Any, key_name: str) -> Iterable[Any]:
    if isinstance(value, dict):
        for key, item in value.items():
            if key == key_name:
                yield item
            yield from _recursive_values(item, key_name)
    elif isinstance(value, list):
        for item in value:
            yield from _recursive_values(item, key_name)


def _actions_from_manifest(value: Any) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return actions
    for assertion in value.get("assertions", []):
        if not isinstance(assertion, dict) or not str(assertion.get("label", "")).startswith("c2pa.actions"):
            continue
        data = assertion.get("data", {})
        raw_actions = data.get("actions", []) if isinstance(data, dict) else []
        for action in raw_actions if isinstance(raw_actions, list) else []:
            if not isinstance(action, dict):
                continue
            clean = {"action": _clean_text(action.get("action"), 80)}
            source_type = _clean_text(action.get("digitalSourceType"), 220)
            if source_type:
                clean["digitalSourceType"] = source_type
            parameters = action.get("parameters", {})
            if isinstance(parameters, dict):
                description = _clean_text(parameters.get("description"), 120)
                if description:
                    clean["description"] = description
            actions.append(clean)
    return actions[:64]


def _vintrace_assertions(value: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return result
    for assertion in value.get("assertions", []):
        if not isinstance(assertion, dict) or not str(assertion.get("label", "")).startswith("com.vintrace."):
            continue
        data = assertion.get("data", {})
        if isinstance(data, dict):
            result.append(data)
    return result


def _safe_provenance(value: Any) -> dict[str, Any]:
    source = value if isinstance(value, dict) else {}
    model = source.get("model", {}) if isinstance(source.get("model"), dict) else {}
    runtime = source.get("runtime", {}) if isinstance(source.get("runtime"), dict) else {}
    catalog = source.get("catalog", {}) if isinstance(source.get("catalog"), dict) else {}
    edit = source.get("edit", {}) if isinstance(source.get("edit"), dict) else {}
    hashes_value = source.get("hashes", {}) if isinstance(source.get("hashes"), dict) else {}
    clean: dict[str, Any] = {
        "schemaVersion": CONTENT_CREDENTIAL_SUMMARY_SCHEMA_VERSION,
        "policyVersion": CONTENT_CREDENTIAL_POLICY_VERSION,
        "trustScope": "workspace-local",
        "timestamped": False,
    }
    clean_model = {
        key: _clean_text(model.get(key), 160)
        for key in ("id", "revision", "catalogId", "license", "variant", "tier")
        if _clean_text(model.get(key), 160)
    }
    if clean_model:
        clean["model"] = clean_model
    clean_runtime = {
        key: _clean_text(runtime.get(key), 160)
        for key in ("id", "revision", "provider", "device", "license")
        if _clean_text(runtime.get(key), 160)
    }
    if clean_runtime:
        clean["runtime"] = clean_runtime
    clean_catalog = {
        key: _clean_text(catalog.get(key), 160)
        for key in ("id", "version", "sha256")
        if _clean_text(catalog.get(key), 160)
    }
    if clean_catalog:
        clean["catalog"] = clean_catalog
    clean_edit = {
        key: _clean_text(edit.get(key), 120)
        for key in ("mode", "tier", "operation", "baseEditStackHash")
        if _clean_text(edit.get(key), 120)
    }
    if clean_edit:
        clean["edit"] = clean_edit
    clean_hashes = {
        key: _clean_text(hashes_value.get(key), 128)
        for key in ("sourceSha256", "modelOutputSha256", "renderOutputSha256", "promptSha256")
        if _clean_text(hashes_value.get(key), 128)
    }
    if clean_hashes:
        clean["hashes"] = clean_hashes
    signer_id = _clean_text(source.get("signerId"), 128)
    if signer_id:
        clean["signerId"] = signer_id
    return clean


class ContentCredentialService:
    def __init__(
        self,
        root: Path,
        workspace_encryption: WorkspaceEncryption,
        *,
        app_version: str,
    ) -> None:
        self.root = root.expanduser().resolve()
        self.workspace_encryption = workspace_encryption
        self.app_version = _clean_text(app_version, 80) or "unknown"
        self.identity_path = self.root / "content-credentials" / "signing-identity.json"
        self._identity: _SigningIdentity | None = None
        self._lock = threading.RLock()

    def status(self) -> dict[str, Any]:
        package_version, native_version = _package_versions()
        available = package_version == C2PA_PYTHON_VERSION and native_version == C2PA_NATIVE_SDK_VERSION
        identity_error = ""
        identity = None
        try:
            identity = self._load_identity(create=False)
        except ContentCredentialError as exc:
            identity_error = _clean_text(exc, _MAX_ERROR_LENGTH)
        return {
            "available": available,
            "policyVersion": CONTENT_CREDENTIAL_POLICY_VERSION,
            "specVersion": CONTENT_CREDENTIAL_SPEC_VERSION,
            "packageVersion": package_version,
            "nativeSdkVersion": native_version,
            "expectedPackageVersion": C2PA_PYTHON_VERSION,
            "expectedNativeSdkVersion": C2PA_NATIVE_SDK_VERSION,
            "offline": True,
            "remoteManifestFetch": False,
            "ocspFetch": False,
            "timestamped": False,
            "trustScope": "workspace-local",
            "globallyTrusted": False,
            "identityReady": identity is not None,
            "identityPersisted": bool(identity and identity.persisted),
            "identityEncrypted": bool(identity and identity.persisted and self.workspace_encryption.enabled),
            "identityStorage": (
                "workspace-aes-256-gcm"
                if self.workspace_encryption.enabled
                else "ephemeral-development-memory"
            ),
            "signerId": identity.signer_id if identity else "",
            "error": identity_error,
        }

    def _load_identity(self, *, create: bool) -> _SigningIdentity | None:
        with self._lock:
            if self._identity is not None:
                return self._identity
            if self.workspace_encryption.enabled and self.identity_path.exists():
                try:
                    raw = self.identity_path.read_bytes()
                    if not self.workspace_encryption.is_encrypted_bytes(raw):
                        raise ContentCredentialError(
                            "The persisted Content Credentials identity is not encrypted at rest."
                        )
                    identity = _identity_from_payload(
                        self.workspace_encryption.read_json(
                            self.identity_path,
                            role=CONTENT_CREDENTIAL_IDENTITY_ROLE,
                        )
                    )
                except WorkspaceEncryptionError as exc:
                    raise ContentCredentialError(
                        "The Content Credentials identity could not be decrypted with this workspace key."
                    ) from exc
                except OSError as exc:
                    raise ContentCredentialError("The Content Credentials identity could not be read.") from exc
                self._identity = identity
                return identity
            if not create:
                return None
            identity = _new_identity(persisted=self.workspace_encryption.enabled)
            if self.workspace_encryption.enabled:
                try:
                    self.identity_path.parent.mkdir(parents=True, exist_ok=True)
                    try:
                        self.identity_path.parent.chmod(0o700)
                    except OSError:
                        pass
                    self.workspace_encryption.write_json_atomic(
                        self.identity_path,
                        _identity_payload(identity),
                        role=CONTENT_CREDENTIAL_IDENTITY_ROLE,
                    )
                except (OSError, WorkspaceEncryptionError) as exc:
                    raise ContentCredentialError(
                        "The encrypted Content Credentials signing identity could not be persisted."
                    ) from exc
            self._identity = identity
            return identity

    def _context(self, identity: _SigningIdentity | None = None) -> Any:
        c2pa = _c2pa_module()
        trust: dict[str, Any] = {}
        if identity is not None:
            trust["user_anchors"] = identity.root_certificate_pem
        return c2pa.Context.from_dict(
            {
                "version": 1,
                "trust": trust,
                "verify": {
                    "verify_after_reading": True,
                    "verify_after_sign": True,
                    "verify_trust": True,
                    "verify_timestamp_trust": True,
                    "ocsp_fetch": False,
                    "remote_manifest_fetch": False,
                },
                "builder": {
                    "claim_generator_info": {"name": "Vintrace", "version": self.app_version},
                    "thumbnail": {"enabled": False},
                },
            }
        )

    def _signer(self, identity: _SigningIdentity) -> Any:
        c2pa = _c2pa_module()

        def callback(data: bytes) -> bytes:
            return identity.private_key.sign(data, ec.ECDSA(hashes.SHA256()))

        return c2pa.Signer.from_callback(
            callback,
            c2pa.C2paSigningAlg.ES256,
            identity.certificate_chain_pem,
        )

    def is_candidate(self, path: Path, *, scan_bytes: int = 1024 * 1024) -> bool:
        source = path.expanduser().resolve()
        if not source.is_file() or not _mime_type(source):
            return False
        try:
            size = source.stat().st_size
            with source.open("rb") as handle:
                head = handle.read(max(4096, scan_bytes))
                tail = b""
                if size > len(head):
                    handle.seek(max(0, size - scan_bytes))
                    tail = handle.read(scan_bytes)
        except OSError:
            return False
        haystack = (head + tail).lower()
        return any(marker.lower() in haystack for marker in _C2PA_MARKERS)

    def _absent_summary(self, path: Path, *, error: str = "", asset_sha256: str = "") -> dict[str, Any]:
        return {
            "schemaVersion": CONTENT_CREDENTIAL_SUMMARY_SCHEMA_VERSION,
            "policyVersion": CONTENT_CREDENTIAL_POLICY_VERSION,
            "specVersion": CONTENT_CREDENTIAL_SPEC_VERSION,
            "present": False,
            "embedded": False,
            "validationState": "absent" if not error else "unreadable",
            "cryptographicallyValid": False,
            "locallyTrusted": False,
            "globallyTrusted": False,
            "trustScope": "none",
            "timestamped": False,
            "manifestId": "",
            "signer": {},
            "actions": [],
            "historyActions": [],
            "sourceTypes": [],
            "containsAiHistory": False,
            "topLevelAiEdit": False,
            "ingredientCount": 0,
            "assetSha256": asset_sha256,
            "format": _mime_type(path),
            "error": _clean_text(error, _MAX_ERROR_LENGTH),
        }

    def inspect(
        self,
        path: Path,
        *,
        asset_sha256: str = "",
        identity: _SigningIdentity | None = None,
    ) -> dict[str, Any]:
        source = path.expanduser().resolve()
        source_format = _mime_type(source)
        if not source_format:
            return self._absent_summary(
                source,
                error="This file format is not supported by the C2PA runtime.",
                asset_sha256=asset_sha256,
            )
        if not source.is_file():
            return self._absent_summary(source, error="The media file was not found.", asset_sha256=asset_sha256)
        try:
            c2pa = _c2pa_module()
            local_identity = identity or self._load_identity(create=False)
            with self._context(local_identity) as context:
                reader = c2pa.Reader.try_create(source, context=context)
                if reader is None:
                    return self._absent_summary(source, asset_sha256=asset_sha256)
                with reader:
                    active_manifest = reader.get_active_manifest() or {}
                    try:
                        manifest_store = json.loads(reader.json())
                    except (TypeError, ValueError, json.JSONDecodeError):
                        manifest_store = active_manifest
                    validation_results = reader.get_validation_results() or {}
                    validation_state = _clean_text(reader.get_validation_state(), 80) or "unknown"
                    embedded = bool(reader.is_embedded())
                    sdk_valid = bool(reader.is_valid)
        except Exception as exc:
            return self._absent_summary(
                source,
                error=f"C2PA validation failed: {_clean_text(exc, 240)}",
                asset_sha256=asset_sha256,
            )

        entries = list(_iter_validation_entries(validation_results))
        success_codes = [
            _clean_text(entry.get("code"), 120)
            for category, entry in entries
            if category == "success" and entry.get("code")
        ][:_MAX_VALIDATION_CODES]
        failure_codes = [
            _clean_text(entry.get("code"), 120)
            for category, entry in entries
            if category == "failure" and entry.get("code")
        ][:_MAX_VALIDATION_CODES]
        non_trust_failures = [code for code in failure_codes if code != "signingCredential.untrusted"]
        cryptographically_valid = bool(sdk_valid or (active_manifest and not non_trust_failures))
        active_actions = _actions_from_manifest(active_manifest)
        history_actions: list[dict[str, Any]] = []
        seen_actions: set[tuple[str, str]] = set()
        for action_name in _recursive_values(manifest_store, "action"):
            action = _clean_text(action_name, 80)
            if not action:
                continue
            key = (action, "")
            if key in seen_actions:
                continue
            seen_actions.add(key)
            history_actions.append({"action": action})
            if len(history_actions) >= 64:
                break
        source_types = sorted(
            {
                _clean_text(value, 220)
                for value in _recursive_values(manifest_store, "digitalSourceType")
                if _clean_text(value, 220)
            }
        )[:32]
        vintrace_assertions = _vintrace_assertions(active_manifest)
        local_assertion = next(
            (
                assertion
                for assertion in vintrace_assertions
                if assertion.get("policyVersion") == CONTENT_CREDENTIAL_POLICY_VERSION
                and assertion.get("trustScope") == "workspace-local"
            ),
            None,
        )
        local_signer_id = str(local_assertion.get("signerId", "")) if local_assertion else ""
        trusted = "signingCredential.trusted" in success_codes or validation_state.casefold() == "trusted"
        locally_trusted = bool(
            trusted
            and local_assertion
            and local_identity is not None
            and local_signer_id == local_identity.signer_id
        )
        globally_trusted = bool(trusted and not local_assertion)
        signature_info = active_manifest.get("signature_info", {}) if isinstance(active_manifest, dict) else {}
        if not isinstance(signature_info, dict):
            signature_info = {}
        ingredients = active_manifest.get("ingredients", []) if isinstance(active_manifest, dict) else []
        if not isinstance(ingredients, list):
            ingredients = []
        top_source_types = {
            str(action.get("digitalSourceType", ""))
            for action in active_actions
            if action.get("digitalSourceType")
        }
        contains_ai = any("trainedalgorithmic" in value.casefold() for value in source_types)
        timestamped = bool(signature_info.get("time"))
        return {
            "schemaVersion": CONTENT_CREDENTIAL_SUMMARY_SCHEMA_VERSION,
            "policyVersion": CONTENT_CREDENTIAL_POLICY_VERSION,
            "specVersion": CONTENT_CREDENTIAL_SPEC_VERSION,
            "present": True,
            "embedded": embedded,
            "validationState": validation_state,
            "cryptographicallyValid": cryptographically_valid,
            "locallyTrusted": locally_trusted,
            "globallyTrusted": globally_trusted,
            "trustScope": (
                "workspace-local" if local_assertion else "c2pa-global" if globally_trusted else "untrusted"
            ),
            "timestamped": timestamped,
            "manifestId": _clean_text(active_manifest.get("label"), 180),
            "signer": {
                "algorithm": _clean_text(signature_info.get("alg"), 40),
                "issuer": _clean_text(signature_info.get("issuer"), 120),
                "commonName": _clean_text(signature_info.get("common_name"), 120),
                "signerId": local_signer_id,
            },
            "actions": active_actions,
            "historyActions": history_actions,
            "sourceTypes": source_types,
            "containsAiHistory": contains_ai,
            "topLevelAiEdit": any("trainedalgorithmic" in value.casefold() for value in top_source_types),
            "ingredientCount": len(ingredients),
            "assetSha256": asset_sha256 or _sha256_file(source),
            "format": source_format,
            "validation": {
                "successCodes": success_codes,
                "failureCodes": failure_codes,
            },
            "error": "",
        }

    def sign_edited_asset(
        self,
        *,
        unsigned_path: Path,
        destination_path: Path,
        parent_path: Path,
        operation_kind: str,
        provenance: dict[str, Any] | None = None,
        preceding_ordinary_edit: bool = False,
    ) -> dict[str, Any]:
        try:
            return self._sign_edited_asset_impl(
                unsigned_path=unsigned_path,
                destination_path=destination_path,
                parent_path=parent_path,
                operation_kind=operation_kind,
                provenance=provenance,
                preceding_ordinary_edit=preceding_ordinary_edit,
            )
        except ContentCredentialError:
            raise
        except Exception as exc:
            raise ContentCredentialError(
                f"Content Credential signing failed: {_clean_text(exc, 240)}"
            ) from exc

    def _sign_edited_asset_impl(
        self,
        *,
        unsigned_path: Path,
        destination_path: Path,
        parent_path: Path,
        operation_kind: str,
        provenance: dict[str, Any] | None = None,
        preceding_ordinary_edit: bool = False,
    ) -> dict[str, Any]:
        source = unsigned_path.expanduser().resolve()
        destination = destination_path.expanduser().resolve()
        parent = parent_path.expanduser().resolve()
        source_format = _mime_type(source)
        destination_format = _mime_type(destination)
        parent_format = _mime_type(parent)
        if not source.is_file():
            raise ContentCredentialError("The unsigned output for Content Credentials was not found.")
        if not parent.is_file():
            raise ContentCredentialError("The parent media for Content Credentials was not found.")
        if not source_format or source_format != destination_format:
            raise ContentCredentialError("The output format cannot carry an embedded C2PA manifest.")
        if not parent_format:
            raise ContentCredentialError("The parent media format cannot be represented as a C2PA ingredient.")
        operation = str(operation_kind or "").strip().casefold()
        if operation not in {"generative", "ordinary-edit", "rendered-export"}:
            raise ContentCredentialError("The Content Credentials edit operation is unsupported.")
        if preceding_ordinary_edit and operation != "generative":
            raise ContentCredentialError("Only a generative edit can declare a preceding ordinary edit.")
        package_version, native_version = _package_versions()
        if package_version != C2PA_PYTHON_VERSION or native_version != C2PA_NATIVE_SDK_VERSION:
            raise ContentCredentialUnavailableError(
                "The pinned C2PA runtime is unavailable; the edit was not committed unsigned."
            )

        with self._lock:
            identity = self._load_identity(create=True)
            assert identity is not None
            model_output_sha256 = _sha256_file(source)
            parent_sha256 = _sha256_file(parent)
            safe_provenance = _safe_provenance(
                {
                    **(provenance if isinstance(provenance, dict) else {}),
                    "signerId": identity.signer_id,
                    "hashes": {
                        **(
                            provenance.get("hashes", {})
                            if isinstance(provenance, dict) and isinstance(provenance.get("hashes"), dict)
                            else {}
                        ),
                        "sourceSha256": parent_sha256,
                        (
                            "modelOutputSha256" if operation == "generative" else "renderOutputSha256"
                        ): model_output_sha256,
                    },
                }
            )
            assertion_label = (
                "com.vintrace.generative-edit"
                if operation == "generative"
                else "com.vintrace.rendered-export"
            )
            manifest = {
                "title": "Vintrace credentialed edit",
                "assertions": [{"label": assertion_label, "data": safe_provenance}],
            }
            action = "c2pa.edited" if operation in {"generative", "ordinary-edit"} else "c2pa.converted"
            action_payload: dict[str, Any] = {
                "action": action,
                "parameters": {
                    "description": (
                        "Generative media edit"
                        if operation == "generative"
                        else "Ordinary media edit"
                        if operation == "ordinary-edit"
                        else "Rendered media export"
                    )
                },
            }
            if operation == "generative":
                action_payload["digitalSourceType"] = TRAINED_ALGORITHMIC_MEDIA_URI

            destination.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary_name = tempfile.mkstemp(
                prefix=f".{destination.stem}.c2pa-",
                suffix=destination.suffix,
                dir=destination.parent,
            )
            os.close(fd)
            temporary_path = Path(temporary_name)
            try:
                with self._context(identity) as context, self._signer(identity) as signer:
                    c2pa = _c2pa_module()
                    with c2pa.Builder(manifest, context=context) as builder:
                        builder.set_intent(c2pa.C2paBuilderIntent.EDIT)
                        with parent.open("rb") as parent_stream:
                            builder.add_ingredient(
                                {"title": "Source photo", "relationship": "parentOf"},
                                parent_format,
                                parent_stream,
                            )
                        if preceding_ordinary_edit:
                            builder.add_action(
                                {
                                    "action": "c2pa.edited",
                                    "parameters": {"description": "Ordinary edit before generative media edit"},
                                }
                            )
                        builder.add_action(action_payload)
                        with source.open("rb") as source_stream, temporary_path.open("w+b") as destination_stream:
                            builder.sign(signer, source_format, source_stream, destination_stream)
                signed_sha256 = _sha256_file(temporary_path)
                summary = self.inspect(
                    temporary_path,
                    asset_sha256=signed_sha256,
                    identity=identity,
                )
                if not (
                    summary.get("present")
                    and summary.get("embedded")
                    and summary.get("cryptographicallyValid")
                    and summary.get("locallyTrusted")
                    and summary.get("assetSha256") == signed_sha256
                ):
                    raise ContentCredentialError(
                        "The signed Content Credential did not pass immediate local verification."
                    )
                source_mode = source.stat().st_mode & 0o777
                try:
                    temporary_path.chmod(source_mode)
                except OSError:
                    pass
                try:
                    with temporary_path.open("rb") as signed_stream:
                        os.fsync(signed_stream.fileno())
                except OSError:
                    pass
                os.replace(temporary_path, destination)
                try:
                    directory_fd = os.open(destination.parent, os.O_RDONLY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
                except OSError:
                    pass
                return {
                    "modelOutputSha256": model_output_sha256,
                    "artifactSha256": signed_sha256,
                    "sourceSha256": parent_sha256,
                    "contentCredentials": summary,
                }
            except ContentCredentialError:
                raise
            except Exception as exc:
                raise ContentCredentialError(
                    f"Content Credential signing failed: {_clean_text(exc, 240)}"
                ) from exc
            finally:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass


__all__ = [
    "C2PA_NATIVE_SDK_VERSION",
    "C2PA_PYTHON_VERSION",
    "CONTENT_CREDENTIAL_POLICY_VERSION",
    "CONTENT_CREDENTIAL_SPEC_VERSION",
    "ContentCredentialError",
    "ContentCredentialService",
    "ContentCredentialUnavailableError",
    "TRAINED_ALGORITHMIC_MEDIA_URI",
]
