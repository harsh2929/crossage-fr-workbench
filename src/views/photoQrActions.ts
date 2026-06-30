export type PhotoQrActionKind = "url" | "email" | "phone" | "contact" | "text" | "sms" | "wifi" | "geo";

export interface PhotoQrAction {
  kind: PhotoQrActionKind;
  label: string;
  copyLabel: string;
  value: string;
  href?: string;
  confidence?: string;
}

export interface PhotoQrActionInput {
  assetMetadata?: Record<string, unknown> | null;
}

export interface PhotoQrRegionInput extends PhotoQrActionInput {
  width?: number | null;
  height?: number | null;
}

export interface PhotoQrRegion {
  id: string;
  text: string;
  type: string;
  source: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: string;
}

const QR_PAYLOAD_KEYS = new Set([
  "qrtext",
  "qrvalue",
  "qrpayload",
  "barcodetext",
  "barcodevalue",
  "barcodepayload",
  "decodedtext",
  "decodedvalue",
  "rawvalue",
  "payload",
  "text",
  "value",
  "url",
  "email",
  "phone",
  "tel",
  "contact",
]);

function cleanQrText(value: unknown): string {
  return String(value || "").replace(/\0/g, "").trim().slice(0, 2000);
}

function cleanQrNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value || "").trim());
  return Number.isFinite(number) ? number : null;
}

function cleanQrConfidence(value: unknown): string {
  const number = cleanQrNumber(value);
  if (number === null) {
    const text = cleanQrText(value);
    return text && !/^\[object\s/i.test(text) ? text : "";
  }
  const percent = number <= 1 ? number * 100 : number;
  if (!Number.isFinite(percent) || percent < 0) return "";
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

function collectQrPayloads(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string" || typeof value === "number") {
    const clean = cleanQrText(value);
    return clean ? [clean] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectQrPayloads(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const payloads: string[] = [];
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase();
      if (QR_PAYLOAD_KEYS.has(normalizedKey)) {
        payloads.push(...collectQrPayloads(item, depth + 1));
      } else if (["qrcodes", "qrcode", "barcodes", "barcode", "detectedcodes", "detecteditems"].includes(normalizedKey)) {
        payloads.push(...collectQrPayloads(item, depth + 1));
      }
    });
    return payloads;
  }
  return [];
}

function qrConfidenceFromMetadata(metadata: Record<string, unknown>): string {
  for (const key of ["qrConfidence", "barcodeConfidence", "confidence"]) {
    const confidence = cleanQrConfidence(metadata[key]);
    if (confidence) return confidence;
  }
  return "";
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function qrRegionText(record: Record<string, unknown>): string {
  for (const key of ["text", "value", "payload", "rawValue", "decodedText", "qrText", "barcodeText", "url", "email", "phone", "contact", "label"]) {
    const text = cleanQrText(record[key]).replace(/\s+/g, " ").slice(0, 240);
    if (text) return text;
  }
  return "";
}

function qrRegionConfidence(record: Record<string, unknown>, fallback: string): string {
  for (const key of ["confidence", "score", "probability", "qrConfidence", "barcodeConfidence"]) {
    const confidence = cleanQrConfidence(record[key]);
    if (confidence) return confidence;
  }
  return fallback;
}

function numericBoundsFromArray(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const numbers = value.slice(0, 4).map(cleanQrNumber);
  if (numbers.some((number) => number === null)) return null;
  return numbers as [number, number, number, number];
}

function numericBoundsFromRecord(record: Record<string, unknown>): [number, number, number, number] | null {
  const x = cleanQrNumber(record.x ?? record.left ?? record.l);
  const y = cleanQrNumber(record.y ?? record.top ?? record.t);
  let width = cleanQrNumber(record.width ?? record.w);
  let height = cleanQrNumber(record.height ?? record.h);
  const right = cleanQrNumber(record.right ?? record.r);
  const bottom = cleanQrNumber(record.bottom ?? record.b);
  if (width === null && x !== null && right !== null) width = right - x;
  if (height === null && y !== null && bottom !== null) height = bottom - y;
  return x === null || y === null || width === null || height === null ? null : [x, y, width, height];
}

function qrBoundsCandidate(value: unknown): [number, number, number, number] | null {
  const record = objectRecord(value);
  if (!record) return numericBoundsFromArray(value);
  const nested = ["bounds", "boundingBox", "bbox", "box", "rect", "frame"]
    .map((key) => qrBoundsCandidate(record[key]))
    .find(Boolean);
  return nested || numericBoundsFromRecord(record) || numericBoundsFromArray(record.bbox || record.box || record.boundingBox);
}

function qrBoundsToPercent(
  bounds: [number, number, number, number],
  record: Record<string, unknown>,
  mediaWidth: number,
  mediaHeight: number,
): Pick<PhotoQrRegion, "x" | "y" | "width" | "height"> | null {
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
  return { x: left, y: top, width: cleanWidth, height: cleanHeight };
}

function collectQrRegionCandidates(
  value: unknown,
  mediaWidth: number,
  mediaHeight: number,
  fallbackConfidence: string,
  depth = 0,
): PhotoQrRegion[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectQrRegionCandidates(item, mediaWidth, mediaHeight, fallbackConfidence, depth + 1));
  }
  const record = objectRecord(value);
  if (!record) return [];
  const text = qrRegionText(record);
  const bounds = qrBoundsCandidate(record);
  const percentBounds = bounds ? qrBoundsToPercent(bounds, record, mediaWidth, mediaHeight) : null;
  const direct = text && percentBounds ? [{
    id: "",
    text,
    type: cleanQrText(record.type || record.kind || record.format) || "QR Code",
    source: cleanQrText(record.source) || "",
    confidence: qrRegionConfidence(record, fallbackConfidence),
    ...percentBounds,
  }] : [];
  const nested = Object.entries(record)
    .filter(([key]) => !["bounds", "boundingBox", "bbox", "box", "rect", "frame"].includes(key))
    .flatMap(([, item]) => collectQrRegionCandidates(item, mediaWidth, mediaHeight, fallbackConfidence, depth + 1));
  return [...direct, ...nested];
}

function normalizeUrl(value: string): string {
  const text = value.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^www\./i.test(text)) return `https://${text}`;
  return "";
}

function normalizeEmail(value: string): string {
  const text = value.trim();
  if (/^mailto:/i.test(text)) return text.slice(7).trim();
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] || "";
}

function normalizePhone(value: string): string {
  const text = value.trim();
  if (/^tel:/i.test(text)) return text.slice(4).trim();
  const match = text.match(/\+?[0-9][0-9()\s.-]{6,}[0-9]/);
  return match?.[0]?.replace(/\s+/g, " ").trim() || "";
}

function actionForQrPayload(value: string, confidence: string): PhotoQrAction | null {
  const clean = cleanQrText(value);
  if (!clean) return null;
  const url = normalizeUrl(clean);
  if (url) {
    return { kind: "url", label: "Open URL", copyLabel: "Copy URL", value: url, href: url, confidence };
  }
  const email = normalizeEmail(clean);
  if (email) {
    return { kind: "email", label: "Email", copyLabel: "Copy email", value: email, href: `mailto:${email}`, confidence };
  }
  const phone = normalizePhone(clean);
  if (phone) {
    return { kind: "phone", label: "Phone", copyLabel: "Copy phone", value: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}`, confidence };
  }
  if (/^(begin:vcard|mecard:)/i.test(clean)) {
    return { kind: "contact", label: "Contact", copyLabel: "Copy contact", value: clean, confidence };
  }
  return { kind: "text", label: "QR text", copyLabel: "Copy text", value: clean, confidence };
}

function emailAction(email: string, confidence: string): PhotoQrAction {
  return { kind: "email", label: "Email", copyLabel: "Copy email", value: email, href: `mailto:${email}`, confidence };
}

function phoneAction(phone: string, confidence: string): PhotoQrAction {
  return { kind: "phone", label: "Phone", copyLabel: "Copy phone", value: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}`, confidence };
}

// Split a vCard payload into trimmed lines, tolerating real CRLF/LF newlines as
// well as the literal "\n" separators some QR encoders emit.
function vcardLines(raw: string): string[] {
  return raw.split(/\r\n|\r|\n|\\n/).map((line) => line.trim()).filter(Boolean);
}

// vCard structured name "Family;Given;Additional;Prefix;Suffix" -> "Given Family".
function vcardStructuredName(value: string): string {
  const parts = value.split(";").map((part) => part.trim());
  return [parts[1] || "", parts[0] || ""].filter(Boolean).join(" ").trim();
}

// Emit discrete call/email actions for an extracted contact, followed by a
// named "Copy contact" action whose value stays the raw card (back-compatible
// with the prior single-contact behaviour).
function buildContactActions(name: string, tels: string[], emails: string[], raw: string, confidence: string): PhotoQrAction[] {
  const actions: PhotoQrAction[] = [];
  const seenTel = new Set<string>();
  tels.forEach((tel) => {
    const key = tel.replace(/[^\d+]/g, "");
    if (!key || seenTel.has(key)) return;
    seenTel.add(key);
    actions.push(phoneAction(tel, confidence));
  });
  const seenEmail = new Set<string>();
  emails.forEach((email) => {
    const key = email.toLocaleLowerCase();
    if (seenEmail.has(key)) return;
    seenEmail.add(key);
    actions.push(emailAction(email, confidence));
  });
  actions.push({
    kind: "contact",
    label: name ? `Contact: ${name}` : "Contact",
    copyLabel: "Copy contact",
    value: cleanQrText(raw),
    confidence,
  });
  return actions;
}

function parseVCardActions(raw: string, confidence: string): PhotoQrAction[] {
  let fnName = "";
  let nName = "";
  const tels: string[] = [];
  const emails: string[] = [];
  vcardLines(raw).forEach((line) => {
    const fn = line.match(/^FN(?:;[^:]*)?:(.+)$/i);
    if (fn) {
      if (!fnName) fnName = fn[1].trim();
      return;
    }
    const n = line.match(/^N(?:;[^:]*)?:(.+)$/i);
    if (n) {
      if (!nName) nName = vcardStructuredName(n[1]);
      return;
    }
    const tel = line.match(/^TEL(?:;[^:]*)?:(.+)$/i);
    if (tel) {
      const phone = normalizePhone(tel[1]);
      if (phone) tels.push(phone);
      return;
    }
    const email = line.match(/^EMAIL(?:;[^:]*)?:(.+)$/i);
    if (email) {
      const value = normalizeEmail(email[1]);
      if (value) emails.push(value);
    }
  });
  return buildContactActions(fnName || nName, tels, emails, raw, confidence);
}

function parseMeCardActions(raw: string, confidence: string): PhotoQrAction[] {
  let name = "";
  const tels: string[] = [];
  const emails: string[] = [];
  raw.replace(/^mecard:/i, "").split(";").forEach((field) => {
    const match = field.match(/^([A-Z]+):(.*)$/i);
    if (!match) return;
    const key = match[1].toLocaleUpperCase();
    const value = match[2].trim();
    if (!value) return;
    if (key === "N") {
      if (!name) {
        const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
        name = parts.length > 1 ? `${parts[1]} ${parts[0]}` : parts[0];
      }
    } else if (key === "TEL") {
      const phone = normalizePhone(value);
      if (phone) tels.push(phone);
    } else if (key === "EMAIL") {
      const email = normalizeEmail(value);
      if (email) emails.push(email);
    }
  });
  return buildContactActions(name, tels, emails, raw, confidence);
}

function parseWifiAction(raw: string, confidence: string): PhotoQrAction | null {
  const body = raw.replace(/^wifi:/i, "");
  const field = (key: string): string => {
    const match = body.match(new RegExp(`(?:^|;)${key}:((?:\\\\.|[^;])*)`, "i"));
    return match ? match[1].replace(/\\(.)/g, "$1").trim() : "";
  };
  const ssid = field("S");
  const password = field("P");
  const encryption = field("T");
  if (!ssid && !password) return null;
  const label = ssid ? `Wi-Fi: ${ssid}` : "Wi-Fi network";
  if (!password || /^nopass$/i.test(encryption)) {
    return { kind: "wifi", label, copyLabel: "Copy network name", value: ssid, confidence };
  }
  return { kind: "wifi", label, copyLabel: "Copy Wi-Fi password", value: password, confidence };
}

function parseSmsAction(raw: string, confidence: string): PhotoQrAction | null {
  const body = raw.replace(/^(smsto:|sms:)/i, "");
  const phone = normalizePhone(body.split(/[:?;]/)[0].trim());
  if (!phone) return null;
  return { kind: "sms", label: "Message", copyLabel: "Copy number", value: phone, href: `sms:${phone.replace(/[^\d+]/g, "")}`, confidence };
}

function parseGeoAction(raw: string, confidence: string): PhotoQrAction | null {
  const parts = raw.replace(/^geo:/i, "").split("?")[0].trim().split(",").map((part) => part.trim());
  if (cleanQrNumber(parts[0]) === null || cleanQrNumber(parts[1]) === null) return null;
  return {
    kind: "geo",
    label: "Open in Maps",
    copyLabel: "Copy coordinates",
    value: `${parts[0]}, ${parts[1]}`,
    href: `geo:${parts[0]},${parts[1]}`,
    confidence,
  };
}

// Structured-scheme dispatch runs BEFORE the generic url/email/phone fallback so
// a scheme payload (vCard/MECARD/WIFI/sms/geo) is never misread as a bare email
// or phone number embedded in its body.
function actionsForQrPayload(value: string, confidence: string): PhotoQrAction[] {
  const clean = cleanQrText(value);
  if (!clean) return [];
  if (/^begin:vcard/i.test(clean)) return parseVCardActions(clean, confidence);
  if (/^mecard:/i.test(clean)) return parseMeCardActions(clean, confidence);
  if (/^wifi:/i.test(clean)) {
    const wifi = parseWifiAction(clean, confidence);
    if (wifi) return [wifi];
  }
  if (/^(smsto:|sms:)/i.test(clean)) {
    const sms = parseSmsAction(clean, confidence);
    if (sms) return [sms];
  }
  if (/^geo:/i.test(clean)) {
    const geo = parseGeoAction(clean, confidence);
    if (geo) return [geo];
  }
  const single = actionForQrPayload(clean, confidence);
  return single ? [single] : [];
}

export function buildPhotoQrActions(item: PhotoQrActionInput | null | undefined): PhotoQrAction[] {
  const metadata = item?.assetMetadata;
  if (!metadata || typeof metadata !== "object") return [];
  const confidence = qrConfidenceFromMetadata(metadata);
  const payloads = [
    ...collectQrPayloads(metadata.qrText),
    ...collectQrPayloads(metadata.barcodeText),
    ...collectQrPayloads(metadata.decodedText),
    ...collectQrPayloads(metadata.qrCodes),
    ...collectQrPayloads(metadata.barcodes),
    ...collectQrPayloads(metadata.detectedCodes),
  ];
  const actions: PhotoQrAction[] = [];
  const seen = new Set<string>();
  payloads.forEach((payload) => {
    actionsForQrPayload(payload, confidence).forEach((action) => {
      const key = `${action.kind}:${action.value.toLocaleLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      actions.push(action);
    });
  });
  return actions.slice(0, 4);
}

export function buildPhotoQrRegions(item: PhotoQrRegionInput | null | undefined): PhotoQrRegion[] {
  const metadata = item?.assetMetadata;
  if (!metadata || typeof metadata !== "object") return [];
  const mediaWidth = Math.max(0, Number(item?.width || metadata.width || metadata.imageWidth || metadata.pixelWidth || 0) || 0);
  const mediaHeight = Math.max(0, Number(item?.height || metadata.height || metadata.imageHeight || metadata.pixelHeight || 0) || 0);
  const fallbackConfidence = qrConfidenceFromMetadata(metadata);
  const seen = new Set<string>();
  const regions = [
    metadata.qrRegions,
    metadata.barcodeRegions,
    metadata.qrCodes,
    metadata.barcodes,
    metadata.detectedCodes,
  ]
    .flatMap((value) => collectQrRegionCandidates(value, mediaWidth, mediaHeight, fallbackConfidence))
    .filter((region) => {
      const key = `${region.text.toLocaleLowerCase()}:${region.x.toFixed(2)}:${region.y.toFixed(2)}:${region.width.toFixed(2)}:${region.height.toFixed(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 40);
  return regions.map((region, index) => ({ ...region, id: `qr-region-${index}` }));
}
