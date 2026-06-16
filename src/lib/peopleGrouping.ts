// Pure people-grouping logic for the redesigned Enroll tab's people gallery.
// No React, no I/O — groups the flat reference list into per-person cards and is
// unit-tested in plain node (see tests/people_grouping.test.mjs).

import type { AgeBucket, ReferenceFace } from "../types";

// Display order for age coverage chips; "unknown" is intentionally excluded.
const AGE_ORDER: AgeBucket[] = ["child", "adolescent", "adult"];

export interface Person {
  name: string;
  photos: ReferenceFace[]; // this person's references, best quality first
  count: number;
  ageCoverage: AgeBucket[]; // present buckets, child->adult order, no "unknown"
  averageQuality: number;
}

/** Which of child/adolescent/adult are represented, in display order. */
export function ageCoverageOf(photos: ReferenceFace[]): AgeBucket[] {
  const present = new Set(photos.map((photo) => photo.ageBucket));
  return AGE_ORDER.filter((bucket) => present.has(bucket));
}

/**
 * Group a flat reference list into per-person cards. People are sorted by name
 * (case-insensitive); each person's photos are sorted best-quality first.
 */
export function groupReferencesByPerson(refs: ReferenceFace[]): Person[] {
  const byName = new Map<string, ReferenceFace[]>();
  for (const ref of refs) {
    const list = byName.get(ref.personName);
    if (list) {
      list.push(ref);
    } else {
      byName.set(ref.personName, [ref]);
    }
  }
  const people: Person[] = [];
  for (const [name, photos] of byName) {
    const sorted = [...photos].sort((a, b) => b.quality - a.quality);
    const averageQuality = sorted.reduce((sum, photo) => sum + photo.quality, 0) / sorted.length;
    people.push({
      name,
      photos: sorted,
      count: sorted.length,
      ageCoverage: ageCoverageOf(sorted),
      averageQuality,
    });
  }
  people.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return people;
}

/** Case-insensitive name filter; a blank query returns everyone. */
export function filterPeople(people: Person[], query: string): Person[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return people;
  return people.filter((person) => person.name.toLowerCase().includes(needle));
}
