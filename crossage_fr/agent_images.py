from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from contextlib import contextmanager
import dis
from io import BytesIO
import hashlib
import json
import mimetypes
from pathlib import Path
import re
import threading
import time
from typing import Any, Callable, Literal
import uuid

from PIL import Image as PilImage

from crossage_fr import __version__
from crossage_fr.agent_auth import current_agent_principal
from crossage_fr.agent_recipes import (
    MAX_CUSTOM_RECIPES,
    MAX_RECIPE_STEPS,
    all_recipes,
    load_custom_recipes,
    render_recipe,
    save_custom_recipes,
    validate_recipe,
)
from crossage_fr.api_server import DesktopApi
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS
from crossage_fr.ingest.safety import assess_image_safety
from crossage_fr.workspace_registry import atomic_write_text


SearchMode = Literal["lexical", "semantic", "hybrid"]
JobType = Literal["scan", "indexing", "export", "inbound"]

AGENT_IMAGE_API_VERSION = "1.0"
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MAX_FETCH_ASSETS = 100
MAX_PREVIEW_DIMENSION = 2048
MAX_PREVIEW_BYTES = 8 * 1024 * 1024
MAX_ACTION_PAYLOAD_BYTES = 1024 * 1024
MAX_ACTION_BATCH_ITEMS = 1000
MAX_HYBRID_CANDIDATES = 200
MAX_LEDGER_RESULTS = 500
MAX_LEDGER_TOMBSTONES = 10_000
MAX_OPERATION_OUTPUTS = 50
MAX_OUTPUT_RESOURCE_BYTES = 32 * 1024 * 1024


@dataclass(frozen=True)
class ImageActionSpec:
    name: str
    category: str
    description: str
    read_only: bool
    destructive: bool
    open_world: bool
    idempotent: bool
    confirmation_required: bool
    operator_token_required: bool
    required: tuple[str, ...]
    accepted: tuple[str, ...]

    def public(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.update(
            {
                "readOnly": payload.pop("read_only"),
                "openWorld": payload.pop("open_world"),
                "confirmationRequired": payload.pop("confirmation_required"),
                "operatorTokenRequired": payload.pop("operator_token_required"),
            }
        )
        payload["required"] = list(self.required)
        payload["acceptedFields"] = list(payload.pop("accepted"))
        payload["executionLane"] = "read" if self.read_only else "destructive" if self.destructive else "write"
        payload["deprecated"] = False
        payload["replacementAction"] = ""
        payload["inputSchema"] = _action_input_schema(self.required, self.accepted)
        if self.required:
            payload["examplePayload"] = {
                field: _example_action_value(field)
                for field in self.required
            }
        return payload


def _action_field_schema(field: str) -> dict[str, Any]:
    lowered = str(field or "").lower()
    if lowered in {"assetid", "relatedassetid", "coverassetid", "albumid", "memoryid", "projectid", "jobid", "operationid"}:
        return {"type": "string", "minLength": 1, "maxLength": 160}
    if lowered.endswith("assetids"):
        return {
            "type": "array",
            "maxItems": MAX_ACTION_BATCH_ITEMS,
            "uniqueItems": True,
            "items": {"type": "string", "minLength": 1, "maxLength": 160},
        }
    if lowered.endswith(("ids", "paths")) or lowered in {"items", "updates", "entries"}:
        return {"type": "array", "maxItems": MAX_ACTION_BATCH_ITEMS, "items": {}}
    if lowered in {"rules", "metadata", "profile", "location", "options", "filters", "settings", "editstack", "scope"}:
        return {"type": "object", "additionalProperties": True}
    if lowered.startswith(("include", "allow", "create", "replace", "favorite", "sensitive")) or lowered in {
        "apply", "commit", "dryrun", "pendingonly",
    }:
        return {"type": "boolean"}
    if lowered in {"latitude", "longitude"}:
        return {
            "type": "number",
            "minimum": -90 if lowered == "latitude" else -180,
            "maximum": 90 if lowered == "latitude" else 180,
        }
    if lowered.endswith(("score", "threshold", "confidence")):
        return {"type": "number", "minimum": 0, "maximum": 1}
    if lowered.endswith(("limit", "offset", "count", "budget")) or lowered in {
        "columns", "thumbnailsize", "thumbsize", "quality", "renderquality",
    }:
        schema: dict[str, Any] = {"type": "integer", "minimum": 0}
        if lowered.endswith("limit"):
            schema["maximum"] = MAX_ACTION_BATCH_ITEMS
        return schema
    if lowered in {
        "createdat", "updatedat", "completedat", "startedat", "deletedat",
        "capturedate", "originalcapturedate", "datefrom", "dateto",
    } or lowered.endswith("_at"):
        return {"type": "string", "format": "date-time", "maxLength": 64}
    return {"type": "string", "maxLength": 4096}


def _example_action_value(field: str) -> Any:
    schema = _action_field_schema(field)
    if schema["type"] == "array":
        singular = str(field or "item")
        singular = singular[:-1] if singular.endswith("s") else singular
        return [f"<{singular}>"]
    if schema["type"] == "boolean":
        return True
    if schema["type"] == "integer":
        return 50 if str(field or "").lower().endswith("limit") else 0
    if schema["type"] == "object":
        return {}
    return f"<{field}>"


def _action_input_schema(required: tuple[str, ...], accepted: tuple[str, ...]) -> dict[str, Any]:
    fields = tuple(dict.fromkeys((*required, *accepted)))
    return {
        "type": "object",
        "required": list(required),
        "properties": {field: _action_field_schema(field) for field in fields},
        "additionalProperties": True,
    }


_READ_ACTIONS = {
    "inbound_connector_catalog",
    "list_inbound_connector_sources",
    "preview_inbound_connector",
    "photo_restore_rehearsal",
    "photo_backup_restore_rehearsal",
    "photo_library_backup_check",
    "photo_repair_history",
    "photo_library_settings",
    "photo_ocr_index_status",
    "photo_barcode_index_status",
    "photo_object_index_status",
    "photo_indexing_jobs",
    "photo_curation_preferences",
    "photo_user_memories",
    "photo_user_memory_source_order",
    "photo_slideshow_theme_templates",
    "photo_slideshow_projects",
    "photo_album_source_order",
    "photo_color_profile_status",
    "photo_export_job_status",
    "photo_export_jobs",
    "list_safe_mode_flagged",
}

_IMAGE_ACTION_EXTRAS = {
    "inbound_connector_catalog",
    "list_inbound_connector_sources",
    "preview_inbound_connector",
    "import_inbound_connector",
    "sync_inbound_connector",
    "list_safe_mode_flagged",
    "prepare_previews",
}

_DESTRUCTIVE_TOKENS = {
    "delete",
    "permanently",
    "purge",
    "clear",
    "merge",
    "cleanup",
    "restore",
    "revert",
    "relink",
    "consolidate",
    "archive",
    "remove",
    "dismiss",
    "reset",
    "cancel",
}

_OPEN_WORLD_ACTIONS = {
    "reverse_geocode_photo_location",
    "preview_inbound_connector",
    "import_inbound_connector",
    "sync_inbound_connector",
}
_BLOCKED_AGENT_ACTIONS = {
    "configure_inbound_connector",
    "forget_inbound_connector",
    "photo_library_agent_status",
    "query_photo_library_agent",
    "execute_photo_library_agent_plan",
}
_OPERATOR_TOKEN_ACTIONS = {"set_photo_safe_mode_override"}

# These backend commands historically consume source paths because the desktop
# UI already has them in memory. Agent clients receive only stable IDs, so the
# service resolves IDs to trusted internal paths immediately before execution.
_STABLE_ID_PATH_ACTIONS = {
    "add_photo_album_items",
    "export_photo_contact_sheet",
    "export_photo_live_motion",
    "export_photo_portrait_blur",
    "export_photo_selection",
    "export_photo_subject_cutout",
    "export_photo_video_frame",
    "export_photo_video_trim",
    "list_photo_date_buckets",
    "list_photo_folder_items",
    "rebuild_photo_previews",
    "record_photo_asset_event",
    "remove_photo_album_items",
    "reorder_photo_album_items",
    "reset_photo_live_key_photo",
    "reset_photo_video_poster",
    "save_photo_slideshow_project",
    "save_photo_user_memory",
    "semantic_search_photos",
    "set_photo_burst_selection",
    "set_photo_live_key_photo",
    "set_photo_video_poster",
}

_STABLE_ID_FIELD_ALIASES = {
    "coverAssetId": "coverSourcePath",
    "relatedAssetId": "relatedSourcePath",
    "keepAssetIds": "keepSourcePaths",
    "audioPlacementStartAssetId": "audioPlacementStartSourcePath",
    "audioPlacementEndAssetId": "audioPlacementEndSourcePath",
}

_CATEGORY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("export", ("export", "color_profile")),
    ("import", ("import", "recovered", "consolidate")),
    ("index", ("index", "ocr", "barcode", "object", "preview")),
    ("edit", ("edit_stack", "rendered_version", "live_key", "video_poster")),
    ("organize", ("album", "memory", "slideshow", "saved_filter", "curation", "people_group")),
    ("metadata", ("metadata", "keyword", "profile", "pet", "media_pair", "reverse_geocode")),
    ("visibility", ("visibility", "permanently_delete", "undo_photo_operation", "restore_rehearsal")),
    ("deduplicate", ("duplicate", "burst")),
    ("maintain", ("repair", "backup", "cleanup", "relink", "settings", "operation")),
)

_ACTION_DESCRIPTIONS = {
    "inbound_connector_catalog": "List operator-authorized inbound visual sources, provider capabilities, safety policy, and recent connector jobs without exposing credentials.",
    "list_inbound_connector_sources": "List operator-authorized inbound visual sources for Slack, web, cloud drives, and WebDAV without contacting the provider.",
    "preview_inbound_connector": "Discover bounded remote image and video metadata from one operator-authorized source without downloading pixels into the library.",
    "import_inbound_connector": "Download a reviewed selection from one operator-authorized remote source into managed storage and assign stable library asset IDs.",
    "sync_inbound_connector": "Incrementally discover and import changed media from one operator-authorized remote source into managed storage.",
    "list_photo_folder_items": "Page through an image collection using exact metadata, date, media, person, place, album, visibility, and quality filters.",
    "semantic_search_photos": "Rank local images against natural-language meaning with the on-device semantic index.",
    "update_photo_assets_metadata": "Update titles, captions, favorites, keywords, dates, locations, and other non-destructive metadata in one batch.",
    "save_photo_album": "Create or update a manual or smart album.",
    "save_photo_edit_stacks": "Apply non-destructive edit stacks to multiple image assets.",
    "start_photo_export_job": "Start an asynchronous image, contact-sheet, video, or project export job.",
    "enqueue_photo_indexing_job": "Queue OCR, barcode, object, semantic, or preview indexing for a bounded scope.",
    "import_photos": "Import or reference approved image and video paths with provenance and storage policy.",
    "photo_library_backup_check": "Check whether originals, catalog data, and generated state are covered by current backup evidence.",
    "merge_photo_duplicates": "Merge a reviewed duplicate group while preserving the selected keeper and operation history.",
    "set_photo_safe_mode_override": "Set or clear the human-reviewed Safe Mode verdict for one asset; this requires an operator token.",
}

_ACTION_ACCEPTED_FIELDS = {
    "list_inbound_connector_sources": ("provider",),
    "preview_inbound_connector": ("provider", "connectionId", "itemLimit", "sampleLimit", "timeBudgetMs"),
    "import_inbound_connector": (
        "provider", "connectionId", "externalIds", "explicitExternalDownloadConsent", "removedPolicy",
    ),
    "sync_inbound_connector": (
        "provider", "connectionId", "explicitExternalDownloadConsent", "removedPolicy",
    ),
}

_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_ACTION_ALIASES = {
    "create_manual_album": "save_photo_album",
    "create_photo_album": "save_photo_album",
    "create_album": "save_photo_album",
    "create_contact_sheet": "export_photo_contact_sheet",
    "generate_contact_sheet": "export_photo_contact_sheet",
    "update_image_metadata": "update_photo_asset_metadata",
    "update_asset_metadata": "update_photo_asset_metadata",
    "catalog_cleanup": "photo_library_catalog_cleanup",
}
_LEDGER_LOCKS: dict[str, threading.Lock] = {}
_LEDGER_LOCKS_GUARD = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _request_id() -> str:
    return f"agentreq_{uuid.uuid4().hex}"


def _action_category(action: str) -> str:
    lowered = action.lower()
    for category, needles in _CATEGORY_RULES:
        if any(needle in lowered for needle in needles):
            return category
    return "discover"


def _action_description(action: str) -> str:
    explicit = _ACTION_DESCRIPTIONS.get(action)
    if explicit:
        return explicit
    words = action.replace("_", " ")
    return words[:1].upper() + words[1:] + "."


def _looks_like_image_action(action: str) -> bool:
    if action in _BLOCKED_AGENT_ACTIONS:
        return False
    lowered = action.lower()
    return (
        "photo" in lowered
        or "album" in lowered
        or "memory" in lowered
        or "slideshow" in lowered
        or action in _IMAGE_ACTION_EXTRAS
    )


def _action_parameter_fields(api: DesktopApi, action: str, required: tuple[str, ...]) -> tuple[str, ...]:
    """Discover handler payload keys from bytecode retained in source and frozen builds."""
    owner = type(api)
    handlers = getattr(api, "_COMMAND_HANDLERS", {})
    initial_names = [str(handlers.get(action, "") or ""), action, f"_cmd_{action}"]
    fields = list(required)
    seen_fields = set(fields)
    seen_methods: set[str] = set()

    def inspect_method(name: str, depth: int = 0) -> None:
        if not name or name in seen_methods or depth > 3:
            return
        seen_methods.add(name)
        method = getattr(owner, name, None)
        code = getattr(method, "__code__", None)
        if code is None:
            return
        instructions = list(dis.get_instructions(method))
        parameter_names = set(code.co_varnames[: code.co_argcount]) - {"self", "cls"}
        if not parameter_names:
            return

        def loads_parameter(instruction: Any) -> bool:
            if not (
                str(instruction.opname).startswith("LOAD_FAST")
                or instruction.opname == "LOAD_DEREF"
            ):
                return False
            values = instruction.argval if isinstance(instruction.argval, tuple) else (instruction.argval,)
            return any(value in parameter_names for value in values)

        forwarded_methods: list[str] = []
        for index, instruction in enumerate(instructions):
            if loads_parameter(instruction):
                window = instructions[index + 1:index + 6]
                if window and window[0].opname in {"LOAD_ATTR", "LOAD_METHOD"} and window[0].argval == "get":
                    for candidate in window[1:]:
                        if candidate.opname == "LOAD_CONST" and isinstance(candidate.argval, str):
                            field = candidate.argval
                            if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{1,80}", field) and field not in seen_fields:
                                seen_fields.add(field)
                                fields.append(field)
                            break
                        if "CALL" in candidate.opname:
                            break
            if (
                instruction.opname == "LOAD_CONST"
                and isinstance(instruction.argval, str)
                and index + 2 < len(instructions)
                and loads_parameter(instructions[index + 1])
                and instructions[index + 2].opname == "CONTAINS_OP"
            ):
                field = instruction.argval
                if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{1,80}", field) and field not in seen_fields:
                    seen_fields.add(field)
                    fields.append(field)
            if instruction.opname in {"LOAD_ATTR", "LOAD_METHOD"}:
                candidate_name = str(instruction.argval or "")
                if not callable(getattr(owner, candidate_name, None)):
                    continue
                call_window = instructions[index + 1:index + 8]
                parameter_forwarded = False
                for candidate in call_window:
                    if loads_parameter(candidate):
                        parameter_forwarded = True
                    if "CALL" in candidate.opname:
                        break
                if parameter_forwarded:
                    forwarded_methods.append(candidate_name)
        for candidate_name in forwarded_methods:
            inspect_method(candidate_name, depth + 1)

    for method_name in initial_names:
        inspect_method(method_name)
    for field in _ACTION_ACCEPTED_FIELDS.get(action, ()):
        if field not in seen_fields:
            seen_fields.add(field)
            fields.append(field)
    if action in _STABLE_ID_PATH_ACTIONS:
        field_set = set(fields)
        if {"sourcePaths", "paths"} & field_set and "assetIds" not in field_set:
            fields.append("assetIds")
            field_set.add("assetIds")
        if {"sourcePath", "path"} & field_set and "assetId" not in field_set:
            fields.append("assetId")
    field_set = set(fields)
    for alias, target in _STABLE_ID_FIELD_ALIASES.items():
        if target in field_set and alias not in field_set:
            fields.append(alias)
    return tuple(fields)


def image_action_specs(api: DesktopApi) -> dict[str, ImageActionSpec]:
    handlers = getattr(api, "_COMMAND_HANDLERS", {})
    required_map = getattr(api, "_COMMAND_REQUIRED_PARAMS", {})
    specs: dict[str, ImageActionSpec] = {}
    for action in sorted(str(name) for name in handlers if _looks_like_image_action(str(name))):
        verb = action.split("_", 1)[0]
        read_only = action in _READ_ACTIONS or verb in {
            "get",
            "list",
            "search",
            "semantic",
            "suggest",
            "preview",
            "validate",
        }
        destructive = action in _OPERATOR_TOKEN_ACTIONS or any(
            token in action.split("_") for token in _DESTRUCTIVE_TOKENS
        )
        if read_only:
            destructive = False
        category = _action_category(action)
        required = tuple(str(value) for value in required_map.get(action, ()))
        specs[action] = ImageActionSpec(
            name=action,
            category=category,
            description=_action_description(action),
            read_only=read_only,
            destructive=destructive,
            # Imports and exports cross the managed-library boundary even when
            # they remain on the local machine. Advertising that impact lets
            # MCP clients apply the same scrutiny they use for network calls.
            open_world=action in _OPEN_WORLD_ACTIONS or category in {"import", "export"},
            # Reads are naturally repeatable; writes are retry-safe within the
            # published persistent idempotency-ledger retention in run().
            idempotent=True,
            confirmation_required=not read_only,
            operator_token_required=action in _OPERATOR_TOKEN_ACTIONS,
            required=required,
            accepted=_action_parameter_fields(api, action, required),
        )
    return specs


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, default=str)


def _safe_json_value(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _api_value(value: Any) -> Any:
    """Remove the desktop IPC wrapper from canonical agent responses."""
    if isinstance(value, dict) and "value" in value:
        return value.get("value")
    return value


def _payload_size_bytes(payload: dict[str, Any]) -> int:
    return len(_canonical_json(payload).encode("utf-8"))


def _is_path_key(key: str) -> bool:
    normalized = re.sub(r"(?<!^)(?=[A-Z])", "_", str(key or "").replace("-", "_")).lower()
    if normalized in {
        "path",
        "paths",
        "file",
        "files",
        "folder",
        "folders",
        "root",
        "roots",
        "workspace",
        "target",
        "destination",
        "output",
        "source",
        "sources",
        "directory",
        "directories",
    }:
        return True
    return normalized.endswith(
        (
            "_path",
            "_paths",
            "_file",
            "_files",
            "_folder",
            "_folders",
            "_root",
            "_roots",
            "_workspace",
            "_directory",
            "_directories",
        )
    )


def _list_values(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _public_title(asset: dict[str, Any], metadata: dict[str, Any]) -> str:
    title = str(metadata.get("title", metadata.get("caption", "")) or "").strip()
    if title:
        return title[:240]
    asset_id = str(asset.get("assetId", "") or "")
    return f"Image {asset_id[-8:]}" if asset_id else "Image"


def _public_asset(
    asset: dict[str, Any],
    *,
    metadata: dict[str, Any] | None = None,
    people: list[dict[str, Any]] | None = None,
    albums: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    metadata_value = metadata if isinstance(metadata, dict) else (
        asset.get("metadata", {}) if isinstance(asset.get("metadata"), dict) else {}
    )
    result = {
        "assetId": str(asset.get("assetId", "") or ""),
        "title": _public_title(asset, metadata_value),
        "mediaKind": str(asset.get("mediaKind", "image") or "image"),
        "mimeType": str(asset.get("mimeType", "") or ""),
        "width": asset.get("width"),
        "height": asset.get("height"),
        "durationMs": asset.get("durationMs"),
        "captureDate": str(asset.get("captureDate", "") or ""),
        "addedAt": str(asset.get("addedAt", "") or ""),
        "updatedAt": max(
            str(asset.get("updatedAt", "") or ""),
            str(metadata_value.get("updatedAt", "") or ""),
        ),
        "sourceKind": str(asset.get("sourceKind", "") or ""),
        "missing": bool(asset.get("missingAt")),
        "metadata": metadata_value,
    }
    if people is not None:
        result["people"] = people
    if albums is not None:
        result["albums"] = albums
    return result


class AgentImageService:
    """Canonical agent contract shared by MCP and the local HTTP API."""

    def __init__(
        self,
        api: DesktopApi,
        *,
        workspace: Path,
        require_consent: Callable[[], None],
        validate_path: Callable[[str], Path],
        validate_operator_token: Callable[[str, str], None] | None = None,
    ) -> None:
        self.api = api
        self.workspace = Path(workspace).expanduser().resolve()
        self.require_consent = require_consent
        self.validate_path = validate_path
        self.validate_operator_token = validate_operator_token
        self._specs = image_action_specs(api)

    @property
    def specs(self) -> dict[str, ImageActionSpec]:
        return self._specs

    def _policy(self, spec: ImageActionSpec | None, *, pixel_disclosure: bool = False) -> dict[str, Any]:
        return {
            "readOnly": bool(spec.read_only) if spec else True,
            "destructive": bool(spec.destructive) if spec else False,
            "openWorld": bool(spec.open_world) if spec else False,
            "idempotent": bool(spec.idempotent) if spec else True,
            "pixelDisclosure": bool(pixel_disclosure),
            "confirmationRequired": bool(spec.confirmation_required) if spec else False,
            "operatorTokenRequired": bool(spec.operator_token_required) if spec else False,
        }

    def _envelope(
        self,
        action: str,
        data: Any,
        *,
        spec: ImageActionSpec | None = None,
        page: dict[str, Any] | None = None,
        job: dict[str, Any] | None = None,
        warnings: list[str] | None = None,
        pixel_disclosure: bool = False,
        request_id: str | None = None,
        approval_state: str = "",
        activity_status: str = "completed",
        replayed: bool = False,
    ) -> dict[str, Any]:
        workspace_metadata = getattr(self.api.project, "workspace_metadata", {})
        envelope = {
            "ok": True,
            "requestId": request_id or _request_id(),
            "action": action,
            "data": data,
            "page": page,
            "job": job,
            "warnings": list(warnings or []),
            "provenance": {
                "workspaceId": str((workspace_metadata or {}).get("workspaceId", "") or ""),
                "generatedAt": _utc_now(),
            },
            "policy": self._policy(spec, pixel_disclosure=pixel_disclosure),
        }
        if replayed:
            envelope["replayed"] = True
        self._record_activity(
            envelope,
            status=activity_status,
            approval_state=approval_state,
        )
        return envelope

    @staticmethod
    def _activity_identifier(value: Any, keys: tuple[str, ...]) -> str:
        if isinstance(value, dict):
            for key in keys:
                candidate = str(value.get(key, "") or "").strip()
                if candidate:
                    return candidate
            # Only descend through known result wrappers. Capability schemas
            # also contain fields named jobId/operationId; recursively walking
            # arbitrary dictionaries would mistake schema examples for events.
            for wrapper in ("result", "operation", "job"):
                candidate = AgentImageService._activity_identifier(value.get(wrapper), keys)
                if candidate:
                    return candidate
        elif isinstance(value, list):
            for child in value[:50]:
                candidate = AgentImageService._activity_identifier(child, keys)
                if candidate:
                    return candidate
        return ""

    def _record_activity(
        self,
        envelope: dict[str, Any],
        *,
        status: str,
        approval_state: str = "",
        error_code: str = "",
        message: str = "",
    ) -> None:
        """Append a compact, path-free agent trace to the tamper-evident audit chain."""
        try:
            data = envelope.get("data")
            page = envelope.get("page") if isinstance(envelope.get("page"), dict) else {}
            policy = envelope.get("policy") if isinstance(envelope.get("policy"), dict) else {}
            item_count = 0
            if isinstance(page, dict):
                item_count = int(page.get("returned", 0) or 0)
            if not item_count and isinstance(data, dict):
                for key in ("items", "assets", "operations", "jobs", "events", "recipes"):
                    if isinstance(data.get(key), list):
                        item_count = len(data[key])
                        break
            inferred_approval = approval_state or (
                "not_required" if not bool(policy.get("confirmationRequired", False)) else "unknown"
            )
            safe_message = ""
            if str(error_code or "") == "confirmation_required":
                safe_message = "Explicit confirmation and an idempotency key are required."
            elif message:
                # Raw backend exceptions can contain filenames or paths. The
                # client receives a separately redacted error; the durable
                # activity trace deliberately retains only a generic summary.
                safe_message = "Request failed; see the client-visible redacted error."
            principal = current_agent_principal()
            self.api.project._append_audit(
                {
                    "action": "agent_tool_result" if bool(envelope.get("ok", False)) else "agent_tool_failure",
                    "agent_action": str(envelope.get("action", "") or "")[:160],
                    "request_id": str(envelope.get("requestId", "") or "")[:96],
                    "status": str(status or "completed")[:40],
                    "approval_state": inferred_approval[:40],
                    "read_only": bool(policy.get("readOnly", True)),
                    "destructive": bool(policy.get("destructive", False)),
                    "open_world": bool(policy.get("openWorld", False)),
                    "pixel_disclosure": bool(policy.get("pixelDisclosure", False)),
                    "replayed": bool(envelope.get("replayed", False)),
                    "item_count": item_count,
                    "job_id": self._activity_identifier(data, ("jobId", "scanId"))[:128],
                    "operation_id": self._activity_identifier(data, ("operationId", "importId"))[:128],
                    "error_code": str(error_code or "")[:80],
                    "message": safe_message,
                    "principal_id": str(principal.principal_id if principal else "local-stdio")[:160],
                    "auth_type": str(principal.auth_type if principal else "stdio")[:40],
                    "auth_scopes": list(principal.scopes)[:16] if principal else [],
                }
            )
        except Exception:
            # Observability must never make the image operation fail.
            return

    def record_failure(
        self,
        action: str,
        message: str,
        *,
        error_code: str = "invalid_request",
        spec: ImageActionSpec | None = None,
    ) -> None:
        envelope = {
            "ok": False,
            "requestId": _request_id(),
            "action": str(action or "agent_request"),
            "data": None,
            "page": None,
            "policy": self._policy(spec),
        }
        self._record_activity(
            envelope,
            status="failed",
            approval_state="required" if "confirm" in str(message or "").lower() else "",
            error_code=error_code,
            message=message,
        )

    def capabilities(self, category: str = "", include_actions: bool = True) -> dict[str, Any]:
        category_value = str(category or "").strip().lower()
        specs = [spec for spec in self.specs.values() if not category_value or spec.category == category_value]
        categories: dict[str, int] = {}
        for spec in specs:
            categories[spec.category] = categories.get(spec.category, 0) + 1
        data: dict[str, Any] = {
            "apiVersion": AGENT_IMAGE_API_VERSION,
            "platformVersion": __version__,
            "name": "Vintrace Agent Images",
            "description": "Local-first discovery, understanding, organization, non-destructive editing, export, and maintenance for image and video libraries.",
            "categories": categories,
            "actionCount": len(specs),
            "deprecations": [],
            "limits": {
                "defaultPageSize": DEFAULT_PAGE_SIZE,
                "maxPageSize": MAX_PAGE_SIZE,
                "maxFetchAssets": MAX_FETCH_ASSETS,
                "maxPreviewDimension": MAX_PREVIEW_DIMENSION,
                "maxPreviewBytes": MAX_PREVIEW_BYTES,
                "maxActionBatchItems": MAX_ACTION_BATCH_ITEMS,
                "maxHybridCandidates": MAX_HYBRID_CANDIDATES,
                "maxIdempotencyReplayResults": MAX_LEDGER_RESULTS,
                "maxIdempotencyTombstones": MAX_LEDGER_TOMBSTONES,
                "maxSavedRecipes": MAX_CUSTOM_RECIPES,
                "maxRecipeSteps": MAX_RECIPE_STEPS,
                "maxOperationOutputs": MAX_OPERATION_OUTPUTS,
                "maxOutputResourceBytes": MAX_OUTPUT_RESOURCE_BYTES,
            },
            "frontDoors": [
                "get_image_library_overview",
                "search_images",
                "fetch_image_assets",
                "analyze_image_assets",
                "get_image_preview",
                "plan_image_action",
                "run_image_read_action",
                "run_image_write_action",
                "run_destructive_image_action",
                "get_image_job",
                "list_image_operations",
                "get_image_operation",
                "list_image_recipes",
                "get_image_recipe",
                "plan_image_recipe",
                "get_agent_activity",
            ],
        }
        if include_actions:
            data["actions"] = [spec.public() for spec in specs]
        return self._envelope("list_image_capabilities", data)

    def library_overview(self, *, include_health: bool = False) -> dict[str, Any]:
        self.require_consent()
        db = self.api.project.db
        revision = db.photo_smart_album_materialization_revision()
        # The desktop folder rail deliberately materializes rich people/place/
        # trip groups and can scan a large library. An agent overview should be
        # O(number of user collections), not O(number of assets), so build a
        # compact collection directory directly from catalog tables and cached
        # generated collections.
        manual_album_counts: dict[str, int] = {}
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT album_id, COUNT(*) AS n FROM photo_album_items GROUP BY album_id"
            ).fetchall()
            manual_album_counts = {
                str(row["album_id"] or ""): int(row["n"] or 0)
                for row in rows
                if str(row["album_id"] or "")
            }
        collections: list[dict[str, Any]] = []
        for album in db.list_photo_albums()[:100]:
            album_id = str(album.get("albumId", "") or "")
            album_kind = str(album.get("albumKind", "smart") or "smart")
            collections.append(
                {
                    "id": f"album:{album_id}",
                    "kind": f"{album_kind}-album",
                    "name": str(album.get("name", "") or "")[:240],
                    "count": manual_album_counts.get(album_id) if album_kind == "manual" else None,
                }
            )
        for folder in db.list_photo_album_folders()[:50]:
            collections.append(
                {
                    "id": f"albumFolder:{str(folder.get('folderId', '') or '')}",
                    "kind": "album-folder",
                    "name": str(folder.get("name", "") or "")[:240],
                    "count": int(folder.get("albumCount", 0) or 0),
                }
            )
        for saved_filter in db.list_photo_saved_filters()[:25]:
            collections.append(
                {
                    "id": f"saved:{str(saved_filter.get('filterId', '') or '')}",
                    "kind": "saved-filter",
                    "name": str(saved_filter.get("name", "") or "")[:240],
                    "count": None,
                }
            )
        for memory in db.photo_user_memories()[:25]:
            collections.append(
                {
                    "id": f"memory:{str(memory.get('memoryId', '') or '')}",
                    "kind": "user-memory",
                    "name": str(memory.get("name", "") or "")[:240],
                    "count": len(_list_values(memory.get("sourcePaths"))),
                }
            )
        generated = db.photo_generated_collection_cache()
        for kind, rows in (("trip", generated.get("trips")), ("generated-memory", generated.get("memories"))):
            for row in _list_values(rows)[:25]:
                if not isinstance(row, dict):
                    continue
                collection_id = str(row.get("tripId", row.get("memoryId", "")) or "")
                collections.append(
                    {
                        "id": f"{kind}:{collection_id}",
                        "kind": kind,
                        "name": str(row.get("name", "") or "")[:240],
                        "count": int(row.get("count", 0) or 0),
                    }
                )
        indexing = _api_value(self.api.handle("photo_indexing_jobs", {"limit": 10}))
        exports = _api_value(self.api.handle("photo_export_jobs", {"limit": 10}))
        data: dict[str, Any] = {
            "assetCount": int(revision.get("photoAssets", {}).get("count", 0) or 0),
            "albumCount": int(revision.get("photoAlbums", {}).get("count", 0) or 0),
            "keywordCount": int(revision.get("photoKeywords", {}).get("count", 0) or 0),
            "duplicateGroupCount": int(revision.get("photoDuplicateGroups", {}).get("count", 0) or 0),
            "mediaPairCount": int(revision.get("photoMediaPairs", {}).get("count", 0) or 0),
            "revision": str(revision.get("revision", "") or ""),
            "collections": collections[:200],
            "indexing": indexing,
            "exports": exports,
            "settings": _api_value(self.api.handle("photo_library_settings", {})),
        }
        if include_health:
            data["backup"] = _api_value(self.api.handle("photo_library_backup_check", {}))
            data["repairHistory"] = _api_value(self.api.handle("photo_repair_history", {"limit": 10}))
            data["planningHints"] = {
                "dryRunCatalogCleanup": {
                    "tool": "plan_image_action",
                    "action": "photo_library_catalog_cleanup",
                    "payload": {"commit": False},
                }
            }
        return self._envelope("get_image_library_overview", data)

    def activity(
        self,
        *,
        action: str = "",
        status: str = "",
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Return a compact agent-only trace and approval/reliability dashboard."""
        self.require_consent()
        clean_action = str(action or "").strip().lower()
        clean_status = str(status or "").strip().lower()
        offset_value = max(0, int(offset or 0))
        limit_value = max(1, min(MAX_PAGE_SIZE, int(limit or DEFAULT_PAGE_SIZE)))
        audit = self.api.project.audit_events(limit=500, offset=0)
        rows = []
        for event in audit.get("events", []) if isinstance(audit.get("events"), list) else []:
            if not isinstance(event, dict) or str(event.get("action", "") or "") not in {
                "agent_tool_result",
                "agent_tool_failure",
            }:
                continue
            agent_action = str(event.get("agent_action", "") or "")
            event_status = str(event.get("status", "") or "")
            if clean_action and clean_action not in agent_action.lower():
                continue
            if clean_status and clean_status != event_status.lower():
                continue
            operation_id = str(event.get("operation_id", "") or "")
            rows.append(
                {
                    "activityId": f"activity_{int(event.get('seq', 0) or 0)}",
                    "at": str(event.get("at", "") or ""),
                    "requestId": str(event.get("request_id", "") or ""),
                    "action": agent_action,
                    "status": event_status,
                    "approvalState": str(event.get("approval_state", "") or ""),
                    "readOnly": bool(event.get("read_only", True)),
                    "destructive": bool(event.get("destructive", False)),
                    "openWorld": bool(event.get("open_world", False)),
                    "pixelDisclosure": bool(event.get("pixel_disclosure", False)),
                    "replayed": bool(event.get("replayed", False)),
                    "itemCount": int(event.get("item_count", 0) or 0),
                    "jobId": str(event.get("job_id", "") or ""),
                    "operationId": operation_id,
                    "operationResource": f"vintrace://agent/operations/{operation_id}" if operation_id else "",
                    "errorCode": str(event.get("error_code", "") or ""),
                    "message": str(event.get("message", "") or ""),
                    "principalId": str(event.get("principal_id", "") or ""),
                    "authType": str(event.get("auth_type", "") or ""),
                }
            )
        total = len(rows)
        page_rows = rows[offset_value:offset_value + limit_value]
        summary = {
            "observed": total,
            "reads": sum(1 for row in rows if row["readOnly"]),
            "writes": sum(1 for row in rows if not row["readOnly"] and not row["destructive"]),
            "destructive": sum(1 for row in rows if row["destructive"]),
            "pixelDisclosures": sum(1 for row in rows if row["pixelDisclosure"]),
            "confirmed": sum(1 for row in rows if row["approvalState"] == "confirmed"),
            "approvalRequired": sum(1 for row in rows if row["approvalState"] == "required"),
            "replays": sum(1 for row in rows if row["replayed"]),
            "failures": sum(1 for row in rows if row["status"] == "failed"),
        }
        return self._envelope(
            "get_agent_activity",
            {
                "summary": summary,
                "items": page_rows,
                "windowSize": 500,
                "windowTruncated": int(audit.get("total", 0) or 0) > 500,
            },
            page={
                "offset": offset_value,
                "limit": limit_value,
                "returned": len(page_rows),
                "total": total,
                "hasMore": offset_value + len(page_rows) < total,
                "totalIsEstimate": int(audit.get("total", 0) or 0) > 500,
            },
        )

    @staticmethod
    def _metadata_restricts_agent_access(metadata: dict[str, Any] | None) -> bool:
        """Hidden and Recently-Deleted assets are off-limits to the agent/mobile surface.

        On the desktop these collections sit behind an OS biometric prompt (Touch ID /
        Face ID), but that gate lives in Electron. A paired mobile companion talks to this
        service directly, so the gate must also live here — otherwise a phone that knows an
        asset id (e.g. it saw the photo before the user hid it) keeps access to the pixels.
        Search already excludes these; fetch/analyze/preview did not.
        """
        if not isinstance(metadata, dict):
            return False
        if bool(metadata.get("hidden")):
            return True
        if str(metadata.get("deletedAt") or "").strip():
            return True
        return False

    def _hydrate_assets(self, asset_ids: list[str]) -> list[dict[str, Any]]:
        clean_ids = []
        seen: set[str] = set()
        for value in asset_ids:
            asset_id = str(value or "").strip()
            if asset_id and asset_id not in seen:
                seen.add(asset_id)
                clean_ids.append(asset_id)
        assets = self.api.project.db.photo_assets_by_ids(clean_ids)
        hydrated_ids = [str(asset.get("assetId", "") or "") for asset in assets]
        metadata_by_id = self.api.project.db.photo_asset_metadata_by_ids(hydrated_ids)
        people_by_id = self.api.project.db.photo_asset_people_by_ids(hydrated_ids)
        result = []
        for asset in assets:
            asset_id = str(asset.get("assetId", "") or "")
            # Restricted assets are reported as simply "not found" (see fetch_assets'
            # missingAssetIds). A distinct "forbidden" reply would be an oracle confirming
            # that a specific hidden photo exists in the library.
            if self._metadata_restricts_agent_access(metadata_by_id.get(asset_id, {})):
                continue
            albums = self.api.project.db.list_photo_asset_album_memberships(asset_id)
            result.append(
                _public_asset(
                    asset,
                    metadata=metadata_by_id.get(asset_id, {}),
                    people=people_by_id.get(asset_id, []),
                    albums=albums,
                )
            )
        order = {asset_id: index for index, asset_id in enumerate(clean_ids)}
        result.sort(key=lambda item: order.get(str(item.get("assetId", "")), len(order)))
        return result

    def fetch_assets(self, asset_ids: list[str]) -> dict[str, Any]:
        self.require_consent()
        if not isinstance(asset_ids, list):
            raise ValueError("asset_ids must be a list of stable asset IDs.")
        if len(asset_ids) > MAX_FETCH_ASSETS:
            raise ValueError(f"At most {MAX_FETCH_ASSETS} assets can be fetched per call.")
        items = self._hydrate_assets(asset_ids)
        found = {str(item.get("assetId", "")) for item in items}
        missing = [str(value) for value in asset_ids if str(value) not in found]
        return self._envelope(
            "fetch_image_assets",
            {"items": items, "missingAssetIds": missing},
            warnings=[f"{len(missing)} asset IDs were not found."] if missing else [],
        )

    def changes(self, *, after_seq: int = 0, limit: int = DEFAULT_PAGE_SIZE) -> dict[str, Any]:
        """Return an ordered, resumable catalog delta page without exposing source paths."""
        self.require_consent()
        clean_after = max(0, int(after_seq or 0))
        clean_limit = max(1, min(MAX_PAGE_SIZE, int(limit or DEFAULT_PAGE_SIZE)))
        change_page = self.api.project.db.photo_catalog_change_page(
            after_seq=clean_after,
            limit=clean_limit,
        )
        raw_items = change_page.get("items", []) if isinstance(change_page, dict) else []
        asset_ids = [
            str(item.get("assetId", "") or "")
            for item in raw_items
            if isinstance(item, dict) and str(item.get("assetId", "") or "")
        ]
        existing_ids = {
            str(asset.get("assetId", "") or "")
            for asset in self.api.project.db.photo_assets_by_ids(asset_ids)
        }
        public_by_id = {
            str(asset.get("assetId", "") or ""): asset
            for asset in self._hydrate_assets(asset_ids)
        }
        items: list[dict[str, Any]] = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            asset_id = str(raw.get("assetId", "") or "")
            recorded_kind = str(raw.get("changeKind", "upsert") or "upsert")
            public_asset = public_by_id.get(asset_id)
            if recorded_kind == "delete" or asset_id not in existing_ids:
                operation = "delete"
            elif public_asset is None:
                # Hidden and Recently Deleted assets leave the remote replica without
                # revealing which protected state caused their removal.
                operation = "remove"
            else:
                operation = "upsert"
            item = {
                "seq": int(raw.get("seq", 0) or 0),
                "eventId": str(raw.get("eventId", "") or ""),
                "assetId": asset_id,
                "operation": operation,
                "scope": str(raw.get("scope", "asset") or "asset"),
                "changedAt": str(raw.get("changedAt", "") or ""),
                "origin": str(raw.get("origin", "local") or "local"),
                "tombstone": operation != "upsert",
            }
            if public_asset is not None and operation == "upsert":
                item["asset"] = public_asset
            items.append(item)
        return self._envelope(
            "get_image_changes",
            {
                "items": items,
                "cursor": {
                    "afterSeq": int(change_page.get("afterSeq", clean_after) or clean_after),
                    "nextAfterSeq": int(change_page.get("nextAfterSeq", clean_after) or clean_after),
                    "oldestSeq": int(change_page.get("oldestSeq", 0) or 0),
                    "latestSeq": int(change_page.get("latestSeq", 0) or 0),
                },
            },
            page={
                "limit": clean_limit,
                "returned": len(items),
                "hasMore": bool(change_page.get("hasMore", False)),
                "nextAfterSeq": int(change_page.get("nextAfterSeq", clean_after) or clean_after),
            },
        )

    def analyze_assets(
        self,
        asset_ids: list[str],
        capabilities: list[str] | None = None,
    ) -> dict[str, Any]:
        """Return existing local intelligence without opening or exporting pixels."""
        self.require_consent()
        if not isinstance(asset_ids, list):
            raise ValueError("asset_ids must be a list of stable asset IDs.")
        if len(asset_ids) > MAX_FETCH_ASSETS:
            raise ValueError(f"At most {MAX_FETCH_ASSETS} assets can be analyzed per call.")
        supported = {"metadata", "text", "objects", "barcodes", "quality", "people", "albums", "edits"}
        requested = [str(value or "").strip().lower() for value in (capabilities or sorted(supported))]
        requested = list(dict.fromkeys(value for value in requested if value))
        unknown = sorted(set(requested) - supported)
        if unknown:
            raise ValueError(f"Unsupported analysis capabilities: {', '.join(unknown)}.")

        public_items = self._hydrate_assets(asset_ids)
        found_ids = [str(item.get("assetId", "") or "") for item in public_items]
        public_by_id = {str(item.get("assetId", "") or ""): item for item in public_items}
        raw_by_id = {
            str(asset.get("assetId", "") or ""): asset
            for asset in self.api.project.db.photo_assets_by_ids(found_ids)
        }
        ocr_by_id = self.api.project.db.photo_ocr_blocks_for_assets(found_ids) if "text" in requested else {}
        objects_by_id = self.api.project.db.photo_object_tags_for_assets(found_ids) if "objects" in requested else {}
        items: list[dict[str, Any]] = []
        for asset_id in found_ids:
            public = public_by_id.get(asset_id, {})
            raw = raw_by_id.get(asset_id, {})
            raw_metadata = raw.get("metadata", {}) if isinstance(raw.get("metadata"), dict) else {}
            intelligence: dict[str, Any] = {}
            availability: dict[str, str] = {}
            if "metadata" in requested:
                intelligence["metadata"] = {
                    "title": public.get("title", ""),
                    "captureDate": public.get("captureDate", ""),
                    "mediaKind": public.get("mediaKind", ""),
                    "mimeType": public.get("mimeType", ""),
                    "width": public.get("width"),
                    "height": public.get("height"),
                    "durationMs": public.get("durationMs"),
                    "values": public.get("metadata", {}),
                }
                availability["metadata"] = "available"
            if "text" in requested:
                blocks = []
                for block in ocr_by_id.get(asset_id, []):
                    if not isinstance(block, dict):
                        continue
                    blocks.append({
                        key: block.get(key)
                        for key in ("blockId", "text", "language", "confidence", "bounds")
                        if key in block
                    })
                legacy_text = [
                    str(raw_metadata.get(key, "") or "").strip()
                    for key in ("ocrText", "liveText", "detectedText")
                    if str(raw_metadata.get(key, "") or "").strip()
                ]
                intelligence["text"] = {"blocks": blocks, "legacyText": legacy_text}
                local = raw_metadata.get("localOcr", {}) if isinstance(raw_metadata.get("localOcr"), dict) else {}
                availability["text"] = str(local.get("status", "") or ("indexed" if blocks or legacy_text else "pending"))
            if "objects" in requested:
                tags = []
                for tag in objects_by_id.get(asset_id, []):
                    if not isinstance(tag, dict):
                        continue
                    tags.append({
                        key: tag.get(key)
                        for key in ("tagId", "label", "confidence", "source", "bounds", "reviewStatus")
                        if key in tag
                    })
                intelligence["objects"] = {"tags": tags}
                local = raw_metadata.get("localObjectTags", {}) if isinstance(raw_metadata.get("localObjectTags"), dict) else {}
                availability["objects"] = str(local.get("status", "") or ("indexed" if tags else "pending"))
            if "barcodes" in requested:
                barcode_rows = raw_metadata.get("barcodes", [])
                barcodes = []
                for row in barcode_rows if isinstance(barcode_rows, list) else []:
                    if not isinstance(row, dict):
                        continue
                    barcodes.append({
                        key: row.get(key)
                        for key in ("type", "format", "text", "confidence", "bounds", "source")
                        if key in row
                    })
                if not barcodes and str(raw_metadata.get("barcodeText", "") or "").strip():
                    barcodes.append({
                        "type": str(raw_metadata.get("barcodeType", "") or "Barcode"),
                        "text": str(raw_metadata.get("barcodeText", "") or ""),
                        "confidence": raw_metadata.get("barcodeConfidence"),
                    })
                intelligence["barcodes"] = {"items": barcodes}
                local = raw_metadata.get("localBarcode", {}) if isinstance(raw_metadata.get("localBarcode"), dict) else {}
                availability["barcodes"] = str(local.get("status", "") or ("indexed" if barcodes else "pending"))
            if "quality" in requested:
                quality_keys = (
                    "qualityScore", "technicalQuality", "aestheticScore", "sharpnessScore",
                    "blurScore", "exposureScore", "utilityClass", "isScreenshot", "isDocument",
                )
                intelligence["quality"] = {
                    key: raw_metadata.get(key) for key in quality_keys if key in raw_metadata
                }
                availability["quality"] = "available" if intelligence["quality"] else "not_computed"
            if "people" in requested:
                intelligence["people"] = public.get("people", [])
                availability["people"] = "available"
            if "albums" in requested:
                intelligence["albums"] = public.get("albums", [])
                availability["albums"] = "available"
            if "edits" in requested:
                stack = self.api.project.db.photo_edit_stack_by_asset(asset_id=asset_id) or {}
                intelligence["edits"] = {
                    key: stack.get(key)
                    for key in ("stackId", "version", "updatedAt", "operations", "hasAdjustments")
                    if key in stack
                }
                availability["edits"] = "available" if stack else "none"
            items.append({"assetId": asset_id, "availability": availability, "intelligence": intelligence})

        missing = [str(value) for value in asset_ids if str(value) not in set(found_ids)]
        pending_kinds = sorted({
            kind
            for item in items
            for kind, status in item["availability"].items()
            if status in {"pending", "not_computed"}
        })
        warnings = []
        if pending_kinds:
            warnings.append(
                "Some requested intelligence is not indexed; plan enqueue_photo_indexing_job for the relevant bounded scope."
            )
        if missing:
            warnings.append(f"{len(missing)} asset IDs were not found.")
        return self._envelope(
            "analyze_image_assets",
            {
                "requestedCapabilities": requested,
                "items": items,
                "missingAssetIds": missing,
                "pendingCapabilities": pending_kinds,
            },
            warnings=warnings,
        )

    def _public_folder_items(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        asset_ids = [
            str(item.get("assetId", "") or "")
            for item in _list_values(payload.get("items"))
            if isinstance(item, dict) and str(item.get("assetId", "") or "")
        ]
        return self._hydrate_assets(asset_ids)

    def _semantic_items(
        self,
        query: str,
        limit: int,
        offset: int,
        *,
        scope: str = "all",
        filters: dict[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any], list[str]]:
        filter_payload = dict(filters or {})
        constrained = bool(filter_payload) or str(scope or "all").strip() not in {"", "all"}
        semantic_limit = MAX_HYBRID_CANDIDATES if constrained else min(
            MAX_HYBRID_CANDIDATES,
            max(1, offset + limit),
        )
        payload = self.api.handle(
            "semantic_search_photos",
            {
                "query": query,
                "limit": semantic_limit,
                "previewBudget": 0,
                "allowInlineIndexing": False,
                "queueMissing": True,
            },
        )
        warnings: list[str] = []
        if not bool(payload.get("available", False)):
            warnings.append(str(payload.get("reason", "Semantic search is unavailable.")))
            return [], payload, warnings
        rows = _list_values(payload.get("items"))
        if constrained and rows:
            # The semantic engine intentionally knows nothing about library
            # policy. Re-run its bounded candidate set through the canonical
            # metadata/album/person/visibility filter engine, then preserve the
            # semantic rank. This prevents a semantic hit from bypassing an
            # exact filter while keeping pixel disclosure at zero.
            candidate_paths = [
                str(row.get("sourcePath", "") or "")
                for row in rows
                if isinstance(row, dict) and str(row.get("sourcePath", "") or "")
            ]
            exact = self.api.handle(
                "list_photo_folder_items",
                {
                    **filter_payload,
                    "folderId": str(scope or "all").strip() or "all",
                    "query": "",
                    "sourcePaths": candidate_paths,
                    "sort": "newest",
                    "offset": 0,
                    "limit": MAX_HYBRID_CANDIDATES,
                    "previewBudget": 0,
                },
            )
            allowed_paths = {
                str(item.get("sourcePath", "") or "")
                for item in _list_values(exact.get("items"))
                if isinstance(item, dict) and str(item.get("sourcePath", "") or "")
            }
            rows = [
                row
                for row in rows
                if isinstance(row, dict) and str(row.get("sourcePath", "") or "") in allowed_paths
            ]
            payload = dict(payload)
            payload["filteredScored"] = len(rows)
            if int(payload.get("scored", 0) or 0) > semantic_limit:
                warnings.append(
                    f"Exact filters were applied to the top {semantic_limit} semantic candidates; narrow the search for exhaustive filtered ranking."
                )
        rows = rows[offset:offset + limit]
        asset_by_path: dict[str, dict[str, Any]] = {}
        source_paths = [str(row.get("sourcePath", "") or "") for row in rows if isinstance(row, dict)]
        for asset in self.api.project.db.photo_assets_by_paths(source_paths):
            asset_by_path[str(asset.get("sourcePath", "") or "")] = asset
        asset_ids: list[str] = []
        scores: dict[str, float] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            asset = asset_by_path.get(str(row.get("sourcePath", "") or ""))
            if not asset:
                continue
            asset_id = str(asset.get("assetId", "") or "")
            asset_ids.append(asset_id)
            scores[asset_id] = float(row.get("score", 0.0) or 0.0)
        items = self._hydrate_assets(asset_ids)
        for item in items:
            item["semanticScore"] = scores.get(str(item.get("assetId", "")), 0.0)
            item["matchReasons"] = ["On-device semantic similarity"]
        return items, payload, warnings

    def search(
        self,
        *,
        query: str = "",
        mode: SearchMode = "hybrid",
        scope: str = "all",
        filters: dict[str, Any] | None = None,
        sort: str = "newest",
        offset: int = 0,
        limit: int = DEFAULT_PAGE_SIZE,
    ) -> dict[str, Any]:
        self.require_consent()
        mode_value = str(mode or "hybrid").strip().lower()
        if mode_value not in {"lexical", "semantic", "hybrid"}:
            raise ValueError("mode must be lexical, semantic, or hybrid.")
        query_value = str(query or "").strip()
        scope_value = str(scope or "all").strip() or "all"
        if scope_value.lower() in {"library", "photos", "images", "entire-library", "entire_library"}:
            scope_value = "all"
        if mode_value in {"semantic", "hybrid"} and not query_value:
            mode_value = "lexical"
        offset_value = max(0, int(offset or 0))
        limit_value = max(1, min(MAX_PAGE_SIZE, int(limit or DEFAULT_PAGE_SIZE)))
        if mode_value == "hybrid" and offset_value + limit_value > MAX_HYBRID_CANDIDATES:
            raise ValueError(
                f"Hybrid search is capped at the top {MAX_HYBRID_CANDIDATES} fused candidates; use lexical mode or narrower filters for deeper pagination."
            )
        filter_payload = dict(filters or {})
        self._validate_payload(filter_payload)
        candidate_window = min(
            MAX_HYBRID_CANDIDATES,
            max(offset_value + limit_value, limit_value * 3, DEFAULT_PAGE_SIZE),
        )
        lexical_params = {
            **filter_payload,
            "folderId": scope_value,
            "query": query_value,
            "sort": str(sort or "newest"),
            "offset": 0 if mode_value == "hybrid" else offset_value,
            "limit": candidate_window if mode_value == "hybrid" else limit_value,
            "previewBudget": 0,
        }
        lexical_payload: dict[str, Any] = {}
        semantic_payload: dict[str, Any] = {}
        warnings: list[str] = []
        items: list[dict[str, Any]] = []
        lexical_items: list[dict[str, Any]] = []
        semantic_items: list[dict[str, Any]] = []
        if mode_value in {"lexical", "hybrid"}:
            lexical_payload = self.api.handle("list_photo_folder_items", lexical_params)
            lexical_items = self._public_folder_items(lexical_payload)
        if mode_value in {"semantic", "hybrid"}:
            semantic_items, semantic_payload, semantic_warnings = self._semantic_items(
                query_value,
                candidate_window if mode_value == "hybrid" else limit_value,
                0 if mode_value == "hybrid" else offset_value,
                scope=scope_value,
                filters=filter_payload,
            )
            warnings.extend(semantic_warnings)
        ranking: dict[str, Any]
        if mode_value == "hybrid":
            # Reciprocal-rank fusion gives text/metadata and on-device visual
            # meaning equal opportunity without pretending their raw scores are
            # calibrated. Deterministic asset-ID tie-breaking makes retries and
            # pagination stable for an unchanged library revision.
            fused: dict[str, dict[str, Any]] = {}
            for source, source_items in (("lexical", lexical_items), ("semantic", semantic_items)):
                for rank, item in enumerate(source_items, start=1):
                    asset_id = str(item.get("assetId", "") or "")
                    if not asset_id:
                        continue
                    entry = fused.setdefault(
                        asset_id,
                        {"item": dict(item), "score": 0.0, "reasons": []},
                    )
                    if source == "semantic" and "semanticScore" in item:
                        entry["item"]["semanticScore"] = item["semanticScore"]
                    entry["score"] += 1.0 / (60.0 + rank)
                    entry["reasons"].append(
                        "Text or metadata match" if source == "lexical" else "On-device semantic similarity"
                    )
            ranked = sorted(
                fused.items(),
                key=lambda pair: (-float(pair[1]["score"]), pair[0]),
            )
            fused_items: list[dict[str, Any]] = []
            for _asset_id, entry in ranked:
                item = dict(entry["item"])
                item["hybridScore"] = round(float(entry["score"]), 8)
                item["matchReasons"] = list(entry["reasons"])
                fused_items.append(item)
            items = fused_items[offset_value:offset_value + limit_value]
            ranking = {
                "strategy": "reciprocal-rank-fusion",
                "candidateWindow": candidate_window,
                "candidateCap": MAX_HYBRID_CANDIDATES,
            }
        elif mode_value == "semantic":
            items = semantic_items[:limit_value]
            ranking = {"strategy": "semantic-similarity", "candidateCap": MAX_HYBRID_CANDIDATES}
        else:
            items = lexical_items[:limit_value]
            for item in items:
                item["matchReasons"] = ["Text, metadata, or exact library filter"]
            ranking = {"strategy": str(sort or "newest")}
        lexical_total = int(lexical_payload.get("total", 0) or 0)
        semantic_total = int(semantic_payload.get("filteredScored", semantic_payload.get("scored", 0)) or 0)
        estimated_total = max(lexical_total, semantic_total, offset_value + len(items))
        total = min(MAX_HYBRID_CANDIDATES, estimated_total) if mode_value == "hybrid" else estimated_total
        page = {
            "offset": offset_value,
            "limit": limit_value,
            "returned": len(items),
            "total": total,
            "hasMore": offset_value + len(items) < total,
            "totalIsEstimate": mode_value in {"semantic", "hybrid"},
        }
        data = {
            "query": query_value,
            "mode": mode_value,
            "scope": scope_value,
            "filters": filter_payload,
            "items": items,
            "ranking": ranking,
            "indexingJob": semantic_payload.get("queuedJob", {}) if semantic_payload else {},
        }
        return self._envelope("search_images", data, page=page, warnings=warnings)

    def _safe_mode_status(self, asset: dict[str, Any]) -> dict[str, Any]:
        # The desktop and this (MCP/HTTP) process are separate, and mcp_server._api()
        # caches the project for the process lifetime. Without re-reading config.json
        # here, an operator ENABLING or TIGHTENING Safe Mode on the desktop would not
        # reach the mobile preview path until the sidecar restarted — i.e. it would
        # fail OPEN. The refresh is stat-guarded, so this is one stat on the hot path.
        self.api.project.refresh_config_from_disk()
        content_hash = str(asset.get("contentHash", "") or "")
        override = self.api.project.db.safe_mode_override_for(content_hash) if content_hash else None
        if override is not None:
            return {"protected": bool(override), "source": "operator-override"}
        if not bool(self.api.project.config.safe_mode):
            return {"protected": False, "source": "safe-mode-disabled"}
        source_path = Path(str(asset.get("sourcePath", "") or "")).expanduser()
        if source_path.suffix.lower() not in IMAGE_EXTENSIONS:
            if content_hash:
                with self.api.project.db.connect() as conn:
                    row = conn.execute(
                        "SELECT sensitive, score, reason FROM safety_cache WHERE file_hash = ? ORDER BY created_at DESC LIMIT 1",
                        (content_hash,),
                    ).fetchone()
                if row:
                    return {
                        "protected": bool(row["sensitive"]),
                        "source": "cached-classifier",
                        "score": float(row["score"] or 0.0),
                        "reason": str(row["reason"] or ""),
                    }
            return {"protected": True, "source": "unverified-video"}
        assessment = assess_image_safety(
            source_path,
            threshold=float(self.api.project.config.safe_mode_threshold),
            temperature=float(self.api.project.config.safe_mode_temperature),
            multimodal=bool(self.api.project.config.safe_mode_multimodal),
        )
        return {
            "protected": bool(assessment.sensitive),
            "source": "classifier",
            "score": float(assessment.score),
            "reason": str(assessment.reason),
            "categoryScores": dict(assessment.category_scores),
            "categoryEvidence": dict(assessment.category_evidence),
        }

    def preview(
        self,
        asset_id: str,
        *,
        max_dimension: int = 1536,
        max_bytes: int = 4 * 1024 * 1024,
    ) -> dict[str, Any]:
        self.require_consent()
        clean_id = str(asset_id or "").strip()
        if not clean_id:
            raise ValueError("asset_id is required.")
        asset = self.api.project.db.photo_asset_by_id(clean_id)
        if not asset:
            raise ValueError("Image asset was not found in the active workspace.")
        # Hidden / Recently-Deleted assets are gated behind an OS biometric prompt on the
        # desktop; the agent/mobile surface must honour that too. Reported as "not found"
        # (not "forbidden") so the reply is not an existence oracle for hidden photos.
        preview_metadata = self.api.project.db.photo_asset_metadata_by_ids([clean_id]).get(clean_id, {})
        if self._metadata_restricts_agent_access(preview_metadata):
            raise ValueError("Image asset was not found in the active workspace.")
        safety = self._safe_mode_status(asset)
        if bool(safety.get("protected", False)):
            raise ValueError("Safe Mode protects this asset; pixel disclosure was refused.")
        dimension_limit = max(256, min(MAX_PREVIEW_DIMENSION, int(max_dimension or 1536)))
        source_path = str(asset.get("sourcePath", "") or "")
        edit_stack = self.api.project.db.photo_edit_stack_by_asset(asset_id=clean_id)
        rendered_preview = str((edit_stack or {}).get("renderedPreviewPath", "") or "")
        # Generate the cached base preview at the resolution we are actually going to serve.
        # Previously this always used the 768px list thumbnail, so a request for the advertised
        # maxPreviewDimension (2048) silently returned 768 — PIL.thumbnail never upscales. Ask
        # for the requested edge; it is produced from the original and honest up to the source's
        # own resolution.
        preview_path = (
            rendered_preview
            or self.api.project.preview_path_for(source_path, create=True, max_edge=dimension_limit)
            or source_path
        )
        path = Path(preview_path).expanduser()
        if not path.exists() or not path.is_file():
            raise ValueError("A preview could not be generated for this asset.")
        byte_limit = max(64 * 1024, min(MAX_PREVIEW_BYTES, int(max_bytes or 4 * 1024 * 1024)))
        with PilImage.open(path) as image:
            image.load()
            image.thumbnail((dimension_limit, dimension_limit), PilImage.Resampling.LANCZOS)
            if image.mode not in {"RGB", "L"}:
                background = PilImage.new("RGB", image.size, (255, 255, 255))
                if "A" in image.getbands():
                    background.paste(image, mask=image.getchannel("A"))
                else:
                    background.paste(image.convert("RGB"))
                image = background
            elif image.mode == "L":
                image = image.convert("RGB")
            encoded = BytesIO()
            quality = 90
            image.save(encoded, format="JPEG", quality=quality, optimize=True)
            while encoded.tell() > byte_limit and quality > 45:
                quality -= 10
                encoded = BytesIO()
                image.save(encoded, format="JPEG", quality=quality, optimize=True)
            while encoded.tell() > byte_limit and max(image.size) > 512:
                image.thumbnail((max(512, int(image.width * 0.8)), max(512, int(image.height * 0.8))), PilImage.Resampling.LANCZOS)
                encoded = BytesIO()
                image.save(encoded, format="JPEG", quality=max(45, quality), optimize=True)
            while encoded.tell() > byte_limit and max(image.size) > 64:
                next_width = max(64, int(image.width * 0.75))
                next_height = max(64, int(image.height * 0.75))
                image.thumbnail((next_width, next_height), PilImage.Resampling.LANCZOS)
                encoded = BytesIO()
                image.save(encoded, format="JPEG", quality=40, optimize=True)
            data = encoded.getvalue()
            if len(data) > byte_limit:
                raise ValueError("The preview could not be encoded within the requested byte limit.")
            width, height = image.size
        self.api.project._append_audit(
            {
                "action": "agent_image_preview_disclosed",
                "asset_id": clean_id,
                "width": width,
                "height": height,
                "bytes": len(data),
                "safe_mode_source": safety.get("source", ""),
            }
        )
        return {
            "assetId": clean_id,
            "mimeType": "image/jpeg",
            "width": width,
            "height": height,
            "bytes": len(data),
            "data": data,
            "safety": safety,
        }

    def _validate_payload(self, payload: dict[str, Any]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object.")
        if _payload_size_bytes(payload) > MAX_ACTION_PAYLOAD_BYTES:
            raise ValueError("Action payload is too large.")

        def walk(value: Any, key: str = "") -> None:
            if isinstance(value, dict):
                for child_key, child in value.items():
                    walk(child, str(child_key))
                return
            if isinstance(value, list):
                if len(value) > MAX_ACTION_BATCH_ITEMS:
                    raise ValueError(f"Action lists are capped at {MAX_ACTION_BATCH_ITEMS} items.")
                for child in value:
                    walk(child, key)
                return
            if isinstance(value, str) and value.strip() and _is_path_key(key):
                text = value.strip()
                if text.startswith(("http://", "https://", "vintrace://")):
                    return
                self.validate_path(text)

        walk(payload)

    @staticmethod
    def _normalize_action_payload(spec: ImageActionSpec, payload: dict[str, Any]) -> dict[str, Any]:
        accepted = set(spec.accepted)
        params = dict(payload)
        explicit_aliases = {
            "captions": "includeCaptions",
            "caption": "includeCaptions",
        }
        for alias, canonical in explicit_aliases.items():
            if alias in params and canonical in accepted and canonical not in params:
                params[canonical] = params.pop(alias)
        for key in tuple(params):
            if "_" not in key:
                continue
            parts = [part for part in key.split("_") if part]
            if not parts:
                continue
            camel = parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])
            if camel in accepted and camel not in params:
                params[camel] = params.pop(key)
        if spec.name == "photo_library_catalog_cleanup":
            if "dry_run" in params and "dryRun" not in params:
                params["dryRun"] = params.pop("dry_run")
            if "dryRun" in params and "commit" not in params and "apply" not in params:
                params["commit"] = not bool(params.pop("dryRun"))
        return params

    def _resolve_stable_asset_aliases(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        params = dict(payload)
        accepted = set(self.specs[action].accepted)
        alias_ids: list[str] = []
        for alias, target in _STABLE_ID_FIELD_ALIASES.items():
            if target not in accepted or target in params:
                continue
            raw = params.get(alias)
            if isinstance(raw, list):
                alias_ids.extend(str(value or "").strip() for value in raw if str(value or "").strip())
            elif str(raw or "").strip():
                alias_ids.append(str(raw or "").strip())
        if alias_ids:
            alias_assets = self.api.project.db.photo_assets_by_ids(list(dict.fromkeys(alias_ids)))
            alias_paths = {
                str(asset.get("assetId", "") or ""): str(asset.get("sourcePath", "") or "")
                for asset in alias_assets
            }
            missing_aliases = [asset_id for asset_id in alias_ids if not alias_paths.get(asset_id)]
            if missing_aliases:
                raise ValueError(f"{len(missing_aliases)} stable asset IDs were not found in the active workspace.")
            for alias, target in _STABLE_ID_FIELD_ALIASES.items():
                if target not in accepted or target in params:
                    continue
                raw = params.get(alias)
                if isinstance(raw, list):
                    ids = [str(value or "").strip() for value in raw if str(value or "").strip()]
                    if ids:
                        params[target] = [alias_paths[asset_id] for asset_id in ids]
                elif str(raw or "").strip():
                    params[target] = alias_paths[str(raw or "").strip()]
        if action not in _STABLE_ID_PATH_ACTIONS:
            return params
        raw_many = params.get("assetIds")
        raw_one = params.get("assetId")
        asset_ids = (
            [str(value or "").strip() for value in raw_many if str(value or "").strip()]
            if isinstance(raw_many, list)
            else []
        )
        if not asset_ids and str(raw_one or "").strip():
            asset_ids = [str(raw_one or "").strip()]
        if not asset_ids:
            return params
        assets = self.api.project.db.photo_assets_by_ids(asset_ids)
        path_by_id = {
            str(asset.get("assetId", "") or ""): str(asset.get("sourcePath", "") or "")
            for asset in assets
        }
        missing = [asset_id for asset_id in asset_ids if not path_by_id.get(asset_id)]
        if missing:
            raise ValueError(f"{len(missing)} stable asset IDs were not found in the active workspace.")
        paths = [path_by_id[asset_id] for asset_id in asset_ids]
        if "sourcePaths" in accepted and not isinstance(params.get("sourcePaths"), list):
            params["sourcePaths"] = paths
        elif "paths" in accepted and not isinstance(params.get("paths"), list):
            params["paths"] = paths
        if len(paths) == 1:
            if "sourcePath" in accepted and not str(params.get("sourcePath", "") or "").strip():
                params["sourcePath"] = paths[0]
            elif "path" in accepted and not str(params.get("path", "") or "").strip():
                params["path"] = paths[0]
        return params

    def _spec(self, action: str) -> ImageActionSpec:
        clean_action = str(action or "").strip()
        clean_action = _ACTION_ALIASES.get(clean_action, clean_action)
        spec = self.specs.get(clean_action)
        if spec is None:
            raise ValueError(
                "Action is not in the live agent image capability catalog. Use list_image_capabilities with the "
                "narrowest relevant category and include_actions=true, then retry with the returned exact name."
            )
        return spec

    def plan(self, action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        self.require_consent()
        spec = self._spec(action)
        params = self._normalize_action_payload(spec, dict(payload or {}))
        self._validate_payload(params)
        self._resolve_stable_asset_aliases(spec.name, params)
        if spec.name == "enqueue_photo_indexing_job" and isinstance(params.get("capabilities"), list):
            kind_by_capability = {
                "text": "ocr",
                "ocr": "ocr",
                "objects": "objects",
                "barcodes": "barcodes",
                "semantic": "semantic",
                "previews": "previews",
            }
            kinds = list(dict.fromkeys(
                kind_by_capability.get(str(value or "").strip().lower(), "")
                for value in params["capabilities"]
            ))
            kinds = [value for value in kinds if value]
            if not kinds:
                raise ValueError("capabilities must contain text, objects, barcodes, semantic, or previews.")
            scope = params.get("scope", {"all": True, "pendingOnly": True})
            limit = max(1, min(MAX_ACTION_BATCH_ITEMS, int(params.get("limit", MAX_ACTION_BATCH_ITEMS) or MAX_ACTION_BATCH_ITEMS)))
            batch_plans = [
                {
                    "action": spec.name,
                    "payload": {"jobKind": kind, "scope": scope, "limit": limit},
                    "nextTool": "run_image_write_action",
                    "approval": "write",
                }
                for kind in kinds
            ]
            return self._envelope(
                "plan_image_action",
                {
                    "action": spec.public(),
                    "valid": True,
                    "execution": "plan-only; execute each batch plan separately with a unique idempotency key",
                    "batchPlans": batch_plans,
                    "estimatedAffectedItems": len(batch_plans),
                    "nextTool": "run_image_write_action",
                },
                spec=spec,
                approval_state="proposed",
            )
        missing = [name for name in spec.required if name not in params]
        if missing:
            raise ValueError(f"{spec.name} requires parameter(s): {', '.join(missing)}.")
        affected = 0
        for key in ("assetIds", "sourcePaths", "items", "updates", "candidateIds"):
            if isinstance(params.get(key), list):
                affected = max(affected, len(params[key]))
        if affected == 0 and any(key in params for key in ("assetId", "sourcePath", "albumId", "memoryId")):
            affected = 1
        data = {
            "action": spec.public(),
            "valid": True,
            "payloadKeys": sorted(params),
            "normalizedPayload": params,
            "estimatedAffectedItems": affected,
            "nextTool": (
                "run_image_read_action"
                if spec.read_only
                else "run_destructive_image_action"
                if spec.destructive
                else "run_image_write_action"
            ),
        }
        warnings = []
        if spec.open_world:
            warnings.append("This action may contact an external service when workspace policy permits it.")
        if spec.destructive:
            warnings.append("This action can delete, overwrite, merge, or otherwise remove state.")
        return self._envelope(
            "plan_image_action",
            data,
            spec=spec,
            warnings=warnings,
            approval_state="proposed",
        )

    def _ledger_path(self) -> Path:
        return self.workspace / ".vintrace-agent-operations.json"

    def _ledger_lock(self) -> threading.Lock:
        key = str(self._ledger_path())
        with _LEDGER_LOCKS_GUARD:
            if key not in _LEDGER_LOCKS:
                _LEDGER_LOCKS[key] = threading.Lock()
            return _LEDGER_LOCKS[key]

    @contextmanager
    def _ledger_process_lock(self):
        """Serialize short ledger transactions across Codex/Claude MCP processes."""
        self.workspace.mkdir(parents=True, exist_ok=True)
        lock_dir = self.workspace / ".vintrace-agent-operations.lock"
        deadline = time.monotonic() + 10.0
        while True:
            try:
                lock_dir.mkdir(mode=0o700)
                break
            except FileExistsError:
                try:
                    age = time.time() - lock_dir.stat().st_mtime
                except OSError:
                    age = 0.0
                if age > 30.0:
                    try:
                        lock_dir.rmdir()
                        continue
                    except OSError:
                        pass
                if time.monotonic() >= deadline:
                    raise TimeoutError("Timed out waiting for the agent operation ledger lock.")
                time.sleep(0.02)
        try:
            yield
        finally:
            try:
                lock_dir.rmdir()
            except OSError:
                pass

    @contextmanager
    def _ledger_guard(self):
        with self._ledger_lock():
            with self._ledger_process_lock():
                yield

    def _read_ledger(self) -> dict[str, Any]:
        path = self._ledger_path()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return {"version": 2, "operations": {}, "tombstones": {}}
        if not isinstance(payload, dict) or not isinstance(payload.get("operations"), dict):
            return {"version": 2, "operations": {}, "tombstones": {}}
        if not isinstance(payload.get("tombstones"), dict):
            payload["tombstones"] = {}
        return payload

    def _write_ledger(self, ledger: dict[str, Any]) -> None:
        self.workspace.mkdir(parents=True, exist_ok=True)
        operations = ledger.get("operations", {}) if isinstance(ledger.get("operations"), dict) else {}
        ordered = sorted(
            operations.items(),
            key=lambda item: str(
                (item[1] if isinstance(item[1], dict) else {}).get(
                    "updatedAt",
                    (item[1] if isinstance(item[1], dict) else {}).get("createdAt", ""),
                )
            ),
            reverse=True,
        )
        retained = dict(ordered[:MAX_LEDGER_RESULTS])
        tombstones = dict(ledger.get("tombstones", {})) if isinstance(ledger.get("tombstones"), dict) else {}
        for key, value in ordered[MAX_LEDGER_RESULTS:]:
            body = value if isinstance(value, dict) else {}
            tombstones[key] = {
                "action": str(body.get("action", "") or ""),
                "fingerprint": str(body.get("fingerprint", "") or ""),
                "state": str(body.get("state", "indeterminate") or "indeterminate"),
                "createdAt": str(body.get("createdAt", "") or ""),
                "updatedAt": str(body.get("updatedAt", body.get("createdAt", "")) or ""),
            }
        for key in retained:
            tombstones.pop(key, None)
        ordered_tombstones = sorted(
            tombstones.items(),
            key=lambda item: str(
                (item[1] if isinstance(item[1], dict) else {}).get(
                    "updatedAt",
                    (item[1] if isinstance(item[1], dict) else {}).get("createdAt", ""),
                )
            ),
            reverse=True,
        )[:MAX_LEDGER_TOMBSTONES]
        body = {
            "version": 2,
            "updatedAt": _utc_now(),
            "operations": retained,
            "tombstones": dict(ordered_tombstones),
        }
        atomic_write_text(
            self._ledger_path(),
            json.dumps(body, ensure_ascii=False, sort_keys=True),
        )

    def _fingerprint(self, action: str, payload: dict[str, Any]) -> str:
        clean_payload = {key: value for key, value in payload.items() if key not in {"confirm", "operatorToken", "operator_token"}}
        return hashlib.sha256(_canonical_json({"action": action, "payload": clean_payload}).encode("utf-8")).hexdigest()

    def _run_idempotent_mutation(
        self,
        *,
        action: str,
        payload: dict[str, Any],
        spec: ImageActionSpec,
        idempotency_key: str,
        execute: Callable[[], Any],
    ) -> dict[str, Any]:
        """Execute one confirmed mutation with durable cross-process replay semantics."""
        clean_key = str(idempotency_key or "").strip()
        if not _IDEMPOTENCY_KEY_RE.fullmatch(clean_key):
            raise ValueError("A valid idempotency_key is required for every agent write.")
        fingerprint = self._fingerprint(action, payload)
        with self._ledger_guard():
            ledger = self._read_ledger()
            operations = ledger.setdefault("operations", {})
            existing = operations.get(clean_key)
            if isinstance(existing, dict):
                if str(existing.get("fingerprint", "")) != fingerprint:
                    raise ValueError("The idempotency key was already used with different action input.")
                if str(existing.get("state", "complete") or "complete") != "complete":
                    raise ValueError(
                        "The idempotency key belongs to a previous attempt with an indeterminate outcome; inspect the library or job state before choosing a new key."
                    )
                replay = dict(existing.get("envelope", {})) if isinstance(existing.get("envelope"), dict) else {}
                if not replay:
                    raise ValueError("The idempotency key has no replayable result and requires operator inspection.")
                replay["replayed"] = True
                self._record_activity(replay, status="replayed", approval_state="confirmed")
                return replay
            tombstones = ledger.setdefault("tombstones", {})
            tombstone = tombstones.get(clean_key)
            if isinstance(tombstone, dict):
                if str(tombstone.get("fingerprint", "")) != fingerprint:
                    raise ValueError("The idempotency key was already used with different action input.")
                raise ValueError(
                    "The idempotency key belongs to an older operation whose full result has expired; inspect the library or job state before choosing a new key."
                )
            operations[clean_key] = {
                "action": action,
                "fingerprint": fingerprint,
                "createdAt": _utc_now(),
                "state": "running",
            }
            self._write_ledger(ledger)
        try:
            result = _api_value(execute())
            if isinstance(result, dict):
                result = {
                    **result,
                    "agentOperationId": f"agent-write:{clean_key}",
                    "operationResourceUri": f"vintrace://agent/operations/agent-write:{clean_key}",
                }
            envelope = self._envelope(action, result, spec=spec, approval_state="confirmed")
        except Exception as exc:
            with self._ledger_guard():
                ledger = self._read_ledger()
                operations = ledger.setdefault("operations", {})
                tombstones = ledger.setdefault("tombstones", {})
                current = operations.get(clean_key)
                if not isinstance(current, dict):
                    current = tombstones.pop(clean_key, {}) if isinstance(tombstones.get(clean_key), dict) else {}
                operations[clean_key] = {
                    **current,
                    "action": action,
                    "fingerprint": fingerprint,
                    "state": "indeterminate",
                    "updatedAt": _utc_now(),
                }
                self._write_ledger(ledger)
            self.record_failure(action, str(exc), error_code="operation_indeterminate", spec=spec)
            raise
        with self._ledger_guard():
            ledger = self._read_ledger()
            operations = ledger.setdefault("operations", {})
            tombstones = ledger.setdefault("tombstones", {})
            current = operations.get(clean_key)
            if not isinstance(current, dict):
                current = tombstones.pop(clean_key, {}) if isinstance(tombstones.get(clean_key), dict) else {}
            operations[clean_key] = {
                **current,
                "action": action,
                "fingerprint": fingerprint,
                "state": "complete",
                "updatedAt": _utc_now(),
                "envelope": _safe_json_value(envelope),
            }
            self._write_ledger(ledger)
        return envelope

    def run(
        self,
        *,
        action: str,
        payload: dict[str, Any] | None = None,
        lane: Literal["read", "write", "destructive"] = "read",
        confirm: bool = False,
        idempotency_key: str = "",
        operator_token: str = "",
    ) -> dict[str, Any]:
        self.require_consent()
        spec = self._spec(action)
        params = self._normalize_action_payload(spec, dict(payload or {}))
        if spec.name == "enqueue_photo_indexing_job" and isinstance(params.get("capabilities"), list):
            raise ValueError("A multi-capability indexing plan must be executed as its separate returned batchPlans.")
        self._validate_payload(params)
        execution_params = self._resolve_stable_asset_aliases(spec.name, params)
        if lane not in {"read", "write", "destructive"}:
            raise ValueError("lane must be read, write, or destructive.")
        if lane == "read" and not spec.read_only:
            raise ValueError("Mutating actions must use run_image_write_action or run_destructive_image_action.")
        if lane == "write" and (spec.read_only or spec.destructive):
            raise ValueError("This action does not belong in the non-destructive write lane.")
        if lane == "destructive" and not spec.destructive:
            raise ValueError("This action is not classified as destructive.")
        if spec.operator_token_required:
            if self.validate_operator_token is None:
                raise ValueError("This action requires operator-token validation, which is unavailable.")
            self.validate_operator_token(f"Running {spec.name}", operator_token)
        if not spec.read_only and not confirm:
            preview = self.plan(action, params)
            preview["ok"] = False
            preview["error"] = {
                "code": "confirmation_required",
                "message": "Review the plan, then call the matching write tool with confirm=true and an idempotency key.",
            }
            self.record_failure(
                "run_destructive_image_action" if spec.destructive else "run_image_write_action",
                preview["error"]["message"],
                error_code="confirmation_required",
                spec=spec,
            )
            return preview
        if spec.read_only:
            result = _api_value(self.api.handle(spec.name, execution_params))
            return self._envelope(spec.name, result, spec=spec)
        return self._run_idempotent_mutation(
            action=spec.name,
            payload=params,
            spec=spec,
            idempotency_key=idempotency_key,
            execute=lambda: self.api.handle(spec.name, {**execution_params, "confirm": True}),
        )

    @staticmethod
    def _recipe_mutation_spec(*, destructive: bool) -> ImageActionSpec:
        return ImageActionSpec(
            name="delete_image_recipe" if destructive else "save_image_recipe",
            category="agent-workflows",
            description=(
                "Delete a durable custom agent workflow recipe."
                if destructive
                else "Save a validated durable custom agent workflow recipe."
            ),
            read_only=False,
            destructive=destructive,
            open_world=False,
            idempotent=True,
            confirmation_required=True,
            operator_token_required=False,
            required=("recipeId",),
            accepted=("recipeId", "recipe"),
        )

    def recipes(self, *, include_steps: bool = False) -> dict[str, Any]:
        self.require_consent()
        rows = all_recipes(self.workspace)
        items: list[dict[str, Any]] = []
        for recipe in rows:
            steps = recipe.get("steps", []) if isinstance(recipe.get("steps"), list) else []
            item: dict[str, Any] = {
                "recipeId": str(recipe.get("recipeId", "") or ""),
                "name": str(recipe.get("name", "") or ""),
                "description": str(recipe.get("description", "") or ""),
                "builtin": bool(recipe.get("builtin", False)),
                "inputSchema": recipe.get("inputSchema", {}),
                "stepCount": len(steps),
                "approvalPoints": [
                    {"stepId": str(step.get("id", "") or ""), "approval": str(step.get("approval", "none") or "none")}
                    for step in steps
                    if isinstance(step, dict) and str(step.get("approval", "none") or "none") != "none"
                ],
                "resourceUri": f"vintrace://agent/recipes/{str(recipe.get('recipeId', '') or '')}",
            }
            if include_steps:
                item["steps"] = steps
            items.append(item)
        return self._envelope(
            "list_image_recipes",
            {
                "items": items,
                "builtinCount": sum(1 for item in items if item["builtin"]),
                "customCount": sum(1 for item in items if not item["builtin"]),
                "execution": "plan-only; recipe steps never execute implicitly",
            },
        )

    def _recipe(self, recipe_id: str) -> dict[str, Any]:
        clean_id = str(recipe_id or "").strip()
        if not clean_id:
            raise ValueError("recipe_id is required.")
        recipe = next(
            (item for item in all_recipes(self.workspace) if str(item.get("recipeId", "") or "") == clean_id),
            None,
        )
        if recipe is None:
            raise ValueError("Agent recipe was not found.")
        return recipe

    def recipe(self, recipe_id: str) -> dict[str, Any]:
        self.require_consent()
        recipe = self._recipe(recipe_id)
        return self._envelope(
            "get_image_recipe",
            {"recipe": recipe, "resourceUri": f"vintrace://agent/recipes/{recipe['recipeId']}"},
        )

    def plan_recipe(self, recipe_id: str, inputs: dict[str, Any] | None = None) -> dict[str, Any]:
        self.require_consent()
        recipe = self._recipe(recipe_id)
        plan = render_recipe(recipe, inputs or {})
        plan["resourceUri"] = f"vintrace://agent/recipes/{recipe['recipeId']}"
        return self._envelope(
            "plan_image_recipe",
            plan,
            approval_state="proposed" if plan.get("approvalPoints") else "not_required",
        )

    def save_recipe(
        self,
        recipe_id: str,
        recipe: dict[str, Any],
        *,
        confirm: bool = False,
        idempotency_key: str = "",
    ) -> dict[str, Any]:
        self.require_consent()
        clean = validate_recipe(recipe, recipe_id=str(recipe_id or "").strip())
        spec = self._recipe_mutation_spec(destructive=False)
        if not confirm:
            preview = self._envelope(
                "plan_save_agent_recipe",
                {
                    "recipe": clean,
                    "impact": "Creates or replaces one custom workspace recipe; it does not execute any recipe step.",
                    "nextTool": "save_image_recipe",
                },
                spec=spec,
                approval_state="proposed",
            )
            preview["ok"] = False
            preview["error"] = {
                "code": "confirmation_required",
                "message": "Review the recipe, then call save_image_recipe with confirm=true and an idempotency key.",
            }
            self.record_failure("save_image_recipe", preview["error"]["message"], error_code="confirmation_required", spec=spec)
            return preview

        def save() -> dict[str, Any]:
            with self._ledger_guard():
                custom = load_custom_recipes(self.workspace)
                custom[clean["recipeId"]] = clean
                save_custom_recipes(self.workspace, custom)
            return {
                "recipe": clean,
                "resourceUri": f"vintrace://agent/recipes/{clean['recipeId']}",
                "execution": "saved; no recipe steps were executed",
            }

        return self._run_idempotent_mutation(
            action="save_image_recipe",
            payload={"recipeId": clean["recipeId"], "recipe": clean},
            spec=spec,
            idempotency_key=idempotency_key,
            execute=save,
        )

    def delete_recipe(
        self,
        recipe_id: str,
        *,
        confirm: bool = False,
        idempotency_key: str = "",
    ) -> dict[str, Any]:
        self.require_consent()
        clean_id = str(recipe_id or "").strip()
        if clean_id.startswith("builtin."):
            raise ValueError("Built-in recipes cannot be deleted.")
        try:
            existing = self._recipe(clean_id)
        except ValueError:
            if not confirm:
                raise
            existing = {"name": ""}
        spec = self._recipe_mutation_spec(destructive=True)
        if not confirm:
            preview = self._envelope(
                "plan_delete_agent_recipe",
                {
                    "recipeId": clean_id,
                    "name": str(existing.get("name", "") or ""),
                    "impact": "Permanently removes one custom recipe definition; it does not change library assets.",
                    "nextTool": "delete_image_recipe",
                },
                spec=spec,
                approval_state="proposed",
            )
            preview["ok"] = False
            preview["error"] = {
                "code": "confirmation_required",
                "message": "Review the deletion, then call delete_image_recipe with confirm=true and an idempotency key.",
            }
            self.record_failure("delete_image_recipe", preview["error"]["message"], error_code="confirmation_required", spec=spec)
            return preview

        def delete() -> dict[str, Any]:
            with self._ledger_guard():
                custom = load_custom_recipes(self.workspace)
                if clean_id not in custom:
                    raise ValueError("Agent recipe was not found.")
                removed = custom.pop(clean_id)
                save_custom_recipes(self.workspace, custom)
            return {"deleted": True, "recipeId": clean_id, "name": str(removed.get("name", "") or "")}

        return self._run_idempotent_mutation(
            action="delete_image_recipe",
            payload={"recipeId": clean_id},
            spec=spec,
            idempotency_key=idempotency_key,
            execute=delete,
        )

    @staticmethod
    def _operation_progress(value: Any) -> dict[str, Any]:
        progress = value if isinstance(value, dict) else {}
        processed = int(progress.get("processed", progress.get("completed", 0)) or 0)
        total = int(progress.get("total", 0) or 0)
        percent = round((processed / total) * 100.0, 2) if total > 0 else (
            100.0 if str(progress.get("status", "") or "").lower() == "completed" else 0.0
        )
        return {
            "processed": processed,
            "total": total,
            "percent": percent,
            "phase": str(progress.get("phase", progress.get("message", "")) or "")[:160],
        }

    def _collect_operations(self) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        items: list[dict[str, Any]] = []
        details: dict[str, Any] = {}

        def add(
            kind: str,
            source_id: str,
            action: str,
            status: str,
            created_at: str,
            updated_at: str,
            *,
            completed_at: str = "",
            progress: Any = None,
            cancellable: bool = False,
            resumable: bool = False,
            result_available: bool = False,
            summary: dict[str, Any] | None = None,
            detail: Any = None,
        ) -> None:
            clean_source_id = str(source_id or "").strip()
            if not clean_source_id:
                return
            operation_id = f"{kind}:{clean_source_id}"
            item = {
                "operationId": operation_id,
                "sourceId": clean_source_id,
                "kind": kind,
                "action": str(action or "")[:160],
                "status": str(status or "unknown").lower(),
                "createdAt": str(created_at or ""),
                "updatedAt": str(updated_at or created_at or ""),
                "completedAt": str(completed_at or ""),
                "progress": self._operation_progress(progress),
                "cancellable": bool(cancellable),
                "resumable": bool(resumable),
                "resultAvailable": bool(result_available),
                "summary": dict(summary or {}),
                "resourceUri": f"vintrace://agent/operations/{operation_id}",
            }
            items.append(item)
            details[operation_id] = detail if detail is not None else item

        for session in self.api.project.db.list_photo_import_sessions(limit=200, include_archived=True):
            if not isinstance(session, dict):
                continue
            status = str(session.get("status", "completed") or "completed")
            add(
                "import",
                str(session.get("importId", "") or ""),
                "import_photos",
                status,
                str(session.get("startedAt", session.get("createdAt", "")) or ""),
                str(session.get("updatedAt", "") or ""),
                completed_at=str(session.get("completedAt", "") or ""),
                progress={
                    "processed": int(session.get("importedCount", 0) or 0) + int(session.get("failedCount", 0) or 0),
                    "total": int(session.get("importedCount", 0) or 0) + int(session.get("failedCount", 0) or 0),
                    "status": status,
                },
                resumable=status in {"failed", "paused"},
                result_available=True,
                summary={
                    "imported": int(session.get("importedCount", 0) or 0),
                    "failed": int(session.get("failedCount", 0) or 0),
                    "storageMode": str(session.get("storageMode", "") or ""),
                    "archived": bool(session.get("archived", False)),
                },
                detail=session,
            )

        indexing = _api_value(self.api.handle("photo_indexing_jobs", {"limit": 200})) or {}
        for job in indexing.get("jobs", []) if isinstance(indexing, dict) else []:
            if not isinstance(job, dict):
                continue
            status = str(job.get("status", "unknown") or "unknown").lower()
            add(
                "indexing",
                str(job.get("jobId", "") or ""),
                str(job.get("jobKind", "index_photos") or "index_photos"),
                status,
                str(job.get("createdAt", "") or ""),
                str(job.get("updatedAt", "") or ""),
                completed_at=str(job.get("completedAt", "") or ""),
                progress=job.get("progress", {}),
                cancellable=status in {"queued", "running", "paused"},
                resumable=status in {"paused", "failed", "cancelled"},
                result_available=bool(job.get("result")),
                summary={"jobKind": str(job.get("jobKind", "") or ""), "attempts": int(job.get("attempts", 0) or 0)},
                detail=job,
            )

        exports = _api_value(self.api.handle("photo_export_jobs", {"limit": 200})) or {}
        for job in exports.get("jobs", []) if isinstance(exports, dict) else []:
            if not isinstance(job, dict):
                continue
            status = str(job.get("status", "unknown") or "unknown").lower()
            add(
                "export",
                str(job.get("jobId", "") or ""),
                str(job.get("command", "export") or "export"),
                status,
                str(job.get("createdAt", "") or ""),
                str(job.get("updatedAt", "") or ""),
                completed_at=str(job.get("finishedAt", "") or ""),
                progress=job.get("progress", {}),
                cancellable=status in {"queued", "running"},
                resumable=status in {"failed", "cancelled"},
                result_available=bool(job.get("result")),
                summary={"command": str(job.get("command", "") or ""), "message": str(job.get("message", "") or "")[:160]},
                detail=job,
            )

        repairs = _api_value(self.api.handle("photo_repair_history", {"limit": 100})) or {}
        for event in repairs.get("events", []) if isinstance(repairs, dict) else []:
            if not isinstance(event, dict):
                continue
            source_id = str(event.get("operationId", event.get("eventId", event.get("seq", ""))) or "")
            add(
                "repair",
                source_id,
                str(event.get("action", "repair") or "repair"),
                str(event.get("status", "completed") or "completed"),
                str(event.get("at", event.get("createdAt", "")) or ""),
                str(event.get("updatedAt", event.get("at", "")) or ""),
                completed_at=str(event.get("completedAt", event.get("at", "")) or ""),
                progress={"processed": 1, "total": 1, "status": "completed"},
                result_available=True,
                summary={"message": str(event.get("message", event.get("detail", "")) or "")[:160]},
                detail=event,
            )

        photo_operations = _api_value(self.api.handle("list_photo_operations", {"limit": 200})) or {}
        for operation in photo_operations.get("operations", []) if isinstance(photo_operations, dict) else []:
            if not isinstance(operation, dict):
                continue
            add(
                "library",
                str(operation.get("operationId", "") or ""),
                str(operation.get("operationType", operation.get("action", "library_operation")) or "library_operation"),
                "undone" if bool(operation.get("undone", False)) else "completed",
                str(operation.get("createdAt", "") or ""),
                str(operation.get("updatedAt", operation.get("createdAt", "")) or ""),
                completed_at=str(operation.get("updatedAt", operation.get("createdAt", "")) or ""),
                progress={"processed": 1, "total": 1, "status": "completed"},
                result_available=True,
                summary={"label": str(operation.get("label", "") or "")[:160], "undone": bool(operation.get("undone", False))},
                detail=operation,
            )

        ledger = self._read_ledger()
        for key, operation in ledger.get("operations", {}).items() if isinstance(ledger.get("operations"), dict) else []:
            if not isinstance(operation, dict):
                continue
            state = str(operation.get("state", "unknown") or "unknown")
            envelope = operation.get("envelope", {}) if isinstance(operation.get("envelope"), dict) else {}
            add(
                "agent-write",
                str(key),
                str(operation.get("action", "agent_write") or "agent_write"),
                state,
                str(operation.get("createdAt", "") or ""),
                str(operation.get("updatedAt", operation.get("createdAt", "")) or ""),
                completed_at=str(operation.get("updatedAt", "") or "") if state == "complete" else "",
                progress={"processed": 1 if state == "complete" else 0, "total": 1, "status": "completed" if state == "complete" else state},
                resumable=state in {"indeterminate", "failed"},
                result_available=bool(envelope),
                summary={"replayable": bool(envelope), "idempotencyKey": str(key)},
                detail={"idempotencyKey": str(key), **operation},
            )

        items.sort(key=lambda item: (str(item.get("updatedAt", "")), str(item.get("operationId", ""))), reverse=True)
        return items, details

    def operations(
        self,
        *,
        kinds: list[str] | None = None,
        status: str = "",
        offset: int = 0,
        limit: int = 50,
    ) -> dict[str, Any]:
        self.require_consent()
        kind_aliases = {"agent_write": "agent-write", "index": "indexing", "exports": "export", "imports": "import"}
        clean_kinds = {
            kind_aliases.get(str(value or "").strip().lower(), str(value or "").strip().lower())
            for value in (kinds or []) if str(value or "").strip()
        }
        clean_status = str(status or "").strip().lower()
        offset_value = max(0, int(offset or 0))
        limit_value = max(1, min(MAX_PAGE_SIZE, int(limit or DEFAULT_PAGE_SIZE)))
        items, _details = self._collect_operations()
        filtered = [
            item
            for item in items
            if (not clean_kinds or str(item.get("kind", "") or "") in clean_kinds)
            and (not clean_status or str(item.get("status", "") or "") == clean_status)
        ]
        page_items = filtered[offset_value:offset_value + limit_value]
        counts: dict[str, int] = {}
        for item in filtered:
            key = f"{item['kind']}:{item['status']}"
            counts[key] = counts.get(key, 0) + 1
        return self._envelope(
            "list_image_operations",
            {"items": page_items, "counts": counts, "kinds": sorted({item["kind"] for item in items})},
            page={
                "offset": offset_value,
                "limit": limit_value,
                "returned": len(page_items),
                "total": len(filtered),
                "hasMore": offset_value + len(page_items) < len(filtered),
                "totalIsEstimate": False,
            },
        )

    def operation(self, operation_id: str) -> dict[str, Any]:
        self.require_consent()
        clean_id = str(operation_id or "").strip()
        if not clean_id:
            raise ValueError("operation_id is required.")
        items, details = self._collect_operations()
        summary = next((item for item in items if str(item.get("operationId", "")) == clean_id), None)
        if summary is None:
            raise ValueError("Agent operation was not found.")
        manifest = self._operation_manifest(summary, details.get(clean_id))
        return self._envelope(
            "get_image_operation",
            {
                "operation": summary,
                "result": {
                    "available": bool(summary.get("resultAvailable", False)),
                    "summary": _safe_json_value(summary.get("summary", {})),
                    "detailDisclosure": "normalized-only; raw backend detail and local paths are not exposed",
                },
                "manifest": manifest,
                "resourceLinks": [
                    {
                        "name": f"Output manifest for {clean_id}",
                        "uri": manifest["resourceUri"],
                        "mimeType": "application/json",
                    },
                    *[
                        {
                            "name": f"Generated output {output['outputId']}",
                            "uri": output["resourceUri"],
                            "mimeType": output["mimeType"],
                            "size": output["bytes"],
                        }
                        for output in manifest["outputs"]
                        if output.get("resourceAvailable")
                    ],
                ],
            },
        )

    @staticmethod
    def _manifest_source_asset_ids(value: Any) -> list[str]:
        result: list[str] = []

        def add(candidate: Any) -> None:
            clean = str(candidate or "").strip()
            if clean and clean not in result:
                result.append(clean)

        def walk(child: Any, key: str = "") -> None:
            key_lower = key.lower()
            if isinstance(child, dict):
                for child_key, value in child.items():
                    walk(value, str(child_key))
            elif isinstance(child, list):
                if key_lower.endswith("assetids"):
                    for value in child:
                        add(value)
                else:
                    for value in child[:MAX_ACTION_BATCH_ITEMS]:
                        walk(value, key)
            elif key_lower.endswith("assetid"):
                add(child)

        walk(value)
        return result[:MAX_ACTION_BATCH_ITEMS]

    def _operation_output_map(self, operation: dict[str, Any], detail: Any) -> tuple[list[dict[str, Any]], dict[str, Path]]:
        output_keys = {
            "backuppath",
            "csvpath",
            "exportpath",
            "jsonpath",
            "manifestpath",
            "mdpath",
            "ndjsonpath",
            "outputpath",
            "targetpath",
            "zippath",
        }
        candidates: list[tuple[str, str]] = []

        def walk(value: Any, key: str = "") -> None:
            if len(candidates) >= MAX_OPERATION_OUTPUTS * 4:
                return
            if isinstance(value, dict):
                for child_key, child in value.items():
                    walk(child, str(child_key))
            elif isinstance(value, list):
                for child in value[:MAX_ACTION_BATCH_ITEMS]:
                    walk(child, key)
            elif isinstance(value, str) and key.lower() in output_keys and value.strip():
                candidates.append((key, value.strip()))

        walk(detail)
        descriptors: list[dict[str, Any]] = []
        output_paths: dict[str, Path] = {}
        seen_paths: set[str] = set()
        operation_id = str(operation.get("operationId", "") or "")
        for role, candidate in candidates:
            try:
                path = self.validate_path(candidate)
            except Exception:
                continue
            normalized = str(path)
            if normalized in seen_paths or not path.exists():
                continue
            seen_paths.add(normalized)
            output_id = f"output_{hashlib.sha256((operation_id + '|' + role + '|' + normalized).encode('utf-8')).hexdigest()[:24]}"
            is_file = path.is_file()
            size = int(path.stat().st_size) if is_file else 0
            mime_type = mimetypes.guess_type(path.name)[0] if is_file else None
            descriptor = {
                "outputId": output_id,
                "role": str(role or "output")[:80],
                "kind": "file" if is_file else "directory",
                "mimeType": mime_type or ("application/octet-stream" if is_file else "inode/directory"),
                "bytes": size,
                "resourceAvailable": bool(is_file and size <= MAX_OUTPUT_RESOURCE_BYTES),
                "resourceUri": f"vintrace://agent/outputs/{operation_id}/{output_id}",
            }
            descriptors.append(descriptor)
            output_paths[output_id] = path
            if len(descriptors) >= MAX_OPERATION_OUTPUTS:
                break
        return descriptors, output_paths

    def _operation_manifest(self, operation: dict[str, Any], detail: Any) -> dict[str, Any]:
        outputs, _paths = self._operation_output_map(operation, detail)
        operation_id = str(operation.get("operationId", "") or "")
        return {
            "manifestVersion": "1.0",
            "manifestId": f"manifest:{operation_id}",
            "resourceUri": f"vintrace://agent/manifests/{operation_id}",
            "operation": {
                key: _safe_json_value(operation.get(key))
                for key in (
                    "operationId",
                    "kind",
                    "action",
                    "status",
                    "createdAt",
                    "updatedAt",
                    "completedAt",
                    "progress",
                    "resultAvailable",
                    "summary",
                )
            },
            "sourceAssetIds": self._manifest_source_asset_ids(detail),
            "outputs": outputs,
            "outputCount": len(outputs),
            "generatedAt": _utc_now(),
            "privacy": {
                "sourcePathsIncluded": False,
                "sourceHashesIncluded": False,
                "outputPathsIncluded": False,
                "pixelDisclosure": False,
            },
        }

    def operation_manifest(self, operation_id: str) -> dict[str, Any]:
        self.require_consent()
        clean_id = str(operation_id or "").strip()
        items, details = self._collect_operations()
        summary = next((item for item in items if str(item.get("operationId", "")) == clean_id), None)
        if summary is None:
            raise ValueError("Agent operation was not found.")
        return self._envelope("get_image_output_manifest", {"manifest": self._operation_manifest(summary, details.get(clean_id))})

    def operation_output(self, operation_id: str, output_id: str) -> dict[str, Any]:
        self.require_consent()
        clean_operation_id = str(operation_id or "").strip()
        clean_output_id = str(output_id or "").strip()
        items, details = self._collect_operations()
        summary = next((item for item in items if str(item.get("operationId", "")) == clean_operation_id), None)
        if summary is None:
            raise ValueError("Agent operation was not found.")
        descriptors, paths = self._operation_output_map(summary, details.get(clean_operation_id))
        descriptor = next((item for item in descriptors if item.get("outputId") == clean_output_id), None)
        path = paths.get(clean_output_id)
        if descriptor is None or path is None or not path.is_file():
            raise ValueError("Agent output resource was not found.")
        if int(descriptor.get("bytes", 0) or 0) > MAX_OUTPUT_RESOURCE_BYTES:
            raise ValueError(f"Agent output resources are capped at {MAX_OUTPUT_RESOURCE_BYTES} bytes; use the approved export destination for larger files.")
        data = path.read_bytes()
        self.api.project._append_audit(
            {
                "action": "agent_output_resource_disclosed",
                "operation_id": clean_operation_id,
                "output_id": clean_output_id,
                "bytes": len(data),
                "mime_type": str(descriptor.get("mimeType", "application/octet-stream")),
            }
        )
        return {"descriptor": descriptor, "data": data}

    def job(self, job_type: JobType, job_id: str = "") -> dict[str, Any]:
        self.require_consent()
        kind = str(job_type or "").strip().lower()
        if kind == "scan":
            result = self.api.handle("scan_job_status", {})
        elif kind == "indexing":
            jobs = _api_value(self.api.handle("photo_indexing_jobs", {"limit": 100}))
            clean_id = str(job_id or "").strip()
            if clean_id:
                rows = [row for row in _list_values(jobs.get("jobs")) if isinstance(row, dict) and str(row.get("jobId", "")) == clean_id]
                if not rows:
                    raise ValueError("Image indexing job was not found.")
                result = rows[0]
            else:
                result = jobs
        elif kind == "export":
            clean_id = str(job_id or "").strip()
            if not clean_id:
                result = _api_value(self.api.handle("photo_export_jobs", {"limit": 100}))
            else:
                result = _api_value(self.api.handle("photo_export_job_status", {"jobId": clean_id}))
        elif kind == "inbound":
            clean_id = str(job_id or "").strip()
            result = _api_value(self.api.handle("photo_source_job_status", {"jobId": clean_id})) if clean_id else _api_value(
                self.api.handle("photo_source_jobs", {"limit": 100})
            )
            if clean_id and isinstance(result, dict):
                result = result.get("job") if isinstance(result.get("job"), dict) else {}
            if isinstance(result, dict) and isinstance(result.get("jobs"), list):
                result = {
                    **result,
                    "jobs": [
                        row
                        for row in result["jobs"]
                        if isinstance(row, dict) and str(row.get("provider", "") or "") in {
                            "slack", "web", "google_drive", "onedrive", "dropbox", "webdav"
                        }
                    ],
                }
        else:
            raise ValueError("job_type must be scan, indexing, export, or inbound.")
        return self._envelope("get_image_job", result)
