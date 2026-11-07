import { MINIMUM_AI_DEVICE_MEMORY_GB } from "@/lib/folio-ai/device";

export type LocalModelCategory = "fast" | "structured" | "reasoning" | "coder" | "creative";

export interface LocalModelSpec {
  id: string;
  name: string;
  tagline: string;
  category: LocalModelCategory;
  sizeDisplay: string;
  minRamGb: number;
  webLlmModelId: string;
  strengths: readonly string[];
}

export const DEFAULT_LOCAL_MODEL_ID = "smollm2-1.7b";

export const LOCAL_MODELS: Readonly<Record<string, LocalModelSpec>> = {
  "qwen-2.5-3b": {
    id: "qwen-2.5-3b",
    name: "Qwen 2.5 3B · Workhorse",
    tagline: "Structured output and dependable daily task planning",
    category: "structured",
    sizeDisplay: "~1.8 GB",
    minRamGb: 6,
    webLlmModelId: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    strengths: ["Structured JSON", "Task and subtask planning", "Balanced speed"],
  },
  "llama-3.2-3b": {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B · Speed",
    tagline: "Quick task cleanup and lightweight workspace actions",
    category: "fast",
    sizeDisplay: "~1.8 GB",
    minRamGb: 4,
    webLlmModelId: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    strengths: ["Quick-add tasks", "Priority suggestions", "Lower resource use"],
  },
  "smollm2-1.7b": {
    id: "smollm2-1.7b",
    name: "SmolLM2 1.7B · Lightweight",
    tagline: "A smaller model for modest hardware",
    category: "fast",
    sizeDisplay: "~1.1 GB",
    minRamGb: 4,
    webLlmModelId: "SmolLM2-1.7B-Instruct-q4f16_1-MLC",
    strengths: ["Smaller download", "Simple task extraction", "Laptop-friendly"],
  },
  "deepseek-r1-7b": {
    id: "deepseek-r1-7b",
    name: "DeepSeek-R1 Distill 7B · Deep Thinker",
    tagline: "Detailed decomposition for broad, multi-step goals",
    category: "reasoning",
    sizeDisplay: "~4.8 GB",
    minRamGb: 12,
    webLlmModelId: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC",
    strengths: ["Milestone decomposition", "Long-range planning", "Dependency analysis"],
  },
  "qwen-2.5-coder-7b": {
    id: "qwen-2.5-coder-7b",
    name: "Qwen 2.5 Coder 7B · Engineering",
    tagline: "Technical projects, engineering plans, and development tasks",
    category: "coder",
    sizeDisplay: "~4.8 GB",
    minRamGb: 12,
    webLlmModelId: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC",
    strengths: ["Technical task breakdown", "API and schema planning", "Development sprints"],
  },
  "gemma-2-2b": {
    id: "gemma-2-2b",
    name: "Gemma 2 2B · Creative",
    tagline: "Polish rough ideas into clear project proposals",
    category: "creative",
    sizeDisplay: "~1.8 GB",
    minRamGb: 6,
    webLlmModelId: "gemma-2-2b-it-q4f16_1-MLC",
    strengths: ["Idea refinement", "Natural writing", "Project descriptions"],
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
