"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronDown, Download, Globe2 } from "lucide-react";
import { DESKTOP_DOWNLOADS, getDesktopDownloadHref } from "@/lib/desktop-downloads";

type DesktopPlatform = "windows" | "macos" | "linux" | "unknown";
type PlatformLogoProps = { size?: number; className?: string };
type PlatformIconComponent = (props: PlatformLogoProps) => React.JSX.Element;

const RELEASES = {
  latest: "https://github.com/PratikPrasad1813/FOLIO/releases/latest",
} as const;

const RECOMMENDATIONS: Record<
  DesktopPlatform,
  { label: string; href: string; Icon: PlatformIconComponent | typeof Download }
> = {
  windows: { label: "Download for Windows (.exe)", href: getDesktopDownloadHref("windows-exe"), Icon: WindowsLogo },
  macos: { label: "Download for macOS (.dmg)", href: getDesktopDownloadHref("macos-dmg"), Icon: AppleLogo },
  linux: { label: "Download for Linux (.deb)", href: getDesktopDownloadHref("linux-deb"), Icon: LinuxLogo },
  unknown: { label: "Download Desktop App", href: "/download", Icon: Download },
};

const DOWNLOAD_OPTIONS = [
  { ...DESKTOP_DOWNLOADS["windows-exe"], href: getDesktopDownloadHref("windows-exe"), Icon: WindowsLogo },
  { ...DESKTOP_DOWNLOADS["windows-msi"], href: getDesktopDownloadHref("windows-msi"), Icon: WindowsLogo },
  { ...DESKTOP_DOWNLOADS["macos-dmg"], href: getDesktopDownloadHref("macos-dmg"), Icon: AppleLogo },
  { ...DESKTOP_DOWNLOADS["linux-deb"], href: getDesktopDownloadHref("linux-deb"), Icon: LinuxLogo },
  { ...DESKTOP_DOWNLOADS["linux-appimage"], href: getDesktopDownloadHref("linux-appimage"), Icon: LinuxLogo },
] as const;

function WindowsLogo({ size = 17, className }: PlatformLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 4.2 10.7 3v8.4H2V4.2Zm10.1-1.4L22 1.3v10.1h-9.9V2.8ZM2 12.8h8.7v8.3L2 19.9v-7.1Zm10.1 0H22v9.9l-9.9-1.4v-8.5Z" />
    </svg>
  );
}

function AppleLogo({ size = 17, className }: PlatformLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 384 512"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M318.7 268.6c-.2-36.7 16.4-64.4 50-84.8-18.8-26.8-47.2-41.6-84.8-44.5-35.6-2.8-74.4 20.8-88.6 20.8-15 0-49.4-19.8-76.6-19.8C62.5 141.2 0 186.2 0 273.8c0 25.9 4.7 52.7 14.1 80.4 12.5 36.7 57.5 126.6 104.4 125.1 24.6-.6 42-17.5 74.9-17.5 31.9 0 48 17.5 75.4 17.5 47.3-.7 88-82.4 99.9-119.2-63.5-29.9-60-87.7-50-91.5zM260.8 105.5c27.4-32.5 24.9-62.1 24.1-72.7-24.2 1.4-52.2 16.8-68.1 35.4-17.4 19.8-27.6 44.3-25.4 71.9 26.1 2 50-11.4 69.4-34.6z" />
    </svg>
  );
}

function LinuxLogo({ size = 17, className }: PlatformLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      <path
        fill="#111827"
        d="M16 2.2c-4.1 0-6.2 3.2-6.2 7.5 0 1.7.3 3.3.8 4.7-2 2.1-3.1 4.6-3.1 7.5 0 2.2.7 4 2 5.2l-.9 2.1c-.4 1 .4 1.8 1.5 1.5l4.1-1.2c.6.1 1.2.2 1.8.2s1.2-.1 1.8-.2l4.1 1.2c1.1.3 1.9-.5 1.5-1.5l-.9-2.1c1.3-1.2 2-3 2-5.2 0-2.9-1.1-5.4-3.1-7.5.5-1.4.8-3 .8-4.7 0-4.3-2.1-7.5-6.2-7.5Z"
      />
      <ellipse cx="16" cy="21" rx="5.1" ry="6.4" fill="#fff" />
      <ellipse cx="13.8" cy="9.2" rx="1.1" ry="1.5" fill="#fff" />
      <ellipse cx="18.2" cy="9.2" rx="1.1" ry="1.5" fill="#fff" />
      <circle cx="14.1" cy="9.4" r=".55" fill="#111827" />
      <circle cx="17.9" cy="9.4" r=".55" fill="#111827" />
      <path d="m13.5 12.1 2.5 1.5 2.5-1.5-2.5-.6-2.5.6Z" fill="#f59e0b" />
      <path d="M7.3 23.2c-1.8-.7-3.2-.3-3.6.6-.4 1 .4 2.2 2.4 2.8l3 .9.2-2.7-2-1.6Zm17.4 0c1.8-.7 3.2-.3 3.6.6.4 1-.4 2.2-2.4 2.8l-3 .9-.2-2.7 2-1.6Z" fill="#111827" />
      <path d="m11.1 28.5-1.5 1.8 4.4-.7.4-1.8-3.3.7Zm9.8 0 1.5 1.8-4.4-.7-.4-1.8 3.3.7Z" fill="#f59e0b" />
    </svg>
  );
}

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
        <Link
          href={recommendation.href}
          className="lp-button is-primary !gap-2.5 !rounded-r-none !border-r !border-violet-600 !border-r-white/20 !bg-violet-600 !px-4 !text-white shadow-[0_8px_28px_rgba(109,40,217,0.28)] transition hover:!bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400 sm:!px-5"
          aria-label={recommendation.label}
        >
          <PlatformIcon size={17} aria-hidden="true" />
          <span>{recommendation.label}</span>
        </Link>
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
              <Link
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
              </Link>
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
