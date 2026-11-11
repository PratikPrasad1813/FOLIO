"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  Cpu,
  Database,
  ExternalLink,
  FolderKanban,
  GitBranch,
  HeartHandshake,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Lock,
  Menu,
  Moon,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { GithubMark } from "@/components/auth-screen";
import { EMAIL_FEATURES_ENABLED } from "@/lib/feature-flags";

export const GITHUB_REPO_URL = "https://github.com/PratikPrasad1813/Folio";
// Documentation lives on the Third-Commit branch of the repository (the repo has no "main" branch).
const GITHUB_DOCS_BASE = `${GITHUB_REPO_URL}/blob/Third-Commit`;

export const PUBLIC_NAV = [
  ["Product", "product"],
  ["Features", "features"],
  ["Workflows", "workflows"],
  ["Folio AI", "folio-ai"],
  ["Security", "security"],
  ["Developers", "open-source"],
  ["FAQ", "faq"],
];

export function PublicHeader({ home = false }: { home?: boolean }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");

  useEffect(() => {
    if (!home) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -60% 0px" },
    );
    for (const [, id] of PUBLIC_NAV) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [home]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <header className="lp-header">
      <div className="lp-header-inner">
        <Link href="/" className="lp-logo" aria-label="Folio home">
          <Logo />
        </Link>
        <nav
          className={`lp-navigation ${open ? "is-open" : ""}`}
          aria-label="Website navigation"
        >
          {PUBLIC_NAV.map(([label, id]) => (
            <a
              key={id}
              href={`${home ? "" : "/"}#${id}`}
              className={active === id ? "is-active" : ""}
              onClick={() => setOpen(false)}
            >
              {label}
            </a>
          ))}
          <Link href="/docs" onClick={() => setOpen(false)}>
            Docs
          </Link>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-mobile-signin"
            onClick={() => setOpen(false)}
          >
            GitHub Repository
          </a>
          <Link
            href="/login"
            className="lp-mobile-signin"
            onClick={() => setOpen(false)}
          >
            Sign in
          </Link>
        </nav>
        <div className="lp-header-actions">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="lp-github-star"
            aria-label="Star Folio on GitHub"
          >
            <GithubMark />
            <span>Star</span>
          </a>
          <ThemeToggle />
          <Link className="lp-signin" href="/login">
            Sign in
          </Link>
          <Link className="lp-button is-small is-dark" href="/signup">
            Get started
            <ArrowUpRight size={14} />
          </Link>
          <button
            className="lp-menu-toggle"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}

/** Optimized, genuine captures; a missing capture never becomes a broken image. */
export function ProductImage({
  name,
  alt,
  eager = false,
  className = "",
  fallbackName,
}: {
  name: string;
  alt: string;
  eager?: boolean;
  className?: string;
  /** Shown if the themed capture is missing — e.g. the light shot for a dark screen. */
  fallbackName?: string;
}) {
  const [source, setSource] = useState(name);
  const [missing, setMissing] = useState(false);
  useEffect(() => { setSource(name); setMissing(false); }, [name]);
  return (
    <div className={`lp-product-image ${className}`}>
      {missing ? (
        <div
          className="lp-image-fallback"
          role="img"
          aria-label={`${alt}. Preview coming soon.`}
        >
          <Sparkles size={24} />
          <strong>A little clarity, coming into view.</strong>
          <span>Product preview coming soon.</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={source}
          ref={(image) => {
            if (image?.complete && image.naturalWidth === 0) setMissing(true);
          }}
          src={`/screenshots/${source}.png`}
          alt={alt}
          width={1440}
          height={1000}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
          onError={() => {
            if (fallbackName && source !== fallbackName) setSource(fallbackName);
            else setMissing(true);
          }}
        />
      )}
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-top">
        <div className="lp-footer-brand-col">
          <Link href="/" aria-label="Folio home">
            <Logo />
          </Link>
          <p>
            A little clarity.
            <br />A lot of possibility.
          </p>
          <div className="lp-footer-gh-badge">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Folio repository on GitHub"
            >
              <GithubMark />
              <span>PratikPrasad1813 / Folio</span>
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
        <div className="lp-footer-links">
          <div>
            <span>THE PRODUCT</span>
            <Link href="/#product">Interactive Tour</Link>
            <Link href="/#features">Core Features</Link>
            <Link href="/#workflows">Workflows</Link>
            <Link href="/#folio-ai">Folio AI Assistant</Link>
            <Link href="/#security">Security &amp; Privacy</Link>
          </div>
          <div>
            <span>DEVELOPERS</span>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
              GitHub Repository
            </a>
            <a
              href={`${GITHUB_REPO_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Issue Tracker
            </a>
            <a
              href={`${GITHUB_REPO_URL}/pulls`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Contribute
            </a>
            <Link href="/#tech-stack">Technology Stack</Link>
            <Link href="/docs">Developer Documentation</Link>
          </div>
          <div>
            <span>DOCUMENTATION</span>
            <a href={`${GITHUB_REPO_URL}#readme`} target="_blank" rel="noopener noreferrer">
              README &amp; Architecture
            </a>
            <a href={`${GITHUB_DOCS_BASE}/DATABASE_SETUP.md`} target="_blank" rel="noopener noreferrer">
              Database Setup
            </a>
            <a href={`${GITHUB_DOCS_BASE}/AUTHENTICATION.md`} target="_blank" rel="noopener noreferrer">
              Auth &amp; Deletion Guide
            </a>
            <a href={`${GITHUB_DOCS_BASE}/SCREENSHOTS.md`} target="_blank" rel="noopener noreferrer">
              Automated Screenshots
            </a>
          </div>
          <div>
            <span>GET STARTED</span>
            <Link href="/signup">Create Free Account</Link>
            <Link href="/login">Sign In</Link>
            {EMAIL_FEATURES_ENABLED && <Link href="/recover">Forgot Password?</Link>}
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </div>
        </div>
      </div>
      <div className="lp-footer-bottom">
        <span>&copy; {new Date().getFullYear()} Folio. Built in the open on GitHub.</span>
        <span>
          <i /> Thoughtfully organized. Always yours.
        </span>
      </div>
    </footer>
  );
}

type ShowcaseScreen = {
  name: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge: string;
  description: string;
  /** Per-theme capture names; defaults to `<name>` / `<name>-dark`. */
  light?: string;
  dark?: string;
};

const SCREENS: ShowcaseScreen[] = [
  {
    name: "dashboard",
    label: "Overview",
    icon: LayoutDashboard,
    badge: "DAILY HUB",
    description: "The big picture and your next small step. Welcome concierge, weekly focus ring, and priority queue.",
  },
  {
    name: "projects",
    label: "Projects",
    icon: FolderKanban,
    badge: "ORGANIZATION",
    description: "Multi-category project cards, progress rings, custom color themes, and milestone tracking.",
  },
  {
    name: "project-details",
    label: "Project details",
    icon: FolderKanban,
    badge: "DEEP DIVE",
    description: "Checkpoints, linked tasks, notes, activity feeds, and progress metrics in one focused workspace.",
  },
  {
    name: "tasks-board",
    label: "Task board",
    icon: SquareCheckBig,
    badge: "KANBAN",
    description: "Fluid Kanban columns across To Do, In Progress, In Review, and Done with drag-and-drop support.",
  },
  {
    name: "tasks-list",
    label: "Task list",
    icon: Check,
    badge: "FOCUSED LIST",
    description: "Clean, high-density task list with multi-select bulk actions, due chips, and project badges.",
  },
  {
    name: "tasks-calendar",
    label: "Task calendar",
    icon: CalendarDays,
    badge: "TIMELINE",
    description: "See your upcoming task commitments and project deadlines laid out across week and month grids.",
  },
  {
    name: "calendar",
    label: "Calendar",
    icon: CalendarCheck2,
    badge: "INTEGRATION",
    description: "Bidirectional Google Calendar sync with encrypted OAuth credentials and unified event planning.",
  },
  {
    name: "ideas",
    label: "Ideas",
    icon: Lightbulb,
    badge: "INSPIRATION",
    description: "Capture fleeting sparks without guilt. Explore stages, then convert an idea to a full project with one click.",
  },
  {
    name: "analytics",
    label: "Insights",
    icon: CircleCheck,
    badge: "VELOCITY",
    description: "Real-time task velocity, completion trends, overdue alerts, and weekly goal focus metrics.",
  },
  {
    name: "folio-ai",
    label: "Folio AI",
    icon: BrainCircuit,
    badge: "BRING YOUR OWN KEY",
    light: "folio-ai-light",
    dark: "folio-ai-dark",
    description: "A thoughtful assistant running on your own Anthropic, OpenAI, OpenRouter, or Google AI Studio key, with reviewable workspace action plans and a clear daily usage limit. It follows your theme — paper by day, dusk by night.",
  },
];

/* ==========================================================================
   The redesigned landing page — warm-paper edition.
   Design language from DESIGN.md (Notion reference): warm off-white canvas,
   white hairline cards, one blue action, rotating accent panels, and product
   mockups that carry Folio's Indian warmth (names, festivals, chai, cities).
   The Folio logo and tagline lines are untouched.
   ========================================================================== */

type LandingTheme = "light" | "dark";
export const LANDING_THEME_KEY = "folio_landing_theme";

function LandingHeader({
  theme,
  onToggleTheme,
}: {
  theme: LandingTheme;
  onToggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -60% 0px" },
    );
    for (const [, id] of PUBLIC_NAV) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <header className="fl-header">
      <div className="fl-header-inner">
        <Link href="/" aria-label="Folio home">
          <Logo />
        </Link>
        <nav className="fl-nav" aria-label="Website navigation">
          {PUBLIC_NAV.map(([label, id]) => (
            <a
              key={id}
              href={`#${id}`}
              className={active === id ? "is-active" : ""}
              onClick={() => setOpen(false)}
            >
              {label}
            </a>
          ))}
          <Link href="/docs" onClick={() => setOpen(false)}>
            Docs
          </Link>
        </nav>
        <div className="fl-header-actions">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="fl-gh-pill"
            aria-label="Star Folio on GitHub"
          >
            <GithubMark />
            <span>Star</span>
          </a>
          <Link href="/login" className="fl-signin-link">
            Sign in
          </Link>
          <Link href="/signup" className="fl-btn is-primary is-pill">
            Get started
            <ArrowUpRight size={14} />
          </Link>
          <button
            type="button"
            className="fl-theme-btn"
            aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
            onClick={onToggleTheme}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="fl-menu-toggle"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="fl-mobile-nav" aria-label="Mobile navigation">
          {PUBLIC_NAV.map(([label, id]) => (
            <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <Link href="/docs" onClick={() => setOpen(false)}>
            Docs
          </Link>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            GitHub Repository
          </a>
          <Link href="/login" onClick={() => setOpen(false)}>
            Sign in
          </Link>
          <Link href="/signup" className="fl-btn is-primary" onClick={() => setOpen(false)}>
            Get started
            <ArrowUpRight size={15} />
          </Link>
          <button
            type="button"
            className="fl-theme-btn is-mobile"
            aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
            onClick={() => {
              setOpen(false);
              onToggleTheme();
            }}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
        </nav>
      )}
    </header>
  );
}

function LandingFooter() {
  return (
    <footer className="fl-footer">
      <div className="fl-container">
        <div className="fl-footer-top">
          <div className="fl-footer-brand">
            <Link href="/" aria-label="Folio home">
              <Logo />
            </Link>
            <p>
              A little clarity.
              <br />A lot of possibility.
            </p>
            <span className="fl-made-in">
              <Sparkles size={13} />
              <span>
                Made with care in <b>India</b> — for the world.
              </span>
            </span>
            <div className="fl-footer-gh">
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="fl-gh-pill"
                aria-label="Folio repository on GitHub"
              >
                <GithubMark />
                <span>PratikPrasad1813 / Folio</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
          <div className="fl-footer-links">
            <div>
              <span>THE PRODUCT</span>
              <Link href="/#product">Interactive Tour</Link>
              <Link href="/#features">Core Features</Link>
              <Link href="/#workflows">Workflows</Link>
              <Link href="/#folio-ai">Folio AI Assistant</Link>
              <Link href="/#security">Security &amp; Privacy</Link>
            </div>
            <div>
              <span>DEVELOPERS</span>
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
                GitHub Repository
              </a>
              <a href={`${GITHUB_REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
                Issue Tracker
              </a>
              <a href={`${GITHUB_REPO_URL}/pulls`} target="_blank" rel="noopener noreferrer">
                Contribute
              </a>
              <Link href="/#tech-stack">Technology Stack</Link>
              <Link href="/docs">Developer Documentation</Link>
            </div>
            <div>
              <span>DOCUMENTATION</span>
              <a href={`${GITHUB_REPO_URL}#readme`} target="_blank" rel="noopener noreferrer">
                README &amp; Architecture
              </a>
              <a href={`${GITHUB_DOCS_BASE}/DATABASE_SETUP.md`} target="_blank" rel="noopener noreferrer">
                Database Setup
              </a>
              <a href={`${GITHUB_DOCS_BASE}/AUTHENTICATION.md`} target="_blank" rel="noopener noreferrer">
                Auth &amp; Deletion Guide
              </a>
              <a href={`${GITHUB_DOCS_BASE}/SCREENSHOTS.md`} target="_blank" rel="noopener noreferrer">
                Automated Screenshots
              </a>
            </div>
            <div>
              <span>GET STARTED</span>
              <Link href="/signup">Create Free Account</Link>
              <Link href="/login">Sign In</Link>
              {EMAIL_FEATURES_ENABLED && <Link href="/recover">Forgot Password?</Link>}
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/terms">Terms of Service</Link>
            </div>
          </div>
        </div>
        <div className="fl-footer-bottom">
          <span>&copy; {new Date().getFullYear()} Folio. Built in the open on GitHub.</span>
          <em>A little more organized. A little more you.</em>
        </div>
      </div>
    </footer>
  );
}

function HeroMock() {
  return (
    <div className="fl-mock-wrap">
      <svg className="fl-mark is-squiggle" width="54" height="18" viewBox="0 0 54 18" fill="none" aria-hidden="true">
        <path d="M2 12c6-8 10 4 16-2s8 6 14 1 10 3 20-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <svg className="fl-mark is-sparkle" width="26" height="26" viewBox="0 0 26 26" fill="currentColor" aria-hidden="true">
        <path d="M13 1c1 6 5 10 11 12-6 2-10 6-11 12-1-6-5-10-11-12 6-2 10-6 11-12Z" />
      </svg>
      <span className="fl-mark is-ring" aria-hidden="true" />
      <span className="fl-mark is-dot" aria-hidden="true" />

      <div className="fl-mock" role="img" aria-label="Folio workspace preview showing Aarav's projects — Diwali prep, a December Goa trip, and a chai brand launch — with today's tasks">
        <div className="fl-mock-bar">
          <span className="fl-mock-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="fl-mock-url">
            <ShieldCheck size={11} />
            folio / aarav&rsquo;s workspace
          </span>
          <span className="fl-chip is-marigold" style={{ marginLeft: "auto" }}>ALL CHANGES SAVED</span>
        </div>
        <div className="fl-mock-body">
          <aside className="fl-mock-side">
            <div className="fl-mock-side-user">
              <span className="fl-mock-avatar">AS</span>
              <span>
                <strong>Aarav Sharma</strong>
                <small>Personal workspace</small>
              </span>
            </div>
            <div className="fl-mock-side-label">WORKSPACE</div>
            <div className="fl-mock-side-item is-active"><i />Overview</div>
            <div className="fl-mock-side-item"><i />Projects</div>
            <div className="fl-mock-side-item"><i />My tasks</div>
            <div className="fl-mock-side-item"><i />Idea board</div>
            <div className="fl-mock-side-item"><i />Calendar</div>
            <div className="fl-mock-side-item"><i />Folio AI</div>
            <div className="fl-mock-side-label">FAVORITES</div>
            <div className="fl-mock-side-item"><i />Diwali prep</div>
            <div className="fl-mock-side-item"><i />Goa trip</div>
          </aside>
          <div className="fl-mock-main">
            <div className="fl-mock-greeting">
              <h4>Good evening, Aarav</h4>
              <p>Shubh sandhya — three things left on today&rsquo;s list.</p>
            </div>
            <div className="fl-mock-grid">
              <div className="fl-mock-project">
                <span className="fl-chip is-marigold">FESTIVAL</span>
                <strong>Diwali prep</strong>
                <small>12 tasks · 8 done</small>
                <div className="fl-mock-progress"><i style={{ width: "68%", background: "var(--fl-marigold)" }} /></div>
              </div>
              <div className="fl-mock-project">
                <span className="fl-chip is-sky">TRAVEL</span>
                <strong>Goa trip · December</strong>
                <small>Stays shortlisted</small>
                <div className="fl-mock-progress"><i style={{ width: "40%", background: "var(--fl-blue)" }} /></div>
              </div>
              <div className="fl-mock-project">
                <span className="fl-chip is-coral">WORK</span>
                <strong>Chai brand launch</strong>
                <small>D2C · Bengaluru</small>
                <div className="fl-mock-progress"><i style={{ width: "25%", background: "var(--fl-coral)" }} /></div>
              </div>
            </div>
            <div className="fl-mock-tasks">
              <div className="fl-mock-tasks-head">
                <strong>TODAY &amp; NEXT</strong>
                <span className="fl-chip is-sky">3 LEFT</span>
              </div>
              <div className="fl-mock-task is-done">
                <span className="fl-check"><Check size={10} strokeWidth={3.2} /></span>
                <span>Book IRCTC tickets to Madgaon</span>
                <em className="fl-due is-soon">Fri</em>
              </div>
              <div className="fl-mock-task">
                <span className="fl-check" />
                <span>Pay society maintenance</span>
                <em className="fl-due">Today</em>
              </div>
              <div className="fl-mock-task">
                <span className="fl-check" />
                <span>Rangoli colors from the market</span>
                <em className="fl-due is-soon">Sat</em>
              </div>
              <div className="fl-mock-task">
                <span className="fl-check" />
                <span>Pick up Amma&rsquo;s birthday gift</span>
                <em className="fl-due is-soon">Tomorrow</em>
              </div>
            </div>
          </div>
        </div>
      </div>

      <span className="fl-float is-ai"><i />Folio AI planned your week</span>
      <span className="fl-float is-done"><i />3 tasks done today</span>
      <span className="fl-float is-idea"><i />Idea captured: learn tabla</span>
    </div>
  );
}

/* Notion-style hero: a short muted loop of the real app, shot in Aarav's
   workspace, inside the same browser frame. Falls back to the hand-drawn
   mock when video is unavailable or motion is reduced. The loop matches the
   visitor's landing theme — warm paper by day, Linear dark by night. */
function HeroVideo({ theme }: { theme: LandingTheme }) {
  const [mode, setMode] = useState<"checking" | "video" | "mock">("checking");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMode("mock");
      return;
    }
    setMode("video");
  }, []);

  // Be polite: pause the loop when the hero scrolls out of view.
  useEffect(() => {
    if (mode !== "video") return;
    const video = videoRef.current;
    if (!video) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        video.play().catch(() => setMode("mock"));
      } else {
        video.pause();
      }
    }, { threshold: 0.25 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [mode]);

  if (mode !== "video") return <HeroMock />;
  return (
    <div className="fl-mock-wrap">
      <svg className="fl-mark is-squiggle" width="54" height="18" viewBox="0 0 54 18" fill="none" aria-hidden="true">
        <path d="M2 12c6-8 10 4 16-2s8 6 14 1 10 3 20-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      <svg className="fl-mark is-sparkle" width="26" height="26" viewBox="0 0 26 26" fill="currentColor" aria-hidden="true">
        <path d="M13 1c1 6 5 10 11 12-6 2-10 6-11 12-1-6-5-10-11-12 6-2 10-6 11-12Z" />
      </svg>
      <span className="fl-mark is-ring" aria-hidden="true" />
      <span className="fl-mark is-dot" aria-hidden="true" />

      <div className="fl-mock">
        <div className="fl-mock-bar">
          <span className="fl-mock-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="fl-mock-url">
            <ShieldCheck size={11} />
            folio / aarav&rsquo;s workspace
          </span>
          <span className="fl-chip is-marigold" style={{ marginLeft: "auto" }}>ALL CHANGES SAVED</span>
        </div>
        <video
          key={theme}
          ref={videoRef}
          className="fl-hero-video"
          autoPlay
          muted
          loop
          playsInline
          poster={`/screenshots/hero-tour-${theme}-poster.jpg`}
          aria-label="Product tour: Aarav reviews his week, plans the Pongal shoot and asks Folio AI what is due — recorded in the real app"
          onError={() => setMode("mock")}
        >
          <source src={`/screenshots/hero-tour-${theme}.mp4`} type="video/mp4" />
          <source src={`/screenshots/hero-tour-${theme}.webm`} type="video/webm" />
        </video>
      </div>

      <span className="fl-float is-ai"><i />Folio AI planned your week</span>
      <span className="fl-float is-done"><i />3 tasks done today</span>
      <span className="fl-float is-idea"><i />Idea captured: learn tabla</span>
    </div>
  );
}

export function ProductShowcase({ theme = "light" }: { theme?: LandingTheme }) {
  const [selected, setSelected] = useState(0);
  const screen = SCREENS[selected];
  const themedName = (theme === "dark" ? screen.dark ?? `${screen.name}-dark` : screen.light ?? screen.name);
  const lightName = screen.light ?? screen.name;
  return (
    <div className="fl-showcase">
      <div className="fl-showcase-tabs" role="tablist" aria-label="Explore actual Folio screens">
        {SCREENS.map((item, index) => (
          <button
            type="button"
            key={item.name}
            id={`showcase-tab-${item.name}`}
            role="tab"
            aria-selected={selected === index}
            aria-controls="showcase-screen"
            tabIndex={selected === index ? 0 : -1}
            className="fl-tab"
            onClick={() => setSelected(index)}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? SCREENS.length - 1
                      : (index + (e.key === "ArrowRight" ? 1 : -1) + SCREENS.length) %
                        SCREENS.length;
                setSelected(next);
                document.getElementById(`showcase-tab-${SCREENS[next].name}`)?.focus();
              }
            }}
          >
            <item.icon size={14} />
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="fl-stage"
        id="showcase-screen"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${screen.name}`}
      >
        <div className="fl-stage-bar">
          <span className="fl-mock-dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            <ShieldCheck size={11} />
            folio / {screen.label.toLowerCase()}
          </span>
          <span className="fl-chip is-white fl-stage-badge">{screen.badge}</span>
        </div>
        <ProductImage
          key={`${theme}-${screen.name}`}
          name={themedName}
          fallbackName={lightName !== themedName ? lightName : undefined}
          alt={`Actual Folio ${screen.label} interface using a dedicated example workspace`}
        />
      </div>
      <p className="fl-showcase-caption">
        <span>{screen.description}</span>
        <small>Real application captures from PostgreSQL. Never a static mockup.</small>
      </p>
    </div>
  );
}

const WORKFLOW_CARDS = [
  {
    name: "project-details",
    title: "Project details",
    description: "Checkpoints, linked tasks, notes, and an activity feed — one focused workspace per project.",
  },
  {
    name: "tasks-list",
    title: "Task list",
    description: "High-density sorted list with multi-select bulk actions, due chips, and project badges.",
  },
  {
    name: "calendar",
    title: "Calendar",
    description: "Google Calendar events beside Folio deadlines, with encrypted two-way sync.",
  },
  {
    name: "ideas",
    title: "Idea board",
    description: "Spark, explore, and convert — ideas become full projects with one click.",
  },
];

function WorkflowGrid() {
  return (
    <div className="fl-flow-grid">
      {WORKFLOW_CARDS.map((card) => (
        <article className="fl-flow-card" key={card.name}>
          <ProductImage name={card.name} alt={`Folio ${card.title} screen`} className="fl-flow-media" />
          <h3>{card.title}</h3>
          <p>{card.description}</p>
        </article>
      ))}
    </div>
  );
}

const FAQ = [
  [
    "Where is Folio made?",
    "Folio is designed and built in India — and made for the world. You'll notice it in the little things: names in our examples, festivals on the sample calendar, timezones like IST handled first-class. The product itself works the same wherever you are, and your workspace is yours alone.",
  ],
  [
    "What is Folio?",
    "Folio is a personal workspace for your projects, tasks, schedule, and ideas. Built with Next.js 16, PostgreSQL, Drizzle ORM, and a bring-your-own-key AI engine (Anthropic, OpenAI, OpenRouter, or Google AI Studio), it brings big-picture calm and small-step momentum together into one distraction-free place.",
  ],
  [
    "Is Folio completely free to use?",
    "Folio has no subscriptions or premium tiers in this version. Folio AI includes a 10,000-token daily allowance per user, and the usage panel shows only a percentage. Your AI provider's own rate limits and any billing enabled for your API key are separate.",
  ],
  [
    "How does Folio AI protect my privacy?",
    "Folio AI sends your prompt and bounded workspace context to the AI provider you connect with your own API key (Anthropic, OpenAI, OpenRouter, or Google AI Studio). Conversation history and task progress are stored with your Folio account, and Folio enforces a 10,000-token daily allowance per user. Your key is stored in your browser and used only for your own requests. Proposed workspace actions remain visible for your review and confirmation.",
  ],
  [
    "How does Google Calendar integration work?",
    "You can connect Google Calendar from Settings. Folio requests read-only calendar access first so you can view external events alongside your tasks. Creating and updating calendar events is an optional, separate write permission. Tokens are encrypted at rest with AES-256-GCM and can be revoked at any time.",
  ],
  [
    "Can I permanently delete my account and data?",
    "Absolutely. Under Settings → Account → Danger Zone → Delete account, you can permanently erase your entire account. Deletion executes atomically across all 25 PostgreSQL tables (projects, tasks, milestones, subtasks, ideas, calendar mirrors, AI conversations, and sessions), revokes external Google tokens, and invalidates your active session immediately.",
  ],
  [
    "Can I export my workspace data?",
    "Yes. At any time in Settings → Account, you can download a complete, readable JSON export of your projects, milestones, tasks, subtasks, ideas, and activity logs. Your data belongs entirely to you.",
  ],
  [
    "How do I self-host Folio or contribute?",
    "Folio can be deployed to any Node.js environment or platform like Netlify or Vercel connected to a PostgreSQL database (such as Neon PostgreSQL). The repository is publicly hosted on GitHub at https://github.com/PratikPrasad1813/Folio.",
  ],
  [
    "Can I use Folio on mobile devices?",
    "Yes. The public landing page, sign-in, onboarding, and workspace shells adapt responsively to mobile and tablet screens. Folio AI uses hosted inference through your own provider key, so it does not require WebGPU or local model downloads.",
  ],
];

const noopSubscribe = () => () => {};
const readDeletedFlag = () => {
  const deleted = new URLSearchParams(window.location.search).get("deleted");
  return deleted === "account_deleted" || deleted === "true";
};

export function LandingPage() {
  // Read the query flag from the browser location without a synchronous setState in an effect.
  const arrivedAfterDeletion = useSyncExternalStore(noopSubscribe, readDeletedFlag, () => false);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const deletedNotice = arrivedAfterDeletion && !dismissedNotice;

  // Landing theme: warm paper by default, Linear-dark on request. The visitor's
  // system preference seeds the first visit; an explicit choice is persisted.
  const [landingTheme, setLandingTheme] = useState<LandingTheme>("light");
  const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
  useIso(() => {
    const saved = window.localStorage.getItem(LANDING_THEME_KEY);
    if (saved === "dark" || saved === "light") {
      setLandingTheme(saved);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setLandingTheme("dark");
    }
  }, []);
  const toggleLandingTheme = () => {
    setLandingTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(LANDING_THEME_KEY, next);
      } catch {
        /* private mode — the toggle still works for this visit */
      }
      return next;
    });
  };

  return (
    <div className={`public-site folio-landing${landingTheme === "dark" ? " is-fl-dark" : ""}`}>
      {deletedNotice && (
        <aside className="fl-banner" role="status">
          <div className="fl-banner-inner">
            <CircleCheck size={16} />
            <span>
              Your account and workspace data have been permanently deleted. Thank you for using Folio.
            </span>
            <button
              type="button"
              className="fl-banner-dismiss"
              aria-label="Dismiss message"
              onClick={() => setDismissedNotice(true)}
            >
              <X size={14} />
            </button>
          </div>
        </aside>
      )}

      <LandingHeader theme={landingTheme} onToggleTheme={toggleLandingTheme} />

      <main>
        {/* 1. HERO */}
        <section className="fl-hero" aria-labelledby="hero-title">
          <div className="fl-container fl-hero-inner">
            <a href="#folio-ai" className="fl-hero-badge">
              <span className="fl-badge-flag">
                <Sparkles size={11} />
                Made in India
              </span>
              <span>for the world · Folio 2.0 with BYOK AI</span>
              <ArrowRight size={13} className="fl-badge-arrow" />
            </a>
            <h1 className="fl-h1" id="hero-title">
              Make room for <span className="fl-hl">better work.</span>
            </h1>
            <p className="fl-hero-sub">
              Your projects, plans, and bright ideas — <em>beautifully together.</em>{" "}
              A thoughtful personal workspace for everything you want to make happen.
            </p>
            <div className="fl-hero-ctas">
              <Link href="/signup" className="fl-btn is-primary is-hero">
                Start for free
                <ArrowUpRight size={16} />
              </Link>
              <a href="#product" className="fl-btn is-ghost is-hero">
                Explore the product
              </a>
            </div>
            <div className="fl-hero-caption">
              <span>Free forever</span>
              <i />
              <span>No subscriptions</span>
              <i />
              <Link href="/download">Desktop app available</Link>
              <i />
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
                Open source
              </a>
            </div>
            <HeroVideo theme={landingTheme} />
          </div>
        </section>

        {/* 2. IDENTITY BAND */}
        <section className="fl-band">
          <div className="fl-container fl-band-inner">
            <p className="fl-band-copy">
              For the things you&rsquo;re building — <em>and the person you&rsquo;re becoming.</em>
            </p>
            <div className="fl-band-cities">
              <span className="fl-city">Bengaluru</span>
              <span className="fl-city">Mumbai</span>
              <span className="fl-city">Jaipur</span>
              <span className="fl-city">Kochi</span>
              <span className="fl-city">Pune</span>
              <span className="fl-city">+ 40 countries</span>
            </div>
          </div>
        </section>

        {/* 3. PRODUCT SHOWCASE */}
        <section className="fl-section" id="product" aria-label="Interactive product tour">
          <div className="fl-container">
            <div className="fl-section-head">
              <span className="fl-eyebrow">Less scattered. More centered.</span>
              <h2 className="fl-h2">
                Everything in its place — <em>and a place for everything.</em>
              </h2>
              <p>
                Not another noisy tab to keep track of. One considered home for your ambitions,
                day-to-day focus, and the sparks that follow.
              </p>
            </div>
            <ProductShowcase theme={landingTheme} />
          </div>
        </section>

        {/* 4. FEATURES — alternating text + accent panels */}
        <section className="fl-section" id="features">
          <div className="fl-container">
            <div className="fl-section-head">
              <span className="fl-eyebrow">Built for the way you think</span>
              <h2 className="fl-h2">
                Big-picture calm. <em>Small-step momentum.</em>
              </h2>
              <p className="fl-serif">
                A little structure makes a lot of room.
              </p>
            </div>

            {/* Projects */}
            <div className="fl-row">
              <div className="fl-row-copy">
                <span className="fl-eyebrow">Projects &amp; milestones</span>
                <h2 className="fl-h2">
                  Give your next big thing <em>a home.</em>
                </h2>
                <p>
                  Split larger projects into meaningful milestones. Assign custom colors and
                  categories — Personal, Product, Client work — and track completion that updates
                  itself as tasks finish.
                </p>
                <ul className="fl-row-list">
                  <li>Milestones with target dates and honest progress</li>
                  <li>Categories, colors, and favorites</li>
                  <li>Insights that count only finished tasks</li>
                </ul>
                <Link href="/signup" className="fl-row-cta">
                  Make your first project
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="fl-row-panel is-marigold">
                <div className="fl-panel-card">
                  <div className="fl-panel-card-head">
                    <span className="fl-panel-icon is-violet">
                      <FolderKanban size={16} />
                    </span>
                    <span>
                      <strong>Goa trip · December</strong>
                      <small>Personal · 6 tasks</small>
                    </span>
                    <span className="fl-chip is-marigold">45%</span>
                  </div>
                  <ul className="fl-milestones">
                    <li className="is-done">
                      <span className="fl-check"><Check size={10} strokeWidth={3.2} /></span>
                      <span>Shortlist Anjuna &amp; Ashvem stays</span>
                      <em className="fl-due">done</em>
                    </li>
                    <li>
                      <span className="fl-check" />
                      <span>Train tickets — waiting list 42</span>
                      <em className="fl-due is-hot">Tatkal opens Sat</em>
                    </li>
                    <li>
                      <span className="fl-check" />
                      <span>Plan the Old Goa day</span>
                      <em className="fl-due">next week</em>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Tasks */}
            <div className="fl-row is-flip">
              <div className="fl-row-copy">
                <span className="fl-eyebrow">Kanban &amp; density</span>
                <h2 className="fl-h2">
                  Work the way <em>you think today.</em>
                </h2>
                <p>
                  Switch fluidly between a visual board, a high-density list, and an agenda
                  calendar. Set priorities from Urgent to Low, add checklists, and tag with your
                  own labels.
                </p>
                <ul className="fl-row-list">
                  <li>Board, list, and calendar views of the same tasks</li>
                  <li>Priorities, tags, and checkable subtasks</li>
                  <li>Quiet reminders that respect your rest hours</li>
                </ul>
                <Link href="/signup" className="fl-row-cta">
                  Find your next small step
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="fl-row-panel is-sky">
                <div className="fl-kanban">
                  <div className="fl-kanban-col">
                    <div className="fl-kanban-col-head">
                      To do
                      <span className="fl-kanban-count">2</span>
                    </div>
                    <div className="fl-kanban-card">
                      Buy rangoli colors
                      <span className="fl-chip is-coral">URGENT</span>
                    </div>
                    <div className="fl-kanban-card">
                      Call the electrician
                      <span className="fl-chip is-saffron">THIS WEEK</span>
                    </div>
                  </div>
                  <div className="fl-kanban-col">
                    <div className="fl-kanban-col-head">
                      In progress
                      <span className="fl-kanban-count">1</span>
                    </div>
                    <div className="fl-kanban-card">
                      Book IRCTC tickets to Madgaon
                      <span className="fl-chip is-sky">DEC 12</span>
                    </div>
                  </div>
                  <div className="fl-kanban-col">
                    <div className="fl-kanban-col-head">
                      Done
                      <span className="fl-kanban-count">1</span>
                    </div>
                    <div className="fl-kanban-card">
                      Pay society maintenance
                      <span className="fl-chip is-marigold">DONE</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ideas */}
            <div className="fl-row">
              <div className="fl-row-copy">
                <span className="fl-eyebrow">Idea board</span>
                <h2 className="fl-h2">
                  Capture a spark <em>before it slips away.</em>
                </h2>
                <p>
                  Park thoughts under Just an idea, Exploring, or Ready to start. When an idea is
                  ripe, one click converts it into a full project with all your notes intact.
                </p>
                <ul className="fl-row-list">
                  <li>Stages for every mood of an idea</li>
                  <li>One-click idea → project conversion</li>
                  <li>No guilt, no folders-first homework</li>
                </ul>
                <Link href="/signup" className="fl-row-cta">
                  Keep your what-ifs
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="fl-row-panel is-coral">
                <div className="fl-idea-stack">
                  <div className="fl-idea-card">
                    <div className="fl-idea-card-top">
                      <strong>Learn tabla on weekends</strong>
                      <span className="fl-chip is-white">EXPLORING</span>
                    </div>
                    <p>Find a guru near home; practise 20 minutes a day.</p>
                  </div>
                  <div className="fl-idea-card">
                    <div className="fl-idea-card-top">
                      <strong>Coorg homestay — October</strong>
                      <span className="fl-chip is-white">READY TO START</span>
                    </div>
                    <p>Rain, coffee estates, and a very long do-nothing weekend.</p>
                  </div>
                  <div className="fl-idea-card">
                    <div className="fl-idea-card-top">
                      <strong>Marine Drive chai stall</strong>
                      <span className="fl-chip is-white">JUST AN IDEA</span>
                    </div>
                    <p>Kadak chai by the sea. Someday, properly.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Calendar */}
            <div className="fl-row is-flip">
              <div className="fl-row-copy">
                <span className="fl-eyebrow">Calendar &amp; schedule</span>
                <h2 className="fl-h2">
                  Context beside <em>commitments.</em>
                </h2>
                <p>
                  Connect Google Calendar with zero friction. View external meetings right next
                  to Folio deadlines and milestones — tokens sealed with AES-256-GCM at rest.
                </p>
                <ul className="fl-row-list">
                  <li>Two-way Google Calendar sync</li>
                  <li>Encrypted OAuth tokens, revocable anytime</li>
                  <li>Festivals, travel, and quiet hours in one view</li>
                </ul>
                <Link href="/signup" className="fl-row-cta">
                  Meet your day with clarity
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="fl-row-panel is-midnight">
                <div className="fl-cal-card">
                  <div className="fl-cal-head">
                    <strong>November</strong>
                    <span className="fl-chip is-sky">IST</span>
                  </div>
                  <div className="fl-cal-events">
                    <div className="fl-cal-event">
                      <span className="fl-cal-date is-festival"><b>12</b><small>DIWALI</small></span>
                      <span>
                        <b>Diwali — Lakshmi Puja</b>
                        <small>Family dinner at Amma&rsquo;s · all day</small>
                      </span>
                    </div>
                    <div className="fl-cal-event">
                      <span className="fl-cal-date"><b>14</b><small>THU</small></span>
                      <span>
                        <b>Chai with the design team</b>
                        <small>4:30 PM · Indiranagar</small>
                      </span>
                    </div>
                    <div className="fl-cal-event">
                      <span className="fl-cal-date"><b>18</b><small>MON</small></span>
                      <span>
                        <b>Appa&rsquo;s cardiologist check-up</b>
                        <small>11 AM · bring the old reports</small>
                      </span>
                    </div>
                    <div className="fl-cal-event">
                      <span className="fl-cal-date"><b>23</b><small>SAT</small></span>
                      <span>
                        <b>Roka ceremony — Meera &amp; Rohan</b>
                        <small>Travel to Jaipur</small>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5. WORKFLOW GRID */}
        <section className="fl-section" id="workflows">
          <div className="fl-container">
            <div className="fl-section-head">
              <span className="fl-eyebrow">Purpose-built workflows</span>
              <h2 className="fl-h2">
                Every surface, <em>working together.</em>
              </h2>
              <p>
                Projects, tasks, calendar, and ideas are separate enough to focus in — and
                connected enough to keep the whole picture calm.
              </p>
            </div>
            <WorkflowGrid />
          </div>
        </section>

        {/* 6. FOLIO AI — midnight island */}
        <section className="fl-section" id="folio-ai">
          <div className="fl-container">
            <div className="fl-ai">
              <div className="fl-ai-grid">
                <div className="fl-ai-copy">
                  <span className="fl-eyebrow">
                    <Sparkles size={13} />
                    A thoughtful second mind
                  </span>
                  <h2 className="fl-h2">
                    A little perspective. <em>A lot more potential.</em>
                  </h2>
                  <p>
                    Meet Folio AI — a personalized assistant that runs on your own API key and
                    knows your workspace, your calendar, and the way you like to work.
                  </p>
                  <ul className="fl-ai-list">
                    <li>Bring your own key — connect a provider in AI Settings and go.</li>
                    <li>A clear 10,000-token daily allowance, shown as a simple percentage.</li>
                    <li>Safe action plans — proposed changes wait for your review.</li>
                    <li>Custom identity: name, presentation, and communication style.</li>
                  </ul>
                  <div className="fl-ai-providers">
                    <span className="fl-prov"><i />Anthropic</span>
                    <span className="fl-prov"><i />OpenAI</span>
                    <span className="fl-prov"><i />OpenRouter</span>
                    <span className="fl-prov"><i />Google AI Studio</span>
                  </div>
                  <div className="fl-ai-ctas">
                    <Link href="/signup" className="fl-btn is-white">
                      Try Folio AI
                      <ArrowUpRight size={15} />
                    </Link>
                    <a href="#open-source" className="fl-btn is-text" style={{ color: "rgba(255,255,255,.9)" }}>
                      Read the architecture
                    </a>
                  </div>
                  <small className="fl-ai-note">
                    Your AI provider access is configured by you in AI Settings. Your prompts go
                    to the provider you choose; its limits and billing settings also apply.
                  </small>
                </div>
                <div className="fl-chat" role="img" aria-label="Folio AI conversation preview planning a Diwali shopping week with reviewable action plans">
                  <div className="fl-chat-head">
                    <span className="fl-mock-avatar">FA</span>
                    <span>
                      <strong>Folio AI</strong>
                      <small>Your assistant · BYOK</small>
                    </span>
                    <span className="fl-chip is-marigold">GOOGLE AI STUDIO</span>
                  </div>
                  <div className="fl-bubble is-user">
                    Plan my Diwali shopping week — ₹5,000 for gifts and décor.
                  </div>
                  <div className="fl-bubble is-ai">
                    Here&rsquo;s a calm plan for the week before <em>Diwali (Nov 12)</em> — spread
                    across markets, online orders, and one wrapping evening.
                  </div>
                  <div className="fl-plan">
                    <div className="fl-plan-head">
                      <Sparkles size={12} />
                      Suggested Folio actions · 3 steps
                      <span className="fl-chip is-sky">REVIEW FIRST</span>
                    </div>
                    <ul>
                      <li><i />Buy diyas &amp; marigold garlands — Saturday market run</li>
                      <li><i />Order kaju katli from the family&rsquo;s favourite sweet shop</li>
                      <li><i />Wrap gifts &amp; courier to Indore — Wednesday</li>
                    </ul>
                    <div className="fl-plan-foot">
                      <span className="fl-btn is-text is-small">Review only</span>
                      <span className="fl-btn is-primary is-small">
                        <Check size={12} />
                        Approve &amp; run
                      </span>
                    </div>
                  </div>
                  <div className="fl-usage">
                    <span>68% of today&rsquo;s allowance used</span>
                    <span className="fl-usage-track"><i /></span>
                    <span>resets 12 AM IST</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 7. SECURITY */}
        <section className="fl-section" id="security">
          <div className="fl-container">
            <div className="fl-section-head">
              <span className="fl-eyebrow">Security &amp; privacy</span>
              <h2 className="fl-h2">
                Your work is personal. <em>Let&rsquo;s keep it that way.</em>
              </h2>
              <p>
                Account-scoped PostgreSQL storage, zero third-party trackers, and complete,
                verified account deletion on demand.
              </p>
            </div>
            <div className="fl-sec-grid">
              <article className="fl-sec-card">
                <span className="fl-sec-icon"><Lock size={18} /></span>
                <h3>scrypt password hashing</h3>
                <p>Slow, memory-hard hashing with per-user salts. No plaintext secrets ever touch the database.</p>
              </article>
              <article className="fl-sec-card">
                <span className="fl-sec-icon"><ShieldCheck size={18} /></span>
                <h3>HTTP-only sessions</h3>
                <p>SameSite=Lax, HTTP-only cookies — unreachable to scripts, scoped to your account alone.</p>
              </article>
              <article className="fl-sec-card">
                <span className="fl-sec-icon"><Database size={18} /></span>
                <h3>AES-256-GCM encryption</h3>
                <p>Google OAuth tokens are encrypted at rest and revocable in one click from Settings.</p>
              </article>
              <article className="fl-sec-card">
                <span className="fl-sec-icon"><Trash2 size={18} /></span>
                <h3>Verified account deletion</h3>
                <p>One atomic erase across 25 tables — zero orphaned records, tokens revoked immediately.</p>
              </article>
            </div>
            <div style={{ textAlign: "center", marginTop: "26px" }}>
              <Link href="/privacy" className="fl-row-cta" style={{ justifyContent: "center" }}>
                A closer look at privacy
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </section>

        {/* 8. HOW IT WORKS */}
        <section className="fl-section" id="how-it-works">
          <div className="fl-container">
            <div className="fl-section-head">
              <span className="fl-eyebrow">A gentler way to get going</span>
              <h2 className="fl-h2">
                From a little thought to <em>something real.</em>
              </h2>
            </div>
            <div className="fl-steps">
              <article className="fl-step">
                <span className="fl-step-index">1</span>
                <h3>Make yourself at home.</h3>
                <p>
                  Create your account in seconds. Customize your name, timezone, theme, and
                  rhythm — or jump in immediately with smart defaults.
                </p>
              </article>
              <article className="fl-step">
                <span className="fl-step-index">2</span>
                <h3>Give it a little structure.</h3>
                <p>
                  Start with one project. Add the next small task. Keep early sparks on your Idea
                  Board and connect Google Calendar if helpful.
                </p>
              </article>
              <article className="fl-step">
                <span className="fl-step-index">3</span>
                <h3>Make meaningful progress.</h3>
                <p>
                  Watch small wins add up in task insights. Review Folio AI action plans when you
                  want perspective, and keep your workspace calm.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* 9. OPEN SOURCE */}
        <section className="fl-section" id="open-source">
          <div className="fl-container">
            <div className="fl-section-head">
              <span className="fl-eyebrow">Source on GitHub &amp; transparent</span>
              <h2 className="fl-h2">
                Crafted in the open, <em>for developers and thinkers.</em>
              </h2>
              <p>
                Folio&rsquo;s source code is published on GitHub. Read the queries, review the
                security decisions, and follow the work in the open.
              </p>
            </div>
            <div className="fl-oss-grid" id="tech-stack">
              <div className="fl-oss-card">
                <div className="fl-oss-top">
                  <GithubMark />
                  <span>
                    <strong>GitHub Repository</strong>
                    <small>PratikPrasad1813 / Folio</small>
                  </span>
                  <a
                    href={GITHUB_REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fl-gh-pill"
                  >
                    <Star size={13} />
                    Star on GitHub
                  </a>
                </div>
                <p>
                  Browse the complete source code, review commit history, contribute
                  improvements, or report issues on GitHub.
                </p>
                <div className="fl-oss-links">
                  <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
                    <GitBranch size={13} />
                    Repository
                  </a>
                  <a href={`${GITHUB_REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
                    <CircleCheck size={13} />
                    Issues
                  </a>
                  <a href={`${GITHUB_REPO_URL}/pulls`} target="_blank" rel="noopener noreferrer">
                    <HeartHandshake size={13} />
                    Pull requests
                  </a>
                </div>
              </div>
              <div className="fl-oss-card">
                <h3 style={{ margin: 0 }}>Verified technology stack</h3>
                <ul className="fl-tech-list">
                  <li>
                    <span className="fl-tech-icon"><Layers size={16} /></span>
                    <span>
                      <strong>Next.js 16 (App Router)</strong>
                      <span>Server components, streaming route handlers, and proxy middleware</span>
                    </span>
                  </li>
                  <li>
                    <span className="fl-tech-icon"><Database size={16} /></span>
                    <span>
                      <strong>PostgreSQL &amp; Drizzle ORM</strong>
                      <span>Type-safe schemas, 25 user-owned tables, and ordered migrations</span>
                    </span>
                  </li>
                  <li>
                    <span className="fl-tech-icon"><Cpu size={16} /></span>
                    <span>
                      <strong>BYOK AI engine</strong>
                      <span>Your own Anthropic, OpenAI, OpenRouter, or Google AI Studio key with streaming responses and a 10,000-token daily Folio allowance</span>
                    </span>
                  </li>
                  <li>
                    <span className="fl-tech-icon"><ShieldCheck size={16} /></span>
                    <span>
                      <strong>Self-managed security</strong>
                      <span>scrypt password hashing, AES-256 token encryption, and complete deletion</span>
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* 10. FAQ */}
        <section className="fl-section" id="faq">
          <div className="fl-container">
            <div className="fl-faq-grid">
              <div>
                <span className="fl-eyebrow">A little more clarity</span>
                <h2 className="fl-h2">
                  Good questions. <em>Honest answers.</em>
                </h2>
                <p>
                  Everything you might want to know about how Folio works under the hood.
                </p>
                <p className="fl-serif" style={{ marginTop: 14 }}>
                  Still curious? The whole source is on GitHub.
                </p>
              </div>
              <div className="fl-faq-list">
                {FAQ.map(([question, answer]) => (
                  <details key={question}>
                    <summary>
                      {question}
                      <span>
                        <ChevronDown size={17} />
                      </span>
                    </summary>
                    <p>{answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 11. FINAL CTA */}
        <section className="fl-section" aria-label="Get started with Folio">
          <div className="fl-container">
            <div className="fl-final-panel">
              <span className="fl-final-spark" aria-hidden="true">✳</span>
              <span className="fl-eyebrow">Your next chapter starts here</span>
              <h2 className="fl-h2">
                Make room for <em>better work.</em>
              </h2>
              <p>A clearer head. A calmer day. A workspace that&rsquo;s truly yours.</p>
              <div className="fl-final-ctas">
                <Link href="/signup" className="fl-btn is-hero" style={{ background: "#02093a", color: "#fff" }}>
                  Create your free workspace
                  <ArrowUpRight size={16} />
                </Link>
                <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className="fl-btn is-hero" style={{ background: "rgba(255,255,255,.72)" }}>
                  Star on GitHub
                  <ArrowUpRight size={16} />
                </a>
              </div>
              <p className="fl-final-note">
                Already have a little corner here?{" "}
                <Link href="/login">Sign in</Link>
              </p>
            </div>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
