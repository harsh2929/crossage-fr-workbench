import { Clock } from "lucide-react";
import type { PhotoRepairHistoryValue } from "../types";
import { formatDateText } from "./photoDisplayText";
import { photoRepairHistoryEventDetails } from "./photoRepairCenter";

type PhotoRepairHistoryListText = (value: string) => string;

export type PhotoRepairHistoryListProps = {
  value: PhotoRepairHistoryValue | null;
  uiText: PhotoRepairHistoryListText;
};

export function PhotoRepairHistoryList(props: PhotoRepairHistoryListProps) {
  const events = props.value?.events || [];
  if (!events.length) return null;
  return (
    <div className="photo-repair-history-list" aria-label={props.uiText("Recent repair history")}>
      <div className="photo-repair-history-head">
        <Clock size={14} />
        <strong>{props.uiText("Recent repair history")}</strong>
      </div>
      {events.slice(0, 5).map((event, index) => {
        const status = String(event.status || "").toLowerCase();
        const needsAttention = event.ok === false || ["attention", "blocked", "error", "failed", "warning"].includes(status);
        const repaired = ["ready", "recorded", "repaired", "saved"].includes(status);
        const rowClassName = `photo-repair-history-row${needsAttention ? " warn" : repaired ? " ok" : ""}`;
        const historyDetails = photoRepairHistoryEventDetails(event);
        return (
          <article key={`${event.seq || 0}:${event.action}:${event.at}:${index}`} className={rowClassName}>
            <span className="photo-repair-history-icon">
              <Clock size={13} />
            </span>
            <div>
              <strong>{props.uiText(event.label || event.action)}</strong>
              <small>{event.summary || props.uiText("Repair activity recorded.")}</small>
              {historyDetails.length > 0 && (
                <div className="photo-repair-history-details">
                  {historyDetails.map((detail) => (
                    <span key={detail.key}>{props.uiText(detail.label)}: {detail.value}</span>
                  ))}
                </div>
              )}
            </div>
            <small className="photo-repair-history-date">{formatDateText(event.at)}</small>
          </article>
        );
      })}
    </div>
  );
}
