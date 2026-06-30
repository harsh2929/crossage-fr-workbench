export interface PhotoSearchHighlightPart {
  text: string;
  match: boolean;
}

export function buildPhotoSearchHighlightParts(value: unknown, query: unknown): PhotoSearchHighlightPart[] {
  const text = String(value ?? "");
  const needle = String(query ?? "").trim();
  if (!text || needle.length < 2) return text ? [{ text, match: false }] : [];
  const foldedText = text.toLocaleLowerCase();
  const foldedNeedle = needle.toLocaleLowerCase();
  const parts: PhotoSearchHighlightPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const index = foldedText.indexOf(foldedNeedle, cursor);
    if (index < 0) break;
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    parts.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
