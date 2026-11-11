"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, BookOpen, ChevronDown, Command, FileText, Search, X } from "lucide-react";
import { Logo } from "@/components/ui";
import { ThemeToggle, useTheme } from "@/components/theme-toggle";

type Chapter = {
  id: string;
  title: string;
  sections: readonly (readonly [string, string])[];
};

type SearchResult = {
  href: string;
  title: string;
  chapter: string;
  description: string;
};

const SEARCH_TERMS: Record<string, string> = {
  philosophy: "four tab productivity tax Notion Jira Google Calendar ChatGPT workspace principles source of truth",
  "system-map": "Next.js 16 App Router Turbopack React Server Components PostgreSQL Drizzle Tauri architecture diagram",
  "workspace-runtime": "workspace state optimistic UI cache mutations route handlers API ownership validation",
  "api-contracts": "REST HTTP JSON GET POST PATCH DELETE API status codes contracts",
  environment: "DATABASE_URL encryption key OAuth Google GitHub SMTP secrets environment setup",
  schema: "Drizzle ORM users sessions projects milestones tasks subtasks ideas calendar accounts tables indexes",
  migrations: "drizzle-kit generate push migration lifecycle schema verification database init",
  sessions: "scrypt password hashing session tokens HTTP-only cookies timing safe",
  "web-oauth": "Google GitHub OAuth PKCE state verified email account linking callback",
  "desktop-auth": "folio protocol deep link Rust single instance plugin opener one-time handoff",
  "projects-milestones": "project health progress completed milestone percentage archive deadline",
  "task-management": "Kanban drag drop board keyboard shortcuts dense list batch actions status ordering",
  ideas: "idea incubator scratchpad convert promote project transaction milestones subtasks",
  "google-setup": "Google Cloud OAuth consent Calendar API scopes calendar.readonly calendar.events credentials",
  "sync-engine": "Google sync token incremental delta refresh access token conflict resolution etag event mirror",
  "sync-resilience": "Google API rate limit 429 410 expired refresh token offline retry backoff",
  "ambient-ai": "Folio AI context tasks calendar projects privacy model actions consent",
  "prompt-design": "prompt template task decomposition estimation uncertainty JSON output",
  "byok-api": "BYOK bring your own key AI provider API key hosted inference streaming token daily quota billing privacy",
  "tauri-architecture": "Tauri Rust WebView2 WKWebView WebKitGTK desktop app shell",
  "tauri-config": "tauri.conf.json security CSP window icon bundle protocol",
  "desktop-packaging": "Windows exe msi macOS dmg universal Linux deb AppImage signing notarization",
};

export function DocsExperience({
  chapters,
  activeChapterId,
  children,
}: {
  chapters: readonly Chapter[];
  activeChapterId?: string;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(activeChapterId ?? chapters[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [selectedResult, setSelectedResult] = useState(0);

  const searchResults = useMemo(() => {
    const entries: SearchResult[] = [];
    for (const chapter of chapters) {
      entries.push({
        href: `/docs/${chapter.id}`,
        title: chapter.title.replace(/^\d+\.\s*/, ""),
        chapter: "Chapter",
        description: `Overview of ${chapter.title.replace(/^\d+\.\s*/, "")}`,
      });
      for (const [id, title] of chapter.sections) {
        entries.push({
          href: `/docs/${chapter.id}#${id}`,
          title,
          chapter: chapter.title,
          description: SEARCH_TERMS[id] ?? title,
        });
      }
    }

    const normalized = query.trim().toLowerCase();
    if (!normalized) return entries.slice(0, 9);
    const terms = normalized.split(/\s+/).filter(Boolean);
    return entries
      .map((entry) => {
        const haystack = `${entry.title} ${entry.chapter} ${entry.description}`.toLowerCase();
        const score = terms.reduce((total, term) => {
          if (entry.title.toLowerCase().includes(term)) return total + 4;
          if (entry.chapter.toLowerCase().includes(term)) return total + 2;
          return haystack.includes(term) ? total + 1 : total - 10;
        }, 0);
        return { entry, score };
      })
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ entry }) => entry);
  }, [chapters, query]);

  const openSearch = () => {
    setQuery("");
    setSelectedResult(0);
    setSearchOpen(true);
  };

  useEffect(() => {
    if (!searchOpen) return;
    const frame = requestAnimationFrame(() => searchInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setSelectedResult(0);
        setSearchOpen(!searchOpen);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen]);

  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>(".docs-content [id]"));
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -72% 0px", threshold: 0 },
    );
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    const updateProgress = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(100, Math.max(0, window.scrollY / max * 100)) : 0);
    };
    const frame = requestAnimationFrame(updateProgress);
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, [pathname]);

  const selectResult = (result: SearchResult) => {
    setSearchOpen(false);
    setQuery("");
    window.location.assign(result.href);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setSelectedResult((current) => Math.max(0, Math.min(searchResults.length - 1, current + delta)));
      resultsRef.current?.querySelectorAll<HTMLAnchorElement>("[data-search-result]")[selectedResult + delta]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && searchResults[selectedResult]) {
      event.preventDefault();
      selectResult(searchResults[selectedResult]);
    }
  };
  const currentChapter = chapters.find((chapter) => chapter.id === activeChapterId);
  const tocChapters = currentChapter ? [currentChapter] : chapters;

  return (
    <div className={`docs-experience docs-theme-${theme}`}>
      <div className="docs-reading-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      <header className="docs-topbar">
        <div className="docs-topbar-inner">
          <div className="docs-brand-group">
            <Link href="/" aria-label="Folio home" className="docs-brand-link"><Logo /></Link>
            <span className="docs-brand-divider" />
            <Link href="/docs" className="docs-manual-name"><BookOpen size={15} /> Docs</Link>
            {currentChapter && (
              <>
                <span className="docs-brand-divider docs-chapter-divider" />
                <span className="docs-breadcrumb-current">{currentChapter.title.replace(/^\d+\.\s*/, "")}</span>
              </>
            )}
          </div>
          <button type="button" className="docs-search-trigger" onClick={openSearch} aria-label="Search documentation">
            <Search size={16} />
            <span>Search documentation…</span>
            <kbd><Command size={11} /> K</kbd>
          </button>
          <div className="docs-topbar-actions">
            <span className="docs-stack-label">Next.js · Drizzle · PostgreSQL · Tauri</span>
            <ThemeToggle />
            <a className="docs-source-link" href="https://github.com/PratikPrasad1813/FOLIO" target="_blank" rel="noreferrer">Source <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </header>

      <div className="docs-mobile-search">
        <button type="button" className="docs-search-trigger" onClick={openSearch} aria-label="Search documentation">
          <Search size={16} /><span>Search chapters, code, APIs…</span><kbd><Command size={11} /> K</kbd>
        </button>
      </div>
      <details className="docs-mobile-nav">
        <summary><BookOpen size={15} /> Browse chapters <ChevronDown size={14} /></summary>
        <nav aria-label="Mobile documentation chapters">
          {chapters.map((chapter, index) => (
            <div key={chapter.id}>
            <a href={`/docs/${chapter.id}`}><span>{String(index + 1).padStart(2, "0")}</span>{chapter.title.replace(/^\d+\.\s*/, "")}</a>
            {chapter.sections.map(([id, title]) => <a key={id} href={`/docs/${chapter.id}#${id}`}>{title}</a>)}
            </div>
          ))}
        </nav>
      </details>

      <div className="docs-layout">
        <aside className="docs-sidebar docs-sidebar-left">
          <div className="docs-sidebar-heading"><span>GUIDE</span><span>7 CHAPTERS</span></div>
          <nav aria-label="Documentation chapters" className="docs-chapter-nav">
            {chapters.map((chapter, index) => {
              const isActive = activeId === chapter.id || chapter.sections.some(([id]) => id === activeId);
              return (
                <details key={chapter.id} className={`docs-nav-chapter ${isActive ? "is-active" : ""}`} open={isActive}>
                  <summary>
                    <span className="docs-chapter-number">{String(index + 1).padStart(2, "0")}</span>
                    <Link href={`/docs/${chapter.id}`} onClick={(event) => event.stopPropagation()}>{chapter.title.replace(/^\d+\.\s*/, "")}</Link>
                    <ChevronDown size={13} aria-hidden="true" />
                  </summary>
                  <ul>
                    {chapter.sections.map(([id, title]) => (
                      <li key={id}><a href={`/docs/${chapter.id}#${id}`} className={activeId === id ? "is-current" : ""}>{title}</a></li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </nav>
          <div className="docs-sidebar-card">
            <span className="docs-sidebar-card-icon"><FileText size={15} /></span>
            <strong>Built for builders</strong>
            <p>Implementation notes grounded in Folio’s source, schemas, and release setup.</p>
            <a href="https://github.com/PratikPrasad1813/FOLIO" target="_blank" rel="noreferrer">Explore the repository ↗</a>
          </div>
        </aside>

        <div className="docs-content">{children}</div>

        <aside className="docs-sidebar docs-sidebar-right">
          <div className="docs-sidebar-heading"><span>ON THIS PAGE</span></div>
          <nav aria-label="On this page" className="docs-toc">
            {tocChapters.map((chapter) => (
              <div key={chapter.id}>
                <a href={`/docs/${chapter.id}`} className={`docs-toc-chapter ${activeId === chapter.id ? "is-current" : ""}`}>{chapter.title}</a>
                <ul>
                  {chapter.sections.map(([id, title]) => (
                    <li key={id}><a href={activeChapterId ? `#${id}` : `/docs/${chapter.id}#${id}`} className={activeId === id ? "is-current" : ""}>{title}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          {activeChapterId ? (
            <Link className="docs-back-top" href="/docs"><ArrowLeft size={12} /> All documentation</Link>
          ) : (
            <a className="docs-back-top" href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Back to top ↑</a>
          )}
        </aside>
      </div>

      {searchOpen && (
        <div className="docs-search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}>
          <section className="docs-search-dialog" role="dialog" aria-modal="true" aria-label="Search documentation">
            <div className="docs-search-field">
              <Search size={18} aria-hidden="true" />
              <input
                ref={searchInput}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setSelectedResult(0); }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search chapters, concepts, APIs…"
                aria-label="Search all documentation"
                aria-controls="docs-search-results"
              />
              <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={17} /></button>
            </div>
            <div className="docs-search-meta"><span>{query ? "SEARCH RESULTS" : "QUICK LINKS"}</span><span>↑↓ navigate · Enter open · Esc close</span></div>
            <div id="docs-search-results" ref={resultsRef} className="docs-search-results">
              {searchResults.length ? searchResults.map((result, index) => (
                <a
                  key={result.href}
                  href={result.href}
                  data-search-result
                  className={index === selectedResult ? "is-selected" : ""}
                  onMouseEnter={() => setSelectedResult(index)}
                  onClick={(event) => { event.preventDefault(); selectResult(result); }}
                >
                  <span className="docs-search-result-icon"><FileText size={15} /></span>
                  <span className="docs-search-result-copy"><strong>{result.title}</strong><small>{result.chapter} · {result.description}</small></span>
                  <span className="docs-search-result-enter">↵</span>
                </a>
              )) : (
                <div className="docs-search-empty"><Search size={18} /><strong>No matching documentation</strong>                <span>Try a topic such as “OAuth”, “migrations”, or “AI keys”.</span></div>
              )}
            </div>
            <div className="docs-search-footer"><span>Search Folio Engineering Manual</span><span>ESC</span></div>
          </section>
        </div>
      )}
    </div>
  );
}
