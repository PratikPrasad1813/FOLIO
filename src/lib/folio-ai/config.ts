/**
 * Client/server-safe Folio AI limits. Gemini credentials are read only by the
 * server-side API route and must never be added here.
 */
export const FOLIO_AI_CONFIG = {
  provider: "google-gemini" as const,
  modelId: "gemini-3.8-flash",
  modelName: "Gemini 3.8 Flash",
  contextWindowTokens: 4_096,
  maxInputCharacters: 4_000,
  maxOutputTokens: 1_024,
  dailyTokenLimit: 10_000,
  maxReservedTokensPerGeneration: 4_096,
  approximateCharactersPerToken: 4,
  maxContextMessages: 6,
  maxContextCharacters: 4_800,
  reservationLeaseMilliseconds: 600_000,
  heartbeatIntervalMilliseconds: 10_000,
  staleTaskTimeoutMilliseconds: 60_000,
  inactivityStallMilliseconds: 300_000,
  longRunningThresholdMilliseconds: 20_000,
  extendedRunningThresholdMilliseconds: 180_000,
  usageRefreshMilliseconds: 20_000,
  historyMessageLimit: 40,
} as const;

export function maxReservedTokensForModel(_modelId?: string): number {
  return FOLIO_AI_CONFIG.maxReservedTokensPerGeneration;
}

export function approximateHumanSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / FOLIO_AI_CONFIG.approximateCharactersPerToken);
}
