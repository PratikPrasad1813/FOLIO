"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function DocsCodeBlock({ code, language = "text" }: { code: string; language?: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch (error) {
      console.error("Could not copy documentation code.", error);
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  };

  return (
    <div className="docs-code my-5 overflow-hidden rounded-xl border border-slate-800 bg-[#090b10]">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{language}</span>
        <button type="button" onClick={copy} className="docs-copy-button" aria-label={`Copy ${language} code`}>
          {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-5 text-[12px] leading-6 text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
