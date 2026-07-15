export interface PhotoSearchHighlightPart {
  text: string;
  match: boolean;
}

function foldWithOriginalOffsets(value: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    const original = codePoint === undefined ? value[index] : String.fromCodePoint(codePoint);
    const next = index + original.length;
    const foldedSegment = original.toLocaleLowerCase();
    for (let offset = 0; offset < foldedSegment.length; offset += 1) {
      starts.push(index);
      ends.push(next);
    }
    folded += foldedSegment;
    index = next;
  }
  return { folded, starts, ends };
}

export function buildPhotoSearchHighlightParts(value: unknown, query: unknown): PhotoSearchHighlightPart[] {
  const text = String(value ?? "");
  const needle = String(query ?? "").trim();
  if (!text || needle.length < 2) return text ? [{ text, match: false }] : [];
  const { folded: foldedText, starts, ends } = foldWithOriginalOffsets(text);
  const foldedNeedle = foldWithOriginalOffsets(needle).folded;
  const parts: PhotoSearchHighlightPart[] = [];
  let foldedCursor = 0;
  let originalCursor = 0;
  while (foldedCursor < foldedText.length) {
    const index = foldedText.indexOf(foldedNeedle, foldedCursor);
    if (index < 0) break;
    const originalStart = starts[index] ?? text.length;
    const originalEnd = ends[index + foldedNeedle.length - 1] ?? originalStart;
    if (originalEnd <= originalStart) break;
    if (originalStart > originalCursor) parts.push({ text: text.slice(originalCursor, originalStart), match: false });
    parts.push({ text: text.slice(originalStart, originalEnd), match: true });
    originalCursor = originalEnd;
    foldedCursor = index + foldedNeedle.length;
  }
  if (originalCursor < text.length) parts.push({ text: text.slice(originalCursor), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
