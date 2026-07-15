import { CalendarDays, EyeOff, Play, Sparkles, Star, Video } from "lucide-react";

import type { PhotoFolder } from "../types";
import { photoCoverCropStyle } from "./photoCoverCrops";
import type { PhotoMemoriesFeedState } from "./photoCurationPreferences";

type PhotoMemoriesFeedText = (value: string) => string;
type PhotoMemoryActionEvent = { currentTarget?: EventTarget | null };

export type PhotoMemoriesFeedProps = {
  state: PhotoMemoriesFeedState<PhotoFolder>;
  loading: boolean;
  busy: boolean;
  userMemorySaving: boolean;
  userMemoryError: string;
  pendingMemoryPlayId: string;
  launchingMemoryId: string;
  memoryMovieExporting: boolean;
  canCreateMemory: boolean;
  uiText: PhotoMemoriesFeedText;
  formatCount: (count: number) => string;
  isControlSettling: (key: string) => boolean;
  onOpenMemory: (folderId: string) => void;
  onAddPhotos: () => void | Promise<void>;
  onCreateMemory: () => void | Promise<void>;
  onPlayMemory: (folder: PhotoFolder, event?: PhotoMemoryActionEvent) => void;
  onExportMemoryMovie: (folder: PhotoFolder) => void | Promise<void>;
  onToggleMemoryFavorite: (folder: PhotoFolder) => void | Promise<void>;
  onSettleControl: (key: string) => void;
  onFeatureLessMemory: (folder: PhotoFolder) => void | Promise<void>;
};

export function PhotoMemoriesFeed(props: PhotoMemoriesFeedProps) {
  const { memoryFolders, featuredMemory, onThisDayMemories, gridMemories } = props.state;
  const memoryPlayId = (folder: PhotoFolder) => folder.memoryId || folder.memory?.memoryId || folder.id;
  const isMemoryOpening = (folder: PhotoFolder) => Boolean(props.pendingMemoryPlayId) && props.pendingMemoryPlayId === memoryPlayId(folder);
  const memoryCategoryLabel = (category: string) =>
    (({
      on_this_day: props.uiText("On this day"),
      best_of_year: props.uiText("Best of year"),
      trip: props.uiText("Trip"),
      people: props.uiText("People"),
      place: props.uiText("Place"),
      year: props.uiText("Year"),
    } as Record<string, string>)[category] ?? category.replace(/_/g, " "));

  if (!memoryFolders.length) {
    if (props.loading) {
      return (
        <div className="memories-feed">
          <div className="memories-grid" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="memory-card memory-card-skeleton" />
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="memories-empty">
        <Sparkles size={30} />
        <strong>{props.uiText("Memories appear here")}</strong>
        <span>
          {props.canCreateMemory
            ? props.uiText("Choose at least two photos to create a Memory, or keep scanning and Vintrace will suggest one.")
            : props.uiText("Add at least two photos and Vintrace can turn them into a Memory.")}
        </span>
        {props.canCreateMemory ? (
          <button type="button" className="primary memories-empty-cta" onClick={() => void props.onCreateMemory()} disabled={props.busy || props.userMemorySaving}>
            <Sparkles size={16} /><span>{props.userMemorySaving ? props.uiText("Saving") : props.uiText("New Memory")}</span>
          </button>
        ) : (
          <button type="button" className="primary memories-empty-cta" onClick={() => void props.onAddPhotos()} disabled={props.busy || props.userMemorySaving}>
            <Sparkles size={16} /><span>{props.uiText("Add photos")}</span>
          </button>
        )}
        {props.userMemoryError && <small className="photo-metadata-error" role="alert">{props.userMemoryError}</small>}
      </div>
    );
  }

  const hero = featuredMemory;
  return (
    <div className="memories-feed">
      {hero && (
        <div className="memory-hero">
          <button type="button" className="memory-hero-cover" onClick={() => props.onOpenMemory(hero.id)} aria-label={`${props.uiText("Open memory")} ${hero.name}`}>
            {hero.coverPreviewUrl ? (
              <img src={hero.coverPreviewUrl} alt="" decoding="async" style={photoCoverCropStyle(hero.coverCrop)} />
            ) : (
              <Sparkles size={44} />
            )}
            <span className="memory-hero-sheen" aria-hidden="true" />
          </button>
          <div className="memory-hero-meta">
            <span className="memory-hero-kicker">{props.uiText("Featured memory")}</span>
            <strong>{hero.name}</strong>
            {hero.memory?.subtitle ? <span className="memory-hero-sub">{hero.memory.subtitle}</span> : null}
            <span className="memory-hero-stat">
              {hero.memory?.dateRangeLabel ? `${hero.memory.dateRangeLabel} · ` : ""}
              {props.formatCount(hero.count)} {hero.count === 1 ? props.uiText("photo") : props.uiText("photos")}
            </span>
            <div className="memory-hero-actions">
              <button type="button" className="primary memory-play" onClick={(event) => props.onPlayMemory(hero, event)} disabled={Boolean(props.pendingMemoryPlayId)}>
                <Play size={16} /><span>{isMemoryOpening(hero) ? props.uiText("Opening") : props.uiText("Play the movie")}</span>
              </button>
              <button type="button" className="secondary memory-export" onClick={() => void props.onExportMemoryMovie(hero)} disabled={props.busy || props.memoryMovieExporting}>
                <Video size={16} /><span>{props.memoryMovieExporting ? props.uiText("Exporting") : props.uiText("Export movie")}</span>
              </button>
              <button
                type="button"
                className={`ghost compact-action${hero.memory?.favorite ? " active" : ""}${props.isControlSettling(`memfav:${hero.id}`) ? " save-settle" : ""}`}
                aria-pressed={Boolean(hero.memory?.favorite)}
                aria-label={`${hero.memory?.favorite ? props.uiText("Unfavorite") : props.uiText("Favorite")} ${hero.name}`}
                onClick={() => {
                  void props.onToggleMemoryFavorite(hero);
                  props.onSettleControl(`memfav:${hero.id}`);
                }}
              >
                <Star size={15} fill={hero.memory?.favorite ? "currentColor" : "none"} />
                <span>{hero.memory?.favorite ? props.uiText("Unfavorite") : props.uiText("Favorite")}</span>
              </button>
              <button type="button" className="ghost compact-action" aria-label={`${props.uiText("Feature less")} ${hero.name}`} onClick={() => void props.onFeatureLessMemory(hero)}>
                <EyeOff size={15} /><span>{props.uiText("Feature less")}</span>
              </button>
            </div>
            {props.userMemoryError && <small className="photo-metadata-error" role="alert">{props.userMemoryError}</small>}
          </div>
        </div>
      )}
      {onThisDayMemories.length > 0 && (
        <section className="memories-onthisday" aria-label={props.uiText("On this day")}>
          <div className="memories-section-head"><CalendarDays size={16} /><strong>{props.uiText("On this day")}</strong></div>
          <div className="memory-strip reveal-stagger">
            {onThisDayMemories.map((folder) => (
              <button type="button" className="memory-strip-card" key={folder.id} onClick={() => props.onOpenMemory(folder.id)}>
                <span className="memory-strip-cover">{folder.coverPreviewUrl ? <img src={folder.coverPreviewUrl} alt="" loading="lazy" decoding="async" style={photoCoverCropStyle(folder.coverCrop)} /> : <Sparkles size={18} />}</span>
                <span className="memory-strip-name">{folder.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="memories-section" aria-label={props.uiText("Memories")}>
        <div className="memories-section-head">
          <Sparkles size={16} /><strong>{props.uiText("For You")}</strong>
          <button type="button" className="ghost compact-action memories-new" onClick={() => void props.onCreateMemory()} disabled={props.busy || props.userMemorySaving || !props.canCreateMemory} title={!props.canCreateMemory ? props.uiText("Add at least two photos first") : undefined}>
            <Sparkles size={14} /><span>{props.userMemorySaving ? props.uiText("Saving") : props.uiText("New Memory")}</span>
          </button>
        </div>
        {props.userMemoryError && <small className="photo-metadata-error" role="alert">{props.userMemoryError}</small>}
        {gridMemories.length > 0 && (
          <div className="memories-grid reveal-stagger">
            {gridMemories.map((folder) => (
              <div className="memory-card" key={folder.id}>
                <button type="button" className="memory-card-open" onClick={() => props.onOpenMemory(folder.id)} aria-label={`${props.uiText("Open memory")} ${folder.name}`}>
                  <span className="memory-card-cover">
                    {folder.coverPreviewUrl ? <img src={folder.coverPreviewUrl} alt="" loading="lazy" decoding="async" style={photoCoverCropStyle(folder.coverCrop)} /> : <Sparkles size={22} />}
                    <span className={`memory-card-play${props.launchingMemoryId === folder.id ? " is-launching" : ""}`} aria-hidden="true"><Play size={18} /></span>
                    {folder.memory?.category ? <span className="memory-card-pill">{memoryCategoryLabel(String(folder.memory.category))}</span> : null}
                  </span>
                  <span className="memory-card-meta">
                    <strong>{folder.name}</strong>
                    <small>{props.formatCount(folder.count)} {folder.count === 1 ? props.uiText("photo") : props.uiText("photos")}{folder.memory?.dateRangeLabel ? ` · ${folder.memory.dateRangeLabel}` : ""}</small>
                  </span>
                </button>
                <div className="memory-card-actions">
                  <button type="button" className="ghost icon-action" title={props.uiText("Play the movie")} aria-label={`${props.uiText("Play the movie")} ${folder.name}`} onClick={(event) => props.onPlayMemory(folder, event)} disabled={Boolean(props.pendingMemoryPlayId)}><Play size={15} /></button>
                  <button type="button" className="ghost icon-action" title={props.uiText("Export movie")} aria-label={`${props.uiText("Export movie")} ${folder.name}`} onClick={() => void props.onExportMemoryMovie(folder)} disabled={props.busy || props.memoryMovieExporting}><Video size={15} /></button>
                  <button type="button" className={`ghost icon-action${folder.memory?.favorite ? " active" : ""}${props.isControlSettling(`memfav:${folder.id}`) ? " save-settle" : ""}`} aria-pressed={Boolean(folder.memory?.favorite)} title={folder.memory?.favorite ? props.uiText("Unfavorite") : props.uiText("Favorite")} aria-label={`${folder.memory?.favorite ? props.uiText("Unfavorite") : props.uiText("Favorite")} ${folder.name}`} onClick={() => { void props.onToggleMemoryFavorite(folder); props.onSettleControl(`memfav:${folder.id}`); }}><Star size={15} fill={folder.memory?.favorite ? "currentColor" : "none"} /></button>
                  <button type="button" className="ghost icon-action" title={props.uiText("Feature less")} aria-label={`${props.uiText("Feature less")} ${folder.name}`} onClick={() => void props.onFeatureLessMemory(folder)}><EyeOff size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
