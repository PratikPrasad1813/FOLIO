"use client";

import type { AIProvider } from "@/lib/folio-ai/provider";
import { GoogleGeminiProvider } from "@/lib/folio-ai/google-gemini-provider";

declare global {
  interface Window {
    __FOLIO_AI_TEST_PROVIDER__?: AIProvider;
  }
}

let provider: AIProvider | null = null;
let providerReady = false;

export function getAIProvider(): AIProvider {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && window.__FOLIO_AI_TEST_PROVIDER__) {
    return window.__FOLIO_AI_TEST_PROVIDER__;
  }
  if (!provider) provider = new GoogleGeminiProvider();
  return provider;
}

export function getAIProviderState(): { provider: AIProvider | null; ready: boolean } {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && window.__FOLIO_AI_TEST_PROVIDER__) {
    return { provider: window.__FOLIO_AI_TEST_PROVIDER__, ready: providerReady };
  }
  return { provider, ready: providerReady };
}

export function markAIProviderReady(ready: boolean) {
  providerReady = ready;
}

export async function unloadAIProvider(): Promise<void> {
  if (!provider) return;
  const current = provider;
  await current.unload();
  if (provider === current) provider = null;
  providerReady = false;
}
