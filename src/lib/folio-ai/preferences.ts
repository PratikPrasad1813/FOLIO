import { eq } from "drizzle-orm";
import { db } from "@/db";
import { folioAiPreferences } from "@/db/schema";
import { ensureSchema } from "@/db/migrate";
import type { AIPreferences, AssistantPresentation, AssistantStyle } from "@/lib/folio-ai/types";
import { ASSISTANT_PRESENTATIONS, ASSISTANT_STYLES } from "@/lib/folio-ai/types";
import { MODEL_BY_ID, MODEL_PREFERENCES, type ModelPreference } from "@/lib/folio-ai/models";

export const DEFAULT_AI_PREFERENCES: AIPreferences = {
  assistantName: "Folio AI",
  presentation: "neutral",
  style: "friendly",
  modelPreference: "automatic",
  selectedModelId: null,
};

export function sanitizePreferences(input: Record<string, unknown>): Partial<AIPreferences> {
  const patch: Partial<AIPreferences> = {};
  if ("assistantName" in input) {
    const name = typeof input.assistantName === "string" ? input.assistantName.trim() : "";
    if (!name || name.length > 40 || /[\u0000-\u001f]/.test(name)) throw new Error("Assistant name must be 1–40 characters.");
    patch.assistantName = name;
  }
  if ("presentation" in input) {
    const value = input.presentation as AssistantPresentation;
    if (!ASSISTANT_PRESENTATIONS.includes(value)) throw new Error("Choose a valid assistant presentation.");
    patch.presentation = value;
  }
  if ("style" in input) {
    const value = input.style as AssistantStyle;
    if (!ASSISTANT_STYLES.includes(value)) throw new Error("Choose a valid communication style.");
    patch.style = value;
  }
  if ("modelPreference" in input) {
    const value = input.modelPreference as ModelPreference;
    if (!MODEL_PREFERENCES.includes(value)) throw new Error("Choose Automatic or a compatible model tier.");
    patch.modelPreference = value;
  }
  if ("selectedModelId" in input) {
    const value = input.selectedModelId;
    patch.selectedModelId = typeof value === "string" && value ? value : null;
  }
  return patch;
}

export interface AIPreferencesResult {
  preferences: AIPreferences;
  initialized: boolean;
}
export async function getAIPreferences(userId: string): Promise<AIPreferencesResult> {
  await ensureSchema();
  const [row] = await db.select().from(folioAiPreferences).where(eq(folioAiPreferences.userId, userId)).limit(1);
  if (row) {
    return {
      preferences: {
        assistantName: row.assistantName || DEFAULT_AI_PREFERENCES.assistantName,
        presentation: (row.presentation as AssistantPresentation) || "neutral",
        style: (row.style as AssistantStyle) || "friendly",
        modelPreference: (row.modelPreference as ModelPreference) || "automatic",
        selectedModelId: row.selectedModelId && MODEL_BY_ID[row.selectedModelId]
          ? row.selectedModelId
          : null,
      },
      initialized: true,
    };
  }
  const defaults: typeof folioAiPreferences.$inferInsert = {
    userId,
    assistantName: DEFAULT_AI_PREFERENCES.assistantName,
    presentation: "neutral",
    style: "friendly",
    modelPreference: "automatic",
    selectedModelId: null,
  };
  await db.insert(folioAiPreferences).values(defaults).onConflictDoNothing({ target: folioAiPreferences.userId });
  return { preferences: { ...DEFAULT_AI_PREFERENCES }, initialized: false };
}

export async function saveAIPreferences(userId: string, patch: Partial<AIPreferences>): Promise<AIPreferencesResult> {
  await ensureSchema();
  const current = await getAIPreferences(userId);
  const next: AIPreferences = { ...current.preferences, ...patch };
  await db.insert(folioAiPreferences).values({
    userId,
    assistantName: next.assistantName,
    presentation: next.presentation,
    style: next.style,
    modelPreference: next.modelPreference,
    selectedModelId: next.selectedModelId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: folioAiPreferences.userId,
    set: {
      assistantName: next.assistantName,
      presentation: next.presentation,
      style: next.style,
      modelPreference: next.modelPreference,
      selectedModelId: next.selectedModelId,
      updatedAt: new Date(),
    },
  });
  return { preferences: next, initialized: true };
}