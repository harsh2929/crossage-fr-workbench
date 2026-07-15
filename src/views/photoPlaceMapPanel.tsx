import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Layers, MapPin, SlidersHorizontal, ZoomIn, ZoomOut } from "lucide-react";

import {
  PHOTO_PLACE_MAP_CLUSTER_RADII,
  buildPhotoPlaceMapPinOffsets,
  type NearbyPhotoPlace,
  type PhotoPlaceMapCluster,
  type PhotoPlaceMapDensityCell,
  type PhotoPlaceMapMode,
  type PhotoPlaceMapPoint,
  type PhotoPlaceMapRadiusOverlay,
} from "./photoPlacesMap";

type PhotoPlaceMapPanelText = (value: string) => string;
type PhotoPlaceMapPanelCount = (value: number) => string;

export type PhotoPlaceMapPanelProps = {
  points: readonly PhotoPlaceMapPoint[];
  mode: PhotoPlaceMapMode;
  zoomLevel: number;
  visibleClusters: readonly PhotoPlaceMapCluster[];
  densityCells: readonly PhotoPlaceMapDensityCell[];
  densityAreas: readonly PhotoPlaceMapDensityCell[];
  radiusOverlay: PhotoPlaceMapRadiusOverlay | null;
  radiusPlaces: readonly NearbyPhotoPlace[];
  activeFolderId: string;
  activePlaceNearby: readonly NearbyPhotoPlace[];
  uiText: PhotoPlaceMapPanelText;
  formatCount: PhotoPlaceMapPanelCount;
  onModeChange: (mode: PhotoPlaceMapMode) => void;
  onZoomLevelChange: (zoomLevel: number) => void;
  onOpenPlace: (folderId: string) => void;
};

export function PhotoPlaceMapPanel(props: PhotoPlaceMapPanelProps) {
  const canZoomOut = props.zoomLevel > 1;
  const canZoomIn = props.zoomLevel < PHOTO_PLACE_MAP_CLUSTER_RADII.length;
  const placeCount = props.points.length;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      setCanvasSize((current) => current.width === width && current.height === height
        ? current
        : { width, height });
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const pinOffsets = useMemo(
    () => buildPhotoPlaceMapPinOffsets(props.visibleClusters, canvasSize),
    [canvasSize, props.visibleClusters],
  );

  return (
    <section className="photo-place-map-panel" aria-label={props.uiText("Places map")}>
      <div className="photo-place-map-head">
        <span>
          <MapPin size={15} />
          <strong>{props.uiText("Places map")}</strong>
        </span>
        <div className="photo-place-map-controls">
          <small>
            {props.formatCount(placeCount)} {placeCount === 1 ? props.uiText("place") : props.uiText("places")}
            {props.mode === "density" && props.densityCells.length < placeCount ? ` · ${props.formatCount(props.densityCells.length)} ${props.uiText("areas")}` : ""}
            {props.mode !== "density" && props.visibleClusters.length < placeCount ? ` · ${props.formatCount(props.visibleClusters.length)} ${props.uiText("pins")}` : ""}
          </small>
          <div className="photo-segmented-control photo-place-map-mode-control" aria-label={props.uiText("Map mode")}>
            <button type="button" className={props.mode === "pins" ? "active" : ""} onClick={() => props.onModeChange("pins")} title={props.uiText("Pins")}>
              <MapPin size={12} />
              <span>{props.uiText("Pins")}</span>
            </button>
            <button type="button" className={props.mode === "clusters" ? "active" : ""} onClick={() => props.onModeChange("clusters")} title={props.uiText("Clusters")}>
              <Layers size={12} />
              <span>{props.uiText("Clusters")}</span>
            </button>
            <button type="button" className={props.mode === "density" ? "active" : ""} onClick={() => props.onModeChange("density")} title={props.uiText("Density")}>
              <SlidersHorizontal size={12} />
              <span>{props.uiText("Density")}</span>
            </button>
          </div>
          <button type="button" className="secondary compact-action" onClick={() => props.onZoomLevelChange(Math.max(1, props.zoomLevel - 1))} disabled={!canZoomOut} aria-label={props.uiText("Zoom out")} title={props.uiText("Zoom out")}>
            <ZoomOut size={13} />
          </button>
          <span className="photo-place-map-zoom">{props.zoomLevel}x</span>
          <button type="button" className="secondary compact-action" onClick={() => props.onZoomLevelChange(Math.min(PHOTO_PLACE_MAP_CLUSTER_RADII.length, props.zoomLevel + 1))} disabled={!canZoomIn} aria-label={props.uiText("Zoom in")} title={props.uiText("Zoom in")}>
            <ZoomIn size={13} />
          </button>
        </div>
      </div>
      <div className="photo-place-map-canvas" ref={canvasRef}>
        {props.radiusOverlay && (
          <div
            className="photo-place-map-radius"
            role="img"
            aria-label={`${props.uiText("Nearby radius")} ${Math.round(props.radiusOverlay.radiusKm)} km`}
            style={{
              left: `${props.radiusOverlay.x}%`,
              top: `${props.radiusOverlay.y}%`,
              width: `${props.radiusOverlay.radiusX * 2}%`,
              height: `${props.radiusOverlay.radiusY * 2}%`,
            }}
          >
            <span>{Math.round(props.radiusOverlay.radiusKm)} km</span>
          </div>
        )}
        {props.mode === "density" ? props.densityCells.map((cell) => {
          const activeCell = cell.points.some((cellPoint) => cellPoint.folderId === props.activeFolderId);
          const densityStyle = {
            left: `${cell.x}%`,
            top: `${cell.y}%`,
            zIndex: Math.round(cell.intensity * 10),
            "--photo-place-density-size": `${cell.radius}px`,
            "--photo-place-density-ring": `${Math.round(7 + cell.intensity * 15)}px`,
          } as CSSProperties;
          const title = `${props.formatCount(cell.placeCount)} ${cell.placeCount === 1 ? props.uiText("place") : props.uiText("places")} · ${props.formatCount(cell.photoCount)} ${cell.photoCount === 1 ? props.uiText("photo") : props.uiText("photos")} · ${cell.points.slice(0, 4).map((cellPoint) => cellPoint.name).join(", ")}`;
          return (
            <button
              key={cell.cellId}
              type="button"
              className={activeCell ? "photo-place-map-density active" : "photo-place-map-density"}
              style={densityStyle}
              onClick={() => props.onOpenPlace(cell.representative.folderId)}
              aria-label={`${props.uiText("Open dense place area near")} ${cell.representative.name}`}
              title={title}
            >
              <span>{Math.min(99, Math.max(1, cell.photoCount))}</span>
            </button>
          );
        }) : props.visibleClusters.map((cluster) => {
          const point = cluster.representative;
          const clustered = cluster.placeCount > 1;
          const activePoint = cluster.points.some((clusterPoint) => clusterPoint.folderId === props.activeFolderId);
          const dotClassName = [
            "photo-place-map-dot",
            cluster.coverPreviewUrl ? "has-cover" : "",
            clustered ? "clustered" : "",
            activePoint ? "active" : "",
          ].filter(Boolean).join(" ");
          const title = clustered
            ? `${props.formatCount(cluster.placeCount)} ${props.uiText("places")} · ${props.formatCount(cluster.photoCount)} ${props.uiText("photos")} · ${cluster.points.slice(0, 4).map((clusterPoint) => clusterPoint.name).join(", ")}`
            : `${point.name} · ${props.formatCount(point.count)} ${point.count === 1 ? props.uiText("photo") : props.uiText("photos")}`;
          const pinZIndex = activePoint
            ? 7
            : 2 + Math.min(4, Math.ceil(Math.log2(Math.max(1, cluster.photoCount) + 1)));
          const pinOffset = pinOffsets[cluster.clusterId] || { offsetX: 0, offsetY: 0 };
          const pinStyle = {
            left: `calc(${cluster.x}% + ${pinOffset.offsetX}px)`,
            top: `calc(${cluster.y}% + ${pinOffset.offsetY}px)`,
            zIndex: pinZIndex,
          } as CSSProperties;
          return (
            <button
              key={cluster.clusterId}
              type="button"
              className={dotClassName}
              style={pinStyle}
              onClick={() => props.onOpenPlace(point.folderId)}
              aria-label={`${clustered ? props.uiText("Open clustered places near") : props.uiText("Open place")} ${point.name}`}
              title={title}
            >
              {cluster.coverPreviewUrl ? <img src={cluster.coverPreviewUrl} alt="" loading="lazy" decoding="async" /> : null}
              <span>{Math.min(99, Math.max(1, cluster.photoCount))}</span>
            </button>
          );
        })}
      </div>
      {props.radiusOverlay && (
        <div className="photo-place-map-radius-summary">
          <MapPin size={13} />
          <span>{props.uiText("Nearby radius")} {Math.round(props.radiusOverlay.radiusKm)} km</span>
          <small>{props.formatCount(props.radiusOverlay.matchedPlaceCount)} {props.radiusOverlay.matchedPlaceCount === 1 ? props.uiText("place") : props.uiText("places")} · {props.formatCount(props.radiusOverlay.matchedPhotoCount)} {props.radiusOverlay.matchedPhotoCount === 1 ? props.uiText("photo") : props.uiText("photos")}</small>
        </div>
      )}
      {props.radiusOverlay && props.radiusPlaces.length > 0 && (
        <div className="photo-place-map-radius-places" role="group" aria-label={props.uiText("Places in radius")}>
          <strong>{props.uiText("Places in radius")}</strong>
          <div>
            {props.radiusPlaces.map((point) => (
              <button key={point.folderId} type="button" className="photo-place-map-radius-place" onClick={() => props.onOpenPlace(point.folderId)}>
                <MapPin size={13} />
                <span>{point.name}</span>
                <small>{Math.max(0, Math.round(point.distanceKm))} km · {props.formatCount(point.count)} {point.count === 1 ? props.uiText("photo") : props.uiText("photos")}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {props.mode === "density" && props.densityAreas.length > 0 && (
        <div className="photo-place-map-areas" aria-label={props.uiText("Map areas")}>
          <strong>{props.uiText("Map areas")}</strong>
          <div>
            {props.densityAreas.map((cell) => (
              <button key={cell.cellId} type="button" className="photo-place-map-area" onClick={() => props.onOpenPlace(cell.representative.folderId)}>
                <Layers size={13} />
                <span>{cell.representative.name}</span>
                <small>{props.formatCount(cell.placeCount)} {cell.placeCount === 1 ? props.uiText("place") : props.uiText("places")} · {props.formatCount(cell.photoCount)} {cell.photoCount === 1 ? props.uiText("photo") : props.uiText("photos")}</small>
                <em>{cell.points.slice(0, 3).map((cellPoint) => cellPoint.name).join(", ")}</em>
              </button>
            ))}
          </div>
        </div>
      )}
      {props.activePlaceNearby.length > 0 && (
        <div className="photo-place-nearby">
          <strong>{props.uiText("Nearby places")}</strong>
          <div>
            {props.activePlaceNearby.map((point) => (
              <button key={point.folderId} type="button" className="ghost compact-action" onClick={() => props.onOpenPlace(point.folderId)}>
                <MapPin size={13} />
                <span>{point.name}</span>
                <small>{Math.max(1, Math.round(point.distanceKm))} km</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
