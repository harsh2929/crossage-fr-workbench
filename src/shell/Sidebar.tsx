// Presentational sidebar: brand lockup, primary nav, engine-mode card, and a
// footer cluster (language + first-use guide). The footer absorbed the two
// chrome controls that had no other natural home after the App-folder top bar
// was removed; the slim .language-picker keeps the same selector the e2e setup
// relies on, reachable on first load. Phase 1 added the contextual rail here.
import { BookOpen, ChevronRight } from "lucide-react";
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
      <nav className="nav-list" aria-label="Primary navigation">
        {tabs.map((tab) => {
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
            >
              <Icon size={18} />
              <span className="nav-label">{t(tab.labelKey)}</span>
              {navMeta[tab.key] && <span className={`nav-badge ${navMeta[tab.key]?.tone}`}>{navMeta[tab.key]?.label}</span>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-card">
        <span className="subtle">Mode</span>
        <strong>{isDemoMode ? "Simple engine" : "Full model"}</strong>
        <span className={isDemoMode ? "pill amber" : "pill green"} title={engineTitle}>{engineBadge}</span>
        <button type="button" className="sidebar-card-manage" onClick={props.onManageEngine}>
          <span>Manage engine</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
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
