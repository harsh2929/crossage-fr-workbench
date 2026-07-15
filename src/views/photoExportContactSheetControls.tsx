import type {
  PhotoContactSheetCaptionPreset,
  PhotoContactSheetFormat,
  PhotoContactSheetLayoutPreset,
  PhotoContactSheetPageSize,
} from "./photoExportPresets";

type PhotoExportContactSheetControlsProps = {
  format: PhotoContactSheetFormat;
  title: string;
  captionPreset: PhotoContactSheetCaptionPreset;
  pageSize: PhotoContactSheetPageSize;
  layout: PhotoContactSheetLayoutPreset;
  columns: string;
  thumbnailSize: string;
  includeCaptions: boolean;
  uiText: (value: string) => string;
  onFormatChange: (format: PhotoContactSheetFormat) => void;
  onTitleChange: (title: string) => void;
  onCaptionPresetChange: (preset: PhotoContactSheetCaptionPreset) => void;
  onPageSizeChange: (pageSize: PhotoContactSheetPageSize) => void;
  onLayoutChange: (layout: PhotoContactSheetLayoutPreset) => void;
  onColumnsChange: (columns: string) => void;
  onThumbnailSizeChange: (thumbnailSize: string) => void;
  onIncludeCaptionsChange: (includeCaptions: boolean) => void;
};

export function PhotoExportContactSheetControls({
  format,
  title,
  captionPreset,
  pageSize,
  layout,
  columns,
  thumbnailSize,
  includeCaptions,
  uiText,
  onFormatChange,
  onTitleChange,
  onCaptionPresetChange,
  onPageSizeChange,
  onLayoutChange,
  onColumnsChange,
  onThumbnailSizeChange,
  onIncludeCaptionsChange,
}: PhotoExportContactSheetControlsProps) {
  const customLayout = layout === "custom";

  return (
    <>
      <label>
        <span>{uiText("Contact format")}</span>
        <select value={format} onChange={(event) => onFormatChange(event.currentTarget.value as PhotoContactSheetFormat)}>
          <option value="pdf">{uiText("PDF")}</option>
          <option value="png">{uiText("PNG")}</option>
          <option value="jpeg">{uiText("JPEG")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Contact title")}</span>
        <input
          aria-label={uiText("Contact sheet title")}
          type="text"
          value={title}
          onChange={(event) => onTitleChange(event.currentTarget.value)}
          placeholder={uiText("Vintrace contact sheet")}
        />
      </label>
      <label>
        <span>{uiText("Page size")}</span>
        <select value={pageSize} onChange={(event) => onPageSizeChange(event.currentTarget.value as PhotoContactSheetPageSize)}>
          <option value="letter">{uiText("Letter")}</option>
          <option value="a4">{uiText("A4")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Print layout")}</span>
        <select value={layout} onChange={(event) => onLayoutChange(event.currentTarget.value as PhotoContactSheetLayoutPreset)}>
          <option value="custom">{uiText("Custom grid")}</option>
          <option value="full_page">{uiText("Full page")}</option>
          <option value="two_up">{uiText("2-up")}</option>
          <option value="four_up">{uiText("4-up")}</option>
          <option value="wallet">{uiText("Wallet")}</option>
        </select>
      </label>
      <label className="photo-rule-toggle">
        <input type="checkbox" checked={includeCaptions} onChange={(event) => onIncludeCaptionsChange(event.currentTarget.checked)} />
        <span>{uiText("Contact captions")}</span>
      </label>
      <label>
        <span>{uiText("Caption details")}</span>
        <select
          value={captionPreset}
          onChange={(event) => onCaptionPresetChange(event.currentTarget.value as PhotoContactSheetCaptionPreset)}
          disabled={!includeCaptions}
        >
          <option value="title_date_people">{uiText("Title, date, people")}</option>
          <option value="metadata">{uiText("Metadata")}</option>
          <option value="filename">{uiText("Filename")}</option>
        </select>
      </label>
      <label>
        <span>{uiText("Contact columns")}</span>
        <input
          aria-label={uiText("Contact sheet columns")}
          type="number"
          min={1}
          max={8}
          step={1}
          value={columns}
          onChange={(event) => onColumnsChange(event.currentTarget.value)}
          disabled={!customLayout}
        />
      </label>
      <label>
        <span>{uiText("Contact tile")}</span>
        <input
          aria-label={uiText("Contact sheet thumbnail size")}
          type="number"
          min={96}
          max={512}
          step={16}
          value={thumbnailSize}
          onChange={(event) => onThumbnailSizeChange(event.currentTarget.value)}
          disabled={!customLayout}
        />
      </label>
    </>
  );
}
