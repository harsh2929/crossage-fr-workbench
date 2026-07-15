export function semanticSearchUnavailableMessage(
  reason: string | null | undefined,
  uiText: (source: string) => string,
): string {
  const normalized = String(reason || "").trim().toLowerCase();
  if (normalized.includes("disabled") || normalized.includes("engine=off") || normalized.includes("turned off")) {
    return uiText("On-device AI search is turned off.");
  }
  if (
    normalized.includes("model")
    || normalized.includes("install")
    || normalized.includes("siglip")
    || normalized.includes("not found")
  ) {
    return uiText("On-device AI search is not installed. Add the AI search model in Settings.");
  }
  return uiText("On-device AI search is unavailable right now.");
}
