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

export function getCompatibleLocalModels(deviceMemoryGB?: number): readonly LocalModelSpec[] {
  const memoryLimit = deviceMemoryGB ?? MINIMUM_AI_DEVICE_MEMORY_GB;
  return LOCAL_MODEL_LIST.filter(model => model.minRamGb <= memoryLimit);
}

export function getLocalModel(modelId: string): LocalModelSpec | undefined {
  return LOCAL_MODELS[modelId];
}

export function getLocalModelByWebLLMId(webLlmModelId: string): LocalModelSpec | undefined {
  return LOCAL_MODEL_LIST.find(model => model.webLlmModelId === webLlmModelId);
}
