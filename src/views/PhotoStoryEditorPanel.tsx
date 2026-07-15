import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Download,
  Film,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  PhotoStory,
  PhotoStoryExportValue,
  PhotoStoryStatus,
  PhotoStoryStyle,
} from "../types";
import type { PhotoSlideshowProject } from "./photoSlideshowProjects";


type invokeValue<T> = Promise<{ value: T }>;

interface PhotoStoryEditorPanelProps {
  memoryId: string;
  memoryName: string;
  memoryCount: number;
  busy: boolean;
  uiText: (value: string) => string;
  photoStoryStatus: (params?: Record<string, unknown>) => invokeValue<PhotoStoryStatus>;
  photoStories: (params?: Record<string, unknown>) => invokeValue<{ stories: PhotoStory[]; total: number; memoryId?: string; offline: boolean }>;
  generatePhotoStory: (params: Record<string, unknown>) => invokeValue<{ story: PhotoStory; idempotentReplay: boolean; offline: boolean }>;
  savePhotoStory: (params: Record<string, unknown>) => invokeValue<{ story: PhotoStory; saved: boolean; unchanged: boolean }>;
  deletePhotoStory: (params: Record<string, unknown>) => invokeValue<{ storyId: string; deleted: number }>;
  restorePhotoStoryVersion: (params: Record<string, unknown>) => invokeValue<{ story: PhotoStory; restored: boolean; versionId: string }>;
  exportPhotoStory: (params: Record<string, unknown>) => invokeValue<PhotoStoryExportValue>;
  createPhotoStorySlideshow: (params: Record<string, unknown>) => invokeValue<{ story: PhotoStory; project: PhotoSlideshowProject; offline: boolean }>;
  onSlideshowCreated: (project: PhotoSlideshowProject) => void | Promise<void>;
}


function operationKey(): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `photo-story:${random}`;
}


function cloneStory(story: PhotoStory): PhotoStory {
  return JSON.parse(JSON.stringify(story)) as PhotoStory;
}


function editableStoryJson(story: PhotoStory): string {
  return JSON.stringify({
    title: story.title,
    subtitle: story.subtitle,
    style: story.style,
    chapters: story.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      narrative: chapter.narrative,
      sourceAssetIds: chapter.sourceAssetIds,
      captions: chapter.captions.map((caption) => ({ assetId: caption.assetId, text: caption.text })),
    })),
  });
}


function modelLabel(story: PhotoStory): string {
  const model = story.generation?.model || {};
  return String(model.modelId || model.id || story.generation?.route?.tier || "Local model");
}


export function PhotoStoryEditorPanel(props: PhotoStoryEditorPanelProps) {
  const {
    memoryId,
    memoryName,
    memoryCount,
    busy,
    uiText,
    photoStoryStatus,
    photoStories,
    generatePhotoStory,
    savePhotoStory,
    deletePhotoStory,
    restorePhotoStoryVersion,
    exportPhotoStory,
    createPhotoStorySlideshow,
    onSlideshowCreated,
  } = props;
  const [status, setStatus] = useState<PhotoStoryStatus | null>(null);
  const [stories, setStories] = useState<PhotoStory[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<PhotoStory | null>(null);
  const [style, setStyle] = useState<PhotoStoryStyle>("journal");
  const [chapterCount, setChapterCount] = useState(3);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [operation, setOperation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const generationKey = useRef("");

  const activeStory = useMemo(
    () => stories.find((story) => story.id === selectedId) || stories[0] || null,
    [selectedId, stories],
  );
  const draftDirty = useMemo(
    () => Boolean(draft && activeStory && editableStoryJson(draft) !== editableStoryJson(activeStory)),
    [activeStory, draft],
  );

  const refresh = useCallback(async () => {
    if (!memoryId) return;
    setError("");
    try {
      const [statusResult, storiesResult] = await Promise.all([
        photoStoryStatus({}),
        photoStories({ memoryId }),
      ]);
      setStatus(statusResult.value);
      const nextStories = Array.isArray(storiesResult.value.stories) ? storiesResult.value.stories : [];
      setStories(nextStories);
      setSelectedId((current) => nextStories.some((story) => story.id === current) ? current : nextStories[0]?.id || "");
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  }, [memoryId, photoStories, photoStoryStatus]);

  useEffect(() => {
    setStories([]);
    setSelectedId("");
    setDraft(null);
    setMessage("");
    setError("");
    generationKey.current = "";
    void refresh();
  }, [memoryId, refresh]);

  useEffect(() => {
    setDraft(activeStory ? cloneStory(activeStory) : null);
    setSelectedVersionId(activeStory?.history?.[0]?.versionId || "");
  }, [activeStory?.id, activeStory?.revision]);

  const replaceStory = useCallback((story: PhotoStory) => {
    setStories((current) => [story, ...current.filter((item) => item.id !== story.id)]);
    setSelectedId(story.id);
    setDraft(cloneStory(story));
  }, []);

  async function generate() {
    if (!memoryId || operation) return;
    if (!generationKey.current) generationKey.current = operationKey();
    setOperation("generate");
    setError("");
    setMessage("");
    try {
      const result = await generatePhotoStory({
        memoryId,
        confirm: true,
        idempotencyKey: generationKey.current,
        style,
        chapterCount,
        generateMissingCaptions: true,
      });
      replaceStory(result.value.story);
      generationKey.current = "";
      setMessage(result.value.idempotentReplay ? uiText("Story draft recovered") : uiText("Story draft ready"));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOperation("");
    }
  }

  async function save() {
    if (!draft || operation) return;
    setOperation("save");
    setError("");
    setMessage("");
    try {
      const result = await persistDraftIfNeeded();
      setMessage(result.unchanged ? uiText("Story already saved") : uiText("Story saved"));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOperation("");
    }
  }

  async function persistDraftIfNeeded(): Promise<{ story: PhotoStory; unchanged: boolean }> {
    if (!draft) throw new Error(uiText("No story draft"));
    if (!draftDirty) return { story: draft, unchanged: true };
    const result = await savePhotoStory({
      storyId: draft.id,
      expectedRevision: draft.revision,
      title: draft.title,
      subtitle: draft.subtitle,
      style: draft.style,
      chapters: draft.chapters,
    });
    replaceStory(result.value.story);
    return { story: result.value.story, unchanged: result.value.unchanged };
  }

  async function restore() {
    if (!draft || !selectedVersionId || operation) return;
    if (!window.confirm(uiText("Restore this story version?"))) return;
    setOperation("restore");
    setError("");
    setMessage("");
    try {
      const result = await restorePhotoStoryVersion({
        storyId: draft.id,
        versionId: selectedVersionId,
        expectedRevision: draft.revision,
      });
      replaceStory(result.value.story);
      setMessage(uiText("Story version restored"));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOperation("");
    }
  }

  async function exportStory() {
    if (!draft || operation) return;
    setOperation("export");
    setError("");
    setMessage("");
    try {
      const persisted = await persistDraftIfNeeded();
      await exportPhotoStory({ storyId: persisted.story.id });
      setMessage(uiText("Story exported"));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOperation("");
    }
  }

  async function createMovie() {
    if (!draft || operation) return;
    setOperation("movie");
    setError("");
    setMessage("");
    try {
      const persisted = await persistDraftIfNeeded();
      const result = await createPhotoStorySlideshow({ storyId: persisted.story.id });
      await onSlideshowCreated(result.value.project);
      setMessage(uiText("Movie project ready"));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOperation("");
    }
  }

  async function remove() {
    if (!draft || operation) return;
    if (!window.confirm(uiText("Delete this story?"))) return;
    setOperation("delete");
    setError("");
    setMessage("");
    try {
      await deletePhotoStory({ storyId: draft.id, confirm: true });
      const next = stories.filter((story) => story.id !== draft.id);
      setStories(next);
      setSelectedId(next[0]?.id || "");
      setDraft(next[0] ? cloneStory(next[0]) : null);
      setMessage(uiText("Story deleted"));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setOperation("");
    }
  }

  function moveChapter(index: number, direction: -1 | 1) {
    if (!draft) return;
    const target = index + direction;
    if (target < 0 || target >= draft.chapters.length) return;
    const chapters = [...draft.chapters];
    [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
    setDraft({ ...draft, chapters });
  }

  const disabled = busy || Boolean(operation);
  const generateDisabled = disabled || memoryCount < 2 || !status?.available;
  const selection = activeStory?.generation?.sourceSelection;

  return (
    <section className="photo-story-editor" aria-label={uiText("Photo story")} title={memoryName}>
      <div className="photo-story-heading">
        <span><BookOpen size={16} /> <strong>{uiText("Photo story")}</strong></span>
        <span className="photo-story-local" title={uiText("Runs offline on this computer")}>
          <ShieldCheck size={12} /> {uiText("Local")}
        </span>
        <button type="button" className="icon-button" title={uiText("Refresh story status")} aria-label={uiText("Refresh story status")} onClick={() => void refresh()} disabled={disabled}>
          <RefreshCcw size={15} />
        </button>
      </div>

      <div className="photo-story-generate-row">
        <label>
          <span>{uiText("Story style")}</span>
          <select value={style} onChange={(event) => { setStyle(event.currentTarget.value as PhotoStoryStyle); generationKey.current = ""; }} disabled={disabled}>
            <option value="journal">{uiText("Journal")}</option>
            <option value="concise">{uiText("Concise")}</option>
            <option value="cinematic">{uiText("Cinematic")}</option>
          </select>
        </label>
        <label>
          <span>{uiText("Chapters")}</span>
          <input type="number" min={1} max={6} step={1} value={chapterCount} onChange={(event) => { setChapterCount(Math.max(1, Math.min(6, Number(event.currentTarget.value) || 1))); generationKey.current = ""; }} disabled={disabled} />
        </label>
        <button type="button" className="secondary compact-action" onClick={() => void generate()} disabled={generateDisabled}>
          {operation === "generate" ? <RefreshCcw size={14} className="spin" /> : stories.length ? <Plus size={14} /> : <Sparkles size={14} />}
          <span>{operation === "generate" ? uiText("Writing") : stories.length ? uiText("New draft") : uiText("Generate draft")}</span>
        </button>
      </div>

      {!status?.available && status?.reason && <small className="photo-story-status">{status.reason}</small>}

      {stories.length > 1 && (
        <label className="photo-story-selector">
          <span>{uiText("Story draft")}</span>
          <select value={activeStory?.id || ""} onChange={(event) => setSelectedId(event.currentTarget.value)} disabled={disabled}>
            {stories.map((story) => <option value={story.id} key={story.id}>{story.title}</option>)}
          </select>
        </label>
      )}

      {draft && (
        <div className="photo-story-draft">
          <div className="photo-story-fields">
            <label>
              <span>{uiText("Story title")}</span>
              <input value={draft.title} maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })} disabled={disabled} />
            </label>
            <label>
              <span>{uiText("Story subtitle")}</span>
              <input value={draft.subtitle} maxLength={180} onChange={(event) => setDraft({ ...draft, subtitle: event.currentTarget.value })} disabled={disabled} />
            </label>
          </div>

          <div className="photo-story-provenance">
            <span>{modelLabel(draft)}</span>
            <span>{draft.humanEdited ? uiText("Edited") : uiText("Generated draft")}</span>
            <span>{selection ? `${selection.selected}/${selection.available}` : draft.sourceAssetIds.length} {uiText("photos")}</span>
          </div>

          <div className="photo-story-chapters">
            {draft.chapters.map((chapter, chapterIndex) => (
              <section className="photo-story-chapter" key={chapter.id}>
                <div className="photo-story-chapter-heading">
                  <span>{uiText("Chapter")} {chapterIndex + 1}</span>
                  <button type="button" className="icon-button" title={uiText("Move chapter up")} aria-label={uiText("Move chapter up")} onClick={() => moveChapter(chapterIndex, -1)} disabled={disabled || chapterIndex === 0}><ArrowUp size={14} /></button>
                  <button type="button" className="icon-button" title={uiText("Move chapter down")} aria-label={uiText("Move chapter down")} onClick={() => moveChapter(chapterIndex, 1)} disabled={disabled || chapterIndex === draft.chapters.length - 1}><ArrowDown size={14} /></button>
                </div>
                <input
                  aria-label={`${uiText("Chapter title")} ${chapterIndex + 1}`}
                  value={chapter.title}
                  maxLength={100}
                  onChange={(event) => {
                    const chapters = [...draft.chapters];
                    chapters[chapterIndex] = { ...chapter, title: event.currentTarget.value };
                    setDraft({ ...draft, chapters });
                  }}
                  disabled={disabled}
                />
                <textarea
                  aria-label={`${uiText("Chapter narrative")} ${chapterIndex + 1}`}
                  value={chapter.narrative}
                  maxLength={700}
                  rows={3}
                  onChange={(event) => {
                    const chapters = [...draft.chapters];
                    chapters[chapterIndex] = { ...chapter, narrative: event.currentTarget.value };
                    setDraft({ ...draft, chapters });
                  }}
                  disabled={disabled}
                />
                <div className="photo-story-captions">
                  {chapter.captions.map((caption, captionIndex) => (
                    <label key={caption.assetId}>
                      <span>{uiText("Caption")} {captionIndex + 1}</span>
                      <textarea
                        value={caption.text}
                        maxLength={220}
                        rows={2}
                        onChange={(event) => {
                          const chapters = [...draft.chapters];
                          const captions = [...chapter.captions];
                          captions[captionIndex] = { ...caption, text: event.currentTarget.value };
                          chapters[chapterIndex] = { ...chapter, captions };
                          setDraft({ ...draft, chapters });
                        }}
                        disabled={disabled}
                      />
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {draft.history.length > 0 && (
            <div className="photo-story-history">
              <label>
                <span>{uiText("Story versions")}</span>
                <select value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.currentTarget.value)} disabled={disabled}>
                  {draft.history.map((version) => <option value={version.versionId} key={version.versionId}>{version.label}</option>)}
                </select>
              </label>
              <button type="button" className="icon-button" title={uiText("Restore story version")} aria-label={uiText("Restore story version")} onClick={() => void restore()} disabled={disabled || !selectedVersionId}>
                <RotateCcw size={15} />
              </button>
            </div>
          )}

          <div className="photo-story-actions">
            <button type="button" className="primary compact-action" onClick={() => void save()} disabled={disabled}><Save size={14} /><span>{operation === "save" ? uiText("Saving") : uiText("Save story")}</span></button>
            <button type="button" className="secondary compact-action" onClick={() => void exportStory()} disabled={disabled}><Download size={14} /><span>{operation === "export" ? uiText("Exporting") : uiText("Export story")}</span></button>
            <button type="button" className="secondary compact-action" onClick={() => void createMovie()} disabled={disabled}><Film size={14} /><span>{operation === "movie" ? uiText("Creating") : uiText("Create movie")}</span></button>
            <button type="button" className="icon-button danger" title={uiText("Delete story")} aria-label={uiText("Delete story")} onClick={() => void remove()} disabled={disabled}><Trash2 size={15} /></button>
          </div>
        </div>
      )}

      {!draft && status?.available && !operation && <small className="photo-story-status">{uiText("No story draft")}</small>}
      {message && <small className="photo-story-message">{message}</small>}
      {error && <small className="photo-metadata-error">{error}</small>}
    </section>
  );
}
