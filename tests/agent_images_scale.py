from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import time

from crossage_fr.agent_images import AgentImageService
from crossage_fr.api_server import DesktopApi
from photo_scale_smoke import seed_photo_library


def env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def timed(callable_value):
    started = time.perf_counter()
    value = callable_value()
    return value, round((time.perf_counter() - started) * 1000, 2)


def main() -> None:
    count = env_int("VINTRACE_AGENT_IMAGE_SCALE_ASSETS", 10_000)
    with tempfile.TemporaryDirectory(prefix="vintrace-agent-image-scale-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        registry = str(root / "registry")
        os.environ["VINTRACE_REGISTRY_HOME"] = registry
        os.environ["CROSSAGE_REGISTRY_HOME"] = registry
        os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"

        api = DesktopApi(workspace, actor="agent-image-scale")
        seed_ms = round(seed_photo_library(api, count), 2)

        def validate_path(value: str) -> Path:
            resolved = Path(value).expanduser().resolve()
            resolved.relative_to(root.resolve())
            return resolved

        service, service_init_ms = timed(
            lambda: AgentImageService(
                api,
                workspace=workspace,
                require_consent=lambda: None,
                validate_path=validate_path,
            )
        )
        overview, overview_ms = timed(lambda: service.library_overview())
        page, search_ms = timed(
            lambda: service.search(
                query="",
                mode="lexical",
                filters={"favoriteOnly": True, "mediaKind": "image"},
                limit=100,
            )
        )
        asset_ids = [
            str(item.get("assetId", "") or "")
            for item in page.get("data", {}).get("items", [])
            if str(item.get("assetId", "") or "")
        ]
        fetched, fetch_ms = timed(lambda: service.fetch_assets(asset_ids))
        serialized = json.dumps({"overview": overview, "search": page, "fetch": fetched})

        budgets = {
            "serviceInitMs": 1000.0,
            "overviewMs": 500.0,
            "searchMs": 1500.0,
            "fetch100Ms": 1000.0,
        }
        metrics = {
            "seedMs": seed_ms,
            "serviceInitMs": service_init_ms,
            "overviewMs": overview_ms,
            "searchMs": search_ms,
            "fetch100Ms": fetch_ms,
        }
        checks = [
            {"name": name, "ok": metrics[name] <= limit, "valueMs": metrics[name], "budgetMs": limit}
            for name, limit in budgets.items()
        ]
        checks.extend(
            [
                {
                    "name": "overview count",
                    "ok": int(overview.get("data", {}).get("assetCount", 0)) == count,
                    "value": overview.get("data", {}).get("assetCount"),
                },
                {
                    "name": "bounded page",
                    "ok": 0 < len(asset_ids) <= 100,
                    "value": len(asset_ids),
                },
                {
                    "name": "stable-ID hydration",
                    "ok": len(fetched.get("data", {}).get("items", [])) == len(asset_ids),
                    "value": len(fetched.get("data", {}).get("items", [])),
                },
                {
                    "name": "no source path disclosure",
                    "ok": "/synthetic/no-photo-used" not in serialized,
                    "value": "redacted",
                },
            ]
        )
        result = {
            "ok": all(check["ok"] for check in checks),
            "assets": count,
            "metrics": metrics,
            "budgets": budgets,
            "checks": checks,
        }
        print(json.dumps(result, indent=2))
        if not result["ok"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
