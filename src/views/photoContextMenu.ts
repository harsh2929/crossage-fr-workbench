import type { ReactNode } from "react";

import type { PhotoRailSectionId } from "./photoRailVisibility";

export type PhotoContextMenuState =
  | { kind: "photo"; x: number; y: number; sourcePath: string; itemIndex: number }
  | { kind: "folder"; x: number; y: number; folderId: string; sectionId: PhotoRailSectionId; canMoveUp: boolean; canMoveDown: boolean }
  | { kind: "savedFilter"; x: number; y: number; filterId: string; canMoveUp: boolean; canMoveDown: boolean };

export type PhotoContextMenuItem = {
  key: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
};

export function photoContextMenuPosition(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };
  const menuWidth = 244;
  const menuHeight = 360;
  return {
    x: Math.max(12, Math.min(x, window.innerWidth - menuWidth - 12)),
    y: Math.max(12, Math.min(y, window.innerHeight - menuHeight - 12)),
  };
}
