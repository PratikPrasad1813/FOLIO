import { MINIMUM_AI_DEVICE_MEMORY_GB } from "@/lib/folio-ai/device";

export type LocalModelCategory = "fast" | "structured" | "reasoning" | "coder" | "creative";

export interface LocalModelSpec {
  id: string;
  name: string;
  tagline: string;
  category: LocalModelCategory;
  sizeDisplay: string;
  approximateDownloadBytes: number;
  minRamGb: number;
  webLlmModelId: string;
  strengths: readonly string[];
  tradeoffs?: readonly string[];
  requiredWebGPUFeatures?: readonly string[];
}

export const DEFAULT_LOCAL_MODEL_ID = "smollm2-1.7b";
export const MAX_LOCAL_MODEL_BUNDLE_BYTES = 2_000_000_000;

export const LOCAL_MODELS: Readonly<Record<string, LocalModelSpec>> = {
  "llama-3.2-1b": {
    id: "llama-3.2-1b",
    name: "Llama 3.2 1B · Quick",
    tagline: "A compact model for quick questions and task updates",
    category: "fast",
    sizeDisplay: "~0.7 GB",
    approximateDownloadBytes: 710_817_850,
    minRamGb: 4,
    webLlmModelId: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    strengths: ["Quick replies", "Task updates", "Compact download"],
  },
  "smollm2-1.7b": {
    id: "smollm2-1.7b",
    name: "SmolLM2 1.7B · Everyday",
    tagline: "A capable local model for planning and everyday workspace help",
    category: "structured",
    sizeDisplay: "~1.0 GB",
    approximateDownloadBytes: 973_038_265,
    minRamGb: 4,
    webLlmModelId: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    strengths: ["Workspace planning", "Task breakdowns", "Everyday questions"],
  },
};

export const LOCAL_MODEL_LIST: readonly LocalModelSpec[] = Object.values(LOCAL_MODELS);

/** Optional quality upgrades are downloaded individually and never included in the compact bundle. */
export const QUALITY_MODELS: Readonly<Record<string, LocalModelSpec>> = {
  "gemma-2-2b": {
    id: "gemma-2-2b",
    name: "Gemma 2 2B IT · Quality",
    tagline: "A more capable general-purpose model for considered answers",
    category: "reasoning",
    sizeDisplay: "~1.5 GB",
    approximateDownloadBytes: 1_490_000_000,
    minRamGb: 8,
    webLlmModelId: "gemma-2-2b-it-q4f16_1-MLC",
    strengths: ["General-purpose answers", "More nuanced writing", "4K context"],
    tradeoffs: ["About 1.5 GB download", "Needs a compatible GPU with shader-f16 support"],
    requiredWebGPUFeatures: ["shader-f16"],
  },
  "qwen2.5-3b": {
    id: "qwen2.5-3b",
    name: "Qwen 2.5 3B Instruct · Quality",
    tagline: "A stronger everyday model for detailed workspace planning",
    category: "structured",
    sizeDisplay: "~1.3 GB",
    approximateDownloadBytes: 1_300_000_000,
    minRamGb: 8,
    webLlmModelId: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    strengths: ["Detailed planning", "Structured requests", "4K context"],
    tradeoffs: ["About 1.3 GB download", "More GPU memory than the compact models"],
  },
  "phi-3.5-mini": {
    id: "phi-3.5-mini",
    name: "Phi 3.5 Mini · Quality",
    tagline: "A capable mini model for deeper, more detailed requests",
    category: "reasoning",
    sizeDisplay: "~1.2 GB",
    approximateDownloadBytes: 1_190_000_000,
    minRamGb: 12,
    webLlmModelId: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    strengths: ["Detailed answers", "Longer reasoning", "4K context"],
    tradeoffs: ["About 1.2 GB download", "Higher GPU-memory needs; suggested for 12 GB+ system RAM"],
  },
  "qwen2.5-7b": {
    id: "qwen2.5-7b",
    name: "Qwen 2.5 7B Instruct · High-end",
    tagline: "The most capable option here, for high-memory computers",
    category: "reasoning",
    sizeDisplay: "~2.4 GB",
    approximateDownloadBytes: 2_390_000_000,
    minRamGb: 16,
    webLlmModelId: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    strengths: ["More capable responses", "Complex planning", "4K context"],
    tradeoffs: ["About 2.4 GB download", "High GPU-memory needs; suggested for 16 GB+ system RAM"],
  },
};

export const QUALITY_MODEL_LIST: readonly LocalModelSpec[] = Object.values(QUALITY_MODELS);
export const ALL_LOCAL_MODEL_LIST: readonly LocalModelSpec[] = [
  ...LOCAL_MODEL_LIST,
  ...QUALITY_MODEL_LIST,
];

export function getCompatibleLocalModels(deviceMemoryGB?: number): readonly LocalModelSpec[] {
  const memoryLimit = deviceMemoryGB ?? MINIMUM_AI_DEVICE_MEMORY_GB;
  return LOCAL_MODEL_LIST.filter(model => model.minRamGb <= memoryLimit);
}

export function getCompatibleQualityModels(
  deviceMemoryGB?: number,
  webgpuFeatures?: readonly string[],
): readonly LocalModelSpec[] {
  if (deviceMemoryGB === undefined) return [];
  const features = new Set(webgpuFeatures ?? []);
  return QUALITY_MODEL_LIST.filter(model =>
    model.minRamGb <= deviceMemoryGB &&
    (model.requiredWebGPUFeatures ?? []).every(feature => features.has(feature)),
  );
}

export function getLocalModel(modelId: string): LocalModelSpec | undefined {
  return LOCAL_MODELS[modelId] ?? QUALITY_MODELS[modelId];
}

export function getLocalModelByWebLLMId(webLlmModelId: string): LocalModelSpec | undefined {
  return ALL_LOCAL_MODEL_LIST.find(model => model.webLlmModelId === webLlmModelId);
}
