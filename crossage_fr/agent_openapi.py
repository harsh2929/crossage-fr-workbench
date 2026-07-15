from __future__ import annotations

from typing import Any

from crossage_fr import __version__
from crossage_fr.agent_images import (
    AGENT_IMAGE_API_VERSION,
    MAX_ACTION_BATCH_ITEMS,
    MAX_FETCH_ASSETS,
    MAX_HYBRID_CANDIDATES,
    MAX_PAGE_SIZE,
    MAX_PREVIEW_BYTES,
    MAX_PREVIEW_DIMENSION,
)


def agent_images_openapi_spec() -> dict[str, Any]:
    """Return the direct agent API contract served beside Streamable HTTP MCP."""

    error_response = {
        "description": "A normalized, path-redacted failure.",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/ErrorEnvelope"},
            }
        },
    }
    envelope_response = {
        "description": "A normalized agent image result envelope.",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/ResultEnvelope"},
            }
        },
    }
    standard_errors = {
        "400": error_response,
        "401": error_response,
        "403": error_response,
        "404": error_response,
        "409": error_response,
        "412": error_response,
        "413": error_response,
        "422": error_response,
        "423": error_response,
        "428": error_response,
        "429": error_response,
        "500": error_response,
    }

    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Vintrace Agent Images API",
            "version": AGENT_IMAGE_API_VERSION,
            "summary": "Local-first image and video library operations for agents.",
            "description": (
                "The same stable-ID, consent-gated image contract exposed through Vintrace MCP. "
                "Search and fetch metadata before requesting pixels. Plan mutations, use the correct "
                "execution lane, explicitly confirm writes, and provide a unique idempotency key."
            ),
            "x-platform-version": __version__,
        },
        "servers": [{"url": "http://127.0.0.1:8765", "description": "Default local Vintrace agent host"}],
        "security": [{"bearerAuth": []}],
        "tags": [
            {"name": "Discovery"},
            {"name": "Mobile companion"},
            {"name": "Assets"},
            {"name": "Changes"},
            {"name": "Inbound connectors"},
            {"name": "Actions"},
            {"name": "Jobs"},
            {"name": "Activity"},
            {"name": "Operations"},
            {"name": "Recipes"},
        ],
        "paths": {
            "/v1/openapi.json": {
                "get": {
                    "operationId": "getAgentImagesOpenApi",
                    "summary": "Read this API contract",
                    "tags": ["Discovery"],
                    "responses": {"200": {"description": "OpenAPI 3.1 document"}, **standard_errors},
                }
            },
            "/v1/health": {
                "get": {
                    "operationId": "getAgentImagesHealth",
                    "summary": "Check authenticated service readiness",
                    "tags": ["Discovery"],
                    "responses": {
                        "200": {
                            "description": "Authenticated service readiness.",
                            "content": {"application/json": {"schema": {"$ref": "#/components/schemas/HealthResponse"}}},
                        },
                        **standard_errors,
                    },
                }
            },
            "/v1/mobile/pair": {
                "post": {
                    "operationId": "pairMobileCompanion",
                    "summary": "Exchange a one-use desktop pairing secret for an HttpOnly mobile session",
                    "tags": ["Mobile companion"],
                    "security": [],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/MobilePairRequest"}}},
                    },
                    "responses": {"200": {"description": "Paired read-only mobile session."}, **standard_errors},
                }
            },
            "/v1/mobile/session": {
                "get": {
                    "operationId": "getMobileCompanionSession",
                    "summary": "Read the paired device, expiry, and preview capability",
                    "tags": ["Mobile companion"],
                    "security": [{"mobileSession": []}],
                    "responses": {"200": {"description": "Current read-only mobile session."}, **standard_errors},
                }
            },
            "/v1/mobile/logout": {
                "post": {
                    "operationId": "logoutMobileCompanion",
                    "summary": "Clear this browser's mobile session cookie without changing device revocation",
                    "tags": ["Mobile companion"],
                    "security": [],
                    "responses": {"204": {"description": "Mobile browser session cleared."}, **standard_errors},
                }
            },
            "/v1/capabilities": {
                "get": {
                    "operationId": "listAgentImageCapabilities",
                    "summary": "Discover live image actions and their impact policy",
                    "tags": ["Discovery"],
                    "parameters": [
                        {"name": "category", "in": "query", "schema": {"type": "string"}},
                        {"name": "includeActions", "in": "query", "schema": {"type": "boolean", "default": True}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/library": {
                "get": {
                    "operationId": "getAgentImageLibraryOverview",
                    "summary": "Read library counts, collections, jobs, settings, and optional health",
                    "tags": ["Discovery"],
                    "parameters": [
                        {"name": "includeHealth", "in": "query", "schema": {"type": "boolean", "default": False}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/changes": {
                "get": {
                    "operationId": "getAgentImageChanges",
                    "summary": "Read ordered catalog deltas after a durable cursor",
                    "description": (
                        "Authenticated, path-free change feed backed by the unconditional catalog journal. "
                        "Apply every item in sequence order and persist data.cursor.nextAfterSeq only after "
                        "the page is committed locally. Delete and protected-asset removals are tombstones."
                    ),
                    "tags": ["Changes"],
                    "parameters": [
                        {"name": "afterSeq", "in": "query", "schema": {"type": "integer", "minimum": 0, "default": 0}},
                        {"name": "limit", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_SIZE, "default": 50}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/connectors": {
                "get": {
                    "operationId": "listInboundVisualSources",
                    "summary": "List operator-authorized inbound visual sources without credentials",
                    "tags": ["Inbound connectors"],
                    "parameters": [
                        {"name": "provider", "in": "query", "schema": {"$ref": "#/components/schemas/InboundProvider"}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/connectors/{provider}/{connection_id}/discover": {
                "post": {
                    "operationId": "discoverInboundVisuals",
                    "summary": "Discover bounded remote visual metadata without importing pixels",
                    "tags": ["Inbound connectors"],
                    "parameters": [
                        {"name": "provider", "in": "path", "required": True, "schema": {"$ref": "#/components/schemas/InboundProvider"}},
                        {"name": "connection_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/InboundDiscoverRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/connectors/{provider}/{connection_id}/import": {
                "post": {
                    "operationId": "importInboundVisuals",
                    "summary": "Import reviewed remote media into managed storage and assign stable IDs",
                    "tags": ["Inbound connectors"],
                    "parameters": [
                        {"name": "provider", "in": "path", "required": True, "schema": {"$ref": "#/components/schemas/InboundProvider"}},
                        {"name": "connection_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/InboundImportRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/connectors/{provider}/{connection_id}/sync": {
                "post": {
                    "operationId": "syncInboundVisuals",
                    "summary": "Incrementally import changed remote media into managed storage",
                    "tags": ["Inbound connectors"],
                    "parameters": [
                        {"name": "provider", "in": "path", "required": True, "schema": {"$ref": "#/components/schemas/InboundProvider"}},
                        {"name": "connection_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/InboundImportRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/search": {
                "post": {
                    "operationId": "searchAgentImages",
                    "summary": "Search without disclosing pixels or source paths",
                    "tags": ["Assets"],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SearchRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/assets/fetch": {
                "post": {
                    "operationId": "fetchAgentImageAssets",
                    "summary": "Fetch structured metadata by stable asset ID",
                    "tags": ["Assets"],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/FetchAssetsRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/assets/analyze": {
                "post": {
                    "operationId": "analyzeAgentImageAssets",
                    "summary": "Read existing on-device intelligence without requesting pixels",
                    "tags": ["Assets"],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AnalyzeAssetsRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/assets/{asset_id}": {
                "get": {
                    "operationId": "getAgentImageAsset",
                    "summary": "Fetch structured metadata for one stable asset ID",
                    "tags": ["Assets"],
                    "parameters": [
                        {"name": "asset_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/assets/{asset_id}/preview": {
                "get": {
                    "operationId": "getAgentImagePreview",
                    "summary": "Fetch one bounded, audited, Safe Mode-approved JPEG preview",
                    "tags": ["Assets"],
                    "parameters": [
                        {"name": "asset_id", "in": "path", "required": True, "schema": {"type": "string"}},
                        {
                            "name": "maxDimension",
                            "in": "query",
                            "schema": {"type": "integer", "minimum": 256, "maximum": MAX_PREVIEW_DIMENSION, "default": 1536},
                        },
                        {
                            "name": "maxBytes",
                            "in": "query",
                            "schema": {"type": "integer", "minimum": 65536, "maximum": MAX_PREVIEW_BYTES, "default": 4194304},
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "JPEG preview bytes",
                            "headers": {
                                "X-Vintrace-Asset-Id": {"schema": {"type": "string"}},
                                "Cache-Control": {"schema": {"type": "string", "const": "private, no-store"}},
                            },
                            "content": {
                                "image/jpeg": {
                                    "schema": {"type": "string", "format": "binary", "contentEncoding": "binary"}
                                }
                            },
                        },
                        **standard_errors,
                    },
                }
            },
            "/v1/actions/plan": {
                "post": {
                    "operationId": "planAgentImageAction",
                    "summary": "Validate an action and inspect its required execution lane",
                    "tags": ["Actions"],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/PlanActionRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/actions/run": {
                "post": {
                    "operationId": "runAgentImageAction",
                    "summary": "Run a cataloged action through a policy-enforced lane",
                    "description": (
                        "Read actions use lane=read. Mutations require the lane returned by plan, confirm=true, "
                        "and a unique idempotencyKey. Human-authority actions also require operatorToken."
                    ),
                    "tags": ["Actions"],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/RunActionRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/jobs/{job_type}/{job_id}": {
                "get": {
                    "operationId": "getAgentImageJob",
                    "summary": "Poll a scan, indexing, export, or inbound job",
                    "tags": ["Jobs"],
                    "parameters": [
                        {
                            "name": "job_type",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string", "enum": ["scan", "indexing", "export", "inbound"]},
                        },
                        {"name": "job_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/jobs/{job_type}": {
                "get": {
                    "operationId": "listAgentImageJobs",
                    "summary": "List recent scan, indexing, export, or inbound jobs",
                    "tags": ["Jobs"],
                    "parameters": [
                        {
                            "name": "job_type",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string", "enum": ["scan", "indexing", "export", "inbound"]},
                        },
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/activity": {
                "get": {
                    "operationId": "getAgentImageActivity",
                    "summary": "Review recent agent requests, approvals, retries, and failures",
                    "tags": ["Activity"],
                    "parameters": [
                        {"name": "action", "in": "query", "schema": {"type": "string"}},
                        {"name": "status", "in": "query", "schema": {"type": "string"}},
                        {"name": "offset", "in": "query", "schema": {"type": "integer", "minimum": 0, "default": 0}},
                        {"name": "limit", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_SIZE, "default": 50}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/events": {
                "get": {
                    "operationId": "subscribeAgentImageEvents",
                    "summary": "Subscribe to path-free agent activity and approval events",
                    "description": "Authenticated Server-Sent Events. Resume with afterSeq or the last event ID.",
                    "tags": ["Activity"],
                    "parameters": [
                        {"name": "afterSeq", "in": "query", "schema": {"type": "integer", "minimum": 0, "default": 0}},
                    ],
                    "responses": {
                        "200": {
                            "description": "A resumable agent.activity event stream.",
                            "content": {"text/event-stream": {"schema": {"type": "string"}}},
                        },
                        **standard_errors,
                    },
                }
            },
            "/v1/operations": {
                "get": {
                    "operationId": "listAgentImageOperations",
                    "summary": "List one operation feed across import, indexing, export, repair, and writes",
                    "tags": ["Operations"],
                    "parameters": [
                        {"name": "kinds", "in": "query", "description": "Comma-separated operation kinds.", "schema": {"type": "string"}},
                        {"name": "status", "in": "query", "schema": {"type": "string"}},
                        {"name": "offset", "in": "query", "schema": {"type": "integer", "minimum": 0, "default": 0}},
                        {"name": "limit", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_SIZE, "default": 50}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/operations/{operation_id}": {
                "get": {
                    "operationId": "getAgentImageOperation",
                    "summary": "Get unified progress, result, and output resource links",
                    "tags": ["Operations"],
                    "parameters": [
                        {"name": "operation_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/operations/{operation_id}/manifest": {
                "get": {
                    "operationId": "getAgentImageOperationManifest",
                    "summary": "Get a path-free generated-output manifest",
                    "tags": ["Operations"],
                    "parameters": [
                        {"name": "operation_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/operations/{operation_id}/outputs/{output_id}": {
                "get": {
                    "operationId": "getAgentImageOperationOutput",
                    "summary": "Read one bounded generated output by opaque IDs",
                    "tags": ["Operations"],
                    "parameters": [
                        {"name": "operation_id", "in": "path", "required": True, "schema": {"type": "string"}},
                        {"name": "output_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {
                        "200": {
                            "description": "Generated output bytes, capped by the advertised service limit.",
                            "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
                        },
                        **standard_errors,
                    },
                }
            },
            "/v1/recipes": {
                "get": {
                    "operationId": "listAgentImageRecipes",
                    "summary": "List reusable workspace-scoped image workflow recipes",
                    "tags": ["Recipes"],
                    "parameters": [
                        {"name": "includeSteps", "in": "query", "schema": {"type": "boolean", "default": False}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                },
                "post": {
                    "operationId": "saveAgentImageRecipe",
                    "summary": "Create or revise a confirmed, idempotent image recipe",
                    "tags": ["Recipes"],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/SaveRecipeRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                },
            },
            "/v1/recipes/plan": {
                "post": {
                    "operationId": "planAgentImageRecipe",
                    "summary": "Bind typed recipe inputs and return an approval-aware multi-step plan",
                    "tags": ["Recipes"],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/PlanRecipeRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                }
            },
            "/v1/recipes/{recipe_id}": {
                "get": {
                    "operationId": "getAgentImageRecipe",
                    "summary": "Get one built-in or custom image recipe and input contract",
                    "tags": ["Recipes"],
                    "parameters": [
                        {"name": "recipe_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "responses": {"200": envelope_response, **standard_errors},
                },
                "delete": {
                    "operationId": "deleteAgentImageRecipe",
                    "summary": "Delete one saved recipe with confirmation and idempotency",
                    "tags": ["Recipes"],
                    "parameters": [
                        {"name": "recipe_id", "in": "path", "required": True, "schema": {"type": "string"}},
                    ],
                    "requestBody": {
                        "required": True,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/DeleteRecipeRequest"}}},
                    },
                    "responses": {"200": envelope_response, **standard_errors},
                },
            },
        },
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "opaque local/service token or OAuth JWT",
                    "description": (
                        "Local operator tokens have full authority. Scoped service-account tokens are stored only as "
                        "SHA-256 hashes. Hosted deployments can validate OAuth JWTs against a configured issuer/JWKS "
                        "and the MCP resource audience. Supported scopes: images:read, images:preview, images:write, "
                        "images:destructive, events:read, images:admin."
                    ),
                    "x-supported-scopes": [
                        "images:read",
                        "images:preview",
                        "images:write",
                        "images:destructive",
                        "events:read",
                        "images:admin",
                    ],
                },
                "mobileSession": {
                    "type": "apiKey",
                    "in": "cookie",
                    "name": "__Host-vintrace_mobile",
                    "description": "Secure, HttpOnly, SameSite=Strict session issued by the one-use mobile pairing exchange.",
                },
            },
            "schemas": {
                "MobilePairRequest": {
                    "type": "object",
                    "required": ["pairingCode"],
                    "properties": {
                        "pairingCode": {
                            "type": "string",
                            "minLength": 40,
                            "maxLength": 128,
                            "pattern": "^[A-Za-z0-9_-]+$",
                            "writeOnly": True,
                        }
                    },
                    "additionalProperties": False,
                },
                "InboundProvider": {
                    "type": "string",
                    "enum": ["slack", "web", "google_drive", "onedrive", "dropbox", "webdav"],
                },
                "InboundDiscoverRequest": {
                    "type": "object",
                    "properties": {
                        "itemLimit": {"type": "integer", "minimum": 1, "maximum": 10000, "default": 1000},
                        "sampleLimit": {"type": "integer", "minimum": 0, "maximum": 100, "default": 40},
                        "timeBudgetMs": {"type": "integer", "minimum": 100, "maximum": 30000, "default": 2000},
                    },
                    "additionalProperties": False,
                },
                "InboundImportRequest": {
                    "type": "object",
                    "required": ["externalDownloadConsent", "confirm", "idempotencyKey"],
                    "properties": {
                        "externalIds": {
                            "type": "array",
                            "maxItems": MAX_ACTION_BATCH_ITEMS,
                            "uniqueItems": True,
                            "items": {"type": "string"},
                        },
                        "externalDownloadConsent": {"const": True},
                        "confirm": {"const": True},
                        "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 128},
                    },
                    "additionalProperties": False,
                },
                "HealthResponse": {
                    "type": "object",
                    "required": ["ok", "service", "apiVersion", "platformVersion", "transport", "openapi", "mcp", "authentication"],
                    "properties": {
                        "ok": {"const": True},
                        "service": {"const": "vintrace-agent-images"},
                        "apiVersion": {"type": "string"},
                        "platformVersion": {"type": "string"},
                        "transport": {"const": "http"},
                        "openapi": {"type": "string"},
                        "mcp": {"type": "string"},
                        "authentication": {
                            "type": "object",
                            "required": ["oauth", "serviceAccounts", "mobileAccounts", "scopes"],
                            "properties": {
                                "oauth": {"type": "boolean"},
                                "serviceAccounts": {"type": "boolean"},
                                "mobileAccounts": {"type": "boolean"},
                                "scopes": {"type": "array", "items": {"type": "string"}},
                            },
                            "additionalProperties": False,
                        },
                    },
                    "additionalProperties": False,
                },
                "Error": {
                    "type": "object",
                    "required": ["code", "message"],
                    "properties": {
                        "code": {
                            "type": "string",
                            "enum": [
                                "unauthorized",
                                "insufficient_scope",
                                "tool_not_granted",
                                "read_only_principal",
                                "mobile_read_only",
                                "mobile_session_required",
                                "mobile_pairing_invalid",
                                "mobile_pairing_origin",
                                "mobile_credentials_busy",
                                "auth_configuration_error",
                                "rate_limited",
                                "consent_required",
                                "workspace_locked",
                                "path_out_of_scope",
                                "confirmation_required",
                                "idempotency_required",
                                "idempotency_conflict",
                                "operation_indeterminate",
                                "operator_approval_required",
                                "payload_too_large",
                                "safe_mode_protected",
                                "not_found",
                                "invalid_action",
                                "invalid_request",
                                "internal_error",
                            ],
                        },
                        "message": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "ErrorEnvelope": {
                    "type": "object",
                    "required": ["ok", "error"],
                    "properties": {
                        "ok": {"const": False},
                        "error": {"$ref": "#/components/schemas/Error"},
                    },
                    "additionalProperties": False,
                },
                "Policy": {
                    "type": "object",
                    "required": [
                        "readOnly",
                        "destructive",
                        "openWorld",
                        "idempotent",
                        "pixelDisclosure",
                        "confirmationRequired",
                        "operatorTokenRequired",
                    ],
                    "properties": {
                        "readOnly": {"type": "boolean"},
                        "destructive": {"type": "boolean"},
                        "openWorld": {"type": "boolean"},
                        "idempotent": {"type": "boolean"},
                        "pixelDisclosure": {"type": "boolean"},
                        "confirmationRequired": {"type": "boolean"},
                        "operatorTokenRequired": {"type": "boolean"},
                    },
                    "additionalProperties": False,
                },
                "ResultEnvelope": {
                    "type": "object",
                    "required": ["ok", "requestId", "action", "data", "warnings", "provenance", "policy"],
                    "properties": {
                        "ok": {"const": True},
                        "requestId": {"type": "string"},
                        "action": {"type": "string"},
                        "data": {},
                        "page": {"type": ["object", "null"]},
                        "job": {"type": ["object", "null"]},
                        "warnings": {"type": "array", "items": {"type": "string"}},
                        "provenance": {"type": "object"},
                        "policy": {"$ref": "#/components/schemas/Policy"},
                    },
                },
                "SearchRequest": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "default": ""},
                        "mode": {"type": "string", "enum": ["lexical", "semantic", "hybrid"], "default": "hybrid"},
                        "scope": {"type": "string", "default": "all"},
                        "filters": {"type": "object", "additionalProperties": True},
                        "sort": {"type": "string", "default": "newest"},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_SIZE, "default": 50},
                    },
                    "additionalProperties": False,
                    "x-hybrid-candidate-cap": MAX_HYBRID_CANDIDATES,
                },
                "FetchAssetsRequest": {
                    "type": "object",
                    "required": ["assetIds"],
                    "properties": {
                        "assetIds": {
                            "type": "array",
                            "maxItems": MAX_FETCH_ASSETS,
                            "uniqueItems": True,
                            "items": {"type": "string"},
                        }
                    },
                    "additionalProperties": False,
                },
                "AnalyzeAssetsRequest": {
                    "type": "object",
                    "required": ["assetIds"],
                    "properties": {
                        "assetIds": {
                            "type": "array",
                            "maxItems": MAX_FETCH_ASSETS,
                            "uniqueItems": True,
                            "items": {"type": "string"},
                        },
                        "capabilities": {
                            "type": "array",
                            "uniqueItems": True,
                            "items": {
                                "type": "string",
                                "enum": ["metadata", "text", "objects", "barcodes", "quality", "people", "albums", "edits"],
                            },
                        },
                    },
                    "additionalProperties": False,
                },
                "PlanActionRequest": {
                    "type": "object",
                    "required": ["action"],
                    "properties": {
                        "action": {"type": "string"},
                        "payload": {"type": "object", "additionalProperties": True},
                    },
                    "additionalProperties": False,
                },
                "RunActionRequest": {
                    "type": "object",
                    "required": ["action", "lane"],
                    "properties": {
                        "action": {"type": "string"},
                        "payload": {"type": "object", "additionalProperties": True},
                        "lane": {"type": "string", "enum": ["read", "write", "destructive"]},
                        "confirm": {"type": "boolean", "default": False},
                        "idempotencyKey": {"type": "string", "maxLength": 128},
                        "operatorToken": {"type": "string", "writeOnly": True},
                    },
                    "additionalProperties": False,
                    "x-max-batch-items": MAX_ACTION_BATCH_ITEMS,
                },
                "SaveRecipeRequest": {
                    "type": "object",
                    "required": ["recipeId", "recipe", "confirm", "idempotencyKey"],
                    "properties": {
                        "recipeId": {"type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$"},
                        "recipe": {"$ref": "#/components/schemas/RecipeDefinition"},
                        "confirm": {"const": True},
                        "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 128},
                    },
                    "additionalProperties": False,
                },
                "PlanRecipeRequest": {
                    "type": "object",
                    "required": ["recipeId"],
                    "properties": {
                        "recipeId": {"type": "string"},
                        "inputs": {"type": "object", "additionalProperties": True},
                    },
                    "additionalProperties": False,
                },
                "RecipeDefinition": {
                    "type": "object",
                    "required": ["name", "steps"],
                    "properties": {
                        "name": {"type": "string", "minLength": 1, "maxLength": 160},
                        "description": {"type": "string", "maxLength": 1200},
                        "inputSchema": {"type": "object"},
                        "steps": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": 24,
                            "items": {"$ref": "#/components/schemas/RecipeStep"},
                        },
                    },
                    "additionalProperties": False,
                },
                "RecipeStep": {
                    "type": "object",
                    "required": ["id", "tool", "arguments"],
                    "properties": {
                        "id": {"type": "string"},
                        "tool": {"type": "string"},
                        "arguments": {"type": "object", "additionalProperties": True},
                        "approval": {
                            "type": "string",
                            "enum": ["none", "pixel-disclosure", "write", "destructive", "operator"],
                            "default": "none",
                        },
                    },
                    "additionalProperties": False,
                },
                "DeleteRecipeRequest": {
                    "type": "object",
                    "required": ["confirm", "idempotencyKey"],
                    "properties": {
                        "confirm": {"const": True},
                        "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 128},
                    },
                    "additionalProperties": False,
                },
            },
        },
    }
