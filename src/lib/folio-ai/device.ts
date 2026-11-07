import { FOLIO_AI_CONFIG } from "@/lib/folio-ai/config";
import type { AICompatibility } from "@/lib/folio-ai/types";

export const MINIMUM_AI_DEVICE_MEMORY_GB = 4;

export function getDeviceMemoryGB(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}

export function isLocalAIAvailable(memoryGB = getDeviceMemoryGB()): boolean {
  return memoryGB === undefined || memoryGB >= MINIMUM_AI_DEVICE_MEMORY_GB;
}

interface GPUAdapterInfoLike { description?: string; vendor?: string; architecture?: string; device?: string }
interface GPUAdapterLike { info?: GPUAdapterInfoLike; requestDevice?: () => Promise<unknown> }
interface NavigatorWithGPU extends Navigator { gpu?: { requestAdapter: () => Promise<GPUAdapterLike | null> } }

export async function checkLocalAICompatibility(): Promise<AICompatibility> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { state: "unsupported", title: "Browser check unavailable", message: "Open Folio AI in a browser tab on this device." };
  }
  if (process.env.NODE_ENV !== "production" && (window as Window & { __FOLIO_AI_TEST_PROVIDER__?: unknown }).__FOLIO_AI_TEST_PROVIDER__) {
    return {
      state: "supported",
      title: "WebGPU is available",
      message: "The model will run locally in this browser. Your prompts and replies stay on this device.",
      adapter: "Local test provider",
    };
  }
  const memory = getDeviceMemoryGB();
  if (!isLocalAIAvailable(memory)) {
    return {
      state: "unsupported",
      title: "Folio AI is unavailable on this device",
      message: `Local AI needs at least ${MINIMUM_AI_DEVICE_MEMORY_GB} GB of reported system memory. AI stays disabled here so Folio remains responsive.`,
      deviceMemoryGB: memory,
    };
  }
  const gpu = (navigator as NavigatorWithGPU).gpu;
  if (!gpu?.requestAdapter) {
    return { state: "unsupported", title: "AI isn't compatible with your device", message: "Your browser does not expose WebGPU. Try a current supported browser (Chrome or Edge 113+, or Safari 26+ where available) and a device with a supported GPU. Folio itself remains fully usable; there is no cloud fallback.", deviceMemoryGB: memory };
  }
  try {
    // The registry check is lazy to the Folio AI page. It loads WebLLM's small
    // JS runtime, not the model weights, and ensures the configured model ID
    // exists in this exact installed WebLLM build before offering model load.
    const webllm = await import("@mlc-ai/web-llm");
    const modelRecord = webllm.prebuiltAppConfig.model_list.find(model => model.model_id === FOLIO_AI_CONFIG.modelId);
    if (!modelRecord) {
      return { state: "unsupported", title: "Configured model is not in this WebLLM build", message: `The installed WebLLM ${webllm.modelVersion} registry does not include ${FOLIO_AI_CONFIG.modelId}. No model was downloaded and no cloud provider will be used.`, deviceMemoryGB: memory };
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { state: "unsupported", title: "AI isn't compatible with your device", message: "WebGPU is present, but the browser could not provide a GPU adapter. Check hardware acceleration, GPU drivers, and browser permissions. Folio remains fully usable; there is no cloud fallback.", deviceMemoryGB: memory };
    }
    const info = adapter.info;
    const label = info?.description || info?.vendor || info?.architecture || undefined;
    // deviceMemory is intentionally a warning only: browsers expose a coarse
    // system-memory bucket, not free VRAM, so it cannot establish compatibility.
    if (memory && memory < 8) {
      return { state: "caution", title: "WebGPU is available · limited memory", message: `The ${FOLIO_AI_CONFIG.modelName} model needs about ${FOLIO_AI_CONFIG.requiredGpuMemoryMB.toLocaleString()} MB of GPU memory. Browser memory estimates are coarse; you can still try loading it. If the device runs out of resources, close other GPU-heavy tabs and retry.`, adapter: label, deviceMemoryGB: memory };
    }
    return { state: "supported", title: "WebGPU is available", message: "The model will run locally in this browser. Your prompts and replies stay on this device.", adapter: label, deviceMemoryGB: memory };
  } catch {
    return { state: "unsupported", title: "Could not access WebGPU", message: "The browser could not initialize a GPU adapter. Check browser permissions, hardware acceleration, and GPU drivers, then retry the compatibility check.", deviceMemoryGB: memory };
  }
}
