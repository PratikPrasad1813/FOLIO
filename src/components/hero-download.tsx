"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Apple, ChevronDown, Download, Globe2, Monitor, Terminal } from "lucide-react";

type DesktopPlatform = "windows" | "macos" | "linux" | "unknown";

const RELEASES = {
  latest: "https://github.com/PratikPrasad1813/FOLIO/releases/latest",
  windowsExe: "https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/Folio_1.0.0_x64-setup.exe",
  windowsMsi: "https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/Folio_1.0.0_x64_en-US.msi",
  macos: "https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/Folio_1.0.0_universal.dmg",
  linuxDeb: "https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/folio_1.0.0_amd64.deb",
  linuxAppImage: "https://github.com/PratikPrasad1813/FOLIO/releases/latest/download/Folio_1.0.0_amd64.AppImage",
} as const;

const RECOMMENDATIONS: Record<
  DesktopPlatform,
  { label: string; href: string; Icon: typeof Monitor }
> = {
  windows: { label: "Download for Windows (.exe)", href: RELEASES.windowsExe, Icon: Monitor },
  macos: { label: "Download for macOS (.dmg)", href: RELEASES.macos, Icon: Apple },
  linux: { label: "Download for Linux (.deb)", href: RELEASES.linuxDeb, Icon: Terminal },
  unknown: { label: "Download Desktop App", href: RELEASES.latest, Icon: Download },
};

const DOWNLOAD_OPTIONS = [
  { label: "Windows installer (.exe)", detail: "64-bit Windows", href: RELEASES.windowsExe, Icon: Monitor },
  { label: "Windows package (.msi)", detail: "64-bit Windows", href: RELEASES.windowsMsi, Icon: Monitor },
  { label: "macOS universal disk image (.dmg)", detail: "Apple Silicon and Intel", href: RELEASES.macos, Icon: Apple },
  { label: "Linux package (.deb)", detail: "Debian and Ubuntu, x86_64", href: RELEASES.linuxDeb, Icon: Terminal },
  { label: "Linux image (.AppImage)", detail: "Portable x86_64 package", href: RELEASES.linuxAppImage, Icon: Terminal },
] as const;

function detectPlatform(userAgent: string): DesktopPlatform {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return "unknown";
  if (/Windows NT/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macos";
  if (/Linux/i.test(userAgent)) return "linux";
  return "unknown";
}

const subscribeToPlatform = () => () => {};
const getBrowserPlatform = () => detectPlatform(window.navigator.userAgent);
const getServerPlatform = (): DesktopPlatform => "unknown";

export function HeroDownload() {
  const platform = useSyncExternalStore(subscribeToPlatform, getBrowserPlatform, getServerPlatform);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const recommendation = RECOMMENDATIONS[platform];
  const PlatformIcon = recommendation.Icon;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdownRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5">
      <div className="relative flex items-stretch" ref={dropdownRef}>
        <a
          href={recommendation.href}
          className="lp-button is-primary !gap-2.5 !rounded-r-none !border-r !border-violet-600 !border-r-white/20 !bg-violet-600 !px-4 !text-white shadow-[0_8px_28px_rgba(109,40,217,0.28)] transition hover:!bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400 sm:!px-5"
          aria-label={recommendation.label}
        >
          <PlatformIcon size={17} aria-hidden="true" />
          <span>{recommendation.label}</span>
        </a>
        <button
          type="button"
          className="inline-flex min-h-[47px] items-center justify-center rounded-r-md border border-l-0 border-violet-500/60 bg-violet-700 px-3 text-white transition hover:bg-violet-600 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400"
          aria-label="Show all Folio download options"
          aria-expanded={open}
          aria-controls="folio-download-options"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div
            id="folio-download-options"
            className="absolute left-0 top-[calc(100%+10px)] z-50 w-[min(21rem,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-slate-700 bg-zinc-900 p-2 text-left text-slate-100 shadow-2xl shadow-black/40"
          >
            <p className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Desktop downloads
            </p>
            {DOWNLOAD_OPTIONS.map(({ label, detail, href, Icon }) => (
              <a
                key={label}
                href={href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
              >
                <Icon size={16} className="shrink-0 text-violet-300" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">{label}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-400">{detail}</span>
                </span>
                <Download size={13} className="shrink-0 text-slate-500" aria-hidden="true" />
              </a>
            ))}
            <div className="my-1 border-t border-slate-700" />
            <Link
              href="/overview"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-violet-200 transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
            >
              <Globe2 size={16} aria-hidden="true" />
              <span className="flex-1 text-xs font-medium">Open in Browser</span>
            </Link>
            <a
              href={RELEASES.latest}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-[10px] text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400"
            >
              View all releases
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        )}
      </div>
      <Link
        href="/overview"
        className="lp-button is-outline !gap-2 !border-slate-600 !bg-zinc-900 !px-4 !text-slate-100 transition hover:!border-violet-500 hover:!bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400"
      >
        Open Web Studio <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
