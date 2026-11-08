# Folio AI — Phase 1 local-browser proof of concept

> Historical implementation notes: the browser-local WebLLM provider described here has been retired. Current setup and Gemini usage limits live in the [README's Google Gemini AI section](README.md#google-gemini-ai) and the app's `/docs` route.

Folio AI is a native workspace page at **`/ai`**. Phase 1 provides genuine, streamed local inference—not canned replies—and deliberately gives the model no access to Folio records and no executable tools.

## Model and WebLLM version (verified against the installed registry)

- **Inference library:** `@mlc-ai/web-llm` **0.2.87** (lockfile-pinned resolution).
- **Selected model:** `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`.
- The selected ID was inspected in WebLLM 0.2.87's actual `prebuiltAppConfig.model_list`. WebLLM supplies the compatible model WASM record: `v0_2_87/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`. This is the supported MLC build mapping for the Qwen2.5 checkpoint; Folio does not construct a guessed model URL.
- Hugging Face lists approximately **880 MB** for the model artifact set. WebLLM's checked-in model record estimates **1,629.75 MB of GPU memory** for this quantization. The card displays ~1.6 GB VRAM; extra browser, context/KV-cache, and GPU-driver overhead means this is not a guarantee that a device with exactly that amount available will load successfully. A device with roughly 2–3 GB of *available* GPU memory is a more comfortable starting point.
- **Model context:** 4,096 tokens; **maximum generated response:** 2,048 tokens.
- Current model configuration and resource limits are centralized in `src/lib/folio-ai/config.ts`. The same identifiers drive runtime registry checks and UI display.

References: [WebLLM basic usage](https://webllm.mlc.ai/docs/user/basic_usage.html), [WebLLM worker/cache guidance](https://webllm.mlc.ai/docs/user/advanced_usage.html), and [Qwen2.5-1.5B MLC artifact listing](https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC/tree/main).

## Architecture

- `AIInferenceProvider` defines the provider-neutral streaming/load/interrupt lifecycle. Phase 1 implements only `LocalAIProvider` / `WebLLMProvider`. The provider manager is the seam for a future hosted provider; no hosted provider, account-secret, billing code, upgrade offer, or automatic cloud fallback exists.
- WebLLM JavaScript is dynamically imported on the AI page for compatibility checking; the engine, Web Worker and model weights are loaded only after the user chooses **Download & load local model**. A dedicated module worker keeps model work off the React UI thread.
- The browser feature-detects `navigator.gpu`, requests a real adapter, and checks the configured ID against WebLLM's current prebuilt model registry. It distinguishes unsupported WebGPU/adapter, low coarse system-memory warning, download failure, GPU-resource/allocation failure, and general initialization failure. Low `navigator.deviceMemory` is only a caution: it is **not** used to declare a device incompatible because it is a coarse system-RAM hint, not available GPU VRAM.
- WebLLM reports download/initialization progress. Its Cache API backend is used (WebLLM's default and documented most-tested cache) so artifacts may be reused on subsequent visits. Browser storage can be evicted, so a cached model may occasionally need downloading again. Folio does not preload the model on other pages.
- The provider streams tokens and can be interrupted by the user at any time. There is **no fixed 3-minute wall-clock timeout**: long-running generations stay alive through periodic heartbeats, reservation lease extensions, and intermediate checkpoints in `folio_ai_tasks`, while a 5-minute inactivity stall guard and 60-second stale-heartbeat detector protect against unresponsive workers. Conversations, messages, and task records persist in PostgreSQL (`folio_ai_conversations`, `folio_ai_messages`, `folio_ai_tasks`). Responses render as React text, not injected HTML/Markdown, so model output cannot execute markup/scripts.
- `src/lib/folio-ai/actions.ts` contains an intentionally empty safe action registry. Phase 1's system prompt clearly says it cannot inspect or mutate Folio and must not claim actions happened. Future actions need per-action schemas, authenticated server-side ownership checks, previews/confirmation, and real backend results. The model gets no database connection, SQL, OAuth token, or Folio API tools.

## Account-wide Neon PostgreSQL usage limits

The existing Drizzle + `pg` Pool `DATABASE_URL` connection is reused; Neon remains the PostgreSQL provider when the existing connection string points at Neon. No second database or AI service was introduced. The existing `pg` Pool architecture was not replaced.

- The free daily allowance is **50 successfully finalized responses per account per UTC calendar day**.
- Tables added by `drizzle/0001_folio_ai_usage.sql`:
  - `folio_ai_daily_usage`: owner, UTC date, completed count, and active reserved count, unique per user/date.
  - `folio_ai_usage_reservations`: owner, generation UUID, UTC date, state, lease timestamps, unique per user/generation ID.
- Every usage operation validates Folio's existing session/demo identity on the server. The client supplies no user ID, date, counter, reset timestamp, prompt, or response to these APIs.
- `/api/ai/usage` reads account usage; `POST /api/ai/usage/reservations` atomically reserves a slot **before** local inference; `PATCH /api/ai/usage/reservations/[id]` finalizes a generated response or releases a failed/cancelled attempt.
- A PostgreSQL transaction-scoped advisory lock serializes admission/finalization for the same user across tabs, devices, and serverless instances. The cap check includes both completed and in-flight reservations, so racing sessions cannot claim the same final slot. Repeated generation IDs return the existing reservation; completion is idempotent. Stale reservations expire after 10 minutes and the next usage request reaps them. Failed initialization never obtains a slot; failed or stopped inference releases a slot without incrementing completed count. Interrupted partial output is not counted.
- Only an opaque generation UUID, client-measured character count, and terminal outcome cross to Folio's same-origin usage endpoints. **Prompt text, conversation, response text, and user content are never sent to Neon or an inference server for accounting.** Browser-local state is not authoritative. Usage refreshes every 20 seconds, on focus, and over a same-origin `BroadcastChannel`; server reservation is authoritative even during races.
- UTC midnight is calculated on the server. The interface formats the returned reset timestamp in the browser's local time zone.
- Daily limit 50, input max 4,000 UTF-16 code units, output max 800 tokens, context size, model ID, duration, and lease are in the central configuration file. The server enforces the allowance and declared input-length limit; because strict privacy forbids uploading text, a malicious modified browser could lie about a client-measured character count. It cannot send text via the provided endpoints or exceed the account-wide reserved/completed message quota. Local model use itself is not a paid/server inference service.

### Existing demo-mode caveat

This Folio branch preserves its existing shared demo workspace fallback when no cookie is present. Therefore **anonymous demo visitors use that demo account's shared 50-message account allowance**; it is not a private identity. Existing valid Folio session cookies take precedence and each user has a separate counter. Set the existing optional `FOLIO_DEMO_MODE=false` environment flag to reject requests without a valid session. The current branch's sign-in UI remains paused, so use an existing valid session when demo mode is disabled. This feature does not change auth providers or create an AI-only account system.

## Setup and local testing

1. Keep the existing `.env` / Neon `DATABASE_URL` intact and install the project dependencies (`npm install`). Do **not** add an AI key: none is required.
2. Apply all outstanding additive Folio Drizzle migrations against the configured database:

   ```sh
   node scripts/migrate-search.mjs
   ```

   The existing server `ensureSchema()` also runs the Drizzle journal after its legacy idempotent bootstrap. The app migration uses the existing `72_031_917` advisory lock; do not reset tables.
3. Start Folio:

   ```sh
   npm run dev
   ```

4. Visit **http://localhost:3000/ai**. The page performs compatibility/model-registry and account-usage checks. It does not download model weights until you explicitly choose **Download & load local model**. First model load needs a network connection to the public Hugging Face / MLC artifact sources; inference subsequently happens on-device.
5. Run the real PostgreSQL/HTTP usage integration tests (only uniquely named disposable users are created and removed in `finally`):

   ```sh
   node scripts/test-ai-usage.mjs
   ```

   Tests include two concurrent reservations through two session cookies for the *same* user, last-slot enforcement, cross-session reads, duplicate completion, invalid/cross-origin requests, input limits, failures, cancellations, expiry, and UTC reset.
6. Optional browser UI tests (Playwright is used via temporary `npx`; it is not a Folio runtime dependency):

   ```sh
   npx --yes --package=@playwright/test playwright install --with-deps chromium
   npx --yes --package=@playwright/test -c 'node scripts/test-folio-ai-browser.mjs'
   ```

   This verifies the local/compatibility and usage UI, cross-tab reservations, theme, mobile fit, and privacy copy. It deliberately does not download an 880-MB model or claim to have executed inference.
7. Validate the app normally:

   ```sh
   npx next typegen
   npm exec tsc -- --noEmit --pretty false
   npm run lint
   npm run build
   ```

## Browser/deployment compatibility

WebLLM requires WebGPU and a compatible GPU/driver and secure context. Current Chrome/Edge desktops are the common target; Safari requires a supported recent OS/browser, and Firefox/WebGPU platform availability varies. Folio feature-detects the actual browser adapter instead of assuming browser-version strings imply GPU compatibility. HTTPS is needed in deployed Netlify; `localhost` is a valid development secure context.

On unsupported hardware, the AI page displays **“AI isn't compatible with your device”**, troubleshooting, and a retry check. Downloads, driver, initialization and GPU allocation errors have separate retry messages. The existing projects/tasks/ideas/calendar/notifications continue to work. No Netlify AI compute, paid AI endpoint, API key, or automatic fallback is involved. The browser downloads open model artifacts from public upstream sources on first load, and uses local WebGPU for inference. Browser cache eviction can require a later re-download.

Netlify/Next still serves the **small authenticated usage-accounting API** using the configured Neon PostgreSQL database. It does not receive prompt or response content and does not run model inference. Since inference is client-side, a modified/offline client can bypass local UI limits; server-side reservations prevent concurrent sessions and normal requests from exceeding the authoritative successful-generation quota, but cannot cryptographically attest that an untrusted browser ran a model. Account-wide enforcement and monitoring apply to requests made through the Folio application/API.

## Files added/changed

**New:** `src/lib/folio-ai/{config,types,provider,provider-manager,webllm-provider,webllm.worker,device,usage,http,actions}.ts`, `src/app/api/ai/usage/route.ts`, `src/app/api/ai/usage/reservations/route.ts`, `src/app/api/ai/usage/reservations/[id]/route.ts`, `src/components/folio-ai-panel.tsx`, `src/app/folio-ai.css`, `scripts/test-ai-usage.mjs`, `scripts/test-folio-ai-browser.mjs`, `FOLIO_AI_PHASE_1.md`, and the generated `drizzle/0001_folio_ai_usage.sql` plus snapshot/journal updates.

**Changed:** `package.json` / lockfile (WebLLM only), `src/db/schema.ts`, workspace `View` types/shell/sidebar, `src/app/(workspace)/[view]/page.tsx`, and `src/app/layout.tsx`.

## Known limits / not implemented in Phase 1

- A successful real model response requires a compatible physical WebGPU device. This sandbox's server health/build checks cannot prove that a user's browser GPU or model download succeeds. Browser tests deliberately don't download the model; use the manual AI page test on a supported device.
- Browser-based inference quality and speed vary with GPU, browser, drivers, thermal state, RAM/VRAM, and other open tabs. A 1.63-GB registry estimate does not equal free GPU memory; the UI warns but never rejects a device based only on coarse system-RAM data.
- The local model has no Folio workspace data/actions in Phase 1. It provides general planning help; the interface explicitly communicates the limitation. No tool calls or autonomous changes exist.
- Conversations are intentionally in React memory only; refreshing or navigating away starts a fresh local conversation. WebLLM model artifacts may stay in the browser cache independently.
- The implementation was verified against actual installed WebLLM 0.2.87 metadata. The real WebGPU generate step remains a manual compatible-device test; no mocked or predefined AI responses are used.
