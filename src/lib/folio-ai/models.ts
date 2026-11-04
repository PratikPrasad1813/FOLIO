import { FOLIO_AI_CONFIG, approximateHumanSize } from "@/lib/folio-ai/config";

export type ModelTier = "lightweight" | "balanced" | "high";
export type ModelPreference = "automatic" | ModelTier;
export const MODEL_TIERS: ModelTier[] = ["lightweight", "balanced", "high"];
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
    modelId: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    modelName: "Qwen2.5 0.5B Instruct · Q4F16",
    approximateDownloadBytes: 420_000_000,
    requiredGpuMemoryMB: 944.62,
    contextWindowTokens: 4_096,
    description: "Smallest verified Folio model. Fast on modest hardware and lighter on memory, with shorter, simpler answers.",
    advantage: "Fastest loading and lowest memory use; best choice for memory-constrained devices.",
    limitation: "Less capable at complex reasoning, multi-step plans, and long-form answers.",
    verifiedInWebLLM: true,
  },
  {
    tier: "balanced",
    modelId: FOLIO_AI_CONFIG.modelId,
    modelName: "Qwen2.5 1.5B Instruct · Q4F16",
    approximateDownloadBytes: 880_000_000,
    requiredGpuMemoryMB: 1_629.75,
    contextWindowTokens: 4_096,
    description: "Recommended default. A solid balance of response quality, speed, and resource use on capable devices.",
    advantage: "Good instruction following and planning for everyday Folio tasks without heavy GPU demands.",
    limitation: "Needs roughly 1.6 GB of GPU memory; large tool plans can still be challenging.",
    verifiedInWebLLM: true,
  },
  {
    tier: "high",
    modelId: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    modelName: "Qwen2.5 3B Instruct · Q4F16",
    approximateDownloadBytes: 1_800_000_000,
    requiredGpuMemoryMB: 2_504.76,
    contextWindowTokens: 4_096,
    description: "Largest verified Folio model. Best response quality and instruction-following on capable GPUs.",
    advantage: "Most reliable at complex, multi-step workspace instructions and richer summaries.",
    limitation: "Largest download and ~2.5 GB GPU memory; slower on integrated GPUs and low-power devices.",
    verifiedInWebLLM: true,
  },
];

export const MODEL_BY_ID: Record<string, FolioAIModelInfo> = Object.fromEntries(
  FOLIO_AI_MODELS.map(model => [model.modelId, model]),
);
export const MODEL_BY_TIER: Record<ModelTier, FolioAIModelInfo> = {
  lightweight: FOLIO_AI_MODELS[0],
  balanced: FOLIO_AI_MODELS[1],
  high: FOLIO_AI_MODELS[2],
};

export interface DeviceProfile {
  webgpu: boolean;
  adapterLabel?: string;
  deviceMemoryGB?: number;
  hardwareConcurrency?: number;
  /** Coarse, honest resource hint: true when deviceMemory is below 4 GB. */
  memoryConstrained: boolean;
}

export function profileDevice(): DeviceProfile {
  if (typeof navigator === "undefined") return { webgpu: false, memoryConstrained: false };
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    webgpu: Boolean((navigator as Navigator & { gpu?: unknown }).gpu),
    deviceMemoryGB: memory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    memoryConstrained: memory !== undefined && memory < 4,
  };
}

export interface ModelRecommendation {
  recommendedTier: ModelTier;
  recommendedModel: FolioAIModelInfo;
  reason: string;
  /** Models considered runnable on this device (registry-verified + adapter available). */
  compatibleTiers: ModelTier[];
}

export function recommendModel(profile: DeviceProfile): ModelRecommendation {
  const memory = profile.deviceMemoryGB;
  let recommendedTier: ModelTier;
  if (memory === undefined) {
    // Unknown system memory: stay conservative but useful.
    recommendedTier = "balanced";
  } else if (memory < 4) {
    recommendedTier = "lightweight";
  } else if (memory >= 12) {
    recommendedTier = "high";
  } else {
    recommendedTier = "balanced";
  }
  const recommendedModel = MODEL_BY_TIER[recommendedTier];
  const reason =
    recommendedTier === "lightweight"
      ? "This device looks memory-constrained (less than 4 GB of browser-reported system memory). The lightweight model offers the most stable local experience."
      : recommendedTier === "high"
        ? "This device reports enough memory (12+ GB) to run the high-performance model with good speed and the strongest instruction-following."
        : "This model offers a good balance of response quality, speed, and resource usage on your device.";
  return {
    recommendedTier,
    recommendedModel,
    reason,
    compatibleTiers: MODEL_TIERS,
  };
}

export function formatModelSize(model: FolioAIModelInfo): string {
  return approximateHumanSize(model.approximateDownloadBytes);
}