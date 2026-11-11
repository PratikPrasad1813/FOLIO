# Folio AI — Phase 2: Workspace Operator + Intelligent Device-Based Model Selection

> Historical implementation notes: the browser-local WebLLM provider and device-based model selection described here have been retired. Folio AI is now bring-your-own-key; current setup and usage limits live in the [README's Bring Your Own Key AI section](README.md#bring-your-own-key-ai) and the app's `/docs` route.

Phase 2 builds on Phase 1 (browser-local WebLLM inference and Neon account-wide usage limits) and adds:

1. **Secure Folio workspace actions** — the local assistant can create, update, complete, search, summarize, and manage real Folio records through validated, authenticated backend actions.
2. **Device-based model recommendation** — Folio detects WebGPU capability and recommends Lightweight, Balanced, or High-performance verified models, while letting the user override with a persisted preference.
3. **Personalized assistant identity** — name, presentation (neutral/feminine/masculine/custom), communication style, animated robot avatar, and onboarding.
4. **Multi-step action previews and confirmations** — destructive and bulk operations require explicit confirmation before execution; the backend enforces this.

Phase 1 behavior (account-wide 50-message daily quota, atomic reservations, UTC reset, local-only inference, no paid API fallback) is preserved and re-tested.

---

## Model tiers (verified against installed WebLLM 0.2.87)

All three IDs below were confirmed present in the **actual installed `@mlc-ai/web-llm` 0.2.87** `prebuiltAppConfig.model_list` and are therefore compatible with this exact build. Folio never constructs guessed model URLs.

| Tier | Model ID | Download (approx.) | WebLLM-reported VRAM | Notes |
|---|---|---|---|---|
| Lightweight | `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` | ~420 MB | ~944 MB | Fastest, lowest memory; recommended for memory-constrained devices (<4 GB coarse system memory). |
| Balanced (default) | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | ~880 MB | ~1.63 GB | Default recommendation for ordinary capable devices (4–12 GB coarse system memory). |
| High performance | `Qwen2.5-3B-Instruct-q4f16_1-MLC` | ~1.8 GB | ~2.5 GB | Best instruction-following; recommended only for devices reporting ≥12 GB system memory. |

Recommendation logic (`src/lib/folio-ai/models.ts`) uses:
- WebGPU adapter availability (from `navigator.gpu.requestAdapter()`).
- `navigator.deviceMemory` (a coarse, browser-provided estimate) and `navigator.hardwareConcurrency`.
- The verified model registry.

A device with **no WebGPU adapter** is treated as incompatible; Folio shows “AI isn't compatible with your device” with troubleshooting and the rest of Folio remains fully usable. A low coarse memory estimate is only a *caution* (it is not free VRAM), never a hard rejection. Manual tier selection persists per account in Neon; choosing **Automatic** re-applies the recommendation for the current device. If a model fails to initialize, Folio explains the failure and keeps the previous conversation; it never silently switches to a cloud provider.

---

## Secure AI action system

The model **never** receives database credentials and **never** executes SQL. The browser assistant emits an optional, validated action-plan block:

```
[AI_ACTION_PLAN]
{"actions":[{"id":"create_task","params":{"title":"Draft brief","priority":"High"}}]}
[/AI_ACTION_PLAN]
```

The client renders a preview, the server validates every action, and execution goes through **existing authenticated Folio HTTP APIs** via a same-origin server-to-server call that forwards the user's session cookie. Ownership checks are performed by those existing endpoints, so one user can never mutate another user's records through the AI.

- **Validation:** each action has a strict validator (enums, UUIDs, dates, ranges, label limits). Invalid plans return 400.
- **Confirmation:** actions marked `destructive` or `bulk` return `409 requiresConfirmation` unless the client sends `confirm: true`. The UI requires a confirmation checkbox for these.
- **Execution results:** the server returns one structured `AIActionResult` per action (id, ok, summary, result). The assistant appends a real, result-backed summary to the conversation; it cannot claim success without a backend confirmation.
- **No arbitrary SQL, no shell, no JS execution, no secrets.**

Supported actions: create/update/archive/restore/delete project; create (bulk)/update/complete/reopen/delete task(s); create/update/delete idea; convert idea to project; search workspace; workspace summary; task report; project report; list/create/update/delete Google Calendar event; list/create/cancel/delete task reminder.

---

## Database changes

`drizzle/0002_folio_ai_preferences.sql` (applied via the existing `scripts/migrate-search.mjs` Drizzle runner, additive only):

- **`folio_ai_preferences`**: per-account assistant identity (`assistant_name`, `presentation`, `style`) and model preference (`model_preference`, `selected_model_id`) with `userId` unique FK (cascade delete), check constraints for allowed enum values, and a unique index.
- Conversation contents are **not** persisted. Only identity/model preferences and aggregate usage counters are stored.

Neon compatibility: the existing Drizzle + `pg` Pool + `DATABASE_URL` connection is reused unchanged. No second database, no AI credentials, no conversation storage.

---

## Files created/modified in Phase 2

**New**
- `src/lib/folio-ai/models.ts` — verified model tiers and device recommendation.
- `src/lib/folio-ai/preferences.ts` — Neon-backed assistant identity and model preference service.
- `src/lib/folio-ai/actions.ts` — shared action registry + validation + plan extraction.
- `src/lib/folio-ai/action-executor.ts` — server-side execution through existing Folio APIs.
- `src/app/api/ai/preferences/route.ts` — GET/PATCH assistant preferences.
- `src/app/api/ai/actions/route.ts` — validated action execution with confirmation enforcement.
- `drizzle/0002_folio_ai_preferences.sql` + `drizzle/meta/0002_snapshot.json` and journal entry.
- `scripts/test-ai-actions.mjs` — action/preferences/confirmation/isolation integration tests.
- `FOLIO_AI_PHASE_2.md`.

**Modified**
- `src/components/folio-ai-panel.tsx` — onboarding, assistant identity, avatar, model settings, action previews/confirmations, conversation context that includes completed-action history.
- `src/lib/folio-ai/types.ts`, `src/lib/folio-ai/provider.ts`, `src/lib/folio-ai/provider-manager.ts`, `src/lib/folio-ai/webllm-provider.ts` — model switching and AI preferences types.
- `src/app/folio-ai.css` — Phase 2 component styles.
- `scripts/test-folio-ai-browser.mjs` — onboarding and model recommendation checks.

No new runtime dependency was added (WebLLM 0.2.87 was already the Phase 1 dependency).

---

## Security and authorization test results (real HTTP + Neon)

`node scripts/test-ai-actions.mjs` (29 assertions) verified against the running app:

- Assistant identity and model preference persist per account; invalid presentation rejected; per-user isolation of preferences.
- Unknown action IDs and missing required params rejected (400).
- Destructive and bulk actions return `409 requiresConfirmation` without `confirm: true`.
- Real create project, bulk create tasks, complete task, create idea, search, workspace summary, reminder create/list all succeed through existing APIs.
- Cross-user update/delete/complete attempts through the AI action endpoint fail (the underlying Folio API rejects them).
- Owner can clean up created records.

`node scripts/test-ai-usage.mjs` (33 assertions) re-verified Phase 1: concurrent reservations across two sessions for the same account, last-slot enforcement, idempotent completion, failure/cancellation release, expiry reaping, cross-user isolation, input limits, and UTC reset.

`npx --yes --package=@playwright/test -c 'node scripts/test-folio-ai-browser.mjs'` (16 checks) verified onboarding, device compatibility messaging, model recommendation display, cross-tab usage sync, dark theme, and mobile bounds, **without downloading the ~880 MB model**.

---

## Local testing instructions

1. Apply migrations: `node scripts/migrate-search.mjs`
2. Start the app: `npm run dev`
3. Server tests:
   - `node scripts/test-ai-usage.mjs`
   - `node scripts/test-ai-actions.mjs`
4. Browser UI test (temporary Playwright, no runtime dependency):
   - `npx --yes --package=@playwright/test playwright install --with-deps chromium`
   - `npx --yes --package=@playwright/test -c 'node scripts/test-folio-ai-browser.mjs'`
5. Static validation: `npx next typegen && npm exec tsc -- --noEmit --pretty false && npm run lint && npm run build`

Manual AI verification on a WebGPU-capable device: open `/ai`, complete onboarding, accept the recommended model, download/load it, then ask e.g. “Create a project called Website Redesign with three tasks due next week and remind me a day before.” Review the action preview, approve, and confirm that the real project/tasks/reminder appear in Folio.

---

## Netlify deployment notes

- No Netlify Functions or serverless AI inference are required. Model weights are downloaded by the browser from public MLC/Hugging Face artifact URLs; inference happens on the user's device.
- The small authenticated `/api/ai/*` accounting/actions endpoints run on Netlify with the existing Neon `DATABASE_URL` and Drizzle migrations. They receive only aggregate usage metadata and validated action requests — never prompt/response text.
- First model load on a user's device requires a network connection and a WebGPU-capable browser; browser cache may later be evicted, causing a re-download. Unsupported devices see a clear compatibility message while the rest of Folio keeps working.
- `FOLIO_DEMO_MODE=false` can be set to disable the inherited shared demo fallback; with it enabled, anonymous demo visitors share the demo account's usage allowance. Real signed-in sessions are always isolated.

---

## Known limitations / not implemented

- The local 0.5B/1.5B/3B models can still occasionally emit a malformed action block; Folio then shows no preview and asks you to rephrase. This is honest behavior, not a fake action.
- Google Calendar actions require the existing OAuth connection and event-write permission; the AI cannot create/edit/delete events for a user who has not granted write access.
- Conversation history, messages, action plans/results, and long-running task states (`queued`, `running`, `waiting`, `completed`, `failed`, `cancelled`) are persisted in Neon PostgreSQL (`folio_ai_conversations`, `folio_ai_messages`, `folio_ai_tasks`).
- Real model generation quality, speed, and VRAM fit depend on the user's GPU/driver/browser; measured WebLLM metadata values are estimates, and only an actual load on a supported device is authoritative.
- Destructive confirmation is enforced server-side for AI-initiated plans; the standard Folio UI confirmation dialogs remain unchanged for manual actions.