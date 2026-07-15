// Navigation model for the Photos-first app shell.
// Primary tabs are the photos-first destinations + a first-class AI Agents
// destination + Tools (recognition engine) + Settings. The legacy recognition tabs
// are folded into Tools / People & Pets and routed via legacyTabTarget(), so every
// existing deep-link keeps working and nothing is left un-wired.
import { Bot, Images, LayoutGrid, Search, Settings, Sparkles, Users, Wrench } from "lucide-react";
import type { TranslationKey } from "../i18n";

export type TabKey = "library" | "memories" | "albums" | "search" | "agents" | "people" | "tools" | "settings";
export type LegacyTab = "dashboard" | "enroll" | "scan" | "review" | "photos" | "agents" | "settings";
export type ToolsSection = "overview" | "scan" | "models" | "diagnostics";
export type PeopleSection = "browse" | "enroll" | "review";
export type SettingsSection = "general" | "engine" | "privacy" | "storage" | "advanced" | "agents";

export type NavTab = { key: TabKey; labelKey: TranslationKey; icon: typeof Images };
export type NavMeta = Partial<Record<TabKey, { label: string; tone: "green" | "amber" | "blue" }>>;

export const tabs: NavTab[] = [
  { key: "library", labelKey: "nav.library", icon: Images },
  { key: "memories", labelKey: "nav.memories", icon: Sparkles },
  { key: "albums", labelKey: "nav.albums", icon: LayoutGrid },
  { key: "search", labelKey: "nav.search", icon: Search },
  { key: "agents", labelKey: "nav.agents", icon: Bot },
  { key: "people", labelKey: "nav.peoplePets", icon: Users },
  { key: "tools", labelKey: "nav.tools", icon: Wrench },
  { key: "settings", labelKey: "nav.settings", icon: Settings },
];

// Tabs whose body is the shared PhotosView, and the rail section each one seeds.
export const PHOTOS_BACKED_TABS: TabKey[] = ["library", "memories", "albums"];
export const PHOTO_TAB_ACTIVE_ID: Partial<Record<TabKey, string>> = {
  library: "all",
  memories: "memories",
  albums: "albums",
};

export interface NavTarget {
  tab: TabKey;
  toolsSection?: ToolsSection;
  peopleSection?: PeopleSection;
  settingsSection?: SettingsSection;
}

// Map a legacy recognition tab to its new home in the Photos-first IA.
export function legacyTabTarget(tab: LegacyTab): NavTarget {
  switch (tab) {
    case "dashboard":
      return { tab: "tools", toolsSection: "overview" };
    case "scan":
      return { tab: "tools", toolsSection: "scan" };
    case "enroll":
      return { tab: "people", peopleSection: "enroll" };
    case "review":
      return { tab: "people", peopleSection: "review" };
    case "photos":
      return { tab: "library" };
    case "agents":
      return { tab: "agents" };
    case "settings":
      return { tab: "settings", settingsSection: "general" };
  }
}
