"use client";

import { useEffect } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";

export function DesktopRedirectClient({ token }: { token: string }) {
  const deepLink = `folio://auth?token=${encodeURIComponent(token)}`;

  useEffect(() => {
    // Automatically trigger the custom Windows protocol to open Folio
    window.location.href = deepLink;
  }, [deepLink]);

  return (
    <div className="min-h-screen bg-[#0d0d11] text-white flex flex-col items-center justify-center p-6">
      <div className="bg-[#141418] border border-zinc-800 p-8 rounded-2xl max-w-md w-full text-center shadow-2xl">
        <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold mb-2">Authentication Successful</h1>
        <p className="text-zinc-400 text-sm mb-6">
          Redirecting back to the Folio desktop application...
        </p>

        <a
          href={deepLink}
          className="inline-flex items-center justify-center gap-2 w-full py-3 px-4 bg-white text-black font-semibold rounded-xl text-sm hover:bg-zinc-200 transition"
        >
          Open Folio Desktop
          <ExternalLink className="w-4 h-4" />
        </a>

        <p className="text-xs text-zinc-500 mt-4">
          You can close this browser tab once Folio opens.
        </p>
      </div>
    </div>
  );
}