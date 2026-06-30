export interface PhotoKeywordFilterCandidate {
  name?: unknown;
  count?: unknown;
  shortcut?: unknown;
}

export interface PhotoKeywordFilterOption {
  name: string;
  count: number;
  shortcut: string;
  active: boolean;
}

function cleanKeywordName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function keywordKey(value: unknown): string {
  return cleanKeywordName(value).toLocaleLowerCase();
}

export function buildPhotoKeywordFilterOptions(
  keywords: PhotoKeywordFilterCandidate[],
  activeKeyword: unknown,
  limit = 12,
): PhotoKeywordFilterOption[] {
  const activeName = cleanKeywordName(activeKeyword);
  const activeKey = keywordKey(activeName);
  const max = Math.max(1, Math.min(24, Number(limit) || 12));
  const byName = new Map<string, PhotoKeywordFilterOption>();

  keywords.forEach((keyword) => {
    const name = cleanKeywordName(keyword.name);
    const key = keywordKey(name);
    if (!key) return;
    const count = Math.max(0, Math.floor(Number(keyword.count || 0) || 0));
    const shortcut = String(keyword.shortcut || "").trim();
    const existing = byName.get(key);
    if (existing) {
      existing.count += count;
      if (!existing.shortcut && shortcut) existing.shortcut = shortcut;
      return;
    }
    byName.set(key, {
      name,
      count,
      shortcut,
      active: Boolean(activeKey && key === activeKey),
    });
  });

  if (activeName && activeKey && !byName.has(activeKey)) {
    byName.set(activeKey, {
      name: activeName,
      count: 0,
      shortcut: "",
      active: true,
    });
  }

  return [...byName.values()]
    .map((keyword) => ({ ...keyword, active: Boolean(activeKey && keywordKey(keyword.name) === activeKey) }))
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      if (right.count !== left.count) return right.count - left.count;
      return left.name.localeCompare(right.name);
    })
    .slice(0, max);
}
