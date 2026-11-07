"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Check, CircleHelp, ExternalLink, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/ui";
import { DESKTOP_DOWNLOADS, type DesktopDownload, type DesktopDownloadId, getDesktopDownloadHref } from "@/lib/desktop-downloads";

const INSTALL_STEPS: Record<DesktopDownload["platform"], { title: string; description: string }[]> = {
  windows: [
    {
      title: "Open the downloaded installer",
      description: "When the download finishes, open your Downloads folder and double-click the downloaded .exe or .msi file. Follow the setup prompts.",
    },
    {
      title: "If Windows says “Windows protected your PC”",
      description: "This warning can appear when Windows SmartScreen has limited reputation information about a new app. First confirm that you downloaded Folio from the official GitHub release linked on this page. If you trust that source, select More info, check that the app name is Folio, then select Run anyway. Do not bypass the warning if the file came from somewhere else or looks unexpected.",
    },
    {
      title: "Finish setup and launch Folio",
      description: "Complete the installer, then open Folio from the Start menu or the shortcut created by setup. The .msi package can be installed by opening it and following its installation wizard.",
    },
  ],
  macos: [
    {
      title: "Open the disk image",
      description: "When Folio_1.0.0_universal.dmg finishes downloading, open it from Downloads. The universal build is intended for both Apple Silicon and Intel Macs.",
    },
    {
      title: "Move Folio to Applications",
      description: "In the disk image window, drag Folio into the Applications folder. Eject the Folio disk image when the copy finishes.",
    },
    {
      title: "If macOS cannot verify the developer",
      description: "Make sure the disk image came from the official Folio GitHub release. If macOS blocks an app that you intentionally downloaded and trust, open Finder, Control-click Folio, choose Open, then confirm Open in the dialog. Do not disable Gatekeeper globally or override a warning for a file you cannot verify.",
    },
  ],
  linux: [
    {
      title: "Install the package",
      description: "On Debian or Ubuntu, open the downloaded .deb file in your software installer and choose Install. Alternatively, in a terminal opened in Downloads, run: sudo apt install ./folio_1.0.0_amd64.deb",
    },
    {
      title: "For the portable AppImage",
      description: "If you chose the AppImage, make it executable with chmod +x Folio_1.0.0_amd64.AppImage, then open it from your file manager. Your desktop may also provide a “Run as executable” permission in the file properties.",
    },
    {
      title: "Launch Folio",
      description: "After installation, launch Folio from your applications menu. The Linux packages are x86_64 builds; check your system architecture if the package manager reports an incompatibility.",
    },
  ],
};

export function DownloadGuide({ download }: { download: DesktopDownload | null }) {
  const [downloadStarted, setDownloadStarted] = useState(false);

  useEffect(() => {
    if (!download) return;

    const timer = window.setTimeout(() => {
      setDownloadStarted(true);
      window.location.assign(download.url);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [download]);

  return (
    <main className="public-site download-page">
      <header className="download-header">
        <Link href="/" aria-label="Folio home" className="download-brand">
          <Logo />
        </Link>
        <Link href="/" className="download-back-link">
          <ArrowLeft size={14} /> Back to Folio
        </Link>
      </header>

      <div className="download-content">
        {download ? (
          <>
            <section className="download-thanks" aria-labelledby="download-title">
              <span className="download-success-icon"><Check size={19} /></span>
              <p className="download-eyebrow">FOLIO DESKTOP · {download.platformName.toUpperCase()}</p>
              <h1 id="download-title">Thank you for choosing <em>Folio.</em></h1>
              <p className="download-lead">
                Your {download.platformName} download should begin automatically. While it downloads, follow these steps to install it.
              </p>
              <a className="lp-button is-primary download-retry" href={download.url}>
                <ArrowDownToLine size={16} />
                Download {download.fileName}
              </a>
              <p className="download-start-status" aria-live="polite">
                {downloadStarted ? "If the download did not start, use the button above." : "Preparing your download…"}
              </p>
            </section>

            <section className="download-install" aria-labelledby="install-title">
              <div className="download-section-heading">
                <span><ShieldCheck size={15} /> INSTALLATION GUIDE</span>
                <h2 id="install-title">A few steps to get started</h2>
              </div>
              <ol className="download-steps">
                {INSTALL_STEPS[download.platform].map((step, index) => (
                  <li key={step.title}>
                    <span className="download-step-number">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {download.platform === "windows" && (
                <aside className="download-security-note">
                  <CircleHelp size={17} />
                  <p>
                    <strong>Stay protected.</strong> SmartScreen is a Windows security feature. “More info → Run anyway” is only appropriate when you intentionally downloaded the installer from Folio’s official release page and are comfortable proceeding. Never turn off Defender or SmartScreen to install an app.
                  </p>
                </aside>
              )}
            </section>
          </>
        ) : (
          <section className="download-thanks download-chooser" aria-labelledby="download-title">
            <span className="download-success-icon"><Check size={19} /></span>
            <p className="download-eyebrow">FOLIO DESKTOP</p>
            <h1 id="download-title">Thank you for choosing <em>Folio.</em></h1>
            <p className="download-lead">Choose the package for your computer to start downloading and see its installation instructions.</p>
            <div className="download-choice-list">
              {(Object.entries(DESKTOP_DOWNLOADS) as [DesktopDownloadId, DesktopDownload][]).map(([id, option]) => (
                <Link key={id} href={getDesktopDownloadHref(id)} className="download-choice">
                  <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          </section>
        )}

        <footer className="download-footer">
          <p>Prefer not to install anything? Folio is also available in your browser.</p>
          <Link href="/overview">Open Web Studio <ExternalLink size={13} /></Link>
        </footer>
      </div>
    </main>
  );
}
