import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { FolderTree } from "./types";

export interface FolderTreeSelectionState {
  folderTree: FolderTree | null;
  setFolderTree: Dispatch<SetStateAction<FolderTree | null>>;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  recursive: boolean;
  setRecursive: Dispatch<SetStateAction<boolean>>;
  excludedDirs: Set<string>;
  setExcludedDirs: Dispatch<SetStateAction<Set<string>>>;
}

export function useFolderTreeSelectionState(folder: string): FolderTreeSelectionState {
  const [folderTree, setFolderTree] = useState<FolderTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [excludedDirs, setExcludedDirs] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setFolderTree(null);
    setError(null);
    setExcludedDirs(new Set<string>());
    setRecursive(true);
  }, [folder]);

  return {
    folderTree,
    setFolderTree,
    loading,
    setLoading,
    error,
    setError,
    recursive,
    setRecursive,
    excludedDirs,
    setExcludedDirs,
  };
}
