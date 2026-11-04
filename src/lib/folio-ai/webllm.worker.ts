import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// The model and all prompt/response tokens stay in this worker on the user's
// device. The worker is lazy-created only after the user asks to load Folio AI.
const handler = new WebWorkerMLCEngineHandler();
const workerScope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null };
workerScope.onmessage = event => handler.onmessage(event);
