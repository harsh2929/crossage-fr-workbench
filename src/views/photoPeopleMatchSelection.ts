import type { PhotoItem } from "../types";

export type PhotoPeopleMatchCorrectionScope =
  | { kind: "all" }
  | { kind: "person"; personName: string }
  | { kind: "group"; memberPeople: string[]; excludePeople?: string[] };

function cleanPeopleMatchKey(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function addCandidateId(ids: string[], seen: Set<string>, value: unknown) {
  const candidateId = String(value ?? "").trim();
  if (!candidateId || seen.has(candidateId)) return;
  seen.add(candidateId);
  ids.push(candidateId);
}

function peopleScopePredicate(scope: PhotoPeopleMatchCorrectionScope): ((personName: unknown) => boolean) | null {
  if (scope.kind === "all") return null;
  if (scope.kind === "person") {
    const personKey = cleanPeopleMatchKey(scope.personName);
    return (personName) => Boolean(personKey && cleanPeopleMatchKey(personName) === personKey);
  }
  const included = new Set((scope.memberPeople || []).map(cleanPeopleMatchKey).filter(Boolean));
  const excluded = new Set((scope.excludePeople || []).map(cleanPeopleMatchKey).filter(Boolean));
  return (personName) => {
    const key = cleanPeopleMatchKey(personName);
    return Boolean(key && included.has(key) && !excluded.has(key));
  };
}

export function photoPeopleMatchCorrectionCandidateIds(
  items: Array<Pick<PhotoItem, "candidateIds" | "people">>,
  scope: PhotoPeopleMatchCorrectionScope = { kind: "all" }
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const predicate = peopleScopePredicate(scope);
  for (const item of items) {
    const people = Array.isArray(item.people) ? item.people : [];
    if (!predicate && !people.length) {
      for (const candidateId of item.candidateIds || []) addCandidateId(ids, seen, candidateId);
      continue;
    }
    for (const person of people) {
      if (person.assetOnly) continue;
      if (predicate && !predicate(person.personName)) continue;
      addCandidateId(ids, seen, person.candidateId);
    }
  }
  return ids;
}
