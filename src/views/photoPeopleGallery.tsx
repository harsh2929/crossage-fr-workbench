import { EyeOff, Pencil, RefreshCcw, ShieldCheck, Star, Tag, UserPlus, Users } from "lucide-react";
import type { ReactNode } from "react";

import type { PhotoFolder } from "../types";
import { photoCoverCropStyle } from "./photoCoverCrops";
import type { PhotoPeopleGalleryState } from "./photoGroupReview";

type PhotoPeopleGalleryText = (value: string) => string;
type PhotoPeopleSectionRequest = (section: "enroll" | "review") => void;

export type PhotoPeopleGalleryProps = {
  state: PhotoPeopleGalleryState;
  loading: boolean;
  busy: boolean;
  renamingPersonId: string;
  renameDrafts: Record<string, string>;
  uiText: PhotoPeopleGalleryText;
  formatCount: (count: number) => string;
  onOpenFolder: (folderId: string) => void;
  onStartRename: (folder: PhotoFolder) => void;
  onRenameDraftChange: (folderId: string, value: string) => void;
  onCancelRename: () => void;
  onCommitRename: (folder: PhotoFolder) => void | Promise<void>;
  onToggleFavoritePerson: (folder: PhotoFolder) => void | Promise<void>;
  onToggleFavoritePet: (folder: PhotoFolder) => void | Promise<void>;
  onToggleFavoriteGroup: (folder: PhotoFolder) => void | Promise<void>;
  onHidePerson: (folder: PhotoFolder) => void | Promise<void>;
  onHidePet: (folder: PhotoFolder) => void | Promise<void>;
  onHideGroup: (folder: PhotoFolder) => void | Promise<void>;
  onFindDuplicates: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onRequestPeopleSection?: PhotoPeopleSectionRequest;
  relationshipPanel?: ReactNode;
};

export function PhotoPeopleGallery(props: PhotoPeopleGalleryProps) {
  const { namedPeople, pets, groups, unknownClusters, petReviewFolder, favoritePeople, favoritePets, reviewPending, hasAny } = props.state;

  const circle = (folder: PhotoFolder, kind: "person" | "pet" | "group") => {
    const favorite = kind === "person" ? folder.personProfile?.favorite
      : kind === "pet" ? folder.petProfile?.favorite : folder.groupProfile?.favorite;
    const renaming = kind === "person" && props.renamingPersonId === folder.id;
    const subLabel = kind === "pet" ? String(folder.petKindLabel || "").trim() : "";
    return (
      <div className="people-circle-card" key={folder.id}>
        <button type="button" className="people-circle-cover-btn" onClick={() => props.onOpenFolder(folder.id)} aria-label={`${props.uiText("Open")} ${folder.name}`}>
          <span className={favorite ? "people-circle-cover favorite" : "people-circle-cover"}>
            {folder.coverPreviewUrl ? <img src={folder.coverPreviewUrl} alt="" loading="lazy" decoding="async" style={photoCoverCropStyle(folder.coverCrop)} /> : <Users size={26} />}
          </span>
        </button>
        <div className="people-circle-meta">
          {renaming ? (
            <input
              className="people-circle-rename"
              autoFocus
              value={props.renameDrafts[folder.id] ?? folder.name}
              onChange={(event) => props.onRenameDraftChange(folder.id, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void props.onCommitRename(folder);
                else if (event.key === "Escape") props.onCancelRename();
              }}
              onBlur={() => void props.onCommitRename(folder)}
              aria-label={`${props.uiText("Rename")} ${folder.name}`}
            />
          ) : kind === "person" ? (
            <button type="button" className="people-circle-name" onClick={() => props.onStartRename(folder)} title={props.uiText("Rename")}>{folder.name}</button>
          ) : (
            <strong className="people-circle-name-static">{folder.name}</strong>
          )}
          <small>{subLabel ? `${subLabel} · ` : ""}{props.formatCount(folder.count)} {folder.count === 1 ? props.uiText("photo") : props.uiText("photos")}</small>
        </div>
        <div className="people-circle-actions">
          <button
            type="button"
            className={favorite ? "icon-action active" : "icon-action"}
            aria-pressed={Boolean(favorite)}
            title={favorite ? props.uiText("Unfavorite") : props.uiText("Favorite")}
            aria-label={`${favorite ? props.uiText("Unfavorite") : props.uiText("Favorite")} ${folder.name}`}
            onClick={() => {
              if (kind === "person") void props.onToggleFavoritePerson(folder);
              else if (kind === "pet") void props.onToggleFavoritePet(folder);
              else void props.onToggleFavoriteGroup(folder);
            }}
          >
            <Star size={15} fill={favorite ? "currentColor" : "none"} />
          </button>
          {kind === "person" && (
            <button type="button" className="icon-action" title={props.uiText("Rename")} aria-label={`${props.uiText("Rename")} ${folder.name}`} onClick={() => props.onStartRename(folder)}>
              <Pencil size={15} />
            </button>
          )}
          <button
            type="button"
            className="icon-action"
            title={props.uiText("Hide")}
            aria-label={`${props.uiText("Hide")} ${folder.name}`}
            onClick={() => {
              if (kind === "person") void props.onHidePerson(folder);
              else if (kind === "pet") void props.onHidePet(folder);
              else void props.onHideGroup(folder);
            }}
          >
            <EyeOff size={15} />
          </button>
        </div>
      </div>
    );
  };

  if (!hasAny && props.loading) {
    return (
      <div className="photos-people-gallery people-gallery-loading" role="status" aria-live="polite" aria-busy="true">
        <span>{props.uiText("Preparing people and pets…")}</span>
        <div className="people-circle-grid" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="people-circle-card people-circle-skeleton" key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (!hasAny) {
    return (
      <div className="people-gallery-empty">
        <Users size={30} />
        <strong>{props.uiText("Add the people and pets you love")}</strong>
        <span>{props.uiText("Name a few faces and Vintrace groups every photo of them — privately, on your device.")}</span>
        {props.onRequestPeopleSection && (
          <button type="button" className="primary" onClick={() => props.onRequestPeopleSection?.("enroll")}><UserPlus size={16} /><span>{props.uiText("Add someone")}</span></button>
        )}
      </div>
    );
  }

  return (
    <div className="photos-people-gallery">
      <div className="people-gallery-head">
        <div className="people-gallery-title">
          <strong>{props.uiText("People & Pets")}</strong>
          <span className="people-gallery-summary">
            {props.formatCount(namedPeople.length)} {namedPeople.length === 1 ? props.uiText("person") : props.uiText("people")} · {props.formatCount(pets.length)} {pets.length === 1 ? props.uiText("pet") : props.uiText("pets")}
          </span>
        </div>
        <div className="people-gallery-actions">
          {props.onRequestPeopleSection && <button type="button" className="primary albums-new-control" onClick={() => props.onRequestPeopleSection?.("enroll")}><UserPlus size={15} /><span>{props.uiText("Add someone")}</span></button>}
          {props.onRequestPeopleSection && <button type="button" className="secondary compact-action people-review-btn" onClick={() => props.onRequestPeopleSection?.("review")}><ShieldCheck size={15} /><span>{props.uiText("Review matches")}</span>{reviewPending > 0 ? <span className="people-review-badge">{props.formatCount(reviewPending)}</span> : null}</button>}
          <button type="button" className="ghost compact-action" onClick={() => void props.onFindDuplicates()} disabled={props.busy}><Users size={15} /><span>{props.uiText("Find duplicates")}</span></button>
          <button type="button" className="ghost compact-action" onClick={() => void props.onRefresh()} disabled={props.busy}><RefreshCcw size={15} /><span>{props.uiText("Refresh")}</span></button>
        </div>
      </div>
      {props.relationshipPanel}
      {favoritePeople.length + favoritePets.length > 0 && (
        <section className="people-section" aria-label={props.uiText("Favorites")}>
          <div className="people-section-head"><Star size={16} /><strong>{props.uiText("Favorites")}</strong></div>
          <div className="people-circle-grid reveal-stagger">{favoritePeople.map((folder) => circle(folder, "person"))}{favoritePets.map((folder) => circle(folder, "pet"))}</div>
        </section>
      )}
      {namedPeople.length > 0 && (
        <section className="people-section" aria-label={props.uiText("People")}>
          <div className="people-section-head"><Users size={16} /><strong>{props.uiText("People")}</strong></div>
          <div className="people-circle-grid reveal-stagger">{namedPeople.map((folder) => circle(folder, "person"))}</div>
        </section>
      )}
      {pets.length > 0 && (
        <section className="people-section" aria-label={props.uiText("Pets")}>
          <div className="people-section-head"><Tag size={16} /><strong>{props.uiText("Pets")}</strong></div>
          <div className="people-circle-grid reveal-stagger">{pets.map((folder) => circle(folder, "pet"))}</div>
        </section>
      )}
      {(unknownClusters.length > 0 || Boolean(petReviewFolder && petReviewFolder.count > 0)) && (
        <section className="people-section people-to-name-band" aria-label={props.uiText("More people to name")}>
          <div className="people-section-head"><UserPlus size={16} /><strong>{props.uiText("More people to name")}</strong></div>
          <div className="people-circle-grid reveal-stagger">
            {petReviewFolder && petReviewFolder.count > 0 ? (
              <div className="people-circle-card to-name" key="petReview">
                <button type="button" className="people-circle-cover-btn" onClick={() => props.onOpenFolder(petReviewFolder.id)} aria-label={props.uiText("Review pets")}>
                  <span className="people-circle-cover">{petReviewFolder.coverPreviewUrl ? <img src={petReviewFolder.coverPreviewUrl} alt="" loading="lazy" decoding="async" style={photoCoverCropStyle(petReviewFolder.coverCrop)} /> : <Tag size={26} />}</span>
                </button>
                <div className="people-circle-meta"><strong className="people-circle-name-static">{petReviewFolder.name}</strong><small>{props.formatCount(petReviewFolder.count)} {props.uiText("to review")}</small></div>
              </div>
            ) : null}
            {unknownClusters.map((folder) => (
              <div className="people-circle-card to-name" key={folder.id}>
                <button type="button" className="people-circle-cover-btn" onClick={() => props.onOpenFolder(folder.id)} aria-label={`${props.uiText("Name")} ${folder.name}`}>
                  <span className="people-circle-cover">{folder.coverPreviewUrl ? <img src={folder.coverPreviewUrl} alt="" loading="lazy" decoding="async" style={photoCoverCropStyle(folder.coverCrop)} /> : <Users size={26} />}</span>
                </button>
                <div className="people-circle-meta"><strong className="people-circle-name-static">{folder.name}</strong><small>{props.formatCount(folder.count)} {folder.count === 1 ? props.uiText("photo") : props.uiText("photos")}</small></div>
                <div className="people-circle-actions">
                  <button type="button" className="icon-action" title={props.uiText("Name")} aria-label={`${props.uiText("Name")} ${folder.name}`} onClick={() => props.onOpenFolder(folder.id)}><Tag size={15} /></button>
                  {props.onRequestPeopleSection && <button type="button" className="icon-action" title={props.uiText("Review")} aria-label={`${props.uiText("Review")} ${folder.name}`} onClick={() => props.onRequestPeopleSection?.("review")}><ShieldCheck size={15} /></button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {groups.length > 0 && (
        <section className="people-section" aria-label={props.uiText("People Together")}>
          <div className="people-section-head"><Users size={16} /><strong>{props.uiText("People Together")}</strong></div>
          <div className="people-circle-grid reveal-stagger">{groups.map((folder) => circle(folder, "group"))}</div>
        </section>
      )}
    </div>
  );
}
