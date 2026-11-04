"use client";

import type { LocalAIProvider } from "@/lib/folio-ai/provider";
import { WebLLMProvider } from "@/lib/folio-ai/webllm-provider";
import { MODEL_BY_TIER, type FolioAIModelInfo } from "@/lib/folio-ai/models";

declare global {
  interface Window {
    __FOLIO_AI_TEST_PROVIDER__?: LocalAIProvider;
  }
}

// Provider indirection lets a future securely selected hosted implementation
// share the chat/controller interface. Only verified local models are loadable.
let localProvider: LocalAIProvider | null = null;
let loadedModelInfo: FolioAIModelInfo | null = null;
let providerReady = false;

export function getLoadedProviderState(): {
  provider: LocalAIProvider | null;
  model: FolioAIModelInfo | null;
  ready: boolean;
} {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && window.__FOLIO_AI_TEST_PROVIDER__) {
    return {
      provider: window.__FOLIO_AI_TEST_PROVIDER__,
      model: loadedModelInfo ?? MODEL_BY_TIER.balanced,
      ready: providerReady,
    };
  }
  return { provider: localProvider, model: loadedModelInfo, ready: providerReady };
}

export function markProviderReady(model: FolioAIModelInfo, ready: boolean) {
  loadedModelInfo = model;
  providerReady = ready;
}

export async function getLocalProvider(model?: FolioAIModelInfo): Promise<LocalAIProvider> {
  const chosenModel = model ?? MODEL_BY_TIER.balanced;
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production" && window.__FOLIO_AI_TEST_PROVIDER__) {
    localProvider = window.__FOLIO_AI_TEST_PROVIDER__;
    loadedModelInfo = chosenModel;
    return localProvider;
  }
  if (localProvider && (!model || localProvider.modelId === model.modelId)) {
    return localProvider;
  }
  if (localProvider) {
    providerReady = false;
    await localProvider.unload();
    localProvider = null;
  }
  loadedModelInfo = chosenModel;
  localProvider = new WebLLMProvider(chosenModel);
  return localProvider;
}

export async function unloadLocalProvider(): Promise<void> {
  providerReady = false;
  loadedModelInfo = null;
  if (!localProvider) return;
  const provider = localProvider;
  await provider.unload();
  if (localProvider === provider) localProvider = null;
}
