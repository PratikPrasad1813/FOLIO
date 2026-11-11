import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";

export interface FolioAIModelInfo {
  modelId: string;
  modelName: string;
  contextWindowTokens: number;
}

/**
 * Display info for the user's own BYOK model. Concrete model identifiers live
 * in AI Settings (localStorage) and travel with each request.
 */
export const BYOK_MODEL_INFO: FolioAIModelInfo = {
  modelId: FOLIO_AI_CONFIG.modelId,
  modelName: FOLIO_AI_CONFIG.modelName,
  contextWindowTokens: FOLIO_AI_CONFIG.contextWindowTokens,
};
