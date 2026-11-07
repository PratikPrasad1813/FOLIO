"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  BrainCircuit,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  Code2,
  Columns3,
  Command,
  Cpu,
  Database,
  ExternalLink,
  Flame,
  FolderKanban,
  GitBranch,
  Globe2,
  HardDrive,
  HeartHandshake,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Lock,
  Mail,
  Menu,
  Moon,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareCheckBig,
  Star,
  Sun,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { Logo } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { HeroDownload } from "@/components/hero-download";
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
}: {
  name: string;
  alt: string;
  eager?: boolean;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);
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
          ref={(image) => {
            if (image?.complete && image.naturalWidth === 0) setMissing(true);
          }}
          src={`/screenshots/${name}.png`}
          alt={alt}
          width={1440}
          height={1000}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
          onError={() => setMissing(true)}
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
            <Link href="/#docs">Developer Documentation</Link>
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

const SCREENS = [
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
    badge: "LOCAL ON-DEVICE",
    description: "100% on-device WebGPU assistant. Proposes verified workspace action plans without cloud data leaks.",
  },
];

export function ProductShowcase() {
  const [selected, setSelected] = useState(0);
  const screen = SCREENS[selected];
  return (
    <div className="lp-showcase">
      <div className="lp-showcase-tabs" role="tablist" aria-label="Explore actual Folio screens">
        {SCREENS.map((item, index) => (
          <button
            type="button"
            key={item.name}
            id={`showcase-tab-${item.name}`}
            role="tab"
            aria-selected={selected === index}
            aria-controls="showcase-screen"
            tabIndex={selected === index ? 0 : -1}
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
            <item.icon size={15} />
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="lp-showcase-stage"
        id="showcase-screen"
        role="tabpanel"
        aria-labelledby={`showcase-tab-${screen.name}`}
      >
        <div className="lp-window-bar">
          <span className="lp-window-dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            <ShieldCheck size={11} />
            folio / {screen.label.toLowerCase()}
          </span>
          <span className="lp-preview-badge">{screen.badge}</span>
        </div>
        <ProductImage
          key={screen.name}
          name={screen.name}
          alt={`Actual Folio ${screen.label} interface using a dedicated example workspace`}
        />
      </div>
      <p className="lp-showcase-caption">
        <span>{screen.description}</span>
        <small>Real application captures from PostgreSQL. Never a static mockup.</small>
      </p>
    </div>
  );
}

const FAQ = [
  [
    "What is Folio?",
    "Folio is a personal workspace for your projects, tasks, schedule, and ideas. Built with Next.js 16, PostgreSQL, Drizzle ORM, and local WebGPU AI, it brings big-picture calm and small-step momentum together into one distraction-free place.",
  ],
  [
    "Is Folio completely free to use?",
    "Folio has no subscriptions, paywalls, or premium tiers in this version. The local AI preview includes an account-wide allowance of 50 completed messages per day running directly on your device.",
  ],
  [
    "How does Folio AI protect my privacy?",
    "Folio AI runs 100% locally inside your browser using WebLLM and WebGPU. Your conversation prompts, drafts, and responses never leave your machine and are never sent to external AI servers. In addition, when AI prepares workspace actions (like creating tasks or organizing a project), it produces a transparent plan that you review and confirm before anything changes.",
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
    "Yes. The public landing page, sign-in, onboarding, and workspace shells adapt responsively to mobile and tablet screens. Local AI inference depends on your device's browser WebGPU support, but the core workspace (projects, tasks, calendar, ideas) works everywhere.",
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

  return (
    <div className="public-site lp-page">
      {deletedNotice && (
        <aside className="lp-deleted-banner" role="status">
          <div className="lp-deleted-banner-inner">
            <CircleCheck size={16} />
            <span>
              Your account and workspace data have been permanently deleted. Thank you for using Folio.
            </span>
            <button
              type="button"
              className="lp-deleted-dismiss"
              aria-label="Dismiss message"
              onClick={() => setDismissedNotice(true)}
            >
              <X size={14} />
            </button>
          </div>
        </aside>
      )}

      <PublicHeader home />

      <main>
        {/* 1. HERO SECTION */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-lines" aria-hidden="true" />
          <div className="lp-hero-copy">
            <a href="#folio-ai" className="lp-announcement">
              <span>
                <Sparkles size={12} />
                Folio 2.0 with On-Device WebGPU AI &amp; Calendar Sync
              </span>
              <span>
                Explore the workspace
                <ArrowRight size={12} />
              </span>
            </a>
            <h1 id="hero-title">
              A clearer mind.
              <br />A little more <em>possibility.</em>
            </h1>
            <p>
              Your projects, plans, and bright ideas. Beautifully together.
              <br className="lp-desktop-break" /> A thoughtful personal workspace for everything you want to make happen.
            </p>
            <div className="lp-hero-actions">
              <HeroDownload />
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-button is-outline lp-btn-gh"
              >
                <GithubMark />
                Star on GitHub
              </a>
              <a href="#product" className="lp-button is-outline lp-btn-scroll">
                Explore product
                <ArrowDown size={14} />
              </a>
            </div>
            <div className="lp-hero-reassurance">
              <span>
                <Check size={13} />
                No subscriptions
              </span>
              <i />
              <span>
                <Check size={13} />
                Self-managed authentication
              </span>
              <i />
              <span>
                <Check size={13} />
                Zero cloud AI data leaks
              </span>
              <i />
              <span>
                <Check size={13} />
                Full data deletion on demand
              </span>
            </div>
          </div>

          {/* 2. PRODUCT DASHBOARD PREVIEW */}
          <div className="lp-hero-preview">
            <div className="lp-preview-label">
              <span>
                <i />
                ONE HOME FOR YOUR EVERYDAY
              </span>
              <span>Less switching. More doing.</span>
            </div>
            <div className="lp-hero-frame">
              <div className="lp-window-bar">
                <span className="lp-window-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <ShieldCheck size={11} />
                  Your personal workspace
                </span>
                <span className="lp-preview-badge">ACTUAL FOLIO SCREEN</span>
              </div>
              <ProductImage
                name="dashboard"
                eager
                alt="The real Folio overview, showing projects, daily tasks, and progress in a non-personal example workspace"
              />
            </div>
            <div className="lp-preview-ground" aria-hidden="true" />
          </div>
        </section>

        {/* BELONGING STRIP */}
        <section className="lp-belong">
          <p>
            For the things you’re building.
            <br className="lp-mobile-break" /> And the person you’re becoming.
          </p>
          <div>
            <span>
              <FolderKanban size={18} />
              The projects
            </span>
            <span>
              <SquareCheckBig size={18} />
              The everyday tasks
            </span>
            <span>
              <CalendarDays size={18} />
              The bigger picture
            </span>
            <span>
              <Lightbulb size={18} />
              The what-ifs
            </span>
            <span>
              <BrainCircuit size={18} />
              The on-device assistant
            </span>
          </div>
        </section>

        {/* 3. PRODUCT WALKTHROUGH SHOWCASE */}
        <section className="lp-section lp-product-section" id="product">
          <div className="lp-section-header">
            <span className="lp-eyebrow">
              <span />
              LESS SCATTERED. MORE CENTERED.
            </span>
            <h2>
              Everything in its place.
              <br />
              <em>And a place for everything.</em>
            </h2>
            <p>
              Not another noisy tab to keep track of. One considered home
              <br className="lp-desktop-break" /> for your ambitions, day-to-day focus, and the sparks that follow.
            </p>
          </div>
          <ProductShowcase />
        </section>

        {/* 4. FEATURES OVERVIEW */}
        <section id="features" className="lp-section lp-features">
          <div className="lp-section-heading-row">
            <div>
              <span className="lp-eyebrow">
                <span />
                BUILT FOR THE WAY YOU THINK
              </span>
              <h2>
                Big-picture calm.
                <br />
                <em>Small-step momentum.</em>
              </h2>
            </div>
            <p>
              A little structure makes a lot of room.
              <br />
              Bring your work into focus, without
              <br className="lp-desktop-break" /> making organization feel like another full-time job.
            </p>
          </div>

          <div className="lp-feature-grid">
            <article className="lp-feature-card is-projects">
              <span className="lp-feature-icon">
                <FolderKanban size={19} />
              </span>
              <h3>Give your next big thing a home.</h3>
              <p>
                Projects with a clear goal, checkpoints, milestones,
                <br />
                and visual progress metrics you can actually celebrate.
              </p>
              <ProductImage
                name="projects"
                alt="Folio project cards with genuine progress and milestones from the example workspace"
                className="lp-feature-capture"
              />
              <Link href="/signup" className="lp-card-link">
                Make your first project
                <ArrowUpRight size={15} />
              </Link>
            </article>

            <article className="lp-feature-card is-tasks">
              <span className="lp-feature-icon">
                <SquareCheckBig size={19} />
              </span>
              <h3>Find your next small step.</h3>
              <p>
                Board, list, or calendar. Prioritize your tasks
                <br />
                with custom tags, estimates, and checkable subtasks.
              </p>
              <ProductImage
                name="tasks-board"
                alt="Real Folio task board with workflow columns"
                className="lp-feature-capture"
              />
              <Link href="/signup" className="lp-card-link">
                A little progress starts here
                <ArrowUpRight size={15} />
              </Link>
            </article>
          </div>

          <div className="lp-small-features">
            <article>
              <span className="lp-small-number">01 /</span>
              <Lightbulb size={23} strokeWidth={1.5} />
              <h3>A home for “what if.”</h3>
              <p>
                Catch a spark before it slips away. Organize your ideas into stages, and turn the right one into a full project with one click.
              </p>
            </article>
            <article>
              <span className="lp-small-number">02 /</span>
              <CalendarDays size={23} strokeWidth={1.5} />
              <h3>Meet your day with clarity.</h3>
              <p>
                Bring selected Google calendars beside your tasks. See what’s coming up, keep deadlines in sight, and make breathing room.
              </p>
            </article>
            <article>
              <span className="lp-small-number">03 /</span>
              <Command size={23} strokeWidth={1.5} />
              <h3>Less looking. More finding.</h3>
              <p>
                Search your entire workspace in a keystroke (⌘K). Save custom filters and navigate with single-letter shortcuts.
              </p>
            </article>
          </div>
        </section>

        {/* 5. WORKFLOWS DEEP DIVE (Projects, Tasks, Calendar, Ideas) */}
        <section className="lp-section lp-workflows-section" id="workflows">
          <div className="lp-section-header">
            <span className="lp-eyebrow">
              <span />
              PURPOSE-BUILT WORKFLOWS
            </span>
            <h2>
              Designed for momentum,
              <br />
              <em>crafted with care.</em>
            </h2>
            <p>
              Explore how each surface works together to keep your thoughts organized and your schedule calm.
            </p>
          </div>

          <div className="lp-workflow-columns">
            {/* Project Management */}
            <div className="lp-workflow-card">
              <div className="lp-workflow-head">
                <span className="lp-workflow-tag tone-violet">PROJECTS &amp; MILESTONES</span>
                <h3>Structure without rigidity.</h3>
                <p>
                  Split larger projects into meaningful milestones. Assign custom color tokens, categories (Personal, Product, Engineering, Client work), and track real completion percentages based on finished tasks.
                </p>
              </div>
              <div className="lp-workflow-img-wrap">
                <ProductImage name="project-details" alt="Project details and milestones screen in Folio" />
              </div>
            </div>

            {/* Kanban & Task List */}
            <div className="lp-workflow-card">
              <div className="lp-workflow-head">
                <span className="lp-workflow-tag tone-green">KANBAN &amp; DENSITY</span>
                <h3>Work the way you think today.</h3>
                <p>
                  Switch fluidly between a visual Kanban board, a high-density sorted list, and an agenda calendar. Set priorities from Urgent to Low, add checklists, tag with custom labels, and set quiet reminder times.
                </p>
              </div>
              <div className="lp-workflow-img-wrap">
                <ProductImage name="tasks-list" alt="High density task list in Folio" />
              </div>
            </div>

            {/* Scheduling & Calendar */}
            <div className="lp-workflow-card">
              <div className="lp-workflow-head">
                <span className="lp-workflow-tag tone-blue">CALENDAR &amp; SCHEDULE</span>
                <h3>Context beside commitments.</h3>
                <p>
                  Connect Google Calendar with zero friction. View external meetings right next to your Folio task deadlines and milestone checkpoints. Tokens are sealed with AES-256-GCM encryption at rest.
                </p>
              </div>
              <div className="lp-workflow-img-wrap">
                <ProductImage name="calendar" alt="Google Calendar integration in Folio" />
              </div>
            </div>

            {/* Ideas & Conversion */}
            <div className="lp-workflow-card">
              <div className="lp-workflow-head">
                <span className="lp-workflow-tag tone-amber">IDEA BOARD</span>
                <h3>Capture before you organize.</h3>
                <p>
                  Great things start with a spark. Park thoughts under “Just an idea”, “Exploring”, or “Ready to start”. When an idea is ripe, one click converts it into an active project with all your notes intact.
                </p>
              </div>
              <div className="lp-workflow-img-wrap">
                <ProductImage name="ideas" alt="Idea board in Folio" />
              </div>
            </div>
          </div>
        </section>

        {/* 6. FOLIO AI ASSISTANT */}
        <section className="lp-ai-section" id="folio-ai">
          <div className="lp-ai-inner">
            <div className="lp-ai-copy">
              <span className="lp-eyebrow">
                <Sparkles size={14} />
                A THOUGHTFUL SECOND MIND
              </span>
              <h2>
                A little perspective.
                <br />
                <em>A lot more potential.</em>
              </h2>
              <p>
                Meet Folio AI. A personalized, local-first assistant that runs directly on your device using WebGPU and WebLLM.
              </p>
              <ul>
                <li>
                  <CheckCircleIcon />
                  <span>
                    <strong>100% on-device inference:</strong> Your prompts and workspace content never leave your browser.
                  </span>
                </li>
                <li>
                  <CheckCircleIcon />
                  <span>
                    <strong>Zero cloud fallback:</strong> No hidden API calls or third-party tracking.
                  </span>
                </li>
                <li>
                  <CheckCircleIcon />
                  <span>
                    <strong>Safe action plans:</strong> Folio AI proposes verified workspace changes that you review before execution.
                  </span>
                </li>
                <li>
                  <CheckCircleIcon />
                  <span>
                    <strong>Custom identity:</strong> Configure your assistant’s presentation, name, and communication style.
                  </span>
                </li>
              </ul>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 22 }}>
                <Link href="/signup" className="lp-button is-dark">
                  Try Folio AI locally
                  <ArrowUpRight size={16} />
                </Link>
                <a href="#open-source" className="lp-button is-outline">
                  Read architecture
                </a>
              </div>
              <small>
                Local AI preview requires a WebGPU-compatible browser (e.g. Chrome 113+, Edge, Safari 26+) and sufficient device memory. Model files download once to browser cache. Your entire workspace functions smoothly without AI enabled.
              </small>
            </div>
            <div className="lp-ai-visual">
              <div className="lp-ai-window">
                <div className="lp-ai-window-label">
                  <Sparkles size={14} />
                  <span>Folio AI Assistant</span>
                  <b>LOCAL ON-DEVICE WEBGPU</b>
                </div>
                <ProductImage
                  name="folio-ai"
                  alt="Actual Folio AI interface with device compatibility and account usage information"
                />
              </div>
              <p>
                <ShieldCheck size={13} />
                Your private thoughts belong strictly on your device.
              </p>
            </div>
          </div>
        </section>

        {/* 7. NOTIFICATIONS & FOCUS */}
        <section className="lp-section lp-notifs-section" id="notifications">
          <div className="lp-section-header">
            <span className="lp-eyebrow">
              <span />
              GENTLE PRODUCTIVITY
            </span>
            <h2>
              Kept in the loop,
              <br />
              <em>never interrupted.</em>
            </h2>
            <p>
              Notifications should feel helpful, never overwhelming. Fine-tune reminders and respect your rest.
            </p>
          </div>

          <div className="lp-notif-cards-grid">
            <div className="lp-notif-feature">
              <div className="lp-notif-icon-bubble tone-violet">
                <Bell size={20} />
              </div>
              <h3>Contextual notifications</h3>
              <p>
                Clean notification center with grouped time buckets (Today, Yesterday, Earlier) and direct shortcuts to tasks, milestones, or calendar events.
              </p>
            </div>
            <div className="lp-notif-feature">
              <div className="lp-notif-icon-bubble tone-blue">
                <Moon size={20} />
              </div>
              <h3>Configurable quiet hours</h3>
              <p>
                Set your personal rest hours. Folio holds reminders during quiet hours and queues delivery for when your morning begins.
              </p>
            </div>
            <div className="lp-notif-feature">
              <div className="lp-notif-icon-bubble tone-green">
                <SlidersHorizontal size={20} />
              </div>
              <h3>Granular category toggles</h3>
              <p>
                Control which alerts you receive: task deadlines, approaching milestones, project updates, calendar sync, or account security notices.
              </p>
            </div>
          </div>
        </section>

        {/* 8. PRIVACY, SECURITY & COMPLETE DATA DELETION */}
        <section className="lp-privacy-strip" id="security">
          <div>
            <span className="lp-privacy-mark">
              <ShieldCheck size={28} strokeWidth={1.5} />
            </span>
            <div>
              <h3>
                Your work is personal.
                <br />
                <em>Let’s keep it that way.</em>
              </h3>
              <p>
                Account-scoped PostgreSQL storage. Secure, HTTP-only sessions with scrypt password hashing.
                <br className="lp-desktop-break" />
                Zero third-party trackers. Complete, verified account deletion on demand with zero orphaned records.
              </p>
              <div className="lp-security-tags">
                <span>
                  <Lock size={12} />
                  scrypt Password Hashing
                </span>
                <span>
                  <ShieldCheck size={12} />
                  SameSite=Lax &amp; HttpOnly
                </span>
                <span>
                  <Database size={12} />
                  AES-256-GCM Token Encryption
                </span>
                <span>
                  <Trash2 size={12} />
                  Verified Account Deletion
                </span>
              </div>
            </div>
          </div>
          <Link href="/privacy" className="lp-privacy-link">
            A closer look at privacy
            <ArrowUpRight size={15} />
          </Link>
        </section>

        {/* 9. HOW IT WORKS */}
        <section id="how-it-works" className="lp-section lp-how">
          <div className="lp-section-header">
            <span className="lp-eyebrow">
              <span />
              A GENTLER WAY TO GET GOING
            </span>
            <h2>
              From a little thought
              <br />
              to <em>something real.</em>
            </h2>
          </div>
          <div className="lp-steps">
            <article>
              <span className="lp-step-index">01</span>
              <div className="lp-step-line" />
              <h3>Make yourself at home.</h3>
              <p>
                Create your account in seconds. Customize your name, timezone, theme, and rhythm—or jump in immediately with smart defaults.
              </p>
            </article>
            <article>
              <span className="lp-step-index">02</span>
              <div className="lp-step-line" />
              <h3>Give it a little structure.</h3>
              <p>
                Start with one project. Add the next small task. Keep early sparks on your Idea Board and connect Google Calendar if helpful.
              </p>
            </article>
            <article>
              <span className="lp-step-index">03</span>
              <div className="lp-step-line" />
              <h3>Make meaningful progress.</h3>
              <p>
                Watch small wins add up in task insights. Review on-device AI plans when you want perspective, and keep your workspace calm.
              </p>
            </article>
          </div>
        </section>

        {/* 10. DEVELOPER & OPEN SOURCE COMMUNITY */}
        <section className="lp-section lp-oss-section" id="open-source">
          <div className="lp-section-header">
            <span className="lp-eyebrow">
              <Code2 size={14} />
              SOURCE ON GITHUB &amp; TRANSPARENT
            </span>
            <h2>
              Crafted in the open,
              <br />
              <em>for developers and thinkers.</em>
            </h2>
            <p>
              Folio’s source code is published on GitHub. Read the queries, review the security decisions, and follow the work in the open.
            </p>
          </div>

          <div className="lp-oss-grid" id="tech-stack">
            <div className="lp-oss-card">
              <div className="lp-oss-card-top">
                <GithubMark />
                <div>
                  <strong>GitHub Repository</strong>
                  <small>PratikPrasad1813 / Folio</small>
                </div>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-oss-cta"
                >
                  <Star size={13} />
                  Star on GitHub
                </a>
              </div>
              <p>
                Browse the complete source code, review commit history, contribute improvements, or report issues on GitHub.
              </p>
              <div className="lp-oss-links">
                <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
                  <GitBranch size={13} />
                  Repository
                </a>
                <a href={`${GITHUB_REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
                  <X size={13} />
                  Issues
                </a>
                <a href={`${GITHUB_REPO_URL}/pulls`} target="_blank" rel="noopener noreferrer">
                  <HeartHandshake size={13} />
                  Pull requests
                </a>
              </div>
            </div>

            <div className="lp-oss-tech-card">
              <h4>Verified Technology Stack</h4>
              <ul className="lp-tech-list">
                <li>
                  <Layers size={15} />
                  <div>
                    <strong>Next.js 16 (App Router)</strong>
                    <span>Server components, streaming route handlers, and proxy middleware</span>
                  </div>
                </li>
                <li>
                  <Database size={15} />
                  <div>
                    <strong>PostgreSQL &amp; Drizzle ORM</strong>
                    <span>Type-safe schemas, 25 user-owned tables, and ordered migrations</span>
                  </div>
                </li>
                <li>
                  <Cpu size={15} />
                  <div>
                    <strong>WebLLM &amp; WebGPU</strong>
                    <span>Local-first on-device AI inference with zero cloud server dependencies</span>
                  </div>
                </li>
                <li>
                  <ShieldCheck size={15} />
                  <div>
                    <strong>Self-Managed Security</strong>
                    <span>scrypt password hashing, AES-256 token encryption, and complete deletion</span>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* 11. DOCUMENTATION GUIDES */}
        <section className="lp-section lp-docs-section" id="docs">
          <div className="lp-section-header">
            <span className="lp-eyebrow">
              <BookOpen size={14} />
              ARCHITECTURE &amp; GUIDES
            </span>
            <h2>
              Documented down to
              <br />
              <em>every detail.</em>
            </h2>
            <p>
              Clear, honest engineering documentation for local development, schema migrations, and production operations.
            </p>
          </div>

          <div className="lp-docs-grid">
            <Link href="/docs" className="lp-doc-card">
              <span className="lp-doc-icon">ENGINEERING MANUAL</span>
              <h3>Folio Engineering Documentation</h3>
              <p>Architecture, database schema, authentication, calendar sync, local AI, and desktop releases.</p>
              <span className="lp-doc-link">
                Explore documentation <ArrowUpRight size={13} />
              </span>
            </Link>

            <a
              href={`${GITHUB_REPO_URL}#readme`}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-doc-card"
            >
              <span className="lp-doc-icon">README.md</span>
              <h3>Project Overview &amp; Architecture</h3>
              <p>Complete project walkthrough, directory layout, commands, and local quickstart.</p>
              <span className="lp-doc-link">
                Read guide <ArrowUpRight size={13} />
              </span>
            </a>

            <a
              href={`${GITHUB_DOCS_BASE}/DATABASE_SETUP.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-doc-card"
            >
              <span className="lp-doc-icon">DATABASE_SETUP.md</span>
              <h3>PostgreSQL &amp; Migrations</h3>
              <p>Base schema initialisation, ordered Drizzle migrations, and schema verification.</p>
              <span className="lp-doc-link">
                Read guide <ArrowUpRight size={13} />
              </span>
            </a>

            <a
              href={`${GITHUB_DOCS_BASE}/AUTHENTICATION.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-doc-card"
            >
              <span className="lp-doc-icon">AUTHENTICATION.md</span>
              <h3>Auth &amp; Account Deletion</h3>
              <p>Self-managed auth architecture, scrypt hashing, OAuth callbacks, and data lifecycle.</p>
              <span className="lp-doc-link">
                Read guide <ArrowUpRight size={13} />
              </span>
            </a>

            <a
              href={`${GITHUB_DOCS_BASE}/SCREENSHOTS.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-doc-card"
            >
              <span className="lp-doc-icon">SCREENSHOTS.md</span>
              <h3>Automated Screenshots</h3>
              <p>Playwright automated pipeline capturing real application screens in isolated test DB.</p>
              <span className="lp-doc-link">
                Read guide <ArrowUpRight size={13} />
              </span>
            </a>
          </div>
        </section>

        {/* 12. FAQ */}
        <section id="faq" className="lp-section lp-faq">
          <div>
            <span className="lp-eyebrow">
              <span />
              A LITTLE MORE CLARITY
            </span>
            <h2>
              Good questions.
              <br />
              <em>Honest answers.</em>
            </h2>
            <p>Everything you might want to know about how Folio works under the hood.</p>
          </div>
          <div className="lp-faq-list">
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
        </section>

        {/* 13. FINAL CALL TO ACTION */}
        <section className="lp-final">
          <span className="lp-final-spark" aria-hidden="true">
            ✳
          </span>
          <span className="lp-eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
          <h2>
            Make room for
            <br />
            <em>better work.</em>
          </h2>
          <p>A clearer head. A calmer day. A workspace that’s truly yours.</p>
          <div>
            <Link href="/signup" className="lp-button is-primary">
              Create your free workspace
              <ArrowUpRight size={17} />
            </Link>
            <div className="lp-final-sublinks">
              <Link href="/login" className="lp-final-signin">
                Already have an account? <span>Sign in<ArrowRight size={13} /></span>
              </Link>
              <span className="lp-final-dot">&middot;</span>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-final-signin"
              >
                <span>Star on GitHub<ArrowUpRight size={13} /></span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}

function ArrowDownIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M10 3v13m-5-5 5 5 5-5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <span className="lp-check-circle">
      <Check size={11} />
    </span>
  );
}
