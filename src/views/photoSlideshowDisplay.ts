import type { CSSProperties } from "react";
import type { PhotoMemory } from "../types";
import {
  cleanPhotoSlideshowSourcePaths,
  cleanPhotoSlideshowMotionKeyframes,
  cleanPhotoSlideshowThemeTemplateRegionMap,
  cleanPhotoSlideshowTimelineItems,
  PHOTO_SLIDESHOW_CAPTION_LIMIT,
  type PhotoSlideshowCaption,
  type PhotoSlideshowCaptionPlacement,
  type PhotoSlideshowCaptionRegion,
  type PhotoSlideshowCaptionTypography,
  type PhotoSlideshowCaptionWrap,
  type PhotoSlideshowMotionKeyframeCurve,
  type PhotoSlideshowMotionKeyframes,
  type PhotoSlideshowBezierControlPoints,
  type PhotoSlideshowMotionPathDraftPoint,
  type PhotoSlideshowMotionPathPoint,
  type PhotoSlideshowMotionPathPointKey,
  type PhotoSlideshowMotionPreset,
  type PhotoSlideshowProject,
  type PhotoSlideshowProjectItemLike,
  type PhotoSlideshowProjectTheme,
  type PhotoSlideshowProjectTimelineItem,
  type PhotoSlideshowTitleCardFontScale,
  type PhotoSlideshowTitleCardLayout,
  type PhotoSlideshowTitleCardPalette,
  photoSlideshowProjectSourcePaths,
  photoSlideshowResolvedCaptionPreset,
  photoSlideshowResolvedRegionMap,
  photoSlideshowBezierControlPointsFromKeyframes,
  photoSlideshowMotionPathPointsFromKeyframes,
  type PhotoSlideshowThemeTemplateBackdrop,
  type PhotoSlideshowThemeTemplateCaptionPreset,
  type PhotoSlideshowThemeTemplateChromeDensity,
  type PhotoSlideshowThemeTemplateFrameStyle,
  type PhotoSlideshowThemeTemplateLayout,
  type PhotoSlideshowThemeTemplatePalette,
  type PhotoSlideshowThemeTemplateRegionMap,
  type PhotoSlideshowThemeTemplateRegionSlot,
  type PhotoSlideshowThemeTemplateTypography,
  type PhotoSlideshowThemeTimelineChoice,
  type PhotoSlideshowTransitionEffect,
} from "./photoSlideshowProjects";

export function photoSlideshowMotionLabel(motion: PhotoSlideshowMotionPreset | "custom"): string {
  if (motion === "slow-zoom") return "Slow zoom";
  if (motion === "pan-left") return "Pan left";
  if (motion === "pan-right") return "Pan right";
  if (motion === "custom") return "Custom path";
  return motion === "still" ? "Still" : "Auto";
}

export function photoSlideshowTransitionLabel(effect: PhotoSlideshowTransitionEffect): string {
  if (effect === "cut") return "Cut";
  if (effect === "fade") return "Fade";
  if (effect === "dissolve") return "Dissolve";
  if (effect === "zoom") return "Zoom";
  return "Auto";
}

export function photoSlideshowThemeTemplateStyle(
  palette: PhotoSlideshowThemeTemplatePalette,
  typography: PhotoSlideshowThemeTemplateTypography,
  backdrop: PhotoSlideshowThemeTemplateBackdrop,
  frameStyle: PhotoSlideshowThemeTemplateFrameStyle,
  chromeDensity: PhotoSlideshowThemeTemplateChromeDensity,
  backdropIntensity = 100,
  stageWidth = 100,
): CSSProperties {
  const intensity = Math.max(0, Math.min(100, Math.round(Number(backdropIntensity) || 0))) / 100;
  const cleanStageWidth = Math.max(50, Math.min(100, Math.round(Number(stageWidth) || 100)));
  const stageScale = cleanStageWidth / 100;
  const palettes: Record<Exclude<PhotoSlideshowThemeTemplatePalette, "auto">, {
    bg: string;
    panel: string;
    accent: string;
    text: string;
    muted: string;
  }> = {
    midnight: { bg: "#080b14", panel: "rgba(20, 25, 39, 0.88)", accent: "#76b9ff", text: "#fafaf6", muted: "rgba(218, 224, 229, 0.76)" },
    paper: { bg: "#eeeae0", panel: "rgba(247, 244, 235, 0.9)", accent: "#557368", text: "#222524", muted: "rgba(67, 74, 72, 0.78)" },
    sunset: { bg: "#2b121f", panel: "rgba(78, 35, 41, 0.88)", accent: "#f6b55c", text: "#fffaf0", muted: "rgba(244, 221, 198, 0.78)" },
    forest: { bg: "#101f1a", panel: "rgba(25, 49, 39, 0.88)", accent: "#97c77f", text: "#f4faee", muted: "rgba(213, 230, 204, 0.78)" },
  };
  const typographies: Record<Exclude<PhotoSlideshowThemeTemplateTypography, "auto">, {
    font: string;
    headingWeight: string;
    letterSpacing: string;
    captionStyle: string;
  }> = {
    clean: { font: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", headingWeight: "700", letterSpacing: "0", captionStyle: "normal" },
    editorial: { font: "Georgia, Times New Roman, serif", headingWeight: "700", letterSpacing: "0", captionStyle: "italic" },
    cinematic: { font: "Avenir Next, Trebuchet MS, sans-serif", headingWeight: "800", letterSpacing: "0.02em", captionStyle: "normal" },
  };
  const backdrops: Record<Exclude<PhotoSlideshowThemeTemplateBackdrop, "auto">, {
    overlay: string;
    mediaBg: string;
    stageShadow: string;
    panelBackdrop: string;
  }> = {
    solid: { overlay: "transparent", mediaBg: "#000", stageShadow: "none", panelBackdrop: "none" },
    vignette: { overlay: "radial-gradient(ellipse at center, transparent 48%, rgba(0, 0, 0, 0.48) 100%)", mediaBg: "#000", stageShadow: "0 0 70px rgba(0, 0, 0, 0.36)", panelBackdrop: "none" },
    glass: { overlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(0, 0, 0, 0.16))", mediaBg: "rgba(0, 0, 0, 0.76)", stageShadow: "0 24px 80px rgba(0, 0, 0, 0.34)", panelBackdrop: "blur(16px)" },
    blur: { overlay: "linear-gradient(180deg, rgba(4, 8, 12, 0.12), rgba(4, 8, 12, 0.32))", mediaBg: "rgba(7, 10, 14, 0.88)", stageShadow: "0 28px 90px rgba(0, 0, 0, 0.42)", panelBackdrop: "blur(24px) saturate(1.18)" },
    spotlight: { overlay: "radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0.12), transparent 34%), radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.58) 100%)", mediaBg: "#050506", stageShadow: "0 0 120px rgba(255, 255, 255, 0.12), 0 30px 90px rgba(0, 0, 0, 0.5)", panelBackdrop: "none" },
    film: { overlay: "linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px), linear-gradient(180deg, rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0.34))", mediaBg: "#050505", stageShadow: "inset 0 0 110px rgba(0, 0, 0, 0.42), 0 22px 72px rgba(0, 0, 0, 0.38)", panelBackdrop: "none" },
  };
  const selectedPalette = palette === "auto" ? null : palettes[palette] || palettes.midnight;
  const selectedTypography = typography === "auto" ? null : typographies[typography] || typographies.clean;
  const selectedBackdrop = backdrop === "auto" ? null : backdrops[backdrop] || backdrops.solid;
  const frameStyles: Record<Exclude<PhotoSlideshowThemeTemplateFrameStyle, "auto">, {
    border: string;
    radius: string;
    padding: string;
    outline: string;
  }> = {
    none: { border: "0", radius: "0", padding: "0", outline: "none" },
    hairline: { border: "1px solid color-mix(in srgb, var(--photo-slideshow-template-accent, #ffffff) 26%, transparent)", radius: "8px", padding: "0", outline: "none" },
    matte: { border: "12px solid color-mix(in srgb, var(--photo-slideshow-template-panel, rgba(18,22,28,.84)) 88%, var(--photo-slideshow-template-accent, #ffffff) 12%)", radius: "10px", padding: "8px", outline: "0 24px 72px rgba(0, 0, 0, 0.34)" },
    accent: { border: "2px solid var(--photo-slideshow-template-accent, #ffffff)", radius: "10px", padding: "3px", outline: "0 0 0 1px color-mix(in srgb, var(--photo-slideshow-template-accent, #ffffff) 32%, transparent), 0 22px 68px rgba(0, 0, 0, 0.32)" },
  };
  const chromeDensities: Record<Exclude<PhotoSlideshowThemeTemplateChromeDensity, "auto">, {
    padding: string;
    gap: string;
    chapterSize: string;
    fontScale: string;
  }> = {
    compact: { padding: "6px", gap: "6px", chapterSize: "28px", fontScale: "0.92" },
    regular: { padding: "8px", gap: "8px", chapterSize: "34px", fontScale: "1" },
    spacious: { padding: "12px", gap: "12px", chapterSize: "42px", fontScale: "1.08" },
  };
  const selectedFrameStyle = frameStyle === "auto" ? null : frameStyles[frameStyle] || frameStyles.hairline;
  const selectedChromeDensity = chromeDensity === "auto" ? null : chromeDensities[chromeDensity] || chromeDensities.regular;
  return {
    ...(selectedPalette ? {
      "--photo-slideshow-template-bg": selectedPalette.bg,
      "--photo-slideshow-template-panel": selectedPalette.panel,
      "--photo-slideshow-template-accent": selectedPalette.accent,
      "--photo-slideshow-template-text": selectedPalette.text,
      "--photo-slideshow-template-muted": selectedPalette.muted,
    } : {}),
    ...(selectedTypography ? {
      "--photo-slideshow-template-font": selectedTypography.font,
      "--photo-slideshow-template-heading-weight": selectedTypography.headingWeight,
      "--photo-slideshow-template-letter-spacing": selectedTypography.letterSpacing,
      "--photo-slideshow-template-caption-style": selectedTypography.captionStyle,
    } : {}),
    ...(selectedBackdrop ? {
      "--photo-slideshow-template-overlay": selectedBackdrop.overlay,
      "--photo-slideshow-template-media-bg": selectedBackdrop.mediaBg,
      "--photo-slideshow-template-stage-shadow": selectedBackdrop.stageShadow,
      "--photo-slideshow-template-panel-backdrop": selectedBackdrop.panelBackdrop,
    } : {}),
    ...(selectedFrameStyle ? {
      "--photo-slideshow-template-frame-border": selectedFrameStyle.border,
      "--photo-slideshow-template-frame-radius": selectedFrameStyle.radius,
      "--photo-slideshow-template-frame-padding": selectedFrameStyle.padding,
      "--photo-slideshow-template-frame-outline": selectedFrameStyle.outline,
    } : {}),
    ...(selectedChromeDensity ? {
      "--photo-slideshow-template-chrome-padding": selectedChromeDensity.padding,
      "--photo-slideshow-template-chrome-gap": selectedChromeDensity.gap,
      "--photo-slideshow-template-chapter-size": selectedChromeDensity.chapterSize,
      "--photo-slideshow-template-chrome-font-scale": selectedChromeDensity.fontScale,
    } : {}),
    "--photo-slideshow-template-overlay-opacity": String(intensity),
    "--photo-slideshow-template-stage-standard-width": `${92 * stageScale}vw`,
    "--photo-slideshow-template-stage-gallery-width": `${86 * stageScale}vw`,
    "--photo-slideshow-template-stage-cinema-width": `${96 * stageScale}vw`,
    "--photo-slideshow-template-stage-poster-width": `${74 * stageScale}vw`,
    "--photo-slideshow-template-stage-split-width": `${66 * stageScale}vw`,
  } as CSSProperties;
}

export function photoSlideshowKeyframeCurveLabel(curve?: PhotoSlideshowMotionKeyframeCurve | null): string {
  if (curve === "linear") return "Linear curve";
  if (curve === "ease") return "Ease curve";
  if (curve === "smooth") return "Smooth curve";
  if (curve === "cinematic") return "Cinematic curve";
  return "";
}

export function photoSlideshowKeyframeTiming(curve?: PhotoSlideshowMotionKeyframeCurve | null): string {
  if (curve === "linear") return "linear";
  if (curve === "ease") return "ease-in-out";
  if (curve === "smooth") return "cubic-bezier(0.45, 0, 0.25, 1)";
  if (curve === "cinematic") return "cubic-bezier(0.22, 0.61, 0.36, 1)";
  return "ease-in-out";
}

export function cleanPhotoSlideshowFocalPercent(value: unknown, fallback = 50): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

export function cleanPhotoSlideshowCropZoom(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(3, Math.round(parsed * 1000) / 1000)) : fallback;
}

export function cleanPhotoSlideshowCaptionPercent(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed * 10) / 10)) : fallback;
}

export function cleanPhotoSlideshowCaptionSizePercent(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.round(parsed * 10) / 10)) : fallback;
}

export function cleanPhotoSlideshowCaptionText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function cleanPhotoSlideshowCaptionPlacement(value: unknown): PhotoSlideshowCaptionPlacement {
  const placement = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (placement === "none" || placement === "off" || placement === "hide") return "hidden";
  if (placement === "bottom" || placement === "lower" || placement === "lower-third") return "lower-left";
  if (placement === "top" || placement === "upper" || placement === "upper-third") return "upper-left";
  if (placement === "left" || placement === "start" || placement === "bottom-left") return "lower-left";
  if (placement === "right" || placement === "end") return "lower-right";
  if (placement === "bottom-center") return "lower-center";
  if (placement === "bottom-right") return "lower-right";
  if (placement === "top-left") return "upper-left";
  if (placement === "top-center") return "upper-center";
  if (placement === "top-right") return "upper-right";
  if (placement === "center-center" || placement === "middle") return "center";
  return ["auto", "hidden", "lower-left", "lower-center", "lower-right", "upper-left", "upper-center", "upper-right", "center"].includes(placement)
    ? placement as PhotoSlideshowCaptionPlacement
    : "auto";
}

export function cleanPhotoSlideshowCaptionTypography(value: unknown): PhotoSlideshowCaptionTypography {
  const typography = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (typography === "plain" || typography === "sans" || typography === "sans-serif" || typography === "default") return "clean";
  if (typography === "serif" || typography === "italic" || typography === "story") return "editorial";
  if (typography === "movie" || typography === "film") return "cinematic";
  if (typography === "strong" || typography === "heavy" || typography === "large") return "bold";
  return ["auto", "clean", "editorial", "cinematic", "bold"].includes(typography)
    ? typography as PhotoSlideshowCaptionTypography
    : "auto";
}

export function cleanPhotoSlideshowCaptionWrap(value: unknown): PhotoSlideshowCaptionWrap {
  const wrap = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (wrap === "single" || wrap === "singleline" || wrap === "one-line" || wrap === "nowrap" || wrap === "no-wrap" || wrap === "no" || wrap === "false") return "single-line";
  if (wrap === "two" || wrap === "2" || wrap === "2-line" || wrap === "two-lines") return "two-line";
  if (wrap === "multi" || wrap === "multiline" || wrap === "multi-lines" || wrap === "wrap" || wrap === "line-wrap" || wrap === "balance" || wrap === "balanced" || wrap === "yes" || wrap === "true") return "multi-line";
  return ["auto", "single-line", "two-line", "multi-line"].includes(wrap)
    ? wrap as PhotoSlideshowCaptionWrap
    : "auto";
}

export function photoSlideshowCropStyle(item?: Pick<PhotoSlideshowProjectTimelineItem, "focalX" | "focalY" | "cropZoom"> | null): CSSProperties {
  const focalX = cleanPhotoSlideshowFocalPercent(item?.focalX, 50);
  const focalY = cleanPhotoSlideshowFocalPercent(item?.focalY, 50);
  const cropZoom = cleanPhotoSlideshowCropZoom(item?.cropZoom, 1);
  return {
    objectPosition: `${focalX}% ${focalY}%`,
    transformOrigin: `${focalX}% ${focalY}%`,
    ...(cropZoom > 1 ? { transform: `scale(${cropZoom.toFixed(3)})` } : {}),
  };
}

export function photoSlideshowCaptionRegionStyle(item?: Pick<PhotoSlideshowProjectTimelineItem, "captionRegion" | "captionPlacement"> | null): CSSProperties {
  const region = item?.captionRegion;
  if (region) {
    const x = cleanPhotoSlideshowCaptionPercent(region.x, 6);
    const y = cleanPhotoSlideshowCaptionPercent(region.y, 72);
    const width = cleanPhotoSlideshowCaptionSizePercent(region.width, 42);
    const height = cleanPhotoSlideshowCaptionSizePercent(region.height, 12);
    return {
      left: `${x}%`,
      top: `${y}%`,
      width: `${Math.min(width, Math.max(1, 100 - x))}%`,
      maxWidth: "none",
      minHeight: `${Math.min(height, Math.max(1, 100 - y))}%`,
      right: "auto",
      bottom: "auto",
      transform: "none",
    };
  }
  const placement = cleanPhotoSlideshowCaptionPlacement(item?.captionPlacement || "auto");
  if (placement === "upper-left") return { left: 20, top: 20, right: "auto", bottom: "auto" };
  if (placement === "upper-center") return { left: "50%", top: 20, right: "auto", bottom: "auto", transform: "translateX(-50%)" };
  if (placement === "upper-right") return { left: "auto", top: 20, right: 20, bottom: "auto" };
  if (placement === "lower-center") return { left: "50%", right: "auto", bottom: 20, transform: "translateX(-50%)" };
  if (placement === "lower-right") return { left: "auto", right: 20, bottom: 20 };
  if (placement === "center") return { left: "50%", top: "50%", right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" };
  return { left: 20, right: "auto", bottom: 20 };
}

export type PhotoSlideshowCaptionLayerChoice = "primary" | `block-${number}`;
export type PhotoSlideshowCaptionDraftLike = Pick<PhotoSlideshowProjectTimelineItem, "captionText" | "captionPlacement" | "captionRegion" | "captionTypography" | "captionWrap"> | PhotoSlideshowCaption;

export function photoSlideshowCaptionId(index: number): string {
  return `caption-${index + 2}`;
}

export function photoSlideshowCaptionIndex(layer: PhotoSlideshowCaptionLayerChoice): number {
  if (!layer.startsWith("block-")) return -1;
  const index = Number(layer.slice("block-".length));
  return Number.isInteger(index) && index >= 0 && index < PHOTO_SLIDESHOW_CAPTION_LIMIT ? index : -1;
}

export function cleanPhotoSlideshowCaption(value: unknown, index: number): PhotoSlideshowCaption | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const captionText = cleanPhotoSlideshowCaptionText(record.captionText ?? record.caption ?? record.text ?? record.title ?? record.label ?? (typeof value === "string" ? value : ""));
  if (!captionText) return null;
  const captionPlacement = cleanPhotoSlideshowCaptionPlacement(record.captionPlacement ?? record.captionPosition ?? record.captionPlace ?? record.captionAnchor ?? record.placement ?? record.position ?? (typeof record.captionRegion === "string" ? record.captionRegion : undefined) ?? "auto");
  const rawRegion = record.captionRegion ?? record.captionBounds ?? record.captionBox ?? record.captionFrame ?? record.captionRect ?? record.region;
  const regionRecord = rawRegion && typeof rawRegion === "object" && !Array.isArray(rawRegion) ? rawRegion as Record<string, unknown> : null;
  const captionRegion = regionRecord
    ? {
      x: cleanPhotoSlideshowCaptionPercent(regionRecord.x ?? regionRecord.left ?? regionRecord.l, 6),
      y: cleanPhotoSlideshowCaptionPercent(regionRecord.y ?? regionRecord.top ?? regionRecord.t, 72),
      width: cleanPhotoSlideshowCaptionSizePercent(regionRecord.width ?? regionRecord.w, 42),
      height: cleanPhotoSlideshowCaptionSizePercent(regionRecord.height ?? regionRecord.h, 12),
    }
    : null;
  const captionTypography = cleanPhotoSlideshowCaptionTypography(record.captionTypography ?? record.captionType ?? record.captionFont ?? record.captionStyle ?? record.captionFontScale ?? record.captionScale ?? record.captionSize ?? record.typography ?? "auto");
  const captionWrap = cleanPhotoSlideshowCaptionWrap(record.captionWrap ?? record.captionWrapMode ?? record.captionWrapping ?? record.captionTextWrap ?? record.captionLines ?? record.captionLineMode ?? record.captionFlow ?? record.wrap ?? "auto");
  return {
    id: String(record.id ?? record.captionId ?? record.key ?? photoSlideshowCaptionId(index)).trim().slice(0, 40) || photoSlideshowCaptionId(index),
    captionText,
    ...(captionPlacement !== "auto" ? { captionPlacement } : {}),
    ...(captionRegion ? { captionRegion } : {}),
    ...(captionTypography !== "auto" ? { captionTypography } : {}),
    ...(captionWrap !== "auto" ? { captionWrap } : {}),
  };
}

export function cleanPhotoSlideshowCaptions(value: unknown): PhotoSlideshowCaption[] {
  const raw = Array.isArray(value) ? value : [];
  const blocks: PhotoSlideshowCaption[] = [];
  raw.forEach((item, index) => {
    if (blocks.length >= PHOTO_SLIDESHOW_CAPTION_LIMIT) return;
    const block = cleanPhotoSlideshowCaption(item, index);
    if (block) blocks.push(block);
  });
  return blocks;
}

export function photoSlideshowTimelineTransitionPatch(item?: PhotoSlideshowProjectTimelineItem | null): Partial<PhotoSlideshowProjectTimelineItem> {
  if (!item) return {};
  const patch: Partial<PhotoSlideshowProjectTimelineItem> = {};
  if (item.transitionEffect) patch.transitionEffect = item.transitionEffect;
  if (typeof item.transitionDurationMs === "number") {
    patch.transitionDurationMs = item.transitionEffect === "cut" ? 0 : Math.max(0, Math.min(3000, Math.round(item.transitionDurationMs)));
  }
  return patch;
}

export function photoSlideshowTransitionDurationDraft(effect: PhotoSlideshowTransitionEffect, value: unknown): number {
  if (effect === "cut") return 0;
  return Math.max(0, Math.min(3000, Math.round(Number(value) || 0)));
}

export function photoSlideshowTimelineCropPatch(item?: Pick<PhotoSlideshowProjectTimelineItem, "focalX" | "focalY" | "cropZoom"> | null): Partial<PhotoSlideshowProjectTimelineItem> {
  if (!item) return {};
  const patch: Partial<PhotoSlideshowProjectTimelineItem> = {};
  if (typeof item.focalX === "number") patch.focalX = cleanPhotoSlideshowFocalPercent(item.focalX, 50);
  if (typeof item.focalY === "number") patch.focalY = cleanPhotoSlideshowFocalPercent(item.focalY, 50);
  if (typeof item.cropZoom === "number") patch.cropZoom = cleanPhotoSlideshowCropZoom(item.cropZoom, 1);
  return patch;
}

export function photoSlideshowPrimaryCaptionActive(item?: Pick<PhotoSlideshowProjectTimelineItem, "captionText" | "captionPlacement" | "captionRegion"> | null): boolean {
  return Boolean(
    item
      && (
        cleanPhotoSlideshowCaptionText(item.captionText)
        || cleanPhotoSlideshowCaptionPlacement(item.captionPlacement || "auto") !== "auto"
        || item.captionRegion
      )
  );
}

export function photoSlideshowPrimaryCaptionPatch(item?: PhotoSlideshowCaptionDraftLike | null): Partial<PhotoSlideshowProjectTimelineItem> {
  if (!item) return {};
  const patch: Partial<PhotoSlideshowProjectTimelineItem> = {};
  const captionText = cleanPhotoSlideshowCaptionText(item.captionText);
  const captionPlacement = cleanPhotoSlideshowCaptionPlacement(item.captionPlacement || "auto");
  const captionTypography = cleanPhotoSlideshowCaptionTypography(item.captionTypography || "auto");
  const captionWrap = cleanPhotoSlideshowCaptionWrap(item.captionWrap || "auto");
  if (captionText) patch.captionText = captionText;
  if (captionPlacement !== "auto") patch.captionPlacement = captionPlacement;
  if (captionTypography !== "auto") patch.captionTypography = captionTypography;
  if (captionWrap !== "auto") patch.captionWrap = captionWrap;
  if (item.captionRegion) {
    const x = cleanPhotoSlideshowCaptionPercent(item.captionRegion.x, 6);
    const y = cleanPhotoSlideshowCaptionPercent(item.captionRegion.y, 72);
    patch.captionRegion = {
      x,
      y,
      width: Math.min(cleanPhotoSlideshowCaptionSizePercent(item.captionRegion.width, 42), Math.max(1, 100 - x)),
      height: Math.min(cleanPhotoSlideshowCaptionSizePercent(item.captionRegion.height, 12), Math.max(1, 100 - y)),
    };
  }
  return patch;
}

export function photoSlideshowTimelineCaptionPatch(item?: (PhotoSlideshowProjectTimelineItem & { captions?: unknown }) | null): Partial<PhotoSlideshowProjectTimelineItem> {
  if (!item) return {};
  const patch = photoSlideshowPrimaryCaptionPatch(item);
  const captions = cleanPhotoSlideshowCaptions(item.captions);
  if (captions.length) patch.captions = captions;
  return patch;
}

export type PhotoSlideshowTimelineItemSections = {
  keyframes?: boolean;
  crop?: boolean;
  captions?: boolean;
  transition?: boolean;
};

export function cleanPhotoSlideshowTimelineDuration(value: unknown, fallback: unknown): number {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return 500;
  return Math.max(500, Math.min(60000, Math.round(parsed)));
}

export function photoSlideshowTimelineItemWithSections(
  item: (Partial<PhotoSlideshowProjectTimelineItem> & { captions?: unknown }) | null | undefined,
  sourcePath: unknown,
  fallbackDurationMs: unknown,
  sections: PhotoSlideshowTimelineItemSections = {},
): PhotoSlideshowProjectTimelineItem {
  const includeKeyframes = sections.keyframes !== false;
  const includeCrop = sections.crop !== false;
  const includeCaptions = sections.captions !== false;
  const includeTransition = sections.transition !== false;
  return {
    sourcePath: String(sourcePath || item?.sourcePath || "").trim(),
    durationMs: cleanPhotoSlideshowTimelineDuration(item?.durationMs, fallbackDurationMs),
    motion: item?.motion || "auto",
    ...(includeKeyframes && item?.keyframes ? { keyframes: item.keyframes } : {}),
    ...(includeCrop ? photoSlideshowTimelineCropPatch(item) : {}),
    ...(includeTransition ? photoSlideshowTimelineTransitionPatch(item as PhotoSlideshowProjectTimelineItem | null | undefined) : {}),
    ...(includeCaptions ? photoSlideshowTimelineCaptionPatch(item as (PhotoSlideshowProjectTimelineItem & { captions?: unknown }) | null | undefined) : {}),
  };
}

export function photoSlideshowCaptionDraftForLayer(item: PhotoSlideshowProjectTimelineItem, layer: PhotoSlideshowCaptionLayerChoice): PhotoSlideshowCaptionDraftLike | null {
  const blockIndex = photoSlideshowCaptionIndex(layer);
  if (blockIndex < 0) return item;
  return cleanPhotoSlideshowCaptions(item.captions)[blockIndex] || null;
}

export function photoSlideshowDraftCropPatch(focalX: unknown, focalY: unknown, cropZoom: unknown): Partial<PhotoSlideshowProjectTimelineItem> {
  return {
    focalX: cleanPhotoSlideshowFocalPercent(focalX, 50),
    focalY: cleanPhotoSlideshowFocalPercent(focalY, 50),
    cropZoom: cleanPhotoSlideshowCropZoom(cropZoom, 1),
  };
}

export type PhotoSlideshowDraftCaptionSourceInput = {
  captionText?: unknown;
  captionPlacement?: unknown;
  captionTypography?: unknown;
  captionWrap?: unknown;
  captionRegionX?: unknown;
  captionRegionY?: unknown;
  captionRegionWidth?: unknown;
  captionRegionHeight?: unknown;
};

export function photoSlideshowDraftCaptionSource(input: PhotoSlideshowDraftCaptionSourceInput): PhotoSlideshowCaptionDraftLike {
  const x = cleanPhotoSlideshowCaptionPercent(input.captionRegionX, 6);
  const y = cleanPhotoSlideshowCaptionPercent(input.captionRegionY, 72);
  return {
    captionText: cleanPhotoSlideshowCaptionText(input.captionText),
    captionPlacement: cleanPhotoSlideshowCaptionPlacement(input.captionPlacement || "auto"),
    captionTypography: cleanPhotoSlideshowCaptionTypography(input.captionTypography || "auto"),
    captionWrap: cleanPhotoSlideshowCaptionWrap(input.captionWrap || "auto"),
    captionRegion: {
      x,
      y,
      width: Math.min(cleanPhotoSlideshowCaptionSizePercent(input.captionRegionWidth, 42), Math.max(1, 100 - x)),
      height: Math.min(cleanPhotoSlideshowCaptionSizePercent(input.captionRegionHeight, 12), Math.max(1, 100 - y)),
    },
  };
}

export function photoSlideshowDraftCaptionPatch(
  layer: PhotoSlideshowCaptionLayerChoice,
  source: PhotoSlideshowCaptionDraftLike,
  existing?: PhotoSlideshowProjectTimelineItem | null,
): Partial<PhotoSlideshowProjectTimelineItem> {
  const blockIndex = photoSlideshowCaptionIndex(layer);
  if (blockIndex < 0) {
    const captions = cleanPhotoSlideshowCaptions(existing?.captions);
    return {
      ...photoSlideshowPrimaryCaptionPatch(source),
      ...(captions.length ? { captions } : {}),
    };
  }
  const captions = cleanPhotoSlideshowCaptions(existing?.captions);
  const draftBlock = cleanPhotoSlideshowCaption({
    ...source,
    id: captions[blockIndex]?.id || photoSlideshowCaptionId(blockIndex),
  }, blockIndex);
  if (draftBlock) {
    captions[blockIndex] = draftBlock;
  } else if (blockIndex < captions.length) {
    captions.splice(blockIndex, 1);
  }
  return {
    ...photoSlideshowPrimaryCaptionPatch(existing),
    ...(captions.length ? { captions: cleanPhotoSlideshowCaptions(captions) } : {}),
  };
}

export type PhotoSlideshowPathEditorMode = "anchors" | "draw" | "bezier";
export type PhotoSlideshowPathDragTarget = PhotoSlideshowMotionPathPointKey | "bezierControl1" | "bezierControl2" | "";
export type PhotoSlideshowProjectPathFrameUpdate =
  | { kind: "anchor"; key: PhotoSlideshowMotionPathPointKey; point: PhotoSlideshowMotionPathDraftPoint }
  | { kind: "bezier"; key: "bezierControl1" | "bezierControl2"; point: PhotoSlideshowMotionPathDraftPoint }
  | { kind: "draw"; points: PhotoSlideshowMotionPathDraftPoint[] };
export type PhotoSlideshowThemeSettings = Pick<
  PhotoSlideshowProject,
  | "theme"
  | "themeTimelinePreset"
  | "themeTemplateName"
  | "themeTemplatePalette"
  | "themeTemplateTypography"
  | "themeTemplateBackdrop"
  | "themeTemplateLayout"
  | "themeTemplateBackdropIntensity"
  | "themeTemplateStageWidth"
  | "themeTemplateFrameStyle"
  | "themeTemplateChromeDensity"
  | "themeTemplateCaptionPreset"
  | "themeTemplateRegionMap"
>;
export type PhotoSlideshowThemeSettingsInput = Partial<PhotoSlideshowThemeSettings> | NonNullable<PhotoMemory["movieSettings"]>;
export type PhotoSlideshowCaptionRegionDraft = { x: number; y: number; width: number; height: number };
export type PhotoSlideshowCaptionRegionDragMode = "move" | "resize-northwest" | "resize-northeast" | "resize-southwest" | "resize-southeast";
export type PhotoSlideshowCaptionRegionDragState = {
  pointerId: number;
  mode: PhotoSlideshowCaptionRegionDragMode;
  startPoint: { x: number; y: number };
  region: PhotoSlideshowCaptionRegionDraft;
};

export const DEFAULT_PHOTO_SLIDESHOW_TEMPLATE_REGION: PhotoSlideshowCaptionRegion = {
  x: 6,
  y: 72,
  width: 54,
  height: 14,
};

export function cleanPhotoSlideshowThemeSettings(
  value: PhotoSlideshowThemeSettingsInput | null | undefined,
  fallbackTheme: PhotoSlideshowProjectTheme = "classic",
): PhotoSlideshowThemeSettings {
  const source = value || {};
  return {
    theme: (source.theme || fallbackTheme) as PhotoSlideshowProjectTheme,
    themeTimelinePreset: (source.themeTimelinePreset || "auto") as PhotoSlideshowThemeTimelineChoice,
    themeTemplateName: String(source.themeTemplateName || "").trim(),
    themeTemplatePalette: (source.themeTemplatePalette || "auto") as PhotoSlideshowThemeTemplatePalette,
    themeTemplateTypography: (source.themeTemplateTypography || "auto") as PhotoSlideshowThemeTemplateTypography,
    themeTemplateBackdrop: (source.themeTemplateBackdrop || "auto") as PhotoSlideshowThemeTemplateBackdrop,
    themeTemplateLayout: (source.themeTemplateLayout || "auto") as PhotoSlideshowThemeTemplateLayout,
    themeTemplateBackdropIntensity: Math.max(0, Math.min(100, Number(source.themeTemplateBackdropIntensity ?? 100) || 100)),
    themeTemplateStageWidth: Math.max(50, Math.min(100, Number(source.themeTemplateStageWidth ?? 100) || 100)),
    themeTemplateFrameStyle: (source.themeTemplateFrameStyle || "auto") as PhotoSlideshowThemeTemplateFrameStyle,
    themeTemplateChromeDensity: (source.themeTemplateChromeDensity || "auto") as PhotoSlideshowThemeTemplateChromeDensity,
    themeTemplateCaptionPreset: (source.themeTemplateCaptionPreset || "auto") as PhotoSlideshowThemeTemplateCaptionPreset,
    themeTemplateRegionMap: cleanPhotoSlideshowThemeTemplateRegionMap(source.themeTemplateRegionMap),
  };
}

export function photoSlideshowThemeSettingsEqual(
  left: PhotoSlideshowThemeSettingsInput | null | undefined,
  right: PhotoSlideshowThemeSettingsInput | null | undefined,
): boolean {
  const a = cleanPhotoSlideshowThemeSettings(left);
  const b = cleanPhotoSlideshowThemeSettings(right);
  return a.theme === b.theme
    && a.themeTimelinePreset === b.themeTimelinePreset
    && a.themeTemplateName === b.themeTemplateName
    && a.themeTemplatePalette === b.themeTemplatePalette
    && a.themeTemplateTypography === b.themeTemplateTypography
    && a.themeTemplateBackdrop === b.themeTemplateBackdrop
    && a.themeTemplateLayout === b.themeTemplateLayout
    && a.themeTemplateBackdropIntensity === b.themeTemplateBackdropIntensity
    && a.themeTemplateStageWidth === b.themeTemplateStageWidth
    && a.themeTemplateFrameStyle === b.themeTemplateFrameStyle
    && a.themeTemplateChromeDensity === b.themeTemplateChromeDensity
    && a.themeTemplateCaptionPreset === b.themeTemplateCaptionPreset
    && JSON.stringify(a.themeTemplateRegionMap) === JSON.stringify(b.themeTemplateRegionMap);
}

export const PHOTO_SLIDESHOW_PATH_POINT_LABELS: Record<PhotoSlideshowMotionPathPointKey, string> = {
  start: "Start",
  quarter: "25%",
  mid: "Mid",
  threeQuarter: "75%",
  end: "End",
};

export const PHOTO_SLIDESHOW_CAPTION_REGION_HANDLES: Array<{
  mode: Exclude<PhotoSlideshowCaptionRegionDragMode, "move">;
  label: string;
}> = [
  { mode: "resize-northwest", label: "northwest" },
  { mode: "resize-northeast", label: "northeast" },
  { mode: "resize-southwest", label: "southwest" },
  { mode: "resize-southeast", label: "southeast" },
];

export type PhotoSlideshowClientRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function photoSlideshowTimelineDropPlacementFromRect(
  clientX: number,
  rect: Pick<PhotoSlideshowClientRectLike, "left" | "width">,
): "before" | "after" {
  return clientX < rect.left + rect.width / 2 ? "before" : "after";
}

export function photoSlideshowTimelineDragIncludesSourcePath(
  draggedSourcePath: string,
  sourcePath: string,
  selectedSources: ReadonlySet<string>,
): boolean {
  if (!draggedSourcePath) return false;
  if (draggedSourcePath === sourcePath) return true;
  return selectedSources.has(draggedSourcePath) && selectedSources.has(sourcePath);
}

export function photoSlideshowPlacementTargets(
  selectedSources: Iterable<string>,
  previewSourcePaths: readonly string[],
  items: ReadonlyArray<{ sourcePath?: string }>,
): string[] {
  const selected = new Set([...selectedSources].map((sourcePath) => String(sourcePath || "").trim()).filter(Boolean));
  if (!selected.size) return [];
  const ordered = previewSourcePaths.filter((sourcePath) => selected.has(sourcePath));
  if (ordered.length) return ordered;
  const orderedItems = items.map((item) => item.sourcePath || "").filter((sourcePath) => selected.has(sourcePath));
  if (orderedItems.length) return orderedItems;
  return [...selected];
}

export function photoSlideshowMotionPathPointFromClient(
  clientX: number,
  clientY: number,
  rect?: PhotoSlideshowClientRectLike | null,
): PhotoSlideshowMotionPathDraftPoint {
  if (!rect) return { x: 50, y: 50 };
  const width = Math.max(1, Number(rect.width) || 0);
  const height = Math.max(1, Number(rect.height) || 0);
  return {
    x: Math.max(0, Math.min(100, Math.round(((clientX - rect.left) / width) * 100))),
    y: Math.max(0, Math.min(100, Math.round(((clientY - rect.top) / height) * 100))),
  };
}

function cleanPhotoSlideshowMotionPathDraftPoint(point: PhotoSlideshowMotionPathDraftPoint): PhotoSlideshowMotionPathDraftPoint {
  return {
    x: Math.max(0, Math.min(100, Math.round(Number(point.x) || 0))),
    y: Math.max(0, Math.min(100, Math.round(Number(point.y) || 0))),
  };
}

export function photoSlideshowPathPointsWithAnchor(
  pathPoints: readonly PhotoSlideshowMotionPathPoint[],
  key: PhotoSlideshowMotionPathPointKey,
  point: PhotoSlideshowMotionPathDraftPoint,
): PhotoSlideshowMotionPathPoint[] {
  const cleanPoint = cleanPhotoSlideshowMotionPathDraftPoint(point);
  return pathPoints.map((pathPoint) => (
    pathPoint.key === key ? { ...pathPoint, ...cleanPoint } : pathPoint
  ));
}

export function photoSlideshowBezierControlsWithHandle(
  controls: PhotoSlideshowBezierControlPoints,
  key: "bezierControl1" | "bezierControl2",
  point: PhotoSlideshowMotionPathDraftPoint,
): PhotoSlideshowBezierControlPoints {
  const cleanPoint = cleanPhotoSlideshowMotionPathDraftPoint(point);
  return {
    control1: key === "bezierControl1" ? cleanPoint : controls.control1,
    control2: key === "bezierControl2" ? cleanPoint : controls.control2,
  };
}

export function photoSlideshowBezierControlsWithAxis(
  controls: PhotoSlideshowBezierControlPoints,
  key: "bezierControl1" | "bezierControl2",
  axis: "x" | "y",
  value: unknown,
): PhotoSlideshowBezierControlPoints {
  const current = key === "bezierControl1" ? controls.control1 : controls.control2;
  return photoSlideshowBezierControlsWithHandle(controls, key, {
    ...current,
    [axis]: Math.max(0, Math.min(100, Math.round(Number(value) || 0))),
  });
}

export function photoSlideshowMotionPathPointNudge(
  point: PhotoSlideshowMotionPathDraftPoint,
  dx: number,
  dy: number,
): PhotoSlideshowMotionPathDraftPoint {
  return {
    x: Math.max(0, Math.min(100, Math.round((Number(point.x) || 0) + dx))),
    y: Math.max(0, Math.min(100, Math.round((Number(point.y) || 0) + dy))),
  };
}

export type PhotoSlideshowDraftKeyframesInput = {
  startX: unknown;
  startY: unknown;
  quarterX: unknown;
  quarterY: unknown;
  midX: unknown;
  midY: unknown;
  threeQuarterX: unknown;
  threeQuarterY: unknown;
  endX: unknown;
  endY: unknown;
  startZoom: unknown;
  quarterZoom: unknown;
  midZoom: unknown;
  threeQuarterZoom: unknown;
  endZoom: unknown;
  curve: PhotoSlideshowMotionKeyframeCurve;
  pathEditorMode?: PhotoSlideshowPathEditorMode;
  bezierControl1X?: unknown;
  bezierControl1Y?: unknown;
  bezierControl2X?: unknown;
  bezierControl2Y?: unknown;
};

export type PhotoSlideshowKeyframeDraftState = {
  startX: number;
  startY: number;
  quarterX: number;
  quarterY: number;
  midX: number;
  midY: number;
  threeQuarterX: number;
  threeQuarterY: number;
  endX: number;
  endY: number;
  startZoom: number;
  quarterZoom: number;
  midZoom: number;
  threeQuarterZoom: number;
  endZoom: number;
  curve: PhotoSlideshowMotionKeyframeCurve;
  bezierControl1X: number;
  bezierControl1Y: number;
  bezierControl2X: number;
  bezierControl2Y: number;
  pathEditorMode: PhotoSlideshowPathEditorMode | "";
};

export function photoSlideshowDraftKeyframes(input: PhotoSlideshowDraftKeyframesInput): PhotoSlideshowMotionKeyframes {
  return cleanPhotoSlideshowMotionKeyframes({
    startX: input.startX,
    startY: input.startY,
    quarterX: input.quarterX,
    quarterY: input.quarterY,
    midX: input.midX,
    midY: input.midY,
    threeQuarterX: input.threeQuarterX,
    threeQuarterY: input.threeQuarterY,
    endX: input.endX,
    endY: input.endY,
    startZoom: input.startZoom,
    quarterZoom: input.quarterZoom,
    midZoom: input.midZoom,
    threeQuarterZoom: input.threeQuarterZoom,
    endZoom: input.endZoom,
    curve: input.curve,
    ...(input.pathEditorMode === "bezier" ? {
      pathMode: "bezier",
      bezierControl1X: input.bezierControl1X,
      bezierControl1Y: input.bezierControl1Y,
      bezierControl2X: input.bezierControl2X,
      bezierControl2Y: input.bezierControl2Y,
    } : {}),
  }) || {
    startX: 50,
    startY: 50,
    quarterX: 50,
    quarterY: 50,
    midX: 50,
    midY: 50,
    threeQuarterX: 50,
    threeQuarterY: 50,
    endX: 50,
    endY: 50,
    startZoom: 1,
    quarterZoom: 1.04,
    midZoom: 1.08,
    threeQuarterZoom: 1.08,
    endZoom: 1.08,
    curve: input.curve,
  };
}

export function photoSlideshowKeyframeDraftState(
  keyframes: PhotoSlideshowMotionKeyframes | null | undefined,
  fallbackCurve: PhotoSlideshowMotionKeyframeCurve,
): PhotoSlideshowKeyframeDraftState {
  const clean = cleanPhotoSlideshowMotionKeyframes(keyframes) || photoSlideshowDraftKeyframes({
    startX: 50,
    startY: 50,
    quarterX: 50,
    quarterY: 50,
    midX: 50,
    midY: 50,
    threeQuarterX: 50,
    threeQuarterY: 50,
    endX: 50,
    endY: 50,
    startZoom: 1,
    quarterZoom: 1.04,
    midZoom: 1.08,
    threeQuarterZoom: 1.08,
    endZoom: 1.08,
    curve: fallbackCurve,
  });
  const points = photoSlideshowMotionPathPointsFromKeyframes(clean);
  const start = points[0] || { x: 50, y: 50 };
  const quarter = points[1] || { x: 50, y: 50 };
  const mid = points[2] || { x: 50, y: 50 };
  const threeQuarter = points[3] || { x: 50, y: 50 };
  const end = points[4] || { x: 50, y: 50 };
  const midZoom = clean.midZoom ?? Math.round(((clean.startZoom + clean.endZoom) / 2) * 1000) / 1000;
  const controls = photoSlideshowBezierControlPointsFromKeyframes(clean);
  return {
    startX: start.x,
    startY: start.y,
    quarterX: quarter.x,
    quarterY: quarter.y,
    midX: mid.x,
    midY: mid.y,
    threeQuarterX: threeQuarter.x,
    threeQuarterY: threeQuarter.y,
    endX: end.x,
    endY: end.y,
    startZoom: clean.startZoom,
    quarterZoom: clean.quarterZoom ?? Math.round(((clean.startZoom + midZoom) / 2) * 1000) / 1000,
    midZoom,
    threeQuarterZoom: clean.threeQuarterZoom ?? Math.round(((midZoom + clean.endZoom) / 2) * 1000) / 1000,
    endZoom: clean.endZoom,
    curve: clean.curve || fallbackCurve,
    bezierControl1X: controls.control1.x,
    bezierControl1Y: controls.control1.y,
    bezierControl2X: controls.control2.x,
    bezierControl2Y: controls.control2.y,
    pathEditorMode: clean.pathMode === "bezier" ? "bezier" : "",
  };
}

export type PhotoSlideshowProjectEditorDraft = {
  id: string;
  name: string;
  title: string;
  themeSettings: PhotoSlideshowThemeSettings;
  music: PhotoSlideshowProject["music"];
  musicPath: string;
  audioVolumePercent: number;
  audioFadeMs: number;
  audioStartMs: number;
  audioEndMs: number;
  audioPlacementStartSourcePath: string;
  audioPlacementEndSourcePath: string;
  includeTitleCard: boolean;
  titleCardTitle: string;
  titleCardSubtitle: string;
  titleCardDurationMs: number;
  titleCardPalette: PhotoSlideshowProject["titleCardPalette"];
  titleCardLayout: PhotoSlideshowProject["titleCardLayout"];
  titleCardFontScale: PhotoSlideshowProject["titleCardFontScale"];
  titleCardShowFooter: boolean;
  sourcePaths: string[];
  timelineItems: PhotoSlideshowProjectTimelineItem[];
  slideDurationMs: number;
  slideMotion: PhotoSlideshowMotionPreset;
  focalX: number;
  focalY: number;
  cropZoom: number;
  captionLayer: PhotoSlideshowCaptionLayerChoice;
  captionDraft: PhotoSlideshowCaptionDraftLike | null;
  slideTransitionEffect: PhotoSlideshowTransitionEffect;
  slideTransitionDurationMs: number;
  keyframeDraft: PhotoSlideshowKeyframeDraftState;
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs: number;
  intervalMs: number;
  fitMode: PhotoSlideshowProject["fitMode"];
};

export function photoSlideshowProjectEditorDraft(project: PhotoSlideshowProject): PhotoSlideshowProjectEditorDraft {
  const timelineItems = project.timelineItems || [];
  const firstCropItem = timelineItems.find((item) => typeof item.focalX === "number" || typeof item.focalY === "number" || typeof item.cropZoom === "number") || null;
  const firstCaptionItem = timelineItems.find((item) => (
    photoSlideshowPrimaryCaptionActive(item)
    || cleanPhotoSlideshowCaptions(item.captions).length > 0
  )) || null;
  const captionLayer = firstCaptionItem && !photoSlideshowPrimaryCaptionActive(firstCaptionItem) && cleanPhotoSlideshowCaptions(firstCaptionItem.captions).length
    ? "block-0"
    : "primary";
  const firstTransitionItem = timelineItems.find((item) => item.transitionEffect || typeof item.transitionDurationMs === "number") || null;
  const slideTransitionEffect = firstTransitionItem?.transitionEffect || "auto";
  return {
    id: project.id,
    name: project.name,
    title: project.title,
    themeSettings: cleanPhotoSlideshowThemeSettings(project),
    music: project.music,
    musicPath: project.musicPath || "",
    audioVolumePercent: Math.round(Math.max(0, Math.min(1, project.audioVolume ?? 1)) * 100),
    audioFadeMs: Math.max(0, Math.min(10000, project.audioFadeMs ?? 0)),
    audioStartMs: Math.max(0, Math.min(3_600_000, project.audioStartMs ?? 0)),
    audioEndMs: Math.max(0, Math.min(3_600_000, project.audioEndMs ?? 0)),
    audioPlacementStartSourcePath: project.audioPlacementStartSourcePath || "",
    audioPlacementEndSourcePath: project.audioPlacementEndSourcePath || "",
    includeTitleCard: Boolean(project.includeTitleCard),
    titleCardTitle: project.titleCardTitle || project.title || "",
    titleCardSubtitle: project.titleCardSubtitle || project.sourceLabel || "",
    titleCardDurationMs: Math.max(1500, Math.min(15000, project.titleCardDurationMs ?? 3000)),
    titleCardPalette: project.titleCardPalette || "auto",
    titleCardLayout: project.titleCardLayout || "center",
    titleCardFontScale: project.titleCardFontScale || "regular",
    titleCardShowFooter: project.titleCardShowFooter !== false,
    sourcePaths: project.sourcePaths || [],
    timelineItems,
    slideDurationMs: timelineItems[0]?.durationMs || project.intervalMs || 4500,
    slideMotion: timelineItems[0]?.motion || "auto",
    focalX: cleanPhotoSlideshowFocalPercent(firstCropItem?.focalX, 50),
    focalY: cleanPhotoSlideshowFocalPercent(firstCropItem?.focalY, 50),
    cropZoom: cleanPhotoSlideshowCropZoom(firstCropItem?.cropZoom, 1),
    captionLayer,
    captionDraft: firstCaptionItem ? photoSlideshowCaptionDraftForLayer(firstCaptionItem, captionLayer) : null,
    slideTransitionEffect,
    slideTransitionDurationMs: photoSlideshowTransitionDurationDraft(slideTransitionEffect, firstTransitionItem?.transitionDurationMs ?? project.transitionDurationMs ?? 650),
    keyframeDraft: photoSlideshowKeyframeDraftState(timelineItems.find((item) => item.keyframes)?.keyframes, "smooth"),
    transitionEffect: project.transitionEffect || "auto",
    transitionDurationMs: Math.max(0, Math.min(3000, project.transitionDurationMs ?? 650)),
    intervalMs: project.intervalMs,
    fitMode: project.fitMode,
  };
}

export function emptyPhotoSlideshowProjectEditorDraft(): PhotoSlideshowProjectEditorDraft {
  return {
    id: "",
    name: "",
    title: "",
    themeSettings: cleanPhotoSlideshowThemeSettings(null),
    music: "none",
    musicPath: "",
    audioVolumePercent: 100,
    audioFadeMs: 0,
    audioStartMs: 0,
    audioEndMs: 0,
    audioPlacementStartSourcePath: "",
    audioPlacementEndSourcePath: "",
    includeTitleCard: false,
    titleCardTitle: "",
    titleCardSubtitle: "",
    titleCardDurationMs: 3000,
    titleCardPalette: "auto",
    titleCardLayout: "center",
    titleCardFontScale: "regular",
    titleCardShowFooter: true,
    sourcePaths: [],
    timelineItems: [],
    slideDurationMs: 4500,
    slideMotion: "auto",
    focalX: 50,
    focalY: 50,
    cropZoom: 1,
    captionLayer: "primary",
    captionDraft: null,
    slideTransitionEffect: "auto",
    slideTransitionDurationMs: 650,
    keyframeDraft: photoSlideshowKeyframeDraftState(null, "smooth"),
    transitionEffect: "auto",
    transitionDurationMs: 650,
    intervalMs: 4500,
    fitMode: "fit",
  };
}

export type PhotoSlideshowProjectSaveDraft = Omit<PhotoSlideshowProject, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type PhotoSlideshowProjectSaveSourcePathsInput = {
  selectedProject?: Pick<PhotoSlideshowProject, "sourcePaths"> | null;
  selectedSources?: Iterable<string>;
  editorSourcePaths?: unknown;
  queueSourceItems?: PhotoSlideshowProjectItemLike[];
};

export function photoSlideshowProjectSaveSourcePaths(input: PhotoSlideshowProjectSaveSourcePathsInput): string[] {
  const editorSourcePaths = cleanPhotoSlideshowSourcePaths(input.editorSourcePaths);
  const selectedSources = cleanPhotoSlideshowSourcePaths([...(input.selectedSources || [])]);
  const selectedSet = new Set(selectedSources);
  const queueSourceItems = input.queueSourceItems || [];
  if (selectedSources.length) {
    const editorMatchesSelection = Boolean(
      editorSourcePaths.length === selectedSources.length
      && editorSourcePaths.every((sourcePath) => selectedSet.has(sourcePath)),
    );
    return editorMatchesSelection ? editorSourcePaths : photoSlideshowProjectSourcePaths(queueSourceItems, selectedSet);
  }
  if (editorSourcePaths.length) return editorSourcePaths;
  if (input.selectedProject) return cleanPhotoSlideshowSourcePaths(input.selectedProject.sourcePaths);
  return photoSlideshowProjectSourcePaths(queueSourceItems);
}

export type PhotoSlideshowProjectSaveDraftInput = PhotoSlideshowProjectSaveSourcePathsInput & {
  selectedProject?: Pick<PhotoSlideshowProject, "id" | "sourcePaths" | "sourceLabel"> | null;
  projectName?: unknown;
  projectTitle?: unknown;
  activeName?: unknown;
  labels?: {
    slideshow?: string;
    selection?: string;
    currentView?: string;
  };
  themeSettings?: PhotoSlideshowThemeSettingsInput | null;
  music: PhotoSlideshowProject["music"];
  musicPath?: unknown;
  audioVolumePercent?: unknown;
  audioFadeMs?: unknown;
  audioStartMs?: unknown;
  audioEndMs?: unknown;
  audioPlacementStartSourcePath?: unknown;
  audioPlacementEndSourcePath?: unknown;
  includeTitleCard: boolean;
  titleCardTitle?: unknown;
  titleCardSubtitle?: unknown;
  titleCardDurationMs?: unknown;
  titleCardPalette: PhotoSlideshowProject["titleCardPalette"];
  titleCardLayout: PhotoSlideshowProject["titleCardLayout"];
  titleCardFontScale: PhotoSlideshowProject["titleCardFontScale"];
  titleCardShowFooter: boolean;
  timelineItems?: unknown;
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs?: unknown;
  intervalMs: number;
  fitMode: PhotoSlideshowProject["fitMode"];
};

function cleanPhotoSlideshowDraftText(value: unknown): string {
  return String(value ?? "").trim();
}

function clampPhotoSlideshowDraftNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  const clean = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, clean));
}

const PHOTO_SLIDESHOW_MEMORY_MUSIC_OPTIONS: readonly PhotoSlideshowProject["music"][] = ["none", "calm", "bright", "cinematic", "custom"];
const PHOTO_SLIDESHOW_MEMORY_FIT_OPTIONS: readonly PhotoSlideshowProject["fitMode"][] = ["fit", "fill"];
const PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_PALETTE_OPTIONS: readonly PhotoSlideshowTitleCardPalette[] = ["auto", "midnight", "paper", "sunset", "forest"];
const PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_LAYOUT_OPTIONS: readonly PhotoSlideshowTitleCardLayout[] = ["center", "lower-third", "left"];
const PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_FONT_SCALE_OPTIONS: readonly PhotoSlideshowTitleCardFontScale[] = ["compact", "regular", "large"];
const PHOTO_SLIDESHOW_MEMORY_TRANSITION_OPTIONS: readonly PhotoSlideshowTransitionEffect[] = ["auto", "cut", "fade", "dissolve", "zoom"];

function cleanPhotoSlideshowMemoryChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? value as T : fallback;
}

function cleanPhotoSlideshowMemoryAudioVolumePercent(value: unknown): number {
  const parsed = Number(value);
  const ratio = Number.isFinite(parsed) ? parsed : 1;
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

export function photoSlideshowProjectSaveDraft(input: PhotoSlideshowProjectSaveDraftInput): PhotoSlideshowProjectSaveDraft | null {
  const selectedSources = cleanPhotoSlideshowSourcePaths([...(input.selectedSources || [])]);
  const sourcePaths = photoSlideshowProjectSaveSourcePaths({ ...input, selectedSources });
  if (!sourcePaths.length) return null;
  const labels = {
    slideshow: input.labels?.slideshow || "Slideshow",
    selection: input.labels?.selection || "Selection",
    currentView: input.labels?.currentView || "Current view",
  };
  const projectTitle = cleanPhotoSlideshowDraftText(input.projectTitle);
  const activeName = cleanPhotoSlideshowDraftText(input.activeName);
  const name = cleanPhotoSlideshowDraftText(input.projectName) || projectTitle || activeName || labels.slideshow;
  const sourceLabel = selectedSources.length
    ? labels.selection
    : input.selectedProject
      ? cleanPhotoSlideshowDraftText(input.selectedProject.sourceLabel) || activeName || labels.currentView
      : activeName || labels.currentView;
  const intervalMs = Number.isFinite(Number(input.intervalMs)) ? Number(input.intervalMs) : 4500;
  const audioPlacementStartSourcePath = cleanPhotoSlideshowDraftText(input.audioPlacementStartSourcePath);
  const audioPlacementEndSourcePath = cleanPhotoSlideshowDraftText(input.audioPlacementEndSourcePath);
  return {
    id: input.selectedProject?.id,
    name,
    title: projectTitle || name,
    sourceLabel,
    sourcePaths,
    ...cleanPhotoSlideshowThemeSettings(input.themeSettings),
    music: input.music,
    musicPath: input.music === "custom" ? cleanPhotoSlideshowDraftText(input.musicPath) : "",
    audioVolume: clampPhotoSlideshowDraftNumber(input.audioVolumePercent, 0, 100, 100) / 100,
    audioFadeMs: clampPhotoSlideshowDraftNumber(input.audioFadeMs, 0, 10000, 0),
    audioStartMs: clampPhotoSlideshowDraftNumber(input.audioStartMs, 0, 3_600_000, 0),
    audioEndMs: clampPhotoSlideshowDraftNumber(input.audioEndMs, 0, 3_600_000, 0),
    audioPlacementStartSourcePath: sourcePaths.includes(audioPlacementStartSourcePath) ? audioPlacementStartSourcePath : "",
    audioPlacementEndSourcePath: sourcePaths.includes(audioPlacementEndSourcePath) ? audioPlacementEndSourcePath : "",
    includeTitleCard: input.includeTitleCard,
    titleCardTitle: cleanPhotoSlideshowDraftText(input.titleCardTitle) || projectTitle || name,
    titleCardSubtitle: cleanPhotoSlideshowDraftText(input.titleCardSubtitle) || sourceLabel,
    titleCardDurationMs: clampPhotoSlideshowDraftNumber(input.titleCardDurationMs, 1500, 15000, 3000),
    titleCardPalette: input.titleCardPalette,
    titleCardLayout: input.titleCardLayout,
    titleCardFontScale: input.titleCardFontScale,
    titleCardShowFooter: input.titleCardShowFooter,
    timelineItems: cleanPhotoSlideshowTimelineItems(input.timelineItems, sourcePaths, intervalMs),
    transitionEffect: input.transitionEffect,
    transitionDurationMs: photoSlideshowTransitionDurationDraft(input.transitionEffect, input.transitionDurationMs),
    intervalMs,
    fitMode: input.fitMode,
  };
}

export type PhotoSlideshowMemoryMovieSettingsPayloadInput = {
  themeSettings?: PhotoSlideshowThemeSettingsInput | null;
  music: PhotoSlideshowProject["music"];
  musicPath?: unknown;
  audioVolumePercent?: unknown;
  audioFadeMs?: unknown;
  audioStartMs?: unknown;
  audioEndMs?: unknown;
  audioPlacementStartSourcePath?: unknown;
  audioPlacementEndSourcePath?: unknown;
  includeTitleCard: boolean;
  titleCardTitle?: unknown;
  titleCardSubtitle?: unknown;
  titleCardDurationMs?: unknown;
  titleCardPalette: PhotoSlideshowProject["titleCardPalette"];
  titleCardLayout: PhotoSlideshowProject["titleCardLayout"];
  titleCardFontScale: PhotoSlideshowProject["titleCardFontScale"];
  titleCardShowFooter: boolean;
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs?: unknown;
  intervalMs: number;
  fitMode: PhotoSlideshowProject["fitMode"];
};

export function photoSlideshowMemoryMovieSettingsPayload(
  input: PhotoSlideshowMemoryMovieSettingsPayloadInput,
): NonNullable<PhotoMemory["movieSettings"]> {
  return {
    ...cleanPhotoSlideshowThemeSettings(input.themeSettings),
    music: input.music,
    musicPath: input.music === "custom" ? cleanPhotoSlideshowDraftText(input.musicPath) : "",
    audioVolume: clampPhotoSlideshowDraftNumber(input.audioVolumePercent, 0, 100, 100) / 100,
    audioFadeMs: clampPhotoSlideshowDraftNumber(input.audioFadeMs, 0, 10000, 0),
    audioStartMs: clampPhotoSlideshowDraftNumber(input.audioStartMs, 0, 3_600_000, 0),
    audioEndMs: clampPhotoSlideshowDraftNumber(input.audioEndMs, 0, 3_600_000, 0),
    audioPlacementStartSourcePath: cleanPhotoSlideshowDraftText(input.audioPlacementStartSourcePath),
    audioPlacementEndSourcePath: cleanPhotoSlideshowDraftText(input.audioPlacementEndSourcePath),
    includeTitleCard: input.includeTitleCard,
    titleCardTitle: cleanPhotoSlideshowDraftText(input.titleCardTitle),
    titleCardSubtitle: cleanPhotoSlideshowDraftText(input.titleCardSubtitle),
    titleCardDurationMs: clampPhotoSlideshowDraftNumber(input.titleCardDurationMs, 1500, 15000, 3000),
    titleCardPalette: input.titleCardPalette,
    titleCardLayout: input.titleCardLayout,
    titleCardFontScale: input.titleCardFontScale,
    titleCardShowFooter: input.titleCardShowFooter,
    transitionEffect: input.transitionEffect,
    transitionDurationMs: photoSlideshowTransitionDurationDraft(input.transitionEffect, input.transitionDurationMs),
    intervalMs: clampPhotoSlideshowDraftNumber(input.intervalMs, 1500, 15000, 4500),
    fitMode: input.fitMode,
  };
}

export type PhotoSlideshowMemoryMovieEditorDraft = {
  themeSettings: PhotoSlideshowThemeSettings;
  music: PhotoSlideshowProject["music"];
  musicPath: string;
  audioVolumePercent: number;
  audioFadeMs: number;
  audioStartMs: number;
  audioEndMs: number;
  audioPlacementStartSourcePath: string;
  audioPlacementEndSourcePath: string;
  includeTitleCard: boolean;
  titleCardTitle: string;
  titleCardSubtitle: string;
  titleCardDurationMs: number;
  titleCardPalette: PhotoSlideshowProject["titleCardPalette"];
  titleCardLayout: PhotoSlideshowProject["titleCardLayout"];
  titleCardFontScale: PhotoSlideshowProject["titleCardFontScale"];
  titleCardShowFooter: boolean;
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs: number;
  intervalMs: number;
  fitMode: PhotoSlideshowProject["fitMode"];
};

export function photoSlideshowMemoryMovieEditorDraft(
  settings: PhotoMemory["movieSettings"] | null | undefined,
  fallbackIntervalMs = 4500,
): PhotoSlideshowMemoryMovieEditorDraft | null {
  if (!settings) return null;
  const music = cleanPhotoSlideshowMemoryChoice(settings.music, PHOTO_SLIDESHOW_MEMORY_MUSIC_OPTIONS, "calm");
  const transitionEffect = cleanPhotoSlideshowMemoryChoice(
    settings.transitionEffect,
    PHOTO_SLIDESHOW_MEMORY_TRANSITION_OPTIONS,
    "auto",
  );
  const fallbackInterval = clampPhotoSlideshowDraftNumber(fallbackIntervalMs, 1500, 15000, 4500);
  return {
    themeSettings: cleanPhotoSlideshowThemeSettings(settings, "ken-burns"),
    music,
    musicPath: music === "custom" ? cleanPhotoSlideshowDraftText(settings.musicPath || settings.audioPath) : "",
    audioVolumePercent: cleanPhotoSlideshowMemoryAudioVolumePercent(settings.audioVolume),
    audioFadeMs: clampPhotoSlideshowDraftNumber(settings.audioFadeMs, 0, 10000, 0),
    audioStartMs: clampPhotoSlideshowDraftNumber(settings.audioStartMs, 0, 3_600_000, 0),
    audioEndMs: clampPhotoSlideshowDraftNumber(settings.audioEndMs, 0, 3_600_000, 0),
    audioPlacementStartSourcePath: cleanPhotoSlideshowDraftText(settings.audioPlacementStartSourcePath),
    audioPlacementEndSourcePath: cleanPhotoSlideshowDraftText(settings.audioPlacementEndSourcePath),
    includeTitleCard: settings.includeTitleCard !== false,
    titleCardTitle: cleanPhotoSlideshowDraftText(settings.titleCardTitle),
    titleCardSubtitle: cleanPhotoSlideshowDraftText(settings.titleCardSubtitle),
    titleCardDurationMs: clampPhotoSlideshowDraftNumber(settings.titleCardDurationMs, 1500, 15000, 3000),
    titleCardPalette: cleanPhotoSlideshowMemoryChoice(settings.titleCardPalette, PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_PALETTE_OPTIONS, "auto"),
    titleCardLayout: cleanPhotoSlideshowMemoryChoice(settings.titleCardLayout, PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_LAYOUT_OPTIONS, "center"),
    titleCardFontScale: cleanPhotoSlideshowMemoryChoice(settings.titleCardFontScale, PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_FONT_SCALE_OPTIONS, "regular"),
    titleCardShowFooter: settings.titleCardShowFooter !== false,
    transitionEffect,
    transitionDurationMs: photoSlideshowTransitionDurationDraft(transitionEffect, settings.transitionDurationMs),
    intervalMs: clampPhotoSlideshowDraftNumber(settings.intervalMs, 1500, 15000, fallbackInterval),
    fitMode: cleanPhotoSlideshowMemoryChoice(settings.fitMode, PHOTO_SLIDESHOW_MEMORY_FIT_OPTIONS, "fill"),
  };
}

export type PhotoSlideshowMemoryMovieExportSettingsInput = PhotoSlideshowMemoryMovieSettingsPayloadInput & {
  settings?: PhotoMemory["movieSettings"] | null;
  memoryTitle?: unknown;
  memorySourceLabel?: unknown;
  timelineItems?: unknown;
  sourcePaths?: readonly string[];
};

export type PhotoSlideshowMemoryMovieExportSettings = PhotoSlideshowThemeSettings & {
  music: PhotoSlideshowProject["music"];
  audioPath: string;
  audioVolume: number;
  audioFadeMs: number;
  audioStartMs: number;
  audioEndMs: number;
  audioPlacementStartSourcePath: string;
  audioPlacementEndSourcePath: string;
  includeTitleCard: boolean;
  titleCardTitle: string;
  titleCardSubtitle: string;
  titleCardDurationMs: number;
  titleCardPalette: PhotoSlideshowProject["titleCardPalette"];
  titleCardLayout: PhotoSlideshowProject["titleCardLayout"];
  titleCardFontScale: PhotoSlideshowProject["titleCardFontScale"];
  titleCardShowFooter: boolean;
  timelineItems: PhotoSlideshowProjectTimelineItem[];
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs: number;
  intervalMs: number;
  fitMode: PhotoSlideshowProject["fitMode"];
};

export function photoSlideshowMemoryMovieExportSettings(
  input: PhotoSlideshowMemoryMovieExportSettingsInput,
): PhotoSlideshowMemoryMovieExportSettings {
  const fallback = photoSlideshowMemoryMovieSettingsPayload(input);
  const source = input.settings && typeof input.settings === "object" ? input.settings : {};
  const savedValue = <T,>(key: keyof NonNullable<PhotoMemory["movieSettings"]>, fallbackValue: T): T => {
    const value = source[key];
    return value === undefined || value === null ? fallbackValue : value as T;
  };
  const savedMusicPath = cleanPhotoSlideshowDraftText(savedValue("musicPath", savedValue("audioPath", fallback.musicPath || "")));
  const savedMusic = cleanPhotoSlideshowMemoryChoice(
    savedValue("music", fallback.music),
    PHOTO_SLIDESHOW_MEMORY_MUSIC_OPTIONS,
    fallback.music as PhotoSlideshowProject["music"],
  );
  const music = savedMusic === "custom" ? (savedMusicPath ? "custom" : "calm") : savedMusic;
  const transitionEffect = cleanPhotoSlideshowMemoryChoice(
    savedValue("transitionEffect", fallback.transitionEffect),
    PHOTO_SLIDESHOW_MEMORY_TRANSITION_OPTIONS,
    fallback.transitionEffect as PhotoSlideshowTransitionEffect,
  );
  const intervalMs = clampPhotoSlideshowDraftNumber(savedValue("intervalMs", fallback.intervalMs), 1500, 15000, fallback.intervalMs || 4500);
  const titleCardTitleFallback = cleanPhotoSlideshowDraftText(fallback.titleCardTitle) || cleanPhotoSlideshowDraftText(input.memoryTitle);
  const titleCardSubtitleFallback = cleanPhotoSlideshowDraftText(fallback.titleCardSubtitle) || cleanPhotoSlideshowDraftText(input.memorySourceLabel);
  return {
    ...cleanPhotoSlideshowThemeSettings({
      theme: savedValue("theme", fallback.theme),
      themeTimelinePreset: savedValue("themeTimelinePreset", fallback.themeTimelinePreset),
      themeTemplateName: savedValue("themeTemplateName", fallback.themeTemplateName),
      themeTemplatePalette: savedValue("themeTemplatePalette", fallback.themeTemplatePalette),
      themeTemplateTypography: savedValue("themeTemplateTypography", fallback.themeTemplateTypography),
      themeTemplateBackdrop: savedValue("themeTemplateBackdrop", fallback.themeTemplateBackdrop),
      themeTemplateLayout: savedValue("themeTemplateLayout", fallback.themeTemplateLayout),
      themeTemplateBackdropIntensity: savedValue("themeTemplateBackdropIntensity", fallback.themeTemplateBackdropIntensity),
      themeTemplateStageWidth: savedValue("themeTemplateStageWidth", fallback.themeTemplateStageWidth),
      themeTemplateFrameStyle: savedValue("themeTemplateFrameStyle", fallback.themeTemplateFrameStyle),
      themeTemplateChromeDensity: savedValue("themeTemplateChromeDensity", fallback.themeTemplateChromeDensity),
      themeTemplateCaptionPreset: savedValue("themeTemplateCaptionPreset", fallback.themeTemplateCaptionPreset),
      themeTemplateRegionMap: savedValue("themeTemplateRegionMap", fallback.themeTemplateRegionMap),
    }, "ken-burns"),
    music,
    audioPath: music === "custom" ? savedMusicPath : "",
    audioVolume: clampPhotoSlideshowDraftNumber(savedValue("audioVolume", fallback.audioVolume), 0, 1, fallback.audioVolume ?? 1),
    audioFadeMs: clampPhotoSlideshowDraftNumber(savedValue("audioFadeMs", fallback.audioFadeMs), 0, 10000, fallback.audioFadeMs ?? 0),
    audioStartMs: clampPhotoSlideshowDraftNumber(savedValue("audioStartMs", fallback.audioStartMs), 0, 3_600_000, fallback.audioStartMs ?? 0),
    audioEndMs: clampPhotoSlideshowDraftNumber(savedValue("audioEndMs", fallback.audioEndMs), 0, 3_600_000, fallback.audioEndMs ?? 0),
    audioPlacementStartSourcePath: cleanPhotoSlideshowDraftText(savedValue("audioPlacementStartSourcePath", fallback.audioPlacementStartSourcePath || "")),
    audioPlacementEndSourcePath: cleanPhotoSlideshowDraftText(savedValue("audioPlacementEndSourcePath", fallback.audioPlacementEndSourcePath || "")),
    includeTitleCard: savedValue("includeTitleCard", input.includeTitleCard) !== false,
    titleCardTitle: cleanPhotoSlideshowDraftText(savedValue("titleCardTitle", fallback.titleCardTitle)) || titleCardTitleFallback,
    titleCardSubtitle: cleanPhotoSlideshowDraftText(savedValue("titleCardSubtitle", fallback.titleCardSubtitle)) || titleCardSubtitleFallback,
    titleCardDurationMs: clampPhotoSlideshowDraftNumber(savedValue("titleCardDurationMs", fallback.titleCardDurationMs), 1500, 15000, fallback.titleCardDurationMs ?? 3000),
    titleCardPalette: cleanPhotoSlideshowMemoryChoice(savedValue("titleCardPalette", fallback.titleCardPalette), PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_PALETTE_OPTIONS, fallback.titleCardPalette as PhotoSlideshowProject["titleCardPalette"]),
    titleCardLayout: cleanPhotoSlideshowMemoryChoice(savedValue("titleCardLayout", fallback.titleCardLayout), PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_LAYOUT_OPTIONS, fallback.titleCardLayout as PhotoSlideshowProject["titleCardLayout"]),
    titleCardFontScale: cleanPhotoSlideshowMemoryChoice(savedValue("titleCardFontScale", fallback.titleCardFontScale), PHOTO_SLIDESHOW_MEMORY_TITLE_CARD_FONT_SCALE_OPTIONS, fallback.titleCardFontScale as PhotoSlideshowProject["titleCardFontScale"]),
    titleCardShowFooter: savedValue("titleCardShowFooter", fallback.titleCardShowFooter) !== false,
    timelineItems: cleanPhotoSlideshowTimelineItems(input.timelineItems, [...(input.sourcePaths || [])], intervalMs),
    transitionEffect,
    transitionDurationMs: photoSlideshowTransitionDurationDraft(transitionEffect, savedValue("transitionDurationMs", fallback.transitionDurationMs)),
    intervalMs,
    fitMode: cleanPhotoSlideshowMemoryChoice(savedValue("fitMode", fallback.fitMode), PHOTO_SLIDESHOW_MEMORY_FIT_OPTIONS, fallback.fitMode as PhotoSlideshowProject["fitMode"]),
  };
}

export function photoSlideshowPathPolyline(points: readonly PhotoSlideshowMotionPathDraftPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function photoSlideshowCaptionRegionDraft(
  xValue: unknown,
  yValue: unknown,
  widthValue: unknown,
  heightValue: unknown,
): PhotoSlideshowCaptionRegionDraft {
  const x = cleanPhotoSlideshowCaptionPercent(xValue, 6);
  const y = cleanPhotoSlideshowCaptionPercent(yValue, 72);
  return {
    x,
    y,
    width: Math.min(cleanPhotoSlideshowCaptionSizePercent(widthValue, 42), Math.max(1, 100 - x)),
    height: Math.min(cleanPhotoSlideshowCaptionSizePercent(heightValue, 12), Math.max(1, 100 - y)),
  };
}

export function photoSlideshowTemplateRegionForSlot(
  captionPreset: PhotoSlideshowThemeTemplateCaptionPreset,
  layout: PhotoSlideshowThemeTemplateLayout,
  regionMap: PhotoSlideshowThemeTemplateRegionMap | Record<string, unknown> | null | undefined,
  slot: PhotoSlideshowThemeTemplateRegionSlot,
): PhotoSlideshowCaptionRegion {
  const resolvedMap = photoSlideshowResolvedRegionMap(captionPreset, layout, regionMap);
  return resolvedMap[slot] || DEFAULT_PHOTO_SLIDESHOW_TEMPLATE_REGION;
}

export function photoSlideshowTemplateRegionMapWithSlotPatch(
  regionMap: PhotoSlideshowThemeTemplateRegionMap | Record<string, unknown> | null | undefined,
  slot: PhotoSlideshowThemeTemplateRegionSlot,
  patch: Partial<PhotoSlideshowCaptionRegion>,
  fallbackRegion: PhotoSlideshowCaptionRegion = DEFAULT_PHOTO_SLIDESHOW_TEMPLATE_REGION,
): PhotoSlideshowThemeTemplateRegionMap {
  const currentMap = cleanPhotoSlideshowThemeTemplateRegionMap(regionMap);
  const currentRegion = currentMap[slot] || fallbackRegion;
  const x = cleanPhotoSlideshowCaptionPercent(patch.x ?? currentRegion.x, currentRegion.x);
  const y = cleanPhotoSlideshowCaptionPercent(patch.y ?? currentRegion.y, currentRegion.y);
  const width = Math.min(cleanPhotoSlideshowCaptionSizePercent(patch.width ?? currentRegion.width, currentRegion.width), Math.max(1, 100 - x));
  const height = Math.min(cleanPhotoSlideshowCaptionSizePercent(patch.height ?? currentRegion.height, currentRegion.height), Math.max(1, 100 - y));
  return cleanPhotoSlideshowThemeTemplateRegionMap({
    ...currentMap,
    [slot]: { x, y, width, height },
  });
}

export type PhotoSlideshowCaptionPresetCompositionInput = {
  index: number;
  sourceCount: number;
  existing?: PhotoSlideshowProjectTimelineItem | null;
  captionPreset: PhotoSlideshowThemeTemplateCaptionPreset;
  layout: PhotoSlideshowThemeTemplateLayout;
  regionMap?: PhotoSlideshowThemeTemplateRegionMap | Record<string, unknown> | null;
  captionText?: unknown;
  fallbackLabel?: unknown;
  projectLabel?: unknown;
  sourceLabel?: unknown;
  formatCount?: (value: number) => string;
};

export function photoSlideshowCaptionPresetComposition(
  input: PhotoSlideshowCaptionPresetCompositionInput,
): { primary: PhotoSlideshowCaptionDraftLike; captions: PhotoSlideshowCaption[] } {
  const index = Math.max(0, Math.floor(Number(input.index) || 0));
  const sourceCount = Math.max(1, Math.floor(Number(input.sourceCount) || 1));
  const formatCount = input.formatCount || ((value: number) => String(value));
  const preset = photoSlideshowResolvedCaptionPreset(input.captionPreset, input.layout);
  const primaryText = cleanPhotoSlideshowCaptionText(input.captionText || input.existing?.captionText || input.fallbackLabel || `Slide ${index + 1}`);
  const projectLabel = cleanPhotoSlideshowCaptionText(input.projectLabel);
  const sourceLabel = cleanPhotoSlideshowCaptionText(input.sourceLabel || projectLabel);
  const counterLabel = `${formatCount(index + 1)} / ${formatCount(sourceCount)}`;
  const seen = new Set([primaryText].filter(Boolean).map((value) => value.toLocaleLowerCase()));
  const captions: PhotoSlideshowCaption[] = [];
  const resolvedRegions = photoSlideshowResolvedRegionMap(input.captionPreset, input.layout, input.regionMap);

  const addCaption = (
    id: string,
    text: string,
    captionPlacement: PhotoSlideshowCaptionPlacement,
    captionRegion: PhotoSlideshowCaption["captionRegion"],
    captionTypography: PhotoSlideshowCaptionTypography = "auto",
    captionWrap: PhotoSlideshowCaptionWrap = "auto",
  ) => {
    if (captions.length >= PHOTO_SLIDESHOW_CAPTION_LIMIT) return;
    const captionText = cleanPhotoSlideshowCaptionText(text);
    const key = captionText.toLocaleLowerCase();
    if (!captionText || seen.has(key)) return;
    const block = cleanPhotoSlideshowCaption({
      id,
      captionText,
      captionPlacement,
      captionRegion,
      captionTypography,
      captionWrap,
    }, captions.length);
    if (!block) return;
    seen.add(key);
    captions.push(block);
  };

  if (preset === "title-subtitle") {
    addCaption("subtitle", projectLabel || sourceLabel || counterLabel, "lower-left", resolvedRegions.context, "editorial", "single-line");
    addCaption("counter", counterLabel, "lower-right", resolvedRegions.counter, "clean", "single-line");
    return {
      primary: {
        captionText: primaryText,
        captionPlacement: "upper-left",
        captionRegion: resolvedRegions.primary,
        captionTypography: "bold",
        captionWrap: "two-line",
      },
      captions,
    };
  }

  if (preset === "split-story") {
    addCaption("context", sourceLabel || projectLabel || counterLabel, "upper-right", resolvedRegions.context, "clean", "single-line");
    addCaption("counter", counterLabel, "lower-right", resolvedRegions.counter, "bold", "single-line");
    return {
      primary: {
        captionText: primaryText,
        captionPlacement: "lower-left",
        captionRegion: resolvedRegions.primary,
        captionTypography: "editorial",
        captionWrap: "multi-line",
      },
      captions,
    };
  }

  if (preset === "gallery-labels") {
    addCaption("collection", sourceLabel || projectLabel || counterLabel, "upper-left", resolvedRegions.context, "bold", "single-line");
    addCaption("counter", counterLabel, "lower-right", resolvedRegions.counter, "clean", "single-line");
    return {
      primary: {
        captionText: primaryText,
        captionPlacement: "lower-left",
        captionRegion: resolvedRegions.primary,
        captionTypography: "clean",
        captionWrap: "single-line",
      },
      captions,
    };
  }

  if (preset === "cinema-bars") {
    addCaption("context", sourceLabel || projectLabel || counterLabel, "upper-center", resolvedRegions.context, "clean", "single-line");
    addCaption("counter", counterLabel, "upper-right", resolvedRegions.counter, "bold", "single-line");
    return {
      primary: {
        captionText: primaryText,
        captionPlacement: "lower-center",
        captionRegion: resolvedRegions.primary,
        captionTypography: "cinematic",
        captionWrap: "two-line",
      },
      captions,
    };
  }

  addCaption("context", sourceLabel || projectLabel || counterLabel, "lower-right", resolvedRegions.context, "clean", "single-line");
  addCaption("counter", counterLabel, "upper-right", resolvedRegions.counter, "bold", "single-line");
  return {
    primary: {
      captionText: primaryText,
      captionPlacement: "lower-left",
      captionRegion: resolvedRegions.primary,
      captionTypography: "clean",
      captionWrap: "two-line",
    },
    captions,
  };
}

export function resizePhotoSlideshowCaptionRegionDraft(
  region: PhotoSlideshowCaptionRegionDraft,
  mode: Exclude<PhotoSlideshowCaptionRegionDragMode, "move">,
  dx: number,
  dy: number,
): PhotoSlideshowCaptionRegionDraft {
  let left = region.x;
  let top = region.y;
  let right = region.x + region.width;
  let bottom = region.y + region.height;
  if (mode === "resize-northwest" || mode === "resize-southwest") left += dx;
  if (mode === "resize-northeast" || mode === "resize-southeast") right += dx;
  if (mode === "resize-northwest" || mode === "resize-northeast") top += dy;
  if (mode === "resize-southwest" || mode === "resize-southeast") bottom += dy;
  left = Math.max(0, Math.min(left, right - 1));
  top = Math.max(0, Math.min(top, bottom - 1));
  right = Math.max(left + 1, Math.min(100, right));
  bottom = Math.max(top + 1, Math.min(100, bottom));
  return photoSlideshowCaptionRegionDraft(left, top, right - left, bottom - top);
}

export function photoSlideshowKeyframeLabel(keyframes?: PhotoSlideshowMotionKeyframes | null): string {
  if (!keyframes) return "";
  const curveLabel = photoSlideshowKeyframeCurveLabel(keyframes.curve);
  const bezierLabel = keyframes.pathMode === "bezier" && typeof keyframes.bezierControl1X === "number" && typeof keyframes.bezierControl1Y === "number" && typeof keyframes.bezierControl2X === "number" && typeof keyframes.bezierControl2Y === "number"
    ? `Bezier handles ${keyframes.bezierControl1X},${keyframes.bezierControl1Y} / ${keyframes.bezierControl2X},${keyframes.bezierControl2Y}`
    : "";
  const midX = typeof keyframes.midX === "number" ? keyframes.midX : Math.round((keyframes.startX + keyframes.endX) / 2);
  const midY = typeof keyframes.midY === "number" ? keyframes.midY : Math.round((keyframes.startY + keyframes.endY) / 2);
  const midZoom = keyframes.midZoom ?? ((keyframes.startZoom + keyframes.endZoom) / 2);
  const hasQuarterPath = typeof keyframes.quarterX === "number"
    || typeof keyframes.quarterY === "number"
    || typeof keyframes.quarterZoom === "number"
    || typeof keyframes.threeQuarterX === "number"
    || typeof keyframes.threeQuarterY === "number"
    || typeof keyframes.threeQuarterZoom === "number";
  if (hasQuarterPath) {
    const quarterX = typeof keyframes.quarterX === "number" ? keyframes.quarterX : Math.round((keyframes.startX + midX) / 2);
    const quarterY = typeof keyframes.quarterY === "number" ? keyframes.quarterY : Math.round((keyframes.startY + midY) / 2);
    const threeQuarterX = typeof keyframes.threeQuarterX === "number" ? keyframes.threeQuarterX : Math.round((midX + keyframes.endX) / 2);
    const threeQuarterY = typeof keyframes.threeQuarterY === "number" ? keyframes.threeQuarterY : Math.round((midY + keyframes.endY) / 2);
    const quarterZoom = keyframes.quarterZoom ?? ((keyframes.startZoom + midZoom) / 2);
    const threeQuarterZoom = keyframes.threeQuarterZoom ?? ((midZoom + keyframes.endZoom) / 2);
    return [`Path ${keyframes.startX},${keyframes.startY}->${quarterX},${quarterY}->${midX},${midY}->${threeQuarterX},${threeQuarterY}->${keyframes.endX},${keyframes.endY} · ${keyframes.startZoom.toFixed(2)}x->${quarterZoom.toFixed(2)}x->${midZoom.toFixed(2)}x->${threeQuarterZoom.toFixed(2)}x->${keyframes.endZoom.toFixed(2)}x`, bezierLabel, curveLabel].filter(Boolean).join(" · ");
  }
  if (typeof keyframes.midX === "number" && typeof keyframes.midY === "number") {
    return [`Path ${keyframes.startX},${keyframes.startY}->${midX},${midY}->${keyframes.endX},${keyframes.endY} · ${keyframes.startZoom.toFixed(2)}x->${midZoom.toFixed(2)}x->${keyframes.endZoom.toFixed(2)}x`, bezierLabel, curveLabel].filter(Boolean).join(" · ");
  }
  return [`Path ${keyframes.startX},${keyframes.startY}->${keyframes.endX},${keyframes.endY} · ${keyframes.startZoom.toFixed(2)}x->${keyframes.endZoom.toFixed(2)}x`, bezierLabel, curveLabel].filter(Boolean).join(" · ");
}

export function photoSlideshowKeyframeTransformVars(keyframes?: PhotoSlideshowMotionKeyframes | null): CSSProperties {
  if (!keyframes) return {};
  const startX = (50 - keyframes.startX) * 0.12;
  const startY = (50 - keyframes.startY) * 0.08;
  const endX = (50 - keyframes.endX) * 0.12;
  const endY = (50 - keyframes.endY) * 0.08;
  const midX = typeof keyframes.midX === "number" ? (50 - keyframes.midX) * 0.12 : (startX + endX) / 2;
  const midY = typeof keyframes.midY === "number" ? (50 - keyframes.midY) * 0.08 : (startY + endY) / 2;
  const quarterX = typeof keyframes.quarterX === "number" ? (50 - keyframes.quarterX) * 0.12 : (startX + midX) / 2;
  const quarterY = typeof keyframes.quarterY === "number" ? (50 - keyframes.quarterY) * 0.08 : (startY + midY) / 2;
  const threeQuarterX = typeof keyframes.threeQuarterX === "number" ? (50 - keyframes.threeQuarterX) * 0.12 : (midX + endX) / 2;
  const threeQuarterY = typeof keyframes.threeQuarterY === "number" ? (50 - keyframes.threeQuarterY) * 0.08 : (midY + endY) / 2;
  const midZoom = keyframes.midZoom ?? ((keyframes.startZoom + keyframes.endZoom) / 2);
  const quarterZoom = keyframes.quarterZoom ?? ((keyframes.startZoom + midZoom) / 2);
  const threeQuarterZoom = keyframes.threeQuarterZoom ?? ((midZoom + keyframes.endZoom) / 2);
  return {
    "--photo-slideshow-keyframe-start-x": `${startX.toFixed(2)}%`,
    "--photo-slideshow-keyframe-start-y": `${startY.toFixed(2)}%`,
    "--photo-slideshow-keyframe-quarter-x": `${quarterX.toFixed(2)}%`,
    "--photo-slideshow-keyframe-quarter-y": `${quarterY.toFixed(2)}%`,
    "--photo-slideshow-keyframe-mid-x": `${midX.toFixed(2)}%`,
    "--photo-slideshow-keyframe-mid-y": `${midY.toFixed(2)}%`,
    "--photo-slideshow-keyframe-three-quarter-x": `${threeQuarterX.toFixed(2)}%`,
    "--photo-slideshow-keyframe-three-quarter-y": `${threeQuarterY.toFixed(2)}%`,
    "--photo-slideshow-keyframe-end-x": `${endX.toFixed(2)}%`,
    "--photo-slideshow-keyframe-end-y": `${endY.toFixed(2)}%`,
    "--photo-slideshow-keyframe-start-zoom": keyframes.startZoom.toFixed(3),
    "--photo-slideshow-keyframe-quarter-zoom": quarterZoom.toFixed(3),
    "--photo-slideshow-keyframe-mid-zoom": midZoom.toFixed(3),
    "--photo-slideshow-keyframe-three-quarter-zoom": threeQuarterZoom.toFixed(3),
    "--photo-slideshow-keyframe-end-zoom": keyframes.endZoom.toFixed(3),
    "--photo-slideshow-keyframe-timing": photoSlideshowKeyframeTiming(keyframes.curve),
  } as CSSProperties;
}
