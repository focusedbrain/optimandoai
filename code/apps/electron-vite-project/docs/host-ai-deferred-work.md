# Host AI — Deferred Work

This document captures known gaps in Host AI (cross-device inference) that are intentionally deferred, with the context needed to address them later.

## Currently working

Cross-device Host AI inference from sandbox to host:

- Resolver routes correctly when caller passes a handshake ID.
- Model name unwrapped via `bareOllamaModelNameForApi` before HTTP request.
- Field/attachment/focus/milestone context included in the outbound prompt.
- Visible loading indicator while requests are in flight.
- First-attempt race after app restart handled by bounded wait in resolver.
- Round-trip latency ~2-3 seconds for `gemma3:12b` on LAN.

## Gap A — Field/attachment context (RESOLVED)

The Host-internal branch in `HybridSearch.tsx` `handleSubmit` was missing the rich prompt assembly that the same-device path runs (focus prefix, inbox context, project context docs, milestone block). Resolved by duplicating the relevant assembly into the Host branch. Field-drafting context (`setupTextDraft`/`chatDirect`) and RAG retrieval are deferred — see Gap C and Gap D below.

## Gap B — Insert/USE buttons in draft-refine sessions

### Status: deferred

When `isDraftRefineSession` is true, the Host-internal branch in `HybridSearch.tsx` `handleSubmit` is skipped entirely. Host AI does not participate in draft-refine flows. The USE button UI is gated behind `isDraftRefineSession` in JSX, so even if Host populated `draftRefineHistory`, the buttons would not render.

### Why it's deferred

The exclusion is **collateral**, not designed policy:

- The `!isDraftRefineSession` gate was added 2026-03-30 (`cac36bee`) for chat-transcript management — separating “show user messages and clear input” from draft-refine sessions where the draft history panel is shown instead.
- Host-internal was inserted into this pre-existing block on 2026-04-25 (`86986e56`) without explicit consideration of draft-refine.
- No comments, TODOs, or commit messages document a Host × draft-refine policy. There is no found technical incompatibility:
  - `useDraftRefineStore.deliverResponse(text)` accepts a single string; streaming is not required by the contract.
  - `connect()`/`onResponse` is pure UI wiring with no model-ID, IPC, or local-Ollama coupling.
  - No model-selection assumptions tying draft-refine to local-only.

So Host AI *could* run during draft-refine. It is deferred because:

1. **Latency without streaming.** Host-internal is currently non-streaming (`stream: false` in `executeSandboxHostAiOllamaDirectChat`). Draft-refine is iterative — users refine, read, refine again. At 2-3 seconds per iteration, the loop would feel sluggish compared to same-device streaming.
2. **Open product question.** Should draft-refine accept cross-device inference at all? Reasons against include privacy expectations (sending the user's draft to another machine) and consistency (refinement loops are a fast/local pattern). Reasons for include user choice (if they picked Host, they want Host).

### What it would take to integrate

The fix is structural but bounded (~30-60 lines in `HybridSearch.tsx`):

1. Move the Host-internal branch out from under the `!isDraftRefineSession` gate so it can run regardless. The chat-transcript block at ~line 1587 must stay gated — that's intentional.
2. In the Host success path, add a conditional that mirrors the same-device draft-refine success block: when `isDraftRefineSession` is true, call `draftRefineDeliverResponse(refined)`, push to `draftRefineHistory` with `showUseButton: true` and `onUse: draftRefineAcceptRefinement`, then `setResponse(null)` and `setQuery('')`.
3. Verify `chatMessages` is *not* mutated when draft-refine is active (preserves the gate's original purpose).

This should not be done before:

- Streaming support for Host-internal lands (Gap E below), OR
- A product decision is made to accept the latency tradeoff.

## Gap C — Field-drafting context for Host

### Status: deferred

The `setupTextDraft`/`chatDirect`/`includeInChat` flow is not lifted into the Host-internal branch. Same-device sends include rich field-drafting context; Host sends do not.

### Why it's deferred

The field-drafting flow uses a different IPC path (`chatDirect`) and is entangled with streaming and system-prompt construction. Lifting the pure portion would require extracting from inline state-mutating code, which is out of scope for surgical Host-branch additions. Revisit after the broader Host/same-device unification is considered or after streaming exists.

## Gap D — RAG retrieval for Host

### Status: out of scope (intentional)

Pinecone-style retrieval is explicitly not used by the Host path. RAG context is built from local embeddings and retrieval; routing it cross-device is a larger architectural question (where does retrieval run, where does the prompt get assembled, how is privacy handled). Not deferred-pending-fix; deferred-pending-design.

## Gap E — Streaming for Host-internal

### Status: deferred

`executeSandboxHostAiOllamaDirectChat` uses `stream: false` and reads the full response in one shot. Real token streaming would require:

- Setting `stream: true` in the Ollama request body.
- NDJSON parsing in `executeSandboxHostAiOllamaDirectChat`.
- Streaming over IPC via the existing `handshake:chatStreamToken` channel.
- Wiring the renderer's `onChatStreamToken` handler to fire for the Host-internal path (currently it only registers in the same-device fall-through path).

This is the highest-impact deferred item for perceived UX. Recommended as a focused piece of work on its own, not bundled with other Host gaps. Once streaming exists, Gap B's latency objection largely resolves and the integration becomes more attractive.

## Notes for future investigators

- The risk register from the working-state diff (model-name unwrap, resolver priority, `ollama_direct` branch in sandboxHostChat, `sandboxInferenceHandshakeId` plumbing) is load-bearing. Do not revert any of these without replacing the underlying behavior.
- The Host-internal branch in `HybridSearch.tsx` and the same-device fall-through path are deliberately parallel. If you find yourself needing to lift more than one or two helpers from one to the other, that's a signal that unification is the right architectural move — but unification is a planned refactor, not a one-prompt change.
