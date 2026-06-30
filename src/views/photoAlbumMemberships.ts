import type { PhotoAlbumMembership } from "../types";

export type PhotoAlbumMembershipFilter = "all" | "manual" | "smart";
export type PhotoAlbumMembershipSort = "kind" | "name" | "recent";

export interface PhotoAlbumMembershipCounts {
  all: number;
  manual: number;
  smart: number;
}

export function photoAlbumMembershipKind(membership: PhotoAlbumMembership): Exclude<PhotoAlbumMembershipFilter, "all"> {
  return membership.albumKind === "manual" && !membership.derived ? "manual" : "smart";
}

export function photoAlbumMembershipFilterCounts(memberships: PhotoAlbumMembership[] = []): PhotoAlbumMembershipCounts {
  return memberships.reduce<PhotoAlbumMembershipCounts>((counts, membership) => {
    counts.all += 1;
    counts[photoAlbumMembershipKind(membership)] += 1;
    return counts;
  }, { all: 0, manual: 0, smart: 0 });
}

function membershipName(value: PhotoAlbumMembership): string {
  return String(value.name || "").trim().toLocaleLowerCase();
}

function membershipPosition(value: PhotoAlbumMembership): number {
  const position = Number(value.position);
  return Number.isFinite(position) ? position : Number.MAX_SAFE_INTEGER;
}

function membershipAddedAt(value: PhotoAlbumMembership): number {
  const parsed = Date.parse(String(value.addedAt || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareAlbumMembershipNames(a: PhotoAlbumMembership, b: PhotoAlbumMembership): number {
  return membershipName(a).localeCompare(membershipName(b)) || a.albumId.localeCompare(b.albumId);
}

export function visiblePhotoAlbumMemberships(
  memberships: PhotoAlbumMembership[] = [],
  filter: PhotoAlbumMembershipFilter = "all",
  sort: PhotoAlbumMembershipSort = "kind",
): PhotoAlbumMembership[] {
  const rows = memberships.filter((membership) => (
    filter === "all" || photoAlbumMembershipKind(membership) === filter
  ));
  return [...rows].sort((a, b) => {
    if (sort === "name") {
      return compareAlbumMembershipNames(a, b);
    }
    if (sort === "recent") {
      return membershipAddedAt(b) - membershipAddedAt(a) || compareAlbumMembershipNames(a, b);
    }
    const aKind = photoAlbumMembershipKind(a);
    const bKind = photoAlbumMembershipKind(b);
    if (aKind !== bKind) return aKind === "manual" ? -1 : 1;
    if (aKind === "manual") {
      return membershipPosition(a) - membershipPosition(b) || compareAlbumMembershipNames(a, b);
    }
    return compareAlbumMembershipNames(a, b);
  });
}
