/**
 * Plain-English error descriptions for people (not developers).
 *
 * Every message follows the same recipe so anyone can act on it:
 *   1. WHAT happened, in everyday words (no codes, no jargon),
 *   2. whether the user's WORK is safe,
 *   3. what to DO next.
 *
 * `technical` carries the raw text for the optional "Technical details" box
 * and for support — it is never the headline.
 */

export interface FriendlyError {
  /** Short headline, e.g. "Folio can’t connect to the internet". */
  title: string;
  /** One or two sentences: what happened, is my work safe, what now. */
  message: string;
  /** Raw technical text for support (may be empty). */
  technical: string;
  /** Best next action for a retry button label. */
  kind: "offline" | "timeout" | "server" | "signin" | "forbidden" | "missing" | "update" | "unknown";
}

function rawText(error: unknown): string {
  if (error instanceof Error) return [error.name, error.message].filter(Boolean).join(": ");
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

/** Classify any thrown value into a friendly description. */
export function describeError(error: unknown): FriendlyError {
  const technical = rawText(error);
  const text = technical.toLowerCase();
  const name = error instanceof Error ? error.name : "";

  if (/failed to fetch|networkerror|network error|load failed|err_internet_disconnected|err_name_not_resolved|err_connection|offline/.test(text) || (name === "TypeError" && /fetch/.test(text))) {
    return {
      kind: "offline",
      title: "Folio can’t connect to the internet",
      message: "Please check your internet connection and try again. Anything you already saved on this computer is still here.",
      technical,
    };
  }
  if (name === "AbortError" || name === "TimeoutError" || /timed out|timeout|taking too long/.test(text)) {
    return {
      kind: "timeout",
      title: "Folio’s server is taking too long to answer",
      message: "The server is slow or busy right now. Your work is safe. Please wait a moment and try again.",
      technical,
    };
  }
  if (/loading chunk|chunkloaderror|dynamically imported module|failed to load (script|chunk)|importing a module script failed/.test(text)) {
    return {
      kind: "update",
      title: "A part of Folio did not load",
      message: "This usually happens right after Folio was updated or when the connection dropped while loading. Reloading the app fixes it. Your work is safe.",
      technical,
    };
  }
  if (/\b401\b|unauthori[sz]ed|sign in again|session expired|not signed in|please sign in/.test(text)) {
    return {
      kind: "signin",
      title: "Please sign in again",
      message: "Your sign-in has expired for safety. Sign in again to continue. Your work is safe.",
      technical,
    };
  }
  if (/\b403\b|forbidden|not allowed/.test(text)) {
    return {
      kind: "forbidden",
      title: "Folio can’t do that for this account",
      message: "You don’t have permission to do this. If you think that is a mistake, sign out, sign in again and retry.",
      technical,
    };
  }
  if (/\b404\b|not found/.test(text)) {
    return {
      kind: "missing",
      title: "That item could not be found",
      message: "It may have been moved or deleted on another device. Go back to your projects and open it again.",
      technical,
    };
  }
  if (/\b50[0-4]\b|database|server error|service unavailable|bad gateway|could not reach/.test(text)) {
    return {
      kind: "server",
      title: "Folio’s servers are having trouble",
      message: "This is a problem on our side, not yours. Your work is safe. Please wait a minute and try again.",
      technical,
    };
  }
  return {
    kind: "unknown",
    title: "Something went wrong in Folio",
    message: "Folio ran into a problem it did not expect. Your work is safe. Try again, and if it keeps happening, restart Folio.",
    technical,
  };
}

/** Plain-English sentence for an HTTP failure. Prefers a clear message from our own server. */
export function friendlyHttpMessage(status: number, serverMessage?: string | null): string {
  const clean = typeof serverMessage === "string" ? serverMessage.trim() : "";
  if (clean && clean.length <= 220 && !/<\w+/.test(clean)) return clean;
  if (status === 401) return "Your sign-in has expired. Please sign in again.";
  if (status === 403) return "You don’t have permission to do that.";
  if (status === 404) return "Folio could not find what you asked for. It may have been deleted.";
  if (status === 408 || status === 504) return "Folio’s server took too long to answer. Please try again in a moment.";
  if (status === 429) return "That was too many requests in a short time. Please wait a moment and try again.";
  if (status >= 500) return "Folio’s servers are having trouble right now. Your work is safe. Please try again in a minute.";
  return "Folio could not finish that. Please try again.";
}
