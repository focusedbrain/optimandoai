# 14 — Recommended Implementation Order

**Author:** Opus Thinking  
**Date:** 2026-04-01  
**Continuation of:** Opus Rounds 1–3 (docs 01–12)  
**Purpose:** The recommended implementation sequence with rationale. Not patch instructions. The what and why, not the how.

---

## Framing

The ordering principle is: **each step produces a verifiable baseline that the next step depends on.** Implementation that skips ahead to a harder problem before easier ones are proven creates ambiguous failure modes — you can't tell if the hard problem is broken or if a prerequisite was missed.

A secondary principle: **changes to the most fragile function (`handleSendMessage`) come after all other changes are stable.** This function is the highest-risk point in the codebase. It should be touched last among the critical items, not first.

---

## Step 1: Provider Identity Foundation
**Priority: Highest — do before everything else**

Create a shared provider constants file (`providers.ts`). Define `PROVIDER_IDS` (the runtime strings), `PROVIDER_LABELS` (UI display strings), and a `toProviderId(uiLabel)` conversion function.

**Rationale:** Every other provider-related fix depends on having canonical strings. Fixing the `'Local AI'` bug (Step 2) without this produces a one-off string patch that will be bypassed for the next provider. Building cloud execution (Step 5) without this creates new string mismatches immediately. This step costs almost nothing — it's a new file with constants — and it makes every subsequent step architecturally sound.

**What this enables:** Steps 2, 5, and 6 all depend on having `ProviderId` constants.

**Validation:** TypeScript compilation passes. Constants are importable in TypeScript files. The constants object is duplicated or inlined in the plain-JS grid scripts.

---

## Step 2: Fix Local Provider String Recognition
**Priority: Highest — implement immediately after Step 1**

Update `resolveModelForAgent` to recognize `'Local AI'` (stored as `'ollama'` after Step 1's save-time conversion) as the local Ollama provider. Switch the resolution logic from ad-hoc string comparisons to switch-on-ProviderId from the constants file.

Alongside this: update the Agent Box save path in the content-script and grid scripts to store `ProviderId` (e.g., `'ollama'`) rather than the UI display label (`'Local AI'`). The conversion happens at save time using `toProviderId()` from Step 1.

**Rationale:** This is the single most impactful change for establishing a valid test baseline. Until this is done, no local model test can be trusted. The configured model never runs — a fallback model does. All test output is from the wrong model. No subsequent test result is meaningful while this is broken.

**What this enables:** All local model tests (A1–A4 in the test matrix). First verifiable baseline.

**Validation:** Create an Agent Box with `Local AI` and `llama3.2:3b`. Send a trigger. Network tab shows `"model": "llama3.2:3b"` in the `/api/llm/chat` request body. Not the fallback model.

---

## Step 3: Surface Brain Resolution Failures Visibly
**Priority: High — implement alongside or immediately after Step 2**

When `resolveModelForAgent` (or the new `resolveBrain` function) fails — wrong provider, no key, cloud not implemented, Ollama not running — write a visible message to the Agent Box output. Do not silently proceed.

**Rationale:** Without visible failure messages, test failures caused by misconfiguration are indistinguishable from test failures caused by bugs. A developer who sees an empty box cannot tell whether the agent didn't activate, the model resolution failed, the LLM call failed, or the output delivery failed. Visible error messages in the box make every other failure mode diagnosable. This is a debugging affordance, not a feature.

**What this enables:** Unambiguous test result interpretation for all subsequent steps.

**Validation:** Configure a box with `OpenAI` and no API key. Send a trigger. Box shows an error message — not empty, not a wrong-model response.

---

## Step 4: Grid Box Persistence Unification
**Priority: High — implement after Steps 1–3 are verified**

Make grid Agent Boxes visible to the routing engine. The core requirement: `loadAgentBoxesFromSession` must be able to return boxes that were saved from grid dialogs. Currently, grid boxes go to SQLite only; `loadAgentBoxesFromSession` reads `chrome.storage.local` only — a structural blind spot.

Implementation choice (both valid):
- **Option A:** Grid box saves also write to `chrome.storage.local` via the adapter chain, so the existing read path finds them
- **Option B:** `loadAgentBoxesFromSession` reads from the `storageWrapper` active adapter (SQLite when Electron runs), same as `loadAgentsFromSession` already does

Choose Option B if the adapter chain is well-understood and reliably consistent. Choose Option A if the adapter introduces uncertainty and you want to minimize the read-path change.

Additionally: grid display pages must load session state through the service worker proxy (a `GET_SESSION` message), not via direct Electron HTTP. This removes the third session reader and aligns grid session loading with the rest of the system.

**Rationale:** Grid box equivalence is a product requirement. Without this step, no grid test can produce output regardless of all other fixes. This is a structural blind spot — the routing engine is simply unaware that grid boxes exist.

**What this enables:** Steps 5 and all grid test scenarios (D1, D3, G4).

**Validation:** Create a grid Agent Box. Check that `loadAgentBoxesFromSession` returns it (add a temporary console log). The session storage should show the box in the adapter-resolved store.

---

## Step 5: Grid Live Output Handler
**Priority: High — implement immediately after Step 4**

Add a `chrome.runtime.onMessage` handler in the grid scripts for `UPDATE_AGENT_BOX_OUTPUT`. When received with a matching `boxId`, update the DOM slot. Grid pages must know their box IDs at render time — the box ID must be written to the DOM or registered in a local map during box render.

**Rationale:** Step 4 makes routing find the box. Step 5 makes the output land in the DOM. Without both, grid box equivalence is still not functional. Step 5 is additive — it adds a new listener and a DOM update. It does not change any existing path.

**What this enables:** Grid boxes updating live without page reload. T1.1, T1.3, D1, D3 in the test matrix.

**Validation:** After Step 4 + Step 5: trigger an agent assigned to a grid box from WR Chat. The grid tab updates live. Network tab shows the LLM call. Grid DOM shows the output.

---

## Step 6: Define `TurnInput` and `EnrichedInput` Types
**Priority: High — implement before touching `handleSendMessage`**

Define the canonical typed input carrier. `TurnInput` holds the current-turn facts (rawText, imageUrls scoped to this turn, hasImage, sourceType, timestamp). `EnrichedInput` extends it with OCR results, concatenated ocrText, NLP classification result, and combinedText.

**Rationale:** This is the prerequisite for Step 7. Moving OCR before routing in `handleSendMessage` (Step 7) without a typed object to carry the result is cosmetic — the raw `ocrText` variable still exists, the same ad-hoc threading still exists, and the fix is fragile. With `EnrichedInput`, the type system enforces that routing always receives an enriched input. The routing function's input type becomes `EnrichedInput`, not `string`. A caller cannot accidentally pass pre-OCR data.

**What this enables:** Step 7 (OCR resequencing) and Step 8 (routing authority). Both require a typed input contract.

**Validation:** TypeScript compilation passes. `handleSendMessage` constructs a `TurnInput` object before the OCR call.

---

## Step 7: OCR Resequencing in `handleSendMessage`
**Priority: Critical — highest-risk change, must be last among critical items**

Move `processMessagesWithOCR` before the routing call in `handleSendMessage`. Await OCR. Concatenate all image results into `EnrichedInput.ocrText`. Fix `hasImage` to check only the current turn's images. Pass `EnrichedInput` to the routing function.

**This is the highest-risk change in the entire implementation.** `handleSendMessage` is the most loaded function in the codebase — it manages message assembly, state, OCR, routing, NLP, the agent execution loop, and rendering. Changing its internal execution order can break any of these orthogonal concerns. It should only be touched after Steps 1–6 are stable and fully tested, providing a clean regression baseline.

**Rationale:** OCR-aware routing is a core product requirement. Without this step, no agent configured to activate on image content will ever activate via WR Chat. The correct routing logic already exists — `routeClassifiedInput` produces the right result with OCR-enriched input. Step 8 wires it. Step 7 puts the OCR in the right place.

**What this enables:** Image-triggered agent activation. All OCR test scenarios (E1–E3).

**Validation:** Upload an image with a trigger keyword. No typed text. Agent activates. Console shows OCR ran before routing.

---

## Step 8: Routing Authority Unification
**Priority: Critical — implement immediately after Step 7**

Make the post-OCR+NLP routing computation (`routeClassifiedInput` or a renamed equivalent) the sole authority for which agents execute. The execution loop in `handleSendMessage` must consume this result instead of the pre-OCR `routeInput` result.

The pre-OCR `routeInput` call is either removed from the execution path or demoted to a diagnostic-only log. It must not drive agent execution after this step.

**Rationale:** Step 7 puts OCR before routing. Step 8 makes the execution loop use the routing result that was computed with OCR. Without Step 8, OCR runs earlier but the execution loop still iterates the old pre-OCR routing result. The fix is sequentially incomplete without both steps.

**What this enables:** The routing result that drives execution now has OCR and NLP input. Trigger matching can fire on OCR-extracted text.

**Validation:** Same as Step 7 tests. Additionally: confirm the old `routeInput` is no longer in the execution path (console log showing it still being used for execution would be a regression).

---

## Step 9: API Key Store Unification
**Priority: Medium — implement before cloud execution**

Extension settings UI must write API keys to the same store that Electron reads from. The current split (localStorage for extension, SQLite for Electron) means cloud API calls will fail with key-not-found errors even after the cloud dispatch path is built.

This requires: the extension key save path writes to SQLite via the adapter chain; Electron reads from SQLite (already does); the old localStorage key store is deprecated (with a one-time migration or re-entry requirement noted for existing users).

**Rationale:** Cloud execution (Step 10) is the most complex implementation step. Building it before the key store is unified guarantees that T3.1 (cloud model with valid key) will fail for a separate reason. Debugging a cloud execution failure when the key store is also broken is extremely difficult.

**What this enables:** Step 10. Cloud execution becomes testable with valid key.

**Validation:** Set an API key in extension settings. Inspect SQLite: key present under `api_key_openai`. Reload. Key still present.

---

## Step 10: Cloud Provider Execution (One Provider First)
**Priority: Medium — implement after Steps 1–9 are stable**

Add cloud API dispatch to the Electron backend. Implement one provider as the reference (OpenAI recommended). The extension sends `provider`, `model`, `messages`, and `apiKey` in the LLM chat request. Electron routes to the correct API based on `provider`.

Build from the `ProviderId` constants (Step 1). Each additional cloud provider is one dispatch case — no new string matching.

**Rationale:** Cloud execution is the most structurally novel work in the implementation — it adds new code paths rather than fixing existing ones. It should come after all fixes to the local path are confirmed working. A regression on the local path during cloud implementation would be very hard to isolate.

**What this enables:** T3.1 (cloud model with valid key). Cloud provider agents functional.

**Validation:** OpenAI Agent Box, valid key. Network tab shows call to `api.openai.com` (or Electron proxy). Box shows cloud model output.

---

## Recommended Order Summary

```
1. Create providers.ts constants (foundation for all provider work)
2. Fix local provider string + save-time ProviderId conversion (valid local baseline)
3. Surface brain resolution failures (debuggable test results)
4. Grid box persistence unification (routing engine finds grid boxes)
5. Grid live output handler (grid DOM updates live)
6. Define TurnInput + EnrichedInput types (prerequisite for OCR sequencing)
7. OCR resequencing in handleSendMessage (HIGHEST RISK — do after 1–6 stable)
8. Routing authority unification (consumeOCR-enriched routing result)
9. API key store unification (prerequisite for cloud execution)
10. Cloud provider execution — one provider first
```

**Mandatory checkpoints:**
- After Step 3: run A1–A4 test scenarios. All must pass before proceeding.
- After Step 5: run D1, D3 test scenarios. Grid equivalence must be confirmed before touching handleSendMessage.
- After Step 8: run full test suite (A1–A4, D1, D3, E1–E3). This is the first E2E baseline. Document results before proceeding to Step 9.
- After Step 10: run B1–B3 test scenarios.
