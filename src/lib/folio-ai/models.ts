import { FOLIO_AI_CONFIG, approximateHumanSize } from "@/lib/folio-ai/config";
import { MINIMUM_AI_DEVICE_MEMORY_GB } from "@/lib/folio-ai/device";

export type ModelTier = "lightweight" | "balanced" | "high";
export type ModelPreference = "automatic" | ModelTier;
export const MODEL_TIERS: ModelTier[] = ["lightweight", "balanced"];
export const MODEL_PREFERENCES: ModelPreference[] = ["automatic", "lightweight", "balanced", "high"];

export interface FolioAIModelInfo {
  tier: ModelTier;
  modelId: string;
  modelName: string;
  approximateDownloadBytes: number;
  requiredGpuMemoryMB: number;
  contextWindowTokens: number;
  description: string;
  advantage: string;
  limitation: string;
  /** Whether the installed WebLLM registry was verified to contain this ID. */
  verifiedInWebLLM: true;
}

/** Exact IDs verified against the installed @mlc-ai/web-llm 0.2.87 prebuilt registry. */
export const FOLIO_AI_MODELS: FolioAIModelInfo[] = [
  {
    tier: "lightweight",
    modelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    modelName: "Llama 3.2 1B Instruct · Q4F16",
    approximateDownloadBytes: 710_817_850,
    requiredGpuMemoryMB: 879.04,
    contextWindowTokens: 4_096,
    description: "Compact local model for quick questions and task updates.",
    advantage: "The smaller download and memory footprint of the two models.",
    limitation: "Less capable at detailed planning and longer answers.",
    verifiedInWebLLM: true,
  },
  {
    tier: "balanced",
    modelId: FOLIO_AI_CONFIG.modelId,
    modelName: FOLIO_AI_CONFIG.modelName,
    approximateDownloadBytes: FOLIO_AI_CONFIG.approximateDownloadBytes,
    requiredGpuMemoryMB: FOLIO_AI_CONFIG.requiredGpuMemoryMB,
    contextWindowTokens: 4_096,
    description: "The more capable local model for everyday Folio planning.",
    advantage: "Better suited to workspace requests and multi-step task breakdowns.",
    limitation: "Uses more memory and takes longer to download than Llama 3.2 1B.",
    verifiedInWebLLM: true,
  },
];

export const MODEL_BY_ID: Record<string, FolioAIModelInfo> = Object.fromEntries(
  FOLIO_AI_MODELS.map(model => [model.modelId, model]),
);
export const MODEL_BY_TIER: Record<ModelTier, FolioAIModelInfo> = {
  lightweight: FOLIO_AI_MODELS[0],
  balanced: FOLIO_AI_MODELS[1],
  // Keep the legacy preference usable without retaining its old large model.
  high: FOLIO_AI_MODELS[1],
};

export interface DeviceProfile {
  webgpu: boolean;
  adapterLabel?: string;
  deviceMemoryGB?: number;
  hardwareConcurrency?: number;
  /** Coarse, honest resource hint: true when deviceMemory is below 8 GB. */
  memoryConstrained: boolean;
}

export function profileDevice(): DeviceProfile {
  if (typeof navigator === "undefined") return { webgpu: false, memoryConstrained: false };
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    webgpu: Boolean((navigator as Navigator & { gpu?: unknown }).gpu),
    deviceMemoryGB: memory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    memoryConstrained: memory !== undefined && memory < 8,
  };
}

export interface ModelRecommendation {
  recommendedTier: ModelTier;
  recommendedModel: FolioAIModelInfo;
  reason: string;
  /** Model tiers within the reported system-memory budget. */
  compatibleTiers: ModelTier[];
}

export function recommendModel(profile: DeviceProfile): ModelRecommendation {
  const memory = profile.deviceMemoryGB;
  const memoryLimit = memory ?? 4;
  const minimumMemoryByTier: Record<ModelTier, number> = {
    lightweight: MINIMUM_AI_DEVICE_MEMORY_GB,
    balanced: MINIMUM_AI_DEVICE_MEMORY_GB,
    high: MINIMUM_AI_DEVICE_MEMORY_GB,
  };
  const compatibleTiers = MODEL_TIERS.filter(tier => minimumMemoryByTier[tier] <= memoryLimit);
  let recommendedTier: ModelTier;
  if (memory === undefined) {
    recommendedTier = "lightweight";
  } else if (memory < 8) {
    recommendedTier = "lightweight";
  } else {
    recommendedTier = "balanced";
  }
  const recommendedModel = MODEL_BY_TIER[recommendedTier];
  const reason =
    recommendedTier === "lightweight"
      ? memory === undefined
        ? "System memory is not reported, so Folio starts with its smallest model."
        : "This device reports less than 8 GB of system memory. The smallest model is the safest starting point."
      : "This device can run Folio’s more capable local model while keeping the complete model library under 2 GB.";
  return {
    recommendedTier,
    recommendedModel,
    reason,
    compatibleTiers,
  };
}

export function formatModelSize(model: FolioAIModelInfo): string {
  return approximateHumanSize(model.approximateDownloadBytes);
}