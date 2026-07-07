// Reusable segmented sub-navigation used inside the Tools / People & Pets /
// Settings tabs. Implemented as an ARIA tablist with roving tabindex + arrow-key
// navigation so it is keyboard-operable like a native tab strip.
import type { KeyboardEvent } from "react";

interface SectionTabsProps<T extends string> {
  ariaLabel: string;
  items: ReadonlyArray<{ key: T; label: string; badge?: string }>;
  active: T;
  onSelect: (key: T) => void;
}

export function SectionTabs<T extends string>({ ariaLabel, items, active, onSelect }: SectionTabsProps<T>) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    onSelect(items[next].key);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    buttons?.[next]?.focus();
  }
  return (
    <nav className="section-tabs" aria-label={ariaLabel} role="tablist">
      {items.map((item, index) => {
        const isActive = active === item.key;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            className={`section-tab${isActive ? " active" : ""}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(item.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span>{item.label}</span>
            {item.badge && <span className="section-tab-badge">{item.badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}
