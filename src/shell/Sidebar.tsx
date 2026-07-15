// Presentational sidebar: brand lockup, primary nav, engine-mode card, and a
// footer cluster (language + first-use guide). The footer absorbed the two
// chrome controls that had no other natural home after the App-folder top bar
// was removed; the slim .language-picker keeps the same selector the e2e setup
// relies on, reachable on first load. Phase 1 added the contextual rail here.
import { BookOpen, ChevronRight } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { languageOptions, type LanguageCode, type TranslationKey } from "../i18n";
import type { NavMeta, NavTab, TabKey } from "./navModel";

interface SidebarProps {
  tabs: NavTab[];
  activeTab: TabKey;
  onSelect: (key: TabKey) => void;
  navMeta: NavMeta;
  t: (key: TranslationKey) => string;
  iconUrl: string;
  isDemoMode: boolean;
  engineBadge: string;
  engineTitle: string;
  language: LanguageCode;
  onChangeLanguage: (value: string) => void;
  openOnboarding: () => void;
  onManageEngine: () => void;
}

export function Sidebar(props: SidebarProps) {
  const { tabs, activeTab, onSelect, navMeta, t, iconUrl, isDemoMode, engineBadge, engineTitle } = props;
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const nav = navRef.current;
      const active = nav?.querySelector<HTMLElement>(`[data-tab="${activeTab}"]`);
      if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
      const navRect = nav.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      if (activeRect.left < navRect.left || activeRect.right > navRect.right) {
        active.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab]);

  function handleNavigationKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const rtl = window.getComputedStyle(navRef.current || event.currentTarget).direction === "rtl";
    let next = -1;
    if (event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "ArrowRight") next = rtl ? (index === 0 ? last : index - 1) : (index === last ? 0 : index + 1);
    else if (event.key === "ArrowLeft") next = rtl ? (index === last ? 0 : index + 1) : (index === 0 ? last : index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next < 0) return;
    event.preventDefault();
    onSelect(tabs[next].key);
    navRef.current?.querySelectorAll<HTMLButtonElement>("button[data-tab]")[next]?.focus();
  }

  return (
    <aside className="sidebar">
      <div className="brand brand--lockup">
        <div className="brand-mark">
          <img src={iconUrl} alt="" />
        </div>
        <div className="brand-text">
          <strong className="brand-name">Vintrace</strong>
          <span className="brand-subtitle">{t("app.subtitle")}</span>
        </div>
      </div>
      <nav ref={navRef} className="nav-list" aria-label="Primary navigation">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              data-tab={tab.key}
              className={activeTab === tab.key ? "active" : ""}
              onClick={() => onSelect(tab.key)}
              aria-current={activeTab === tab.key ? "page" : undefined}
              aria-label={navMeta[tab.key]?.label ? `${t(tab.labelKey)} ${navMeta[tab.key]?.label}` : t(tab.labelKey)}
              title={t(tab.labelKey)}
              tabIndex={activeTab === tab.key ? 0 : -1}
              onKeyDown={(event) => handleNavigationKey(event, index)}
            >
              <Icon size={18} />
              <span className="nav-label">{t(tab.labelKey)}</span>
              {navMeta[tab.key] && <span className={`nav-badge ${navMeta[tab.key]?.tone}`}>{navMeta[tab.key]?.label}</span>}
            </button>
          );
        })}
      </nav>
      <button type="button" className="sidebar-engine-summary" onClick={props.onManageEngine} title={engineTitle}>
        <span className={isDemoMode ? "sidebar-engine-dot amber" : "sidebar-engine-dot green"} aria-hidden="true" />
        <span className="sidebar-engine-copy">
          <strong>{isDemoMode ? "Simple engine" : "Full model"}</strong>
          <small>{engineBadge}</small>
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      <div className="sidebar-footer">
        <label className="language-picker" title={t("language.title")}>
          <span>{t("language.label")}</span>
          <select
            value={props.language}
            onChange={(event) => props.onChangeLanguage(event.currentTarget.value)}
            aria-label={t("language.title")}
          >
            {languageOptions.map((option) => (
              <option key={option.code} value={option.code}>{option.nativeLabel}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="sidebar-guide-button"
          onClick={props.openOnboarding}
          title={t("topbar.guide")}
          aria-label={t("topbar.guide")}
        >
          <BookOpen size={18} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
