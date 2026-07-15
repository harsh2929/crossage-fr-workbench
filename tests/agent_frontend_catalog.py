from __future__ import annotations

import json
from pathlib import Path
import tempfile

from crossage_fr.agent_images import AgentImageService
from crossage_fr.agent_openapi import agent_images_openapi_spec
from crossage_fr.agent_recipes import BUILTIN_RECIPES
from crossage_fr.api_server import DesktopApi


HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head", "trace"}


def main() -> None:
    root = Path.cwd()
    catalog = json.loads((root / "mcp" / "agent-platform.json").read_text(encoding="utf-8"))
    manifest = json.loads((root / "mcp" / "manifest.json").read_text(encoding="utf-8"))
    spec = agent_images_openapi_spec()

    with tempfile.TemporaryDirectory(prefix="vintrace-agent-frontend-") as tmp:
        workspace = Path(tmp) / "workspace"
        service = AgentImageService(
            DesktopApi(workspace, actor="agent-frontend-catalog"),
            workspace=workspace,
            require_consent=lambda: None,
            validate_path=lambda value: Path(value).expanduser().resolve(),
        )
        action_count = service.capabilities(include_actions=False)["data"]["actionCount"]

    operation_count = sum(
        1
        for path_item in spec["paths"].values()
        for method in path_item
        if method.lower() in HTTP_METHODS
    )
    expected_counts = {
        "imageActions": action_count,
        "mcpTools": len(manifest["tools"]),
        "prompts": len(manifest.get("prompts", [])),
        "apiOperations": operation_count,
        "builtInRecipes": len(BUILTIN_RECIPES),
    }
    assert catalog["schemaVersion"] == 1
    assert catalog["counts"] == expected_counts, (catalog["counts"], expected_counts)

    frontend_recipes = catalog["recipes"]
    backend_recipes = {recipe["recipeId"]: recipe for recipe in BUILTIN_RECIPES}
    assert {recipe["id"] for recipe in frontend_recipes} == set(backend_recipes)
    for recipe in frontend_recipes:
        backend = backend_recipes[recipe["id"]]
        assert recipe["name"] == backend["name"]
        assert recipe["description"] and recipe["approval"]

    groups = catalog["capabilityGroups"]
    assert len(groups) >= 6 and len({group["id"] for group in groups}) == len(groups)
    for group in groups:
        assert group["title"] and group["description"] and len(group["examples"]) >= 3

    platform_features = catalog["platformFeatures"]
    assert {feature["id"] for feature in platform_features} == {
        "reach", "inbound-connectors", "visual-review", "operations", "identity"
    }
    assert all(feature["title"] and feature["description"] for feature in platform_features)

    print(
        "ok frontend agent catalog matches "
        f"{action_count} actions, {len(manifest['tools'])} tools, {operation_count} API operations, "
        f"and {len(BUILTIN_RECIPES)} built-in recipes"
    )


if __name__ == "__main__":
    main()
