import type {
  PhotoExportFilenameMode,
  PhotoExportLayout,
} from "./photoExportPresets";

type PhotoExportPackagingControlsProps = {
  layout: PhotoExportLayout;
  filenameMode: PhotoExportFilenameMode;
  filenameTemplate: string;
  subfolderTemplate: string;
  includeMetadata: boolean;
  includeXmp: boolean;
  includeExistingSidecars: boolean;
  stripLocation: boolean;
  shareAfterExport: boolean;
  uiText: (value: string) => string;
  onLayoutChange: (layout: PhotoExportLayout) => void;
  onFilenameModeChange: (mode: PhotoExportFilenameMode) => void;
  onFilenameTemplateChange: (template: string) => void;
  onSubfolderTemplateChange: (template: string) => void;
  onIncludeMetadataChange: (includeMetadata: boolean) => void;
  onIncludeXmpChange: (includeXmp: boolean) => void;
  onIncludeExistingSidecarsChange: (includeExistingSidecars: boolean) => void;
  onStripLocationChange: (stripLocation: boolean) => void;
  onShareAfterExportChange: (shareAfterExport: boolean) => void;
};

export function PhotoExportPackagingControls({
  layout,
  filenameMode,
  filenameTemplate,
  subfolderTemplate,
  includeMetadata,
  includeXmp,
  includeExistingSidecars,
  stripLocation,
  shareAfterExport,
  uiText,
  onLayoutChange,
  onFilenameModeChange,
  onFilenameTemplateChange,
  onSubfolderTemplateChange,
  onIncludeMetadataChange,
  onIncludeXmpChange,
  onIncludeExistingSidecarsChange,
  onStripLocationChange,
  onShareAfterExportChange,
}: PhotoExportPackagingControlsProps) {
  return (
    <>
      <label>
        <span>{uiText("Layout")}</span>
        <select value={layout} onChange={(event) => onLayoutChange(event.currentTarget.value as PhotoExportLayout)}>
          <option value="bundle">{uiText("Bundle with media folder")}</option>
          <option value="flat">{uiText("Flat original export")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Filename")}</span>
        <select value={filenameMode} onChange={(event) => onFilenameModeChange(event.currentTarget.value as PhotoExportFilenameMode)}>
          <option value="numbered">{uiText("Numbered filenames")}</option>
          <option value="original">{uiText("Original filenames")}</option>
          <option value="template">{uiText("Template filenames")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Name template")}</span>
        <input
          aria-label={uiText("Filename template")}
          type="text"
          value={filenameTemplate}
          onChange={(event) => onFilenameTemplateChange(event.currentTarget.value)}
          disabled={filenameMode !== "template"}
          placeholder="{sequence}-{title}"
        />
      </label>
      <label>
        <span>{uiText("Subfolders")}</span>
        <input
          aria-label={uiText("Subfolder template")}
          type="text"
          value={subfolderTemplate}
          onChange={(event) => onSubfolderTemplateChange(event.currentTarget.value)}
          placeholder="{date}/{album}"
        />
      </label>
      <label className="photo-rule-toggle">
        <input type="checkbox" checked={includeMetadata} onChange={(event) => onIncludeMetadataChange(event.currentTarget.checked)} />
        <span>{uiText("Metadata JSON")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input type="checkbox" checked={includeXmp} onChange={(event) => onIncludeXmpChange(event.currentTarget.checked)} />
        <span>{uiText("XMP sidecars")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input type="checkbox" checked={includeExistingSidecars} onChange={(event) => onIncludeExistingSidecarsChange(event.currentTarget.checked)} />
        <span>{uiText("Existing sidecars")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input type="checkbox" checked={stripLocation} onChange={(event) => onStripLocationChange(event.currentTarget.checked)} />
        <span>{uiText("Strip location")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input type="checkbox" checked={shareAfterExport} onChange={(event) => onShareAfterExportChange(event.currentTarget.checked)} />
        <span>{uiText("Share after export")}</span>
      </label>
    </>
  );
}
