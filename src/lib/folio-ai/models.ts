import { FOLIO_AI_CONFIG, approximateHumanSize } from "@/lib/folio-ai/config";
import { MINIMUM_AI_DEVICE_MEMORY_GB } from "@/lib/folio-ai/device";

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
    modelId: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    modelName: "SmolLM2 1.7B Instruct · Q4F16",
    approximateDownloadBytes: 1_100_000_000,
    requiredGpuMemoryMB: 1_600,
    contextWindowTokens: 4_096,
    description: "Fast local model for quick task updates and lightweight workspace actions.",
    advantage: "Responsive quick-add and prioritization on lower-spec devices.",
    limitation: "Less capable at complex reasoning, multi-step plans, and long-form answers.",
    verifiedInWebLLM: true,
  },
  {
    tier: "balanced",
    modelId: FOLIO_AI_CONFIG.modelId,
    modelName: "Qwen2.5 3B Instruct · Q4F16",
    approximateDownloadBytes: 1_800_000_000,
    requiredGpuMemoryMB: 2_504.76,
    contextWindowTokens: 4_096,
    description: "Default structured workhorse for reliable JSON and everyday Folio planning.",
    advantage: "Strong instruction following and multi-step workspace planning.",
    limitation: "Needs roughly 2.5 GB of GPU memory; larger models require more resources.",
    verifiedInWebLLM: true,
  },
  {
    tier: "high",
    modelId: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
    modelName: "DeepSeek-R1 Distill 7B · Q4F16",
    approximateDownloadBytes: 4_800_000_000,
    requiredGpuMemoryMB: 5_000,
    contextWindowTokens: 4_096,
    description: "High-capacity specialist for complex roadmaps and broad project breakdowns.",
    advantage: "Deeper multi-step reasoning and milestone decomposition.",
    limitation: "Large download and memory footprint; suitable for capable workstation-class devices.",
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
    balanced: 6,
    high: 12,
  };
  const compatibleTiers = MODEL_TIERS.filter(tier => minimumMemoryByTier[tier] <= memoryLimit);
  let recommendedTier: ModelTier;
  if (memory === undefined) {
    recommendedTier = "lightweight";
  } else if (memory < 8) {
    recommendedTier = "lightweight";
  } else if (memory >= 12) {
    recommendedTier = "high";
  } else {
    recommendedTier = "balanced";
  }
  const recommendedModel = MODEL_BY_TIER[recommendedTier];
  const reason =
    recommendedTier === "lightweight"
      ? memory === undefined
        ? "System memory is not reported, so Folio starts with its smallest model."
        : "This device reports less than 8 GB of system memory. The smallest model is the safest starting point."
      : recommendedTier === "high"
        ? "This device reports enough memory (12+ GB) to run the high-performance model with good speed and the strongest instruction-following."
        : "This model offers a good balance of response quality, speed, and resource usage on your device.";
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