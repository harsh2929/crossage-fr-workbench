from __future__ import annotations

from pathlib import Path
import ctypes
import os
import platform
import shutil
import subprocess
from typing import Any


NETWORK_FS_TYPES = {
    "9p",
    "afpfs",
    "cifs",
    "davfs",
    "fuse.sshfs",
    "nfs",
    "nfs4",
    "smbfs",
    "sshfs",
    "webdav",
}


def safe_resolve(path: Path) -> Path:
    try:
        return path.expanduser().resolve()
    except (OSError, RuntimeError):
        return path.expanduser().absolute()


def safe_is_mount(path: Path) -> bool:
    try:
        return path.is_mount()
    except (OSError, NotImplementedError):
        return False


def _path_device(path: Path) -> int | None:
    current = path
    while True:
        try:
            return current.stat().st_dev
        except OSError:
            parent = current.parent
            if parent == current:
                return None
            current = parent


def _windows_drive_type(path: Path) -> tuple[str, str]:
    drive = path.drive or Path.cwd().drive
    if not drive:
        return "unknown", ""
    root = f"{drive}\\"
    try:
        drive_type = ctypes.windll.kernel32.GetDriveTypeW(root)
    except Exception:
        return "unknown", root
    labels = {
        0: "unknown",
        1: "unmounted",
        2: "removable",
        3: "fixed",
        4: "network",
        5: "optical",
        6: "ramdisk",
    }
    return labels.get(int(drive_type), "unknown"), root


def _posix_mount_root(path: Path) -> Path:
    try:
        current = path if path.exists() else path.parent
    except OSError:
        current = path.parent
    while current != current.parent:
        if safe_is_mount(current):
            return current
        current = current.parent
    return current


def _decode_mount_path(value: str) -> str:
    return value.replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")


def _posix_mount_fs_type(mount_root: str) -> str:
    system = platform.system().lower()
    if system == "linux":
        try:
            for line in Path("/proc/mounts").read_text(encoding="utf-8", errors="replace").splitlines():
                parts = line.split()
                if len(parts) >= 3 and _decode_mount_path(parts[1]) == mount_root:
                    return parts[2].casefold()
        except OSError:
            return ""
    if system == "darwin":
        try:
            result = subprocess.run(["/sbin/mount"], check=False, capture_output=True, text=True, timeout=2)
        except (OSError, subprocess.SubprocessError):
            return ""
        marker = f" on {mount_root} ("
        for line in result.stdout.splitlines():
            if marker in line:
                return line.split(marker, 1)[1].split(")", 1)[0].split(",", 1)[0].strip().casefold()
    return ""


def _volume_kind(path: Path, mount_root: str, fs_type: str = "") -> str:
    system = platform.system().lower()
    text = str(path)
    root_text = mount_root.replace("\\", "/")
    if fs_type.casefold() in NETWORK_FS_TYPES:
        return "network"
    if system == "windows":
        kind, _root = _windows_drive_type(path)
        return kind
    if system == "darwin":
        if text.startswith("/Volumes/"):
            return "removable"
        if text.startswith("/Network/") or root_text.startswith("/Network/"):
            return "network"
        return "fixed"
    if text.startswith(("/media/", "/mnt/", "/run/media/")) or root_text.startswith(("/media/", "/mnt/", "/run/media/")):
        return "removable"
    if text.startswith(("/net/", "/nfs/", "/smb/")) or root_text.startswith(("/net/", "/nfs/", "/smb/")):
        return "network"
    return "fixed"


def inspect_storage_path(path: Path, workspace_root: Path | None = None) -> dict[str, Any]:
    resolved = safe_resolve(path)
    try:
        exists = resolved.exists()
        is_dir = resolved.is_dir()
        is_file = resolved.is_file()
    except OSError:
        exists = False
        is_dir = False
        is_file = False
    mount = _posix_mount_root(resolved)
    if platform.system().lower() == "windows":
        kind, root = _windows_drive_type(resolved)
        mount_root = root or str(mount)
        fs_type = ""
    else:
        mount_root = str(mount)
        fs_type = _posix_mount_fs_type(mount_root)
        kind = _volume_kind(resolved, mount_root, fs_type)
    try:
        usage = shutil.disk_usage(mount_root if mount_root else resolved)
        total_bytes = int(usage.total)
        free_bytes = int(usage.free)
    except OSError:
        total_bytes = 0
        free_bytes = 0
    source_device = _path_device(resolved)
    workspace_device = _path_device(safe_resolve(workspace_root)) if workspace_root else None
    same_volume_as_workspace = bool(source_device is not None and workspace_device is not None and source_device == workspace_device)
    readable = os.access(resolved, os.R_OK)
    traversable = os.access(resolved, os.X_OK) if is_dir else True
    warnings: list[str] = []
    if kind in {"removable", "optical"}:
        warnings.append("This looks like an external or removable drive. Keep it connected until the scan finishes.")
    if kind == "network":
        warnings.append("This looks like a network drive. Scans may pause or fail if the connection drops.")
    if exists and is_dir and not (readable and traversable):
        warnings.append("The folder is not fully readable. Some subfolders may be skipped.")
    if total_bytes and free_bytes / max(total_bytes, 1) < 0.03:
        warnings.append("The drive is almost full. Use an app folder on a drive with more free space.")
    if workspace_root and same_volume_as_workspace and kind in {"removable", "network", "optical"}:
        warnings.append("The app folder appears to be on the same external/network drive; use an internal app folder for safer resumes.")
    return {
        "path": str(resolved),
        "exists": exists,
        "isDirectory": is_dir,
        "isFile": is_file,
        "mountRoot": mount_root,
        "fsType": fs_type,
        "volumeKind": kind,
        "externalLikely": kind in {"removable", "optical"},
        "networkLikely": kind == "network",
        "readable": readable,
        "traversable": traversable,
        "sourceDevice": source_device,
        "workspaceDevice": workspace_device,
        "sameVolumeAsWorkspace": same_volume_as_workspace,
        "totalBytes": total_bytes,
        "freeBytes": free_bytes,
        "warnings": warnings,
    }
