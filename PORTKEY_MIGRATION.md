# Portkey Migration

## What changed and why

The two heavy AI calls in Aligned (`gemini-analyze` and `gemini-strategic`) now
go through **Portkey** instead of calling Google Gemini directly. Portkey is an
AI gateway that runs the request against Gemini first and automatically falls
back to OpenAI, then Krutrim, if Gemini is unavailable — so transient Gemini
outages no longer surface as user-visible failures. Transcription
(`gemini-transcribe-audio`) still calls Gemini directly because audio→text is
multimodal-only and the OpenAI/Krutrim chat models cannot consume our audio
payloads; the real transcription fallback (Sarvam) is already wired up in the
frontend.

`max_tokens` for both Portkey-backed calls is set to **65536** to match the
original Gemini-direct behaviour. Aligned meetings routinely run 1–2 hours and
the rich-markdown notes / strategist rollups can easily exceed any lower
ceiling. If a fallback provider in the Portkey config can't honour 65536, that
should be handled inside the Portkey config (provider-specific overrides or
ordering) rather than in the function code.

## Required Supabase secrets

All six secrets must exist in **Supabase → Project Settings → Edge Functions →
Secrets** for the new functions to work:

| Secret | Purpose |
| --- | --- |
| `PORTKEY_API_KEY` | Authenticates every Portkey request. |
| `PORTKEY_CONFIG_STRATEGIC` | Config ID used by `gemini-analyze` and `gemini-strategic` (heavy analysis lineup). |
| `PORTKEY_CONFIG_QUICK` | Reserved for future fast/cheap calls — not used yet but kept available. |
| `PORTKEY_CONFIG_CHAT` | Reserved for the chat route once it migrates off Vercel. |
| `PORTKEY_CONFIG_INDIC` | Reserved for Indian-language specialised routing. |
| `GEMINI_API_KEY` | **Keep this** — still used by `gemini-transcribe-audio`. |

Portkey integration slugs (already set up in the Portkey dashboard, listed here
for reference only — the functions never reference them directly):

| Provider | Slug |
| --- | --- |
| Gemini | `aligned-gemini` |
| OpenAI | `OpenAI-for-aligned-app` |
| Krutrim | `aligned-krutrim` |

## Deployment steps

The new function code lives under `supabase/functions/` in this repo. There is
no CLI deployment — each function is pasted into the Supabase dashboard
manually and deployed from there. The `_shared/` folder holds `cors.ts` and
`portkey.ts` and must be available to each function (in the dashboard, add
those two files as additional files inside each function, or inline them at
the top of `index.ts` when pasting).

Deploy in the order below and test after each step. If a step regresses,
roll back (see "Rollback") before moving to the next one.

### 1. Deploy `gemini-analyze`

1. Open **Supabase Dashboard → Edge Functions → `gemini-analyze`**.
2. Open the code editor, **select all**, **delete**, and paste the contents of
   `supabase/functions/gemini-analyze/index.ts`.
3. Make sure `_shared/cors.ts` and `_shared/portkey.ts` are present in the
   function (add as sibling files or inline).
4. Click **Deploy**.
5. **Test:** record ~1 minute of audio in the app and let it analyse. Confirm
   notes render with the usual emoji sections (📋 Meeting Overview, 🎯 Key
   Takeaways, etc.) and the action-items list looks complete.

### 2. Deploy `gemini-strategic`

1. Open **Supabase Dashboard → Edge Functions → `gemini-strategic`**.
2. Select all → delete → paste contents of
   `supabase/functions/gemini-strategic/index.ts`.
3. Make sure `_shared/cors.ts` and `_shared/portkey.ts` are present.
4. Click **Deploy**.
5. **Test:** open the Strategist view and click **Generate Strategic
   Insights** on a workspace with at least one completed meeting. Confirm the
   Executive Summary, Process Gaps, Strategic Actions, Issue Patterns, and Key
   Themes sections all populate.

### 3. Deploy `gemini-transcribe-audio` (last)

1. Open **Supabase Dashboard → Edge Functions → `gemini-transcribe-audio`**.
2. Select all → delete → paste contents of
   `supabase/functions/gemini-transcribe-audio/index.ts`.
3. Make sure `_shared/cors.ts` is present (this function does NOT import
   `portkey.ts` — it calls Gemini directly).
4. Click **Deploy**.
5. **Test:**
   - Record a **short** clip (~30 s) to exercise the inline-base64 path.
   - Record a **long** clip (>15 min, >15 MB) to exercise the Files API path —
     watch the function logs for `Uploading X MB via Files API...` and
     `✅ File ACTIVE`.

## Rollback

Each function can be reverted independently. The old Vercel handlers in
`api/gemini/*.ts` are untouched and contain the previous Gemini-direct
implementation. To roll back any function:

1. Open the function in the Supabase dashboard.
2. Select all → delete → paste the corresponding `api/gemini/<name>.ts` body,
   adapted to Deno (`Deno.serve` wrapper, `Deno.env.get` for the API key).
   In a pinch, the easiest revert is to switch the frontend back to calling
   the Vercel route by changing the URL — `services/geminiService.ts` ->
   `invokeEdgeFunction` is the single chokepoint.
3. Click **Deploy**.

The frontend works against either backend without any code changes.

## Verifying Portkey is actually serving traffic

1. Open the **Portkey dashboard → Logs**.
2. After running an analysis or strategic generation, a fresh log row should
   appear within a few seconds, showing:
   - The model name (`gemini-2.5-flash`, `gpt-4o-mini`, etc.)
   - Request and response latency.
   - Estimated cost.
   - Which provider in the fallback chain handled the request (useful when
     debugging a Gemini outage — you should see traffic shift to OpenAI).
3. If logs do NOT appear, the most likely culprits are:
   - `PORTKEY_API_KEY` or `PORTKEY_CONFIG_STRATEGIC` not set in Supabase
     secrets (the function will return a 500 with a clear "misconfiguration"
     message).
   - The config ID points to a config that has no providers attached.
