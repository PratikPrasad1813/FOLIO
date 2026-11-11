import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, BookOpen, Braces, Compass, Layers3, ShieldCheck } from "lucide-react";
import { DocsExperience } from "@/components/docs-experience";
import { chapters } from "./docs-content";

export const metadata: Metadata = {
  title: "Folio Docs · A guide to the workspace",
  description:
    "Explore Folio documentation for everyday users and developers: architecture, setup, projects, tasks, security, integrations, AI, and desktop.",
};

const chapterDetails = [
  {
    kicker: "START HERE",
    description: "What Folio is, how the parts fit together, and how information moves through the workspace.",
    audience: "Everyone",
  },
  {
    kicker: "BUILD & RUN",
    description: "Configure the environment, understand the PostgreSQL data model, and apply schema changes safely.",
    audience: "Developers",
  },
  {
    kicker: "TRUST & IDENTITY",
    description: "Follow session handling, provider sign-in, and secure browser-to-desktop authentication.",
    audience: "Developers",
  },
  {
    kicker: "GET WORK DONE",
    description: "Learn how projects, milestones, tasks, lists, and captured ideas fit into a practical workflow.",
    audience: "Everyone",
  },
  {
    kicker: "CONNECT CALENDAR",
    description: "Set up Google Calendar, understand sync state, and know how conflicts and reauthorization work.",
    audience: "Everyone",
  },
  {
    kicker: "BRING YOUR OWN KEY AI",
    description: "Configure your own AI key, understand Folio's token allowance and data flow, and review AI action proposals.",
    audience: "Everyone",
  },
  {
    kicker: "DESKTOP APP",
    description: "Explore the native shell, deep links, platform packaging, release checks, and code signing.",
    audience: "Developers",
  },
] as const;

export default function DocsHomePage() {
  return (
    <DocsExperience chapters={chapters}>
      <main id="top" className="docs-home">
        <section className="docs-home-hero">
          <div className="docs-home-eyebrow"><span /> FOLIO DOCUMENTATION <span>·</span> THE GUIDE</div>
          <h1>
            A clearer way
            <br />
            to <em>find your way.</em>
          </h1>
          <p>
            A calm, practical guide to Folio—for planning your work, understanding the product, or building on the codebase.
          </p>
          <div className="docs-home-actions">
            <Link href="/docs/productivity" className="docs-home-primary">
              Explore the workspace <ArrowRight size={15} />
            </Link>
            <Link href="/docs/architecture" className="docs-home-secondary">
              Start with the architecture <ArrowDownRight size={15} />
            </Link>
          </div>
          <div className="docs-home-meta">
            <span><BookOpen size={13} /> 7 chapters</span>
            <i />
            <span><Braces size={13} /> For people &amp; builders</span>
            <i />
            <span><ShieldCheck size={13} /> Source-grounded</span>
          </div>
        </section>

        <section className="docs-home-audience" aria-label="Choose a path through the docs">
          <Link href="/docs/productivity" className="docs-audience-card">
            <span className="docs-audience-icon"><Compass size={17} /></span>
            <span className="docs-audience-copy">
              <small>USING FOLIO</small>
              <strong>Find your workflow</strong>
              <span>Projects, tasks, ideas, calendar, and AI—explained in everyday language.</span>
            </span>
            <ArrowRight size={15} />
          </Link>
          <Link href="/docs/architecture" className="docs-audience-card">
            <span className="docs-audience-icon"><Layers3 size={17} /></span>
            <span className="docs-audience-copy">
              <small>BUILDING FOLIO</small>
              <strong>Understand the system</strong>
              <span>Architecture, database design, APIs, security, and desktop release engineering.</span>
            </span>
            <ArrowRight size={15} />
          </Link>
        </section>

        <section className="docs-home-chapters">
          <div className="docs-home-section-heading">
            <div>
              <span>THE LIBRARY</span>
              <h2>Explore the guide</h2>
            </div>
            <p>Each chapter is a focused page. Follow the path from the first idea to the details that make it work.</p>
          </div>
          <div className="docs-home-chapter-list">
            {chapters.map((chapter, index) => {
              const details = chapterDetails[index];
              return (
                <Link key={chapter.id} href={`/docs/${chapter.id}`} className="docs-home-chapter">
                  <span className="docs-home-chapter-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="docs-home-chapter-copy">
                    <small>{details.kicker} <i /> {details.audience.toUpperCase()}</small>
                    <strong>{chapter.title.replace(/^\d+\.\s*/, "")}</strong>
                    <span>{details.description}</span>
                    <span className="docs-home-section-count">{chapter.sections.length} sections</span>
                  </span>
                  <span className="docs-home-chapter-arrow"><ArrowRight size={16} /></span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="docs-home-note">
          <span className="docs-home-note-icon"><ShieldCheck size={17} /></span>
          <p><strong>Written from the source.</strong> Implementation details are grounded in Folio’s schema, application routes, integration code, and Tauri release setup. Where an idea is a recommendation rather than current behavior, the guide says so.</p>
        </section>

        <footer className="docs-home-footer">
          <span>Made for clearer work, and the people who make it.</span>
          <Link href="/">Back to Folio <ArrowRight size={12} /></Link>
        </footer>
      </main>
    </DocsExperience>
  );
}
