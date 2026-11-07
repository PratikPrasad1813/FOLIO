/**
 * One client/server-safe Folio AI configuration source. This file contains no
 * secrets. There is no fixed 3-minute (180-second) wall-clock execution cutoff:
 * long-running tasks stay alive through periodic heartbeats, lease renewals,
 * and intermediate progress checkpoints, while stale-worker and inactivity
 * safeguards protect against genuinely dead or unresponsive workers.
 */
export const FOLIO_AI_CONFIG = {
  provider: "webllm" as const,
  modelId: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
  modelName: "Qwen2.5 3B Instruct · Q4F16",
  webLLMVersion: "0.2.87",
  approximateDownloadBytes: 1_800_000_000,
  requiredGpuMemoryMB: 2_504.76,
  contextWindowTokens: 4_096,
  maxInputCharacters: 4_000,
  maxOutputTokens: 2_048,
  dailyTokenLimit: 50_000,
  maxReservedTokensPerGeneration: 6_144,
  approximateCharactersPerToken: 4,
  maxContextMessages: 8,
  maxContextCharacters: 6_000,
  reservationLeaseMilliseconds: 600_000,
  heartbeatIntervalMilliseconds: 10_000,
  staleTaskTimeoutMilliseconds: 60_000,
  inactivityStallMilliseconds: 300_000,
  longRunningThresholdMilliseconds: 20_000,
  extendedRunningThresholdMilliseconds: 180_000,
  usageRefreshMilliseconds: 20_000,
  historyMessageLimit: 40,
} as const;

export function approximateHumanSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / FOLIO_AI_CONFIG.approximateCharactersPerToken);
}
