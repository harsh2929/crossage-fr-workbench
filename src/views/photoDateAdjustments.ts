const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PhotoDateTimeDraft {
  date: string;
  time: string;
  timezone: string;
}

export function parsePhotoDateOffsetDays(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-36500, Math.min(36500, Math.round(parsed)));
}

export function shiftPhotoDateByDays(value: unknown, offsetDays: unknown): string {
  const raw = String(value || "").trim();
  const days = parsePhotoDateOffsetDays(offsetDays);
  if (!raw || !days || !/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(raw)) return "";
  const dateOnly = raw.length <= 10;
  const parsed = new Date(dateOnly ? `${raw}T00:00:00Z` : normalizeIsoLikeDate(raw));
  if (!Number.isFinite(parsed.getTime())) return "";
  const shifted = new Date(parsed.getTime() + days * MS_PER_DAY);
  const iso = shifted.toISOString();
  return dateOnly ? iso.slice(0, 10) : iso;
}

function normalizeIsoLikeDate(value: string): string {
  const normalized = value.replace(" ", "T");
  if (/[zZ]$/.test(normalized) || /[+-]\d{2}:?\d{2}$/.test(normalized)) return normalized;
  return `${normalized}Z`;
}

export function splitPhotoDateTimeOverride(value: unknown): PhotoDateTimeDraft {
  const raw = String(value || "").trim();
  const date = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { date: "", time: "", timezone: "" };
  const timeMatch = raw.match(/[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?/);
  const zoneMatch = raw.match(/(Z|[+-]\d{2}:?\d{2})$/i);
  return {
    date,
    time: normalizePhotoTimeDraft(timeMatch?.[1] || ""),
    timezone: normalizePhotoTimezoneOffset(zoneMatch?.[1] || ""),
  };
}

export function composePhotoDateTimeOverride(date: unknown, time?: unknown, timezone?: unknown): string {
  const cleanDate = String(date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return "";
  const cleanTime = normalizePhotoTimeDraft(time);
  if (!cleanTime) return cleanDate;
  const cleanZone = normalizePhotoTimezoneOffset(timezone);
  return `${cleanDate}T${cleanTime}:00${cleanZone}`;
}

export function normalizePhotoDateTimeOverride(value: unknown): string {
  const draft = splitPhotoDateTimeOverride(value);
  return composePhotoDateTimeOverride(draft.date, draft.time, draft.timezone);
}

export function applyPhotoTimezoneCorrection(value: unknown, timezone: unknown): string {
  const cleanZone = normalizePhotoTimezoneOffset(timezone);
  if (!cleanZone) return "";
  const draft = splitPhotoDateTimeOverride(value);
  if (!draft.date || !draft.time) return "";
  return composePhotoDateTimeOverride(draft.date, draft.time, cleanZone);
}

export function normalizePhotoTimeDraft(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return "";
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function normalizePhotoTimezoneOffset(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(z|utc|gmt)$/i.test(raw)) return "Z";
  const match = raw.match(/^([+-])(\d{1,2}):?(\d{2})$/);
  if (!match) return "";
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 14 || minutes > 59) return "";
  if (hours === 14 && minutes !== 0) return "";
  return `${match[1]}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
