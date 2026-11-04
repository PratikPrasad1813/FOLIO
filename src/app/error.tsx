"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="public-site" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 30 }}><section style={{ textAlign: "center", maxWidth: 450 }}><h1 style={{ fontSize: 30, marginBottom: 15 }}>A little pause.</h1><p style={{ color: "var(--lp-muted)", lineHeight: 1.8 }}>Something interrupted the connection. Your work is still here. Please try again in a moment.</p><div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 24 }}><button className="lp-button is-primary" onClick={reset}>Try again</button><Link className="lp-button is-outline" href="/">Back to Folio</Link></div></section></main>;
}
