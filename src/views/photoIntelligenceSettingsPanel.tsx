import { AudioLines, Download, Gauge, RefreshCw } from "lucide-react";
import type { PhotoIndexingPowerMode, PhotoLocalSettings, PhotoVisionModelTier } from "./photoSettings";

type PhotoIntelligenceSettingsPanelText = (value: string) => string;

export type PhotoIntelligenceSettings = Pick<
  PhotoLocalSettings,
  | "localIntelligenceEnabled"
  | "noNetworkIntelligence"
  | "modelSourceDisclosure"
  | "petModelRecognitionEnabled"
  | "backgroundIndexingPaused"
  | "backgroundIndexingAutoRun"
  | "indexingPowerMode"
  | "visionModelTier"
>;

export type PhotoIntelligenceSettingsPatch = Partial<PhotoIntelligenceSettings>;

export type PhotoIntelligenceSettingsPanelProps = {
  settings: PhotoIntelligenceSettings;
  petRecognitionStatusText: string;
  petRecognitionWarn: boolean;
  visionModelStatusText: string;
  visionModelWarn: boolean;
  visionModelBusy: boolean;
  audioModelStatusText: string;
  audioModelWarn: boolean;
  runtimeStatusText: string;
  runtimeStatusWarn: boolean;
  runtimeStatusBusy: boolean;
  uiText: PhotoIntelligenceSettingsPanelText;
  onChange: (patch: PhotoIntelligenceSettingsPatch) => void;
  onRefreshVisionModel: () => void;
  onInstallVisionModel: (tier: "quality" | "low-memory") => void;
  onRefreshAudioRuntime: () => void;
};

export function PhotoIntelligenceSettingsPanel(props: PhotoIntelligenceSettingsPanelProps) {
  return (
    <>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.localIntelligenceEnabled}
          onChange={(event) => props.onChange({ localIntelligenceEnabled: event.currentTarget.checked })}
        />
        <span>{props.uiText("Local intelligence")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.noNetworkIntelligence}
          onChange={(event) => props.onChange({ noNetworkIntelligence: event.currentTarget.checked })}
        />
        <span>{props.uiText("No-network intelligence")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.modelSourceDisclosure}
          onChange={(event) => props.onChange({ modelSourceDisclosure: event.currentTarget.checked })}
        />
        <span>{props.uiText("Model/source disclosure")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.petModelRecognitionEnabled}
          onChange={(event) => props.onChange({ petModelRecognitionEnabled: event.currentTarget.checked })}
        />
        <span>{props.uiText("Pet model recognition")}</span>
      </label>
      <div className={props.petRecognitionWarn ? "photo-settings-note warn" : "photo-settings-note"}>
        <small>{props.petRecognitionStatusText}</small>
      </div>
      <label>
        <span>{props.uiText("Caption and tag model")}</span>
        <select
          value={props.settings.visionModelTier}
          onChange={(event) => props.onChange({ visionModelTier: event.currentTarget.value as PhotoVisionModelTier })}
        >
          <option value="auto">{props.uiText("Automatic")}</option>
          <option value="quality">{props.uiText("Qwen3-VL quality")}</option>
          <option value="low-memory">{props.uiText("SmolVLM2 low memory")}</option>
        </select>
      </label>
      <div className={props.visionModelWarn ? "photo-settings-note warn" : "photo-settings-note"}>
        <small>{props.visionModelStatusText}</small>
      </div>
      <div className="photo-settings-inline-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={props.uiText("Refresh caption model status")}
          title={props.uiText("Refresh caption model status")}
          disabled={props.visionModelBusy}
          onClick={props.onRefreshVisionModel}
        >
          <RefreshCw size={15} />
        </button>
        <button
          type="button"
          className="secondary"
          disabled={props.visionModelBusy}
          onClick={() => props.onInstallVisionModel("low-memory")}
        >
          <Download size={15} />
          <span>{props.uiText("Install low-memory model")}</span>
        </button>
        <button
          type="button"
          className="secondary"
          disabled={props.visionModelBusy}
          onClick={() => props.onInstallVisionModel("quality")}
        >
          <Download size={15} />
          <span>{props.uiText("Install quality model")}</span>
        </button>
      </div>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.backgroundIndexingPaused}
          onChange={(event) => props.onChange({ backgroundIndexingPaused: event.currentTarget.checked })}
        />
        <span>{props.uiText("Pause indexing")}</span>
      </label>
      <label className="photo-rule-toggle">
        <input
          type="checkbox"
          checked={props.settings.backgroundIndexingAutoRun}
          onChange={(event) => props.onChange({ backgroundIndexingAutoRun: event.currentTarget.checked })}
        />
        <span>{props.uiText("Auto-run indexing queue")}</span>
      </label>
      <label>
        <span>{props.uiText("Indexing budget")}</span>
        <select
          value={props.settings.indexingPowerMode}
          onChange={(event) => props.onChange({ indexingPowerMode: event.currentTarget.value as PhotoIndexingPowerMode })}
        >
          <option value="low">{props.uiText("Low")}</option>
          <option value="balanced">{props.uiText("Balanced")}</option>
          <option value="performance">{props.uiText("Performance")}</option>
        </select>
      </label>
      <div className={props.audioModelWarn ? "photo-settings-note warn" : "photo-settings-note"}>
        <AudioLines size={14} />
        <small>{props.audioModelStatusText}</small>
      </div>
      <div className={props.runtimeStatusWarn ? "photo-settings-note warn" : "photo-settings-note"}>
        <Gauge size={14} />
        <small>{props.runtimeStatusText}</small>
        <button
          type="button"
          className="icon-button"
          aria-label={props.uiText("Refresh audio and runtime status")}
          title={props.uiText("Refresh audio and runtime status")}
          disabled={props.runtimeStatusBusy}
          onClick={props.onRefreshAudioRuntime}
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </>
  );
}
