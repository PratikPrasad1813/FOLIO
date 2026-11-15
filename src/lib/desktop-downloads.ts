/**
 * Desktop release version. Keep in sync with src-tauri/tauri.conf.json,
 * src-tauri/Cargo.toml and package.json - the installer file names below are
 * produced from it by the release workflow (git tag v<version>).
 */
export const DESKTOP_APP_VERSION = "1.3.0";
const V = DESKTOP_APP_VERSION;

export const DESKTOP_DOWNLOADS = {
  "windows-exe": {
    platform: "windows",
    platformName: "Windows",
    label: "Windows installer (.exe)",
    detail: "64-bit Windows",
    fileName: `Folio_${V}_x64-setup.exe`,
    url: `https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/Folio_${V}_x64-setup.exe`,
  },
  "windows-msi": {
    platform: "windows",
    platformName: "Windows",
    label: "Windows package (.msi)",
    detail: "64-bit Windows",
    fileName: `Folio_${V}_x64_en-US.msi`,
    url: `https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/Folio_${V}_x64_en-US.msi`,
  },
  "macos-dmg": {
    platform: "macos",
    platformName: "macOS",
    label: "macOS universal disk image (.dmg)",
    detail: "Apple Silicon and Intel",
    fileName: `Folio_${V}_universal.dmg`,
    url: `https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/Folio_${V}_universal.dmg`,
  },
  "linux-deb": {
    platform: "linux",
    platformName: "Linux",
    label: "Linux package (.deb)",
    detail: "Debian and Ubuntu, x86_64",
    fileName: `folio_${V}_amd64.deb`,
    url: `https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/folio_${V}_amd64.deb`,
  },
  "linux-appimage": {
    platform: "linux",
    platformName: "Linux",
    label: "Linux image (.AppImage)",
    detail: "Portable x86_64 package",
    fileName: `Folio_${V}_amd64.AppImage`,
    url: `https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/Folio_${V}_amd64.AppImage`,
  },
} as const;

export type DesktopDownloadId = keyof typeof DESKTOP_DOWNLOADS;
export type DesktopDownload = (typeof DESKTOP_DOWNLOADS)[DesktopDownloadId];

function isDesktopDownloadId(id: string): id is DesktopDownloadId {
  return Object.hasOwn(DESKTOP_DOWNLOADS, id);
}

export function getDesktopDownload(id: string | undefined): DesktopDownload | null {
  if (!id || !isDesktopDownloadId(id)) return null;
  return DESKTOP_DOWNLOADS[id];
}

export function getDesktopDownloadHref(id: DesktopDownloadId): string {
  return `/download?package=${id}`;
}
