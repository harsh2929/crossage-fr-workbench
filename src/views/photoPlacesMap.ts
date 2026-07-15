import { parsePhotoNearbyCoordinate, type PhotoNearbyFilterState } from "./photoNearbyFilters";

export interface PhotoPlaceMapSource {
  id?: string;
  name?: string;
  count?: number;
  kind?: string;
  coverPreviewPath?: string | null;
  coverPreviewUrl?: string;
  place?: {
    label?: string;
    name?: string;
    latitude?: string | number | null;
    longitude?: string | number | null;
    source?: string;
  } | null;
}

export interface PhotoPlaceMapPoint {
  folderId: string;
  name: string;
  count: number;
  latitude: number;
  longitude: number;
  x: number;
  y: number;
  source: string;
  coverPreviewPath: string | null;
  coverPreviewUrl: string;
}

export interface NearbyPhotoPlace extends PhotoPlaceMapPoint {
  distanceKm: number;
}

export interface PhotoPlaceMapCluster {
  clusterId: string;
  points: PhotoPlaceMapPoint[];
  representative: PhotoPlaceMapPoint;
  placeCount: number;
  photoCount: number;
  x: number;
  y: number;
  coverPreviewPath: string | null;
  coverPreviewUrl: string;
}

export interface PhotoPlaceMapPinOffset {
  offsetX: number;
  offsetY: number;
}

export interface PhotoPlaceMapPinLayoutOptions {
  width?: number;
  height?: number;
  collisionDistancePx?: number;
}

export interface PhotoPlaceMapDensityCell {
  cellId: string;
  points: PhotoPlaceMapPoint[];
  representative: PhotoPlaceMapPoint;
  placeCount: number;
  photoCount: number;
  x: number;
  y: number;
  radius: number;
  intensity: number;
  coverPreviewPath: string | null;
  coverPreviewUrl: string;
}

export type PhotoPlaceMapMode = "clusters" | "pins" | "density";

export interface PhotoPlaceMapRadiusOverlay {
  latitude: number;
  longitude: number;
  radiusKm: number;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  matchedPlaceCount: number;
  matchedPhotoCount: number;
}

export interface PhotoPlaceMapRadiusCenter {
  latitude: number;
  longitude: number;
  radiusKm: number;
}

export const PHOTO_PLACE_MAP_CLUSTER_RADII = [10, 7, 4, 0] as const;

export function placeMapClusterRadius(zoomLevel: number): number {
  const index = Math.max(0, Math.min(PHOTO_PLACE_MAP_CLUSTER_RADII.length - 1, Math.round(zoomLevel) - 1));
  return PHOTO_PLACE_MAP_CLUSTER_RADII[index];
}

export function parsePhotoPlaceCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function placeProjectionBounds(points: Pick<PhotoPlaceMapPoint, "latitude" | "longitude">[]): {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
} {
  // Guard the empty case explicitly: Math.min()/Math.max() with no args return
  // +/-Infinity, which then leaks through projectCoordinate's finite-check as a
  // silent fallback. Returning a zeroed box makes the no-points case explicit.
  if (!points.length) {
    return { minLatitude: 0, maxLatitude: 0, minLongitude: 0, maxLongitude: 0 };
  }
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  return {
    minLatitude: Math.min(...latitudes),
    maxLatitude: Math.max(...latitudes),
    minLongitude: Math.min(...longitudes),
    maxLongitude: Math.max(...longitudes),
  };
}

function projectCoordinate(value: number, min: number, max: number, invert = false): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return 50;
  const raw = ((value - min) / (max - min)) * 76 + 12;
  const clamped = Math.max(12, Math.min(88, raw));
  return invert ? 100 - clamped : clamped;
}

export function buildPhotoPlaceMapPoints(folders: PhotoPlaceMapSource[]): PhotoPlaceMapPoint[] {
  const raw = folders
    .filter((folder) => folder.kind === "place")
    .map((folder) => {
      const latitude = parsePhotoPlaceCoordinate(folder.place?.latitude);
      const longitude = parsePhotoPlaceCoordinate(folder.place?.longitude);
      if (latitude === null || longitude === null) return null;
      return {
        folderId: String(folder.id || ""),
        name: String(folder.place?.label || folder.place?.name || folder.name || "Place"),
        count: Math.max(0, Number(folder.count || 0)),
        latitude,
        longitude,
        x: 50,
        y: 50,
        source: String(folder.place?.source || ""),
        coverPreviewPath: folder.coverPreviewPath || null,
        coverPreviewUrl: String(folder.coverPreviewUrl || ""),
      };
    })
    .filter((point): point is Omit<PhotoPlaceMapPoint, "x" | "y"> & { x: number; y: number } => Boolean(point && point.folderId));
  const { minLatitude, maxLatitude, minLongitude, maxLongitude } = placeProjectionBounds(raw);
  return raw
    .map((point) => ({
      ...point,
      x: projectCoordinate(point.longitude, minLongitude, maxLongitude),
      y: projectCoordinate(point.latitude, minLatitude, maxLatitude, true),
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function photoPlaceMapClusterDistance(left: Pick<PhotoPlaceMapPoint, "x" | "y">, right: Pick<PhotoPlaceMapPoint, "x" | "y">): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function buildPhotoPlaceMapCluster(points: PhotoPlaceMapPoint[]): PhotoPlaceMapCluster {
  const sortedPoints = [...points].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  const representative = sortedPoints[0];
  const photoCount = sortedPoints.reduce((total, point) => total + point.count, 0);
  const weightTotal = sortedPoints.reduce((total, point) => total + Math.max(1, point.count), 0) || 1;
  const coverPoint = sortedPoints.find((point) => point.coverPreviewUrl) || representative;
  return {
    clusterId: sortedPoints.map((point) => point.folderId).sort().join("|"),
    points: sortedPoints,
    representative,
    placeCount: sortedPoints.length,
    photoCount,
    x: sortedPoints.reduce((total, point) => total + point.x * Math.max(1, point.count), 0) / weightTotal,
    y: sortedPoints.reduce((total, point) => total + point.y * Math.max(1, point.count), 0) / weightTotal,
    coverPreviewPath: coverPoint.coverPreviewPath,
    coverPreviewUrl: coverPoint.coverPreviewUrl,
  };
}

export function buildPhotoPlaceMapClusters(points: PhotoPlaceMapPoint[], activeFolderId = "", radiusPercent = 7): PhotoPlaceMapCluster[] {
  const radius = Math.max(0, Number(radiusPercent) || 0);
  const clusters: PhotoPlaceMapCluster[] = [];
  points
    .slice()
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .forEach((point) => {
      if (point.folderId === activeFolderId || radius === 0) {
        clusters.push(buildPhotoPlaceMapCluster([point]));
        return;
      }
      const clusterIndex = clusters.findIndex((cluster) => (
        cluster.placeCount > 0 &&
        !cluster.points.some((member) => member.folderId === activeFolderId) &&
        photoPlaceMapClusterDistance(point, cluster) <= radius
      ));
      if (clusterIndex === -1) {
        clusters.push(buildPhotoPlaceMapCluster([point]));
        return;
      }
      clusters[clusterIndex] = buildPhotoPlaceMapCluster([...clusters[clusterIndex].points, point]);
    });
  return clusters.sort((left, right) => {
    const leftActive = left.points.some((point) => point.folderId === activeFolderId);
    const rightActive = right.points.some((point) => point.folderId === activeFolderId);
    return Number(leftActive) - Number(rightActive) || left.photoCount - right.photoCount || left.representative.name.localeCompare(right.representative.name);
  });
}

export function buildPhotoPlaceMapPinOffsets(
  clusters: readonly PhotoPlaceMapCluster[],
  options: PhotoPlaceMapPinLayoutOptions = {},
): Record<string, PhotoPlaceMapPinOffset> {
  const offsets: Record<string, PhotoPlaceMapPinOffset> = {};
  const ordered = [...clusters].sort((left, right) => (
    left.x - right.x
    || left.y - right.y
    || left.clusterId.localeCompare(right.clusterId)
  ));
  ordered.forEach((cluster) => {
    offsets[cluster.clusterId] = { offsetX: 0, offsetY: 0 };
  });
  const requestedWidth = Number(options.width);
  const requestedHeight = Number(options.height);
  const requestedCollisionDistance = Number(options.collisionDistancePx);
  const canvasWidth = Number.isFinite(requestedWidth) && requestedWidth > 0 ? requestedWidth : 500;
  const canvasHeight = Number.isFinite(requestedHeight) && requestedHeight > 0 ? requestedHeight : 200;
  const collisionDistance = Number.isFinite(requestedCollisionDistance) && requestedCollisionDistance > 0
    ? requestedCollisionDistance
    : 44;
  if (ordered.length < 2) return offsets;

  const groups: Array<{ anchorX: number; anchorY: number; members: PhotoPlaceMapCluster[] }> = [];
  const buckets = new Map<string, number[]>();
  ordered.forEach((cluster) => {
    const screenX = cluster.x * canvasWidth / 100;
    const screenY = cluster.y * canvasHeight / 100;
    const bucketX = Math.floor(screenX / collisionDistance);
    const bucketY = Math.floor(screenY / collisionDistance);
    let nearestGroup = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        const candidates = buckets.get(`${bucketX + xOffset}:${bucketY + yOffset}`) || [];
        candidates.forEach((groupIndex) => {
          const group = groups[groupIndex];
          const distance = Math.hypot(screenX - group.anchorX, screenY - group.anchorY);
          if (distance <= collisionDistance && distance < nearestDistance) {
            nearestGroup = groupIndex;
            nearestDistance = distance;
          }
        });
      }
    }
    if (nearestGroup >= 0) {
      groups[nearestGroup].members.push(cluster);
      return;
    }
    const groupIndex = groups.length;
    groups.push({ anchorX: screenX, anchorY: screenY, members: [cluster] });
    const bucketKey = `${bucketX}:${bucketY}`;
    buckets.set(bucketKey, [...(buckets.get(bucketKey) || []), groupIndex]);
  });

  groups.forEach((group) => {
    if (group.members.length < 2) return;
    const members = [...group.members].sort((left, right) => (
      right.photoCount - left.photoCount
      || left.representative.name.localeCompare(right.representative.name)
      || left.clusterId.localeCompare(right.clusterId)
    ));
    const radius = Math.min(64, Math.max(34, 20 / Math.sin(Math.PI / members.length)));
    const startAngle = members.length === 2 ? Math.PI : -Math.PI / 2;
    const placements = members.map((cluster, index) => {
      const angle = startAngle + (index * Math.PI * 2) / members.length;
      return {
        cluster,
        offsetX: Math.round(Math.cos(angle) * radius),
        offsetY: Math.round(Math.sin(angle) * radius),
      };
    });
    const edgeInset = 22;
    const desiredXs = placements.map(({ cluster, offsetX }) => cluster.x * canvasWidth / 100 + offsetX);
    const desiredYs = placements.map(({ cluster, offsetY }) => cluster.y * canvasHeight / 100 + offsetY);
    const fitShift = (values: number[], size: number) => {
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      let shift = minimum < edgeInset ? edgeInset - minimum : 0;
      if (maximum + shift > size - edgeInset) shift += size - edgeInset - maximum - shift;
      return shift;
    };
    const shiftX = fitShift(desiredXs, canvasWidth);
    const shiftY = fitShift(desiredYs, canvasHeight);
    placements.forEach(({ cluster, offsetX, offsetY }) => {
      offsets[cluster.clusterId] = {
        offsetX: Math.round(offsetX + shiftX),
        offsetY: Math.round(offsetY + shiftY),
      };
    });
  });
  return offsets;
}

export function buildPhotoPlaceMapDensityCells(points: PhotoPlaceMapPoint[], gridSize = 6): PhotoPlaceMapDensityCell[] {
  const size = Math.max(2, Math.min(12, Math.round(Number(gridSize) || 6)));
  const cellWidth = 100 / size;
  const buckets = new Map<string, PhotoPlaceMapPoint[]>();
  points.forEach((point) => {
    const column = Math.max(0, Math.min(size - 1, Math.floor(point.x / cellWidth)));
    const row = Math.max(0, Math.min(size - 1, Math.floor(point.y / cellWidth)));
    const cellId = `${column}:${row}`;
    const bucket = buckets.get(cellId);
    if (bucket) {
      bucket.push(point);
    } else {
      buckets.set(cellId, [point]);
    }
  });
  const cells = [...buckets.entries()].map(([cellId, cellPoints]) => {
    const sortedPoints = [...cellPoints].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
    const representative = sortedPoints[0];
    const photoCount = sortedPoints.reduce((total, point) => total + point.count, 0);
    const weightTotal = sortedPoints.reduce((total, point) => total + Math.max(1, point.count), 0) || 1;
    const coverPoint = sortedPoints.find((point) => point.coverPreviewUrl) || representative;
    return {
      cellId,
      points: sortedPoints,
      representative,
      placeCount: sortedPoints.length,
      photoCount,
      x: sortedPoints.reduce((total, point) => total + point.x * Math.max(1, point.count), 0) / weightTotal,
      y: sortedPoints.reduce((total, point) => total + point.y * Math.max(1, point.count), 0) / weightTotal,
      radius: 34,
      intensity: 0,
      coverPreviewPath: coverPoint.coverPreviewPath,
      coverPreviewUrl: coverPoint.coverPreviewUrl,
    };
  });
  const maxPhotos = Math.max(1, ...cells.map((cell) => cell.photoCount));
  return cells
    .map((cell) => {
      const intensity = Math.max(0.2, Math.min(1, cell.photoCount / maxPhotos));
      return {
        ...cell,
        intensity,
        radius: Math.round(30 + intensity * 36),
      };
    })
    .sort((left, right) => left.photoCount - right.photoCount || left.representative.name.localeCompare(right.representative.name));
}

export function photoPlaceMapDensityAreas(
  cells: readonly PhotoPlaceMapDensityCell[] | null | undefined,
  pointCount: number,
  limit = 6,
): PhotoPlaceMapDensityCell[] {
  const totalPoints = Math.max(0, Math.round(Number(pointCount) || 0));
  return [...(cells || [])]
    .filter((cell) => cell.placeCount > 1 || (cells || []).length < totalPoints)
    .sort((left, right) => right.photoCount - left.photoCount || right.placeCount - left.placeCount || left.representative.name.localeCompare(right.representative.name))
    .slice(0, Math.max(0, Math.round(limit)));
}

export function photoPlaceMapRadiusCenter(filter: PhotoNearbyFilterState | null | undefined): PhotoPlaceMapRadiusCenter | null {
  if (!filter) return null;
  const latitude = parsePhotoNearbyCoordinate(filter.latitude, -90, 90);
  const longitude = parsePhotoNearbyCoordinate(filter.longitude, -180, 180);
  const radiusKm = Number(filter.radiusKm || 25);
  if (latitude === null || longitude === null || !Number.isFinite(radiusKm)) return null;
  return { latitude, longitude, radiusKm };
}

export function buildPhotoPlaceMapRadiusOverlay(
  points: PhotoPlaceMapPoint[],
  center: PhotoPlaceMapRadiusCenter | null,
): PhotoPlaceMapRadiusOverlay | null {
  if (!center || points.length === 0) return null;
  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  const radiusKm = Number(center.radiusKm);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusKm) || radiusKm <= 0) return null;
  const { minLatitude, maxLatitude, minLongitude, maxLongitude } = placeProjectionBounds(points);
  const x = projectCoordinate(longitude, minLongitude, maxLongitude);
  const y = projectCoordinate(latitude, minLatitude, maxLatitude, true);
  const kmPerDegree = 111.32;
  const latitudeDelta = radiusKm / kmPerDegree;
  const longitudeScale = Math.max(0.12, Math.abs(Math.cos(latitude * Math.PI / 180)));
  const longitudeDelta = radiusKm / (kmPerDegree * longitudeScale);
  const xWest = projectCoordinate(longitude - longitudeDelta, minLongitude, maxLongitude);
  const xEast = projectCoordinate(longitude + longitudeDelta, minLongitude, maxLongitude);
  const yNorth = projectCoordinate(latitude + latitudeDelta, minLatitude, maxLatitude, true);
  const ySouth = projectCoordinate(latitude - latitudeDelta, minLatitude, maxLatitude, true);
  const matched = points.filter((point) => photoPlaceDistanceKm(center, point) <= radiusKm);
  return {
    latitude,
    longitude,
    radiusKm,
    x,
    y,
    radiusX: Math.max(7, Math.min(72, Math.abs(xEast - xWest) / 2)),
    radiusY: Math.max(7, Math.min(72, Math.abs(ySouth - yNorth) / 2)),
    matchedPlaceCount: matched.length,
    matchedPhotoCount: matched.reduce((total, point) => total + Math.max(0, point.count), 0),
  };
}

export function photoPlaceDistanceKm(left: Pick<PhotoPlaceMapPoint, "latitude" | "longitude">, right: Pick<PhotoPlaceMapPoint, "latitude" | "longitude">): number {
  const radiusKm = 6371;
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(right.latitude - left.latitude);
  const dLon = toRadians(right.longitude - left.longitude);
  const lat1 = toRadians(left.latitude);
  const lat2 = toRadians(right.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearbyPhotoPlaces(points: PhotoPlaceMapPoint[], activeFolderId: string, limit = 4): NearbyPhotoPlace[] {
  const active = points.find((point) => point.folderId === activeFolderId);
  if (!active) return [];
  return points
    .filter((point) => point.folderId !== active.folderId)
    .map((point) => ({ ...point, distanceKm: photoPlaceDistanceKm(active, point) }))
    .sort((left, right) => left.distanceKm - right.distanceKm || right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, Math.max(0, limit));
}

export function photoPlaceMapActiveNearby(
  points: PhotoPlaceMapPoint[],
  activeFolderId: string | null | undefined,
  limit = 4,
): NearbyPhotoPlace[] {
  return activeFolderId ? nearbyPhotoPlaces(points, activeFolderId, limit) : [];
}

export function nearbyPhotoPlacesWithinRadius(
  points: PhotoPlaceMapPoint[],
  center: PhotoPlaceMapRadiusCenter | null,
  limit = 8,
): NearbyPhotoPlace[] {
  if (!center || points.length === 0) return [];
  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  const radiusKm = Number(center.radiusKm);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusKm) || radiusKm <= 0) return [];
  const origin = { latitude, longitude };
  return points
    .map((point) => ({ ...point, distanceKm: photoPlaceDistanceKm(origin, point) }))
    .filter((point) => point.distanceKm <= radiusKm)
    .sort((left, right) => left.distanceKm - right.distanceKm || right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, Math.max(0, Math.round(limit)));
}

export function photoPlaceMapPanelVisible(
  activeId: unknown,
  activePlace: unknown,
  radiusOverlay: PhotoPlaceMapRadiusOverlay | null | undefined,
  pointCount: number,
): boolean {
  return (activeId === "places" || Boolean(activePlace) || Boolean(radiusOverlay)) && Math.max(0, Number(pointCount) || 0) > 0;
}
