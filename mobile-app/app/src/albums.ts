/**
 * Device-album helpers (real iOS albums), built on expo-media-library's Next OO API (Album/Asset).
 *
 * The phone's own PhotoKit albums — user albums + the Screenshots / Selfies smart albums — surfaced
 * alongside our client-side month groups. We only ever read album membership as a set of PHAsset ids
 * and INTERSECT it with the already-loaded camera-roll metadata (the encrypted replica), so a big
 * album never forces a second metadata pass and non-image members (videos) drop out naturally.
 *
 * These call native code whose exact behavior we can't exercise here; every call is guarded and
 * degrades to empty rather than throwing into the UI.
 */
import { Album, Asset, type AssetMetadata } from 'expo-media-library';

export interface DeviceAlbum {
  id: string;
  title: string;
  /** True for iOS smart albums (Screenshots/Selfies) — those cannot be deleted or added to. */
  smart?: boolean;
}

/** PHAsset ids from the two APIs can differ only by a `ph://` scheme prefix; normalize before matching. */
function norm(id: string): string {
  return id.replace(/^ph:\/\//, '');
}

/** System/duplicate albums we already represent ourselves (Library, Favorites) — hide from the list. */
const HIDDEN_TITLES = new Set(['Recents', 'Recently Added', 'Camera Roll', 'Favorites', 'All Photos']);

/**
 * The device albums worth showing: the Screenshots / Selfies smart albums (if present) followed by the
 * user's own albums, de-duplicated by id and with the system albums we already cover filtered out.
 */
export async function loadDeviceAlbums(): Promise<DeviceAlbum[]> {
  const out: DeviceAlbum[] = [];
  const seen = new Set<string>();

  for (const smart of ['Screenshots', 'Selfies']) {
    try {
      const a = await Album.get(smart);
      if (a && !seen.has(a.id)) {
        const title = await a.getTitle().catch(() => smart);
        out.push({ id: a.id, title: title || smart, smart: true });
        seen.add(a.id);
      }
    } catch {
      /* smart album absent — skip */
    }
  }

  try {
    const all = await Album.getAll();
    for (const a of all) {
      if (seen.has(a.id)) continue;
      let title = '';
      try {
        title = await a.getTitle();
      } catch {
        continue;
      }
      if (!title || HIDDEN_TITLES.has(title)) continue;
      out.push({ id: a.id, title, smart: false });
      seen.add(a.id);
    }
  } catch {
    /* no albums / permission — return whatever smart albums we found */
  }
  return out;
}

/** The normalized PHAsset ids contained in an album (for intersecting with the loaded roll). */
export async function albumAssetIdSet(albumId: string): Promise<Set<string>> {
  try {
    const assets = await new Album(albumId).getAssets();
    return new Set(assets.map((a) => norm(a.id)));
  } catch {
    return new Set();
  }
}

/** Filter loaded metadata to an album's members (by normalized id), preserving the input order. */
export function filterByAlbum(assets: AssetMetadata[], idSet: Set<string>): AssetMetadata[] {
  if (idSet.size === 0) return [];
  return assets.filter((a) => idSet.has(norm(a.id)));
}

/** User albums the viewer's "Add to Album" can target (id + title), newest PhotoKit order. */
export async function listUserAlbums(): Promise<DeviceAlbum[]> {
  try {
    const all = await Album.getAll();
    const titled = await Promise.all(
      all.map(async (a) => {
        const title = await a.getTitle().catch(() => '');
        return { id: a.id, title };
      }),
    );
    return titled.filter((a) => a.title && !HIDDEN_TITLES.has(a.title));
  } catch {
    return [];
  }
}

/** Add one or more photos to an existing album by id. */
export async function addAssetsToAlbum(assetIds: string[], albumId: string): Promise<void> {
  if (assetIds.length === 0) return;
  await new Album(albumId).add(assetIds.map((id) => new Asset(id)));
}

/** Create a new album seeded with one or more photos (iOS requires at least one asset to create). */
export async function createAlbumWithAssets(name: string, assetIds: string[]): Promise<void> {
  await Album.create(name, assetIds.map((id) => new Asset(id)));
}

/** Delete a user album (iOS keeps the photos in the main library; they just leave the album). */
export async function deleteAlbum(albumId: string): Promise<void> {
  await Album.delete([new Album(albumId)]);
}

/** Remove photos from an album WITHOUT deleting them from the library (iOS only). */
export async function removeAssetsFromAlbum(albumId: string, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;
  await new Album(albumId).removeAssets(assetIds.map((id) => new Asset(id)));
}
