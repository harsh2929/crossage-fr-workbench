"use strict";

const path = require("path");

const PHOTO_IMPORT_SOURCE_KINDS = new Set([
  "folder",
  "camera",
  "library",
  "mail",
  "safari",
  "messages",
  "airdrop",
  "downloads",
  "app",
]);

function cleanOptionalString(value) {
  const text = String(value || "").trim();
  return text || undefined;
}

function cleanPhotoImportSourceKind(value) {
  const text = String(value || "").trim().toLowerCase();
  return PHOTO_IMPORT_SOURCE_KINDS.has(text) ? text : undefined;
}

function firstQueryValue(url, names) {
  for (const name of names) {
    const value = cleanOptionalString(url.searchParams.get(name));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function protocolPhotoImportSourceDetail(url) {
  const explicit = firstQueryValue(url, ["sourceDetail", "detail"]);
  if (explicit) {
    return explicit;
  }
  const rows = [
    ["Sender", firstQueryValue(url, ["sender", "from"])],
    ["Page", firstQueryValue(url, ["pageTitle", "title"])],
    ["Source URL", firstQueryValue(url, ["sourceUrl", "pageUrl", "url", "referrer"])],
    ["App", firstQueryValue(url, ["appName", "app"])],
    ["Bundle", firstQueryValue(url, ["bundleId"])],
  ]
    .filter((row) => row[1])
    .map(([label, value]) => `${label}: ${value}`);
  return cleanOptionalString(rows.join(" | "));
}

function protocolAction(url) {
  return (url.hostname || url.pathname.replace(/^\/+/, "") || "open").toLowerCase();
}

function protocolTarget(url) {
  return url.searchParams.get("workspace") || url.searchParams.get("folder") || url.searchParams.get("path");
}

function protocolImportPaths(url) {
  return [
    ...url.searchParams.getAll("paths"),
    ...url.searchParams.getAll("path"),
    ...url.searchParams.getAll("file"),
    ...url.searchParams.getAll("folder"),
  ]
    .map((entry) => cleanOptionalString(entry))
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

function parseProtocolUrl(value, protocolScheme = "vintrace") {
  try {
    const url = new URL(value);
    if (url.protocol !== `${protocolScheme}:`) {
      return null;
    }
    const action = protocolAction(url);
    if (action === "photos-import" || action === "photo-import" || action === "import-photos") {
      const paths = [...new Set(protocolImportPaths(url))];
      if (!paths.length) {
        return { type: "show" };
      }
      const sourceKind = cleanPhotoImportSourceKind(firstQueryValue(url, ["sourceKind", "source", "sourceAppKind", "appKind"]));
      const sourceLabel = firstQueryValue(url, ["sourceLabel", "label", "appName", "sender", "from"]);
      const sourceDetail = protocolPhotoImportSourceDetail(url);
      return {
        type: "photos-import",
        paths,
        source: "protocol",
        ...(sourceKind ? { sourceKind } : {}),
        ...(sourceLabel ? { sourceLabel } : {}),
        ...(sourceDetail ? { sourceDetail } : {}),
      };
    }
    const target = protocolTarget(url);
    if (!target) {
      return { type: "show" };
    }
    const resolved = path.resolve(target);
    if (action === "open" || action === "workspace") {
      return { type: "workspace", path: resolved, source: "protocol" };
    }
    if (action === "scan") {
      return { type: "scan-folder", path: resolved, source: "protocol" };
    }
    if (action === "watch") {
      return { type: "watch-folder", path: resolved, source: "protocol" };
    }
  } catch {
    return null;
  }
  return null;
}

module.exports = {
  parseProtocolUrl,
};
