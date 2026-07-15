import { execFileSync } from "node:child_process";
import path from "node:path";

export function largePhotoLibraryCount(value: string | undefined, minimum = 10_000) {
  const parsed = Number(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(minimum, Math.floor(parsed)) : minimum;
}

function runPythonSeed(projectRoot: string, env: Record<string, string>, script: string, args: string[]) {
  const candidates = [
    process.env.VINTRACE_PYTHON,
    path.join(projectRoot, ".venv", "bin", "python3"),
    "python3",
    "python",
  ].filter((value): value is string => Boolean(value));
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["-c", script, ...args], {
        cwd: projectRoot,
        env,
        stdio: "pipe",
        timeout: 300_000,
      });
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate}: ${detail}`);
    }
  }
  throw new Error(`Could not seed large photo library. ${errors.join(" | ")}`);
}

export function seedLargePhotoLibrary(
  projectRoot: string,
  env: Record<string, string>,
  workspace: string,
  count: number,
) {
  runPythonSeed(projectRoot, env, String.raw`
import json
import sys
from pathlib import Path

from crossage_fr.api_server import DesktopApi
from crossage_fr.workspace_registry import now_iso

workspace = Path(sys.argv[1])
count = int(sys.argv[2])
api = DesktopApi(workspace, actor="large-photo-library-seed")
timestamp = now_iso()
batch_size = 1000
with api.project.db.connect() as conn:
    for start in range(0, count, batch_size):
        asset_rows = []
        metadata_rows = []
        for index in range(start, min(count, start + batch_size)):
            name = f"scale-{index:05d}.jpg"
            asset_id = f"scale_asset_{index:05d}"
            source_path = f"/synthetic/no-photo-used/scale/{name}"
            capture_day = (index % 28) + 1
            capture_hour = (index // 28) % 24
            capture_minute = (index // (28 * 24)) % 60
            asset_rows.append((
                asset_id,
                source_path,
                "referenced",
                json.dumps({"pathKey": source_path, "size": 2048 + index, "mtimeNs": 1800000000000000000 + index}, separators=(",", ":")),
                f"scale-hash-{index:05d}",
                "",
                "image",
                "image/jpeg",
                1200 + (index % 7),
                900 + (index % 5),
                None,
                f"2026-06-{capture_day:02d}T{capture_hour:02d}:{capture_minute:02d}:00Z",
                timestamp,
                timestamp,
                None,
                "large-library-seed",
                json.dumps({"syntheticScale": True, "sortBucket": index % 37}, separators=(",", ":")),
            ))
            metadata_rows.append((
                asset_id,
                f"Scale photo {index:05d}",
                "Synthetic large-library row",
                1 if index % 23 == 0 else 0,
                0,
                None,
                None,
                None,
                0,
                0,
                timestamp,
            ))
        conn.executemany(
            """
            INSERT OR REPLACE INTO photo_assets(
                asset_id, source_path, source_kind, file_signature_json, content_hash,
                perceptual_hash, media_kind, mime_type, width, height, duration_ms,
                capture_date, added_at, updated_at, missing_at, source_scan_run,
                metadata_json
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            asset_rows,
        )
        conn.executemany(
            """
            INSERT OR REPLACE INTO photo_asset_metadata(
                asset_id, title, caption, favorite, hidden, deleted_at, date_override,
                location_override_json, location_hidden, edited, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            metadata_rows,
        )
`, [workspace, String(count)]);
}
