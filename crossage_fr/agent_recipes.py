from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import re
from typing import Any

from crossage_fr.workspace_registry import atomic_write_text


MAX_RECIPE_STEPS = 24
MAX_CUSTOM_RECIPES = 100
RECIPE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$")
INPUT_TOKEN_RE = re.compile(r"\{\{input\.([A-Za-z][A-Za-z0-9_]*)\}\}")

ALLOWED_RECIPE_TOOLS = {
    "list_image_capabilities",
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
}


def _step(step_id: str, tool: str, arguments: dict[str, Any], *, approval: str = "none") -> dict[str, Any]:
    return {"id": step_id, "tool": tool, "arguments": arguments, "approval": approval}


BUILTIN_RECIPES: tuple[dict[str, Any], ...] = (
    {
        "recipeId": "builtin.portfolio-curation",
        "name": "Portfolio curation",
        "description": "Find a bounded visual shortlist, inspect local intelligence, disclose only finalist pixels, and stop at an approved album/export plan.",
        "inputSchema": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string"},
                "maxCandidates": {"type": "integer", "default": 40, "minimum": 1, "maximum": 100},
                "albumName": {"type": "string", "default": "Agent portfolio selects"},
            },
            "additionalProperties": False,
        },
        "steps": [
            _step("overview", "get_image_library_overview", {}),
            _step("search", "search_images", {"query": "{{input.query}}", "mode": "hybrid", "limit": "{{input.maxCandidates}}"}),
            _step("analyze", "analyze_image_assets", {"asset_ids": {"$from": "search.data.items[*].assetId"}, "capabilities": ["quality", "people", "albums", "edits"]}),
            _step("preview-finalists", "get_image_preview", {"asset_id": {"$from": "human-shortlist.assetId"}}, approval="pixel-disclosure"),
            _step("plan-album", "plan_image_action", {"action": "save_photo_album", "payload": {"name": "{{input.albumName}}", "albumKind": "manual"}}, approval="write"),
        ],
    },
    {
        "recipeId": "builtin.ocr-to-reviewed-album",
        "name": "OCR to reviewed album",
        "description": "Find assets by detected text, review the evidence, and create one idempotent manual album.",
        "inputSchema": {
            "type": "object",
            "required": ["text", "albumName"],
            "properties": {"text": {"type": "string"}, "albumName": {"type": "string"}, "limit": {"type": "integer", "default": 100}},
            "additionalProperties": False,
        },
        "steps": [
            _step("search", "search_images", {"query": "{{input.text}}", "mode": "lexical", "limit": "{{input.limit}}"}),
            _step("ocr", "analyze_image_assets", {"asset_ids": {"$from": "search.data.items[*].assetId"}, "capabilities": ["text", "metadata"]}),
            _step("plan-album", "plan_image_action", {"action": "save_photo_album", "payload": {"name": "{{input.albumName}}", "albumKind": "manual"}}, approval="write"),
            _step("plan-membership", "plan_image_action", {"action": "add_photo_album_items", "payload": {"albumId": {"$from": "plan-album.result.albumId"}, "assetIds": {"$from": "human-reviewed.assetIds"}}}, approval="write"),
        ],
    },
    {
        "recipeId": "builtin.trip-memory-movie",
        "name": "Trip memory movie",
        "description": "Select favorite trip assets, save a memory, start an asynchronous movie export, and poll its manifest.",
        "inputSchema": {
            "type": "object",
            "required": ["query", "memoryName"],
            "properties": {"query": {"type": "string"}, "memoryName": {"type": "string"}, "limit": {"type": "integer", "default": 100}},
            "additionalProperties": False,
        },
        "steps": [
            _step("search", "search_images", {"query": "{{input.query}}", "mode": "hybrid", "filters": {"favoriteOnly": True}, "limit": "{{input.limit}}"}),
            _step("plan-memory", "plan_image_action", {"action": "save_photo_user_memory", "payload": {"name": "{{input.memoryName}}", "assetIds": {"$from": "search.data.items[*].assetId"}}}, approval="write"),
            _step("plan-movie", "plan_image_action", {"action": "export_photo_memory_movie", "payload": {"memoryId": {"$from": "plan-memory.result.memoryId"}}}, approval="write"),
            _step("poll", "get_image_job", {"job_type": "export", "job_id": {"$from": "plan-movie.result.jobId"}}),
        ],
    },
    {
        "recipeId": "builtin.batch-metadata-normalization",
        "name": "Batch metadata normalization",
        "description": "Resolve a saved query to stable IDs and stop at a bounded, confirmed batch metadata update.",
        "inputSchema": {
            "type": "object",
            "required": ["query"],
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 500}},
            "additionalProperties": False,
        },
        "steps": [
            _step("search", "search_images", {"query": "{{input.query}}", "mode": "lexical", "limit": 200}),
            _step("fetch", "fetch_image_assets", {"asset_ids": {"$from": "search.data.items[*].assetId"}}),
            _step("plan-update", "plan_image_action", {"action": "update_photo_assets_metadata", "payload": {"items": {"$from": "human-reviewed.metadataUpdates"}}}, approval="write"),
        ],
    },
    {
        "recipeId": "builtin.duplicate-review-and-undo",
        "name": "Duplicate review and undo",
        "description": "Read duplicate groups, preview a proposed keeper, merge only after approval, and retain the undo operation resource.",
        "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "default": 50}}, "additionalProperties": False},
        "steps": [
            _step("groups", "run_image_read_action", {"action": "list_photo_folder_items", "payload": {"folderId": "duplicates", "limit": "{{input.limit}}"}}),
            _step("preview-keeper", "get_image_preview", {"asset_id": {"$from": "human-proposed-keeper.assetId"}}, approval="pixel-disclosure"),
            _step("plan-merge", "plan_image_action", {"action": "merge_photo_duplicates", "payload": {"groupId": {"$from": "human-reviewed.groupId"}, "keepAssetId": {"$from": "human-proposed-keeper.assetId"}}}, approval="destructive"),
            _step("verify-operation", "get_image_operation", {"operation_id": {"$from": "plan-merge.result.operationResource"}}),
        ],
    },
    {
        "recipeId": "builtin.missing-intelligence-index",
        "name": "Missing intelligence index",
        "description": "Inspect local intelligence coverage, queue only missing OCR/object/barcode work, and poll or resume it.",
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string", "default": ""}, "limit": {"type": "integer", "default": 100}}, "additionalProperties": False},
        "steps": [
            _step("search", "search_images", {"query": "{{input.query}}", "mode": "lexical", "limit": "{{input.limit}}"}),
            _step("coverage", "analyze_image_assets", {"asset_ids": {"$from": "search.data.items[*].assetId"}, "capabilities": ["text", "objects", "barcodes"]}),
            _step("plan-index", "plan_image_action", {"action": "enqueue_photo_indexing_job", "payload": {"jobKind": {"$from": "coverage.data.pendingCapabilities[0]"}, "scope": {"assetIds": {"$from": "search.data.items[*].assetId"}}}}, approval="write"),
            _step("poll", "list_image_operations", {"kinds": ["indexing"]}),
        ],
    },
    {
        "recipeId": "builtin.semantic-contact-sheet",
        "name": "Semantic contact sheet",
        "description": "Run semantic curation and stop at a color-managed contact-sheet export plan without exposing source paths.",
        "inputSchema": {
            "type": "object",
            "required": ["query"],
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 40}, "title": {"type": "string", "default": "Agent contact sheet"}},
            "additionalProperties": False,
        },
        "steps": [
            _step("search", "search_images", {"query": "{{input.query}}", "mode": "hybrid", "limit": "{{input.limit}}"}),
            _step("plan-export", "plan_image_action", {"action": "export_photo_contact_sheet", "payload": {"assetIds": {"$from": "search.data.items[*].assetId"}, "title": "{{input.title}}", "preserveColorProfile": True}}, approval="write"),
        ],
    },
    {
        "recipeId": "builtin.archive-health-and-repair",
        "name": "Archive health and repair",
        "description": "Inspect backup/catalog integrity, list repair operations, and stop before any corrective mutation.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "steps": [
            _step("overview", "get_image_library_overview", {"include_health": True}),
            _step("repairs", "list_image_operations", {"kinds": ["repair", "library"]}),
            _step("plan-cleanup", "plan_image_action", {"action": "photo_library_catalog_cleanup", "payload": {"dryRun": True}}),
        ],
    },
)


def recipes_path(workspace: Path) -> Path:
    return Path(workspace).expanduser().resolve() / ".vintrace-agent-recipes.json"


def validate_recipe(value: Any, *, recipe_id: str = "") -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("recipe must be an object.")
    clean_id = str(recipe_id or value.get("recipeId", "") or "").strip()
    if not RECIPE_ID_RE.fullmatch(clean_id) or clean_id.startswith("builtin."):
        raise ValueError("Custom recipeId must be 3-96 safe characters and cannot use the builtin namespace.")
    name = str(value.get("name", "") or "").strip()[:160]
    description = str(value.get("description", "") or "").strip()[:1200]
    if not name:
        raise ValueError("recipe.name is required.")
    input_schema = value.get("inputSchema", {}) if isinstance(value.get("inputSchema"), dict) else {}
    properties = input_schema.get("properties", {}) if isinstance(input_schema.get("properties"), dict) else {}
    required = input_schema.get("required", []) if isinstance(input_schema.get("required"), list) else []
    required = [str(item) for item in required if str(item) in properties]
    clean_schema = {
        "type": "object",
        "properties": deepcopy(properties),
        "required": required,
        "additionalProperties": False,
    }
    raw_steps = value.get("steps", [])
    if not isinstance(raw_steps, list) or not raw_steps or len(raw_steps) > MAX_RECIPE_STEPS:
        raise ValueError(f"recipe.steps must contain 1-{MAX_RECIPE_STEPS} steps.")
    steps: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, raw in enumerate(raw_steps):
        if not isinstance(raw, dict):
            raise ValueError("Every recipe step must be an object.")
        step_id = str(raw.get("id", f"step-{index + 1}") or f"step-{index + 1}").strip()
        if not RECIPE_ID_RE.fullmatch(step_id) or step_id in seen_ids:
            raise ValueError("Recipe step IDs must be unique safe identifiers.")
        seen_ids.add(step_id)
        tool = str(raw.get("tool", "") or "").strip()
        if tool not in ALLOWED_RECIPE_TOOLS:
            raise ValueError(f"Recipe tool is not allowlisted: {tool or '(missing)' }.")
        arguments = raw.get("arguments", {}) if isinstance(raw.get("arguments"), dict) else {}

        def path_key(key: str) -> bool:
            clean_key = str(key or "").strip().lower()
            return clean_key.endswith(("path", "paths", "folder", "folders", "directory", "directories")) or clean_key in {
                "destination",
                "destinations",
                "root",
                "roots",
                "workspace",
            }

        def portable_paths(argument: Any, key: str = "") -> None:
            if path_key(key):
                if argument is None or argument == "":
                    return
                if isinstance(argument, str) and INPUT_TOKEN_RE.fullmatch(argument):
                    return
                if isinstance(argument, dict) and isinstance(argument.get("$from"), str):
                    return
                if isinstance(argument, list):
                    for item in argument:
                        portable_paths(item, key)
                    return
                raise ValueError("Recipe path fields must use an exact {{input.name}} token or a $from reference.")
            if isinstance(argument, dict):
                for child_key, child in argument.items():
                    portable_paths(child, str(child_key))
            elif isinstance(argument, list):
                for child in argument:
                    portable_paths(child, key)

        portable_paths(arguments)
        approval = str(raw.get("approval", "none") or "none").strip().lower()
        if approval not in {"none", "pixel-disclosure", "write", "destructive", "operator"}:
            raise ValueError("Recipe step approval must be none, pixel-disclosure, write, destructive, or operator.")
        steps.append(_step(step_id, tool, deepcopy(arguments), approval=approval))
    return {
        "recipeId": clean_id,
        "name": name,
        "description": description,
        "inputSchema": clean_schema,
        "steps": steps,
        "builtin": False,
    }


def load_custom_recipes(workspace: Path) -> dict[str, dict[str, Any]]:
    path = recipes_path(workspace)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return {}
    rows = payload.get("recipes", {}) if isinstance(payload, dict) and isinstance(payload.get("recipes"), dict) else {}
    result: dict[str, dict[str, Any]] = {}
    for recipe_id, value in rows.items():
        try:
            result[str(recipe_id)] = validate_recipe(value, recipe_id=str(recipe_id))
        except ValueError:
            continue
    return result


def save_custom_recipes(workspace: Path, recipes: dict[str, dict[str, Any]]) -> None:
    if len(recipes) > MAX_CUSTOM_RECIPES:
        raise ValueError(f"At most {MAX_CUSTOM_RECIPES} custom recipes can be saved per workspace.")
    body = {"schemaVersion": 1, "recipes": recipes}
    atomic_write_text(recipes_path(workspace), json.dumps(body, ensure_ascii=False, indent=2, sort_keys=True))


def all_recipes(workspace: Path) -> list[dict[str, Any]]:
    builtins = [{**deepcopy(recipe), "builtin": True} for recipe in BUILTIN_RECIPES]
    custom = list(load_custom_recipes(workspace).values())
    return sorted([*builtins, *custom], key=lambda row: (not bool(row.get("builtin", False)), str(row.get("name", "")).casefold()))


def _input_values(recipe: dict[str, Any], inputs: Any) -> dict[str, Any]:
    values = dict(inputs) if isinstance(inputs, dict) else {}
    schema = recipe.get("inputSchema", {}) if isinstance(recipe.get("inputSchema"), dict) else {}
    properties = schema.get("properties", {}) if isinstance(schema.get("properties"), dict) else {}
    unknown = sorted(set(values) - set(properties))
    if unknown:
        raise ValueError(f"Unknown recipe inputs: {', '.join(unknown)}.")
    for name, field in properties.items():
        if name not in values and isinstance(field, dict) and "default" in field:
            values[name] = deepcopy(field["default"])
    missing = [str(name) for name in schema.get("required", []) if str(name) not in values]
    if missing:
        raise ValueError(f"Recipe requires input(s): {', '.join(missing)}.")
    for name, value in values.items():
        field = properties.get(name, {}) if isinstance(properties.get(name), dict) else {}
        field_type = str(field.get("type", "") or "")
        valid = (
            not field_type
            or (field_type == "string" and isinstance(value, str))
            or (field_type == "integer" and isinstance(value, int) and not isinstance(value, bool))
            or (field_type == "number" and isinstance(value, (int, float)) and not isinstance(value, bool))
            or (field_type == "boolean" and isinstance(value, bool))
            or (field_type == "array" and isinstance(value, list))
            or (field_type == "object" and isinstance(value, dict))
            or (field_type == "null" and value is None)
        )
        if not valid:
            raise ValueError(f"Recipe input {name} must be {field_type}.")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if "minimum" in field and value < field["minimum"]:
                raise ValueError(f"Recipe input {name} is below its minimum.")
            if "maximum" in field and value > field["maximum"]:
                raise ValueError(f"Recipe input {name} exceeds its maximum.")
        if isinstance(field.get("enum"), list) and value not in field["enum"]:
            raise ValueError(f"Recipe input {name} is not one of its allowed values.")
    return values


def render_recipe(recipe: dict[str, Any], inputs: Any) -> dict[str, Any]:
    values = _input_values(recipe, inputs)

    def render(value: Any) -> Any:
        if isinstance(value, dict):
            return {str(key): render(child) for key, child in value.items()}
        if isinstance(value, list):
            return [render(child) for child in value]
        if not isinstance(value, str):
            return value
        exact = INPUT_TOKEN_RE.fullmatch(value)
        if exact:
            key = exact.group(1)
            if key not in values:
                raise ValueError(f"Recipe input is unresolved: {key}.")
            return deepcopy(values[key])
        return INPUT_TOKEN_RE.sub(lambda match: str(values.get(match.group(1), match.group(0))), value)

    steps = [render(step) for step in recipe.get("steps", [])]
    approval_points = [
        {"stepId": step["id"], "approval": step["approval"]}
        for step in steps
        if str(step.get("approval", "none")) != "none"
    ]
    return {
        "recipeId": str(recipe.get("recipeId", "") or ""),
        "name": str(recipe.get("name", "") or ""),
        "description": str(recipe.get("description", "") or ""),
        "inputs": values,
        "steps": steps,
        "approvalPoints": approval_points,
        "execution": "plan-only; run each step through its named MCP tool and retain returned request/operation IDs",
    }
