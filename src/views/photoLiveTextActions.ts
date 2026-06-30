export type PhotoLiveTextActionKind = "copy" | "url" | "email" | "phone" | "contact" | "address";

export interface PhotoLiveTextAction {
  kind: PhotoLiveTextActionKind;
  label: string;
  copyLabel: string;
  value: string;
  href?: string;
  downloadName?: string;
}

export interface PhotoLiveTextActionInput {
  assetMetadata?: Record<string, unknown> | null;
}

export interface PhotoLiveTextActionTextOptions {
  label?: string;
  copyLabel?: string;
}

export interface PhotoLiveTextRegionInput extends PhotoLiveTextActionInput {
  width?: number | null;
  height?: number | null;
}

export interface PhotoLiveTextRegion {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: string;
}

export interface PhotoLiveTextRegionStageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const LIVE_TEXT_KEYS = [
  "ocrText",
  "liveText",
  "detectedText",
  "textRegions",
  "ocrBlocks",
  "textBlocks",
];

function cleanLiveText(value: unknown): string {
  return String(value || "").replace(/\0/g, "").replace(/\s+/g, " ").trim().slice(0, 4000);
}

function collectTextValues(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string" || typeof value === "number") {
    const clean = cleanLiveText(value);
    return clean ? [clean] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextValues(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = ["text", "value", "label", "content", "transcript"].flatMap((key) => collectTextValues(record[key], depth + 1));
    if (direct.length) return direct;
    return Object.values(record).flatMap((item) => collectTextValues(item, depth + 1));
  }
  return [];
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectLiveText(item: PhotoLiveTextActionInput | null | undefined): string {
  const metadata = item?.assetMetadata;
  if (!metadata || typeof metadata !== "object") return "";
  const values = LIVE_TEXT_KEYS.flatMap((key) => collectTextValues(metadata[key]));
  return uniqueText(values).join(" ").slice(0, 4000).trim();
}

function cleanNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value || "").trim());
  return Number.isFinite(number) ? number : null;
}

function cleanConfidence(value: unknown): string {
  const number = cleanNumber(value);
  if (number === null) return "";
  const percent = number <= 1 ? number * 100 : number;
  if (!Number.isFinite(percent) || percent < 0) return "";
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

function cleanRegionText(value: unknown): string {
  return cleanLiveText(value).slice(0, 240);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function regionCandidateText(record: Record<string, unknown>): string {
  const direct = ["text", "value", "label", "content", "transcript"].map((key) => cleanRegionText(record[key])).find(Boolean);
  return direct || "";
}

function regionCandidateConfidence(record: Record<string, unknown>): string {
  return ["confidence", "score", "probability"].map((key) => cleanConfidence(record[key])).find(Boolean) || "";
}

function numericBoundsFromArray(value: unknown): [number, number, number, number] | null {
  const raw = Array.isArray(value) ? value : [];
  if (raw.length < 4) return null;
  const numbers = raw.slice(0, 4).map(cleanNumber);
  if (numbers.some((number) => number === null)) return null;
  return numbers as [number, number, number, number];
}

function numericBoundsFromRecord(record: Record<string, unknown>): [number, number, number, number] | null {
  const x = cleanNumber(record.x ?? record.left ?? record.l);
  const y = cleanNumber(record.y ?? record.top ?? record.t);
  let width = cleanNumber(record.width ?? record.w);
  let height = cleanNumber(record.height ?? record.h);
  const right = cleanNumber(record.right ?? record.r);
  const bottom = cleanNumber(record.bottom ?? record.b);
  if (width === null && x !== null && right !== null) width = right - x;
  if (height === null && y !== null && bottom !== null) height = bottom - y;
  return x === null || y === null || width === null || height === null ? null : [x, y, width, height];
}

function candidateBounds(value: unknown): [number, number, number, number] | null {
  const record = objectRecord(value);
  if (!record) return numericBoundsFromArray(value);
  const nested = ["bounds", "boundingBox", "bbox", "box", "rect", "frame"]
    .map((key) => candidateBounds(record[key]))
    .find(Boolean);
  return nested || numericBoundsFromRecord(record) || numericBoundsFromArray(record.bbox || record.box || record.boundingBox);
}

function boundsToPercent(
  bounds: [number, number, number, number],
  record: Record<string, unknown>,
  mediaWidth: number,
  mediaHeight: number,
): PhotoLiveTextRegionStageBox | null {
  let [x, y, width, height] = bounds;
  const unit = String(record.unit || record.units || record.coordinateUnit || record.coordinateSpace || "").toLocaleLowerCase();
  const maxValue = Math.max(Math.abs(x), Math.abs(y), Math.abs(width), Math.abs(height));
  const explicitPercent = unit.includes("percent") || unit === "%";
  const explicitNormalized = unit.includes("normal") || unit.includes("relative") || unit === "fraction";
  if (explicitNormalized || maxValue <= 1.5) {
    x *= 100;
    y *= 100;
    width *= 100;
    height *= 100;
  } else if (!explicitPercent && mediaWidth > 0 && mediaHeight > 0 && maxValue > 100) {
    x = (x / mediaWidth) * 100;
    width = (width / mediaWidth) * 100;
    y = (y / mediaHeight) * 100;
    height = (height / mediaHeight) * 100;
  }
  const left = Math.max(0, Math.min(100, x));
  const top = Math.max(0, Math.min(100, y));
  const right = Math.max(left, Math.min(100, x + width));
  const bottom = Math.max(top, Math.min(100, y + height));
  const cleanWidth = right - left;
  const cleanHeight = bottom - top;
  if (cleanWidth < 0.1 || cleanHeight < 0.1) return null;
  return { left, top, width: cleanWidth, height: cleanHeight };
}

function collectRegionCandidates(value: unknown, mediaWidth: number, mediaHeight: number, depth = 0): PhotoLiveTextRegion[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectRegionCandidates(item, mediaWidth, mediaHeight, depth + 1));
  const record = objectRecord(value);
  if (!record) return [];
  const text = regionCandidateText(record);
  const bounds = candidateBounds(record);
  const percentBounds = bounds ? boundsToPercent(bounds, record, mediaWidth, mediaHeight) : null;
  const direct = text && percentBounds ? [{
    id: "",
    text,
    x: percentBounds.left,
    y: percentBounds.top,
    width: percentBounds.width,
    height: percentBounds.height,
    confidence: regionCandidateConfidence(record),
  }] : [];
  const nested = Object.values(record).flatMap((item) => collectRegionCandidates(item, mediaWidth, mediaHeight, depth + 1));
  return [...direct, ...nested];
}

export function buildPhotoLiveTextRegions(item: PhotoLiveTextRegionInput | null | undefined): PhotoLiveTextRegion[] {
  const metadata = item?.assetMetadata;
  if (!metadata || typeof metadata !== "object") return [];
  const mediaWidth = Math.max(0, Number(item?.width || metadata.width || metadata.imageWidth || metadata.pixelWidth || 0) || 0);
  const mediaHeight = Math.max(0, Number(item?.height || metadata.height || metadata.imageHeight || metadata.pixelHeight || 0) || 0);
  const seen = new Set<string>();
  const regions = LIVE_TEXT_KEYS.flatMap((key) => collectRegionCandidates(metadata[key], mediaWidth, mediaHeight))
    .filter((region) => {
      const key = `${region.text.toLocaleLowerCase()}:${region.x.toFixed(2)}:${region.y.toFixed(2)}:${region.width.toFixed(2)}:${region.height.toFixed(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
  return regions.map((region, index) => ({ ...region, id: `live-text-region-${index}` }));
}

export function photoLiveTextRegionStageBox(
  region: Pick<PhotoLiveTextRegion, "x" | "y" | "width" | "height">,
  mediaWidth: number,
  mediaHeight: number,
  stageWidth: number,
  stageHeight: number,
  fitMode: "fit" | "fill" = "fit",
): PhotoLiveTextRegionStageBox | null {
  if (mediaWidth <= 0 || mediaHeight <= 0 || stageWidth <= 0 || stageHeight <= 0) {
    return {
      left: region.x,
      top: region.y,
      width: region.width,
      height: region.height,
    };
  }
  const mediaAspect = mediaWidth / mediaHeight;
  const stageAspect = stageWidth / stageHeight;
  let renderedWidth = stageWidth;
  let renderedHeight = stageHeight;
  let offsetLeft = 0;
  let offsetTop = 0;
  if (fitMode === "fill") {
    if (mediaAspect > stageAspect) {
      renderedHeight = stageHeight;
      renderedWidth = renderedHeight * mediaAspect;
      offsetLeft = (stageWidth - renderedWidth) / 2;
    } else {
      renderedWidth = stageWidth;
      renderedHeight = renderedWidth / mediaAspect;
      offsetTop = (stageHeight - renderedHeight) / 2;
    }
  } else if (mediaAspect > stageAspect) {
    renderedWidth = stageWidth;
    renderedHeight = renderedWidth / mediaAspect;
    offsetTop = (stageHeight - renderedHeight) / 2;
  } else {
    renderedHeight = stageHeight;
    renderedWidth = renderedHeight * mediaAspect;
    offsetLeft = (stageWidth - renderedWidth) / 2;
  }
  return {
    left: ((offsetLeft + renderedWidth * (region.x / 100)) / stageWidth) * 100,
    top: ((offsetTop + renderedHeight * (region.y / 100)) / stageHeight) * 100,
    width: (renderedWidth * (region.width / 100) / stageWidth) * 100,
    height: (renderedHeight * (region.height / 100) / stageHeight) * 100,
  };
}

function extractUrls(text: string): string[] {
  const matches = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) || [];
  return uniqueText(matches.map((value) => value.replace(/[),.;:!?]+$/, ""))).map((value) => (
    /^www\./i.test(value) ? `https://${value}` : value
  ));
}

function extractEmails(text: string): string[] {
  return uniqueText((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((value) => value.toLowerCase()));
}

function extractPhones(text: string): string[] {
  const matches = text.match(/\+?[0-9][0-9()\s.-]{6,}[0-9]/g) || [];
  return uniqueText(matches.map((value) => value.replace(/\s+/g, " ").trim()));
}

const STREET_SUFFIX = "(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Terrace|Ter|Way|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Square|Sq|Trail|Trl)";
const STREET_ADDRESS_RE = new RegExp(
  `\\b\\d{1,6}\\s+(?:[A-Za-z0-9.'#-]+\\s+){0,4}${STREET_SUFFIX}\\b\\.?` +
    `(?:\\s*,?\\s*(?:Suite|Ste|Apt|Unit|#)\\s*\\w+)?` +
    `(?:\\s*,\\s*[A-Za-z .'-]+)?` +
    `(?:\\s*,?\\s*[A-Z]{2}\\b)?` +
    `(?:\\s+\\d{5}(?:-\\d{4})?)?`,
  "gi",
);

// Conservative street-address detection: a leading street number plus a
// street-type suffix is required, so phone numbers, prices, and plain prose do
// not match. Optional unit/city/state/ZIP segments are captured when present.
function extractAddresses(text: string): string[] {
  const matches = text.match(STREET_ADDRESS_RE) || [];
  return uniqueText(matches.map((value) => value.replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim()))
    .filter((value) => value.length >= 6)
    .slice(0, 3);
}

function vCardEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,").trim();
}

function inferContactName(rawText: string, email: string, phone: string): string {
  const flattened = rawText.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  const leadingName = flattened.match(/^([A-Za-z][A-Za-z'. -]{1,80}?)(?:\s+(?:visit|email|call|phone|tel|mobile|www\.|https?:\/\/)\b|$)/i)?.[1]?.trim();
  if (leadingName && !/\d/.test(leadingName)) return leadingName;
  const candidates = rawText
    .replace(/\0/g, "")
    .split(/\r?\n|[|•]/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const emailLocal = email ? email.split("@")[0].replace(/[._-]+/g, " ").trim() : "";
  const first = candidates.find((line) => {
    if (line.length < 2 || line.length > 80) return false;
    if (email && line.toLocaleLowerCase().includes(email.toLocaleLowerCase())) return false;
    if (phone && line.includes(phone)) return false;
    if (/\b(?:https?:\/\/|www\.|@)\b/i.test(line)) return false;
    if (/\d{3,}/.test(line)) return false;
    if (/^(email|phone|tel|mobile|call|visit|www)\b/i.test(line)) return false;
    return /[A-Za-z]/.test(line);
  });
  return first || emailLocal || phone || "Detected contact";
}

function buildLiveTextContactVCard(rawText: string, emails: string[], phones: string[], addresses: string[] = []): string {
  if (!emails.length && !phones.length) return "";
  const name = inferContactName(rawText, emails[0] || "", phones[0] || "");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vCardEscape(name)}`];
  emails.slice(0, 3).forEach((email) => lines.push(`EMAIL:${vCardEscape(email)}`));
  phones.slice(0, 3).forEach((phone) => lines.push(`TEL:${vCardEscape(phone)}`));
  if (addresses[0]) lines.push(`ADR:;;${vCardEscape(addresses[0])};;;;`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

function liveTextVCardFilename(vcard: string): string {
  const name = vcard.match(/^FN:(.+)$/m)?.[1] || vcard.match(/^EMAIL:(.+)$/m)?.[1] || "detected-contact";
  const clean = name
    .replace(/\\([,;\\nN])/g, (_match, value: string) => value.toLowerCase() === "n" ? " " : value)
    .replace(/[^A-Za-z0-9._ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64)
    .replace(/\s+/g, "-")
    .toLowerCase();
  return `${clean || "detected-contact"}.vcf`;
}

function liveTextVCardHref(vcard: string): string {
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`;
}

export function buildPhotoLiveTextActionsForText(
  value: unknown,
  options: PhotoLiveTextActionTextOptions = {},
): PhotoLiveTextAction[] {
  const rawText = String(value || "").replace(/\0/g, "").slice(0, 4000);
  const text = cleanLiveText(value);
  if (!text) return [];
  const actions: PhotoLiveTextAction[] = [{
    kind: "copy",
    label: options.label || "Detected text",
    copyLabel: options.copyLabel || "Copy detected text",
    value: text,
  }];
  extractUrls(text).forEach((url) => {
    actions.push({ kind: "url", label: "Open detected URL", copyLabel: "Copy URL", value: url, href: url });
  });
  extractEmails(text).forEach((email) => {
    actions.push({ kind: "email", label: "Email detected address", copyLabel: "Copy email", value: email, href: `mailto:${email}` });
  });
  extractPhones(text).forEach((phone) => {
    actions.push({ kind: "phone", label: "Call detected phone", copyLabel: "Copy phone", value: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}` });
  });
  const addresses = extractAddresses(text);
  addresses.forEach((address) => {
    actions.push({ kind: "address", label: "Detected address", copyLabel: "Copy address", value: address });
  });
  const contact = buildLiveTextContactVCard(rawText, extractEmails(text), extractPhones(text), addresses);
  if (contact) {
    actions.push({
      kind: "contact",
      label: "Save contact card",
      copyLabel: "Copy contact",
      value: contact,
      href: liveTextVCardHref(contact),
      downloadName: liveTextVCardFilename(contact),
    });
  }
  return actions.slice(0, 6);
}

export function buildPhotoLiveTextActions(item: PhotoLiveTextActionInput | null | undefined): PhotoLiveTextAction[] {
  return buildPhotoLiveTextActionsForText(collectLiveText(item));
}
