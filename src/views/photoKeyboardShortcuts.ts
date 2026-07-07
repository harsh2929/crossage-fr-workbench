export type PhotoKeyboardShortcut =
  | "focusSearch"
  | "selectPage"
  | "openInfo"
  | "toggleFavorite"
  | "toggleHidden"
  | "delete"
  | "mergeDuplicateGroups"
  | "toggleShortcutDiscovery";

export type PhotoImageEditKeyboardShortcut =
  | "save"
  | "rotate"
  | "cycleCrop"
  | "flipHorizontal"
  | "flipVertical";

export type PhotoVideoKeyboardShortcut =
  | "markTrimStart"
  | "markTrimEnd"
  | "scrubBackward"
  | "scrubForward"
  | "rotateVideo"
  | "resetVideoTransform";

export type PhotoShortcutDiscoveryCommand =
  | PhotoKeyboardShortcut
  | PhotoImageEditKeyboardShortcut
  | PhotoVideoKeyboardShortcut
  | "lightboxPrevious"
  | "lightboxNext"
  | "lightboxZoomIn"
  | "lightboxZoomOut"
  | "lightboxZoomReset"
  | "videoPlayPause"
  | "videoMute";

export interface PhotoShortcutDiscoveryItem {
  action: string;
  keys: string[];
  command?: PhotoShortcutDiscoveryCommand;
}

export interface PhotoShortcutDiscoveryGroup {
  id: string;
  label: string;
  items: PhotoShortcutDiscoveryItem[];
}

export const PHOTO_SHORTCUT_DISCOVERY_GROUPS: PhotoShortcutDiscoveryGroup[] = [
  {
    id: "library",
    label: "Library",
    items: [
      { action: "Search photos", keys: ["Cmd/Ctrl-F"], command: "focusSearch" },
      { action: "Select visible page", keys: ["Cmd/Ctrl-A"], command: "selectPage" },
      { action: "Open info", keys: ["Cmd/Ctrl-I"], command: "openInfo" },
      { action: "Favorite selected", keys: ["F"], command: "toggleFavorite" },
      { action: "Hide selected", keys: ["H"], command: "toggleHidden" },
      { action: "Delete selected", keys: ["Delete", "Backspace"], command: "delete" },
      { action: "Merge duplicate groups", keys: ["Cmd/Ctrl-Enter"], command: "mergeDuplicateGroups" },
      { action: "Show shortcuts", keys: ["?"], command: "toggleShortcutDiscovery" },
    ],
  },
  {
    id: "lightbox",
    label: "Lightbox",
    items: [
      { action: "Previous photo", keys: ["Left Arrow"], command: "lightboxPrevious" },
      { action: "Next photo", keys: ["Right Arrow"], command: "lightboxNext" },
      { action: "Zoom in", keys: ["+", "="], command: "lightboxZoomIn" },
      { action: "Zoom out", keys: ["-"], command: "lightboxZoomOut" },
      { action: "Reset zoom", keys: ["0"], command: "lightboxZoomReset" },
      { action: "Play or pause video", keys: ["Space"], command: "videoPlayPause" },
      { action: "Mute video", keys: ["M"], command: "videoMute" },
      { action: "Mark video trim start", keys: ["["], command: "markTrimStart" },
      { action: "Mark video trim end", keys: ["]"], command: "markTrimEnd" },
      { action: "Scrub video backward", keys: ["Shift-Left Arrow"], command: "scrubBackward" },
      { action: "Scrub video forward", keys: ["Shift-Right Arrow"], command: "scrubForward" },
      { action: "Rotate video export", keys: ["R"], command: "rotateVideo" },
      { action: "Reset video transform", keys: ["Shift-R"], command: "resetVideoTransform" },
    ],
  },
  {
    id: "edit",
    label: "Image Edit",
    items: [
      { action: "Save edit", keys: ["Cmd/Ctrl-S"], command: "save" },
      { action: "Rotate image", keys: ["R"], command: "rotate" },
      { action: "Cycle crop", keys: ["C"], command: "cycleCrop" },
      { action: "Flip horizontal", keys: ["X"], command: "flipHorizontal" },
      { action: "Flip vertical", keys: ["Y"], command: "flipVertical" },
    ],
  },
];

export interface PhotoKeyboardEventLike {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

export interface PhotoImageEditKeyboardContext {
  canEdit?: boolean;
  hasActiveEdit?: boolean;
  saving?: boolean;
}

export interface PhotoVideoKeyboardContext {
  canEdit?: boolean;
  hasTransform?: boolean;
}

export interface PhotoKeywordShortcutCandidate {
  name: string;
  shortcut?: string | null;
}

export function isPhotoShortcutTypingTarget(target: unknown): boolean {
  const node = target as {
    tagName?: unknown;
    type?: unknown;
    isContentEditable?: unknown;
    closest?: unknown;
  } | null | undefined;
  if (!node || typeof node !== "object") return false;
  const tagName = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  if (tagName === "input") {
    const inputType = typeof node.type === "string" ? node.type.toLowerCase() : "text";
    return !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(inputType);
  }
  if (["textarea", "select"].includes(tagName)) return true;
  if (node.isContentEditable === true) return true;
  if (typeof node.closest === "function") {
    return Boolean(node.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
  }
  return false;
}

export function photoShortcutForKeyboardEvent(event: PhotoKeyboardEventLike): PhotoKeyboardShortcut | null {
  const key = String(event.key || "");
  const normalized = key.toLowerCase();
  const command = Boolean(event.metaKey || event.ctrlKey);
  const typing = isPhotoShortcutTypingTarget(event.target);
  if (command && !event.altKey && normalized === "f") return "focusSearch";
  if (typing) return null;
  if (command && !event.altKey && normalized === "a") return "selectPage";
  if (command && !event.altKey && normalized === "i") return "openInfo";
  if (command && !event.altKey && key === "Enter") return "mergeDuplicateGroups";
  if (!command && !event.altKey && (key === "?" || (event.shiftKey && normalized === "/"))) return "toggleShortcutDiscovery";
  if (command || event.altKey || event.shiftKey) return null;
  if (normalized === "f") return "toggleFavorite";
  if (normalized === "h") return "toggleHidden";
  if (key === "Delete" || key === "Backspace") return "delete";
  return null;
}

export function photoImageEditShortcutForKeyboardEvent(
  event: PhotoKeyboardEventLike,
  context: PhotoImageEditKeyboardContext = {}
): PhotoImageEditKeyboardShortcut | null {
  if (isPhotoShortcutTypingTarget(event.target)) return null;
  if (!context.canEdit || context.saving) return null;
  const key = String(event.key || "");
  const normalized = key.toLowerCase();
  const command = Boolean(event.metaKey || event.ctrlKey);
  if (command && !event.altKey && !event.shiftKey && normalized === "s" && context.hasActiveEdit) return "save";
  if (command || event.altKey || event.shiftKey || event.repeat) return null;
  if (normalized === "r") return "rotate";
  if (normalized === "c") return "cycleCrop";
  if (normalized === "x") return "flipHorizontal";
  if (normalized === "y") return "flipVertical";
  return null;
}

export function photoVideoShortcutForKeyboardEvent(
  event: PhotoKeyboardEventLike,
  context: PhotoVideoKeyboardContext = {}
): PhotoVideoKeyboardShortcut | null {
  if (isPhotoShortcutTypingTarget(event.target)) return null;
  if (!context.canEdit) return null;
  const key = String(event.key || "");
  const code = String(event.code || "");
  const normalized = key.toLowerCase();
  const command = Boolean(event.metaKey || event.ctrlKey);
  if (command || event.altKey || event.repeat) return null;
  if (!event.shiftKey && (key === "[" || code === "BracketLeft")) return "markTrimStart";
  if (!event.shiftKey && (key === "]" || code === "BracketRight")) return "markTrimEnd";
  if (event.shiftKey && key === "ArrowLeft") return "scrubBackward";
  if (event.shiftKey && key === "ArrowRight") return "scrubForward";
  if (!event.shiftKey && normalized === "r") return "rotateVideo";
  if (event.shiftKey && normalized === "r" && context.hasTransform) return "resetVideoTransform";
  return null;
}

export function normalizePhotoKeywordShortcut(value: unknown): string {
  const raw = String(value || "")
    .trim()
    .replace(/⌘/g, " mod ")
    .replace(/⇧/g, " shift ")
    .replace(/⌥/g, " alt ")
    .replace(/⌃/g, " ctrl ");
  if (!raw) return "";
  const tokens = raw
    .toLowerCase()
    .replace(/\b(command|cmd|meta)\b/g, " mod ")
    .replace(/\b(control|ctrl)\b/g, " ctrl ")
    .replace(/\b(option|opt|alternate)\b/g, " alt ")
    .replace(/\bshift\b/g, " shift ")
    .split(/[\s+_-]+/)
    .map((token) => normalizePhotoKeywordShortcutKey(token))
    .filter(Boolean);
  const modifiers = new Set<string>();
  const keys: string[] = [];
  tokens.forEach((token) => {
    if (token === "mod") {
      modifiers.add("mod");
      return;
    }
    if (token === "ctrl") {
      modifiers.add("mod");
      return;
    }
    if (token === "alt" || token === "shift") {
      modifiers.add(token);
      return;
    }
    keys.push(token);
  });
  const key = keys[keys.length - 1] || "";
  if (!key || ["mod", "alt", "shift", "ctrl"].includes(key)) return "";
  const ordered = ["mod", "alt", "shift"].filter((modifier) => modifiers.has(modifier));
  return [...ordered, key].join("+");
}

export function photoKeywordShortcutForKeyboardEvent(event: PhotoKeyboardEventLike): string {
  if (isPhotoShortcutTypingTarget(event.target)) return "";
  const key = normalizePhotoKeywordShortcutKey(event.key);
  if (!key || ["mod", "alt", "shift", "ctrl"].includes(key)) return "";
  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) modifiers.push("mod");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  return [...modifiers, key].join("+");
}

export function resolvePhotoKeywordShortcut(
  keywords: PhotoKeywordShortcutCandidate[],
  event: PhotoKeyboardEventLike
): PhotoKeywordShortcutCandidate | null {
  const eventShortcut = photoKeywordShortcutForKeyboardEvent(event);
  if (!eventShortcut) return null;
  return keywords.find((keyword) => (
    Boolean(String(keyword.name || "").trim())
    && normalizePhotoKeywordShortcut(keyword.shortcut) === eventShortcut
  )) || null;
}

function normalizePhotoKeywordShortcutKey(value: unknown): string {
  const raw = String(value || "");
  if (raw === " ") return "space";
  const key = raw.trim().toLowerCase();
  if (!key) return "";
  if (key === "spacebar") return "space";
  if (key === "esc") return "escape";
  if (key === "return") return "enter";
  if (key === "arrowup" || key === "up") return "arrowup";
  if (key === "arrowdown" || key === "down") return "arrowdown";
  if (key === "arrowleft" || key === "left") return "arrowleft";
  if (key === "arrowright" || key === "right") return "arrowright";
  if (key === "cmd" || key === "command" || key === "meta") return "mod";
  if (key === "control") return "ctrl";
  if (key === "option" || key === "opt" || key === "alternate") return "alt";
  if (/^key[a-z]$/.test(key)) return key.slice(3);
  if (/^digit[0-9]$/.test(key)) return key.slice(5);
  return key.length === 1 ? key : key.replace(/\s+/g, "");
}
