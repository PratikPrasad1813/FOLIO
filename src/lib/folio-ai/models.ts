import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";

export interface FolioAIModelInfo {
  modelId: string;
  modelName: string;
  contextWindowTokens: number;
}

export const GEMINI_MODEL_INFO: FolioAIModelInfo = {
  modelId: FOLIO_AI_CONFIG.modelId,
  modelName: FOLIO_AI_CONFIG.modelName,
  contextWindowTokens: FOLIO_AI_CONFIG.contextWindowTokens,
};
