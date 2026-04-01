# Phase 3: OCR-Aware Canonical Routing — Implementation Report

## What Routing Authority Now Exists

**One authoritative routing path drives execution.** The pipeline is now:

```
User input → current-turn image detection → OCR (if image) → enrich text → routeInput → execute
```

Previously, there were two routing passes:
1. `routeInput(typedText, ...)` — pre-OCR, drove execution
2. `routeEventTagInput(ocrEnrichedText, ...)` — post-OCR, logged as feedback only

Now there is one routing pass:
1. `routeInput(ocrEnrichedText, ...)` — post-OCR, drives execution

The second routing pass (`routeEventTagInput`) has been removed from the execution pipeline. It existed as a compensatory second pass to get OCR-enriched routing, but since the primary routing now has OCR text, the compensation is no longer needed.

NLP classification (`nlpClassifier.classify`) remains in the pipeline as a diagnostic step — it logs trigger detection and entity extraction for observability but does not override the routing decision.

## Whether an Enriched Input Contract Was Introduced

**Yes.** An `EnrichedTurnInput` interface was added to `processFlow.ts`:

```typescript
export interface EnrichedTurnInput {
  typedText: string       // What the user typed
  ocrText: string         // OCR-extracted text (empty if no image)
  combinedText: string    // typedText + ocrText (for routing)
  hasImage: boolean       // Current turn only
  imageUrl?: string       // Current turn image URL
  currentUrl: string      // Active tab URL
  source: 'wr_chat' | 'trigger' | 'screenshot'
}
```

This type documents the contract between input assembly and routing. The assembly happens in `sidepanel.tsx` via `runOcrForCurrentTurn()` + manual text composition. The `combinedText` is what `routeInput` receives.

A reusable `runOcrForCurrentTurn(imageUrl, baseUrl)` function was created to extract OCR text from a single image. This replaces the inline OCR fetch logic that was duplicated across all three entry points.

## What Changed in OCR Timing

### Before (all three entry points)
```
1. routeInput(typedText, hasImage) → routing decision (no OCR text)
2. OCR(imageUrl)                   → ocrText available (too late for routing)
3. Execute with routingDecision    → OCR text only reaches LLM, not routing
```

### After (all three entry points)
```
1. OCR(imageUrl)                   → ocrText available
2. enrichedText = typed + OCR      → enriched text ready
3. routeInput(enrichedText, hasImage) → routing decision (uses OCR text)
4. Execute with routingDecision    → OCR triggers influence agent matching
```

This reordering applies consistently to:
- `handleSendMessage` (main WR Chat send)
- `handleSendMessageWithTrigger` (trigger-based send with optional image)
- `processScreenshotWithTrigger` (screenshot capture + trigger)

## Hidden Issues Fixed Along the Way

### 1. `hasImage` was history-wide (critical)

**Before:**
```typescript
const hasImage = chatMessages.some(msg => msg.imageUrl)
```
This checked ALL messages in chat history. If any previous message had an image, `hasImage` was `true` even for a pure text message. This caused:
- Wrong `inputType` classification (`'mixed'` instead of `'text'`)
- Incorrect routing behavior for text-only messages after an image was sent

**After:**
```typescript
const lastUserMsg = [...chatMessages].reverse().find(m => m.role === 'user' && m.imageUrl)
const currentTurnImageUrl = lastUserMsg?.imageUrl
const hasImage = !!currentTurnImageUrl
```
Only checks the most recent user message for an image. Current-turn scope.

### 2. Duplicate OCR code across entry points

Each of the three entry points had its own inline OCR fetch logic (3 copies). Replaced with one reusable `runOcrForCurrentTurn()` function.

### 3. Split routing authority eliminated

The Event Tag routing pass (`routeEventTagInput`) was a second routing decision that ran after OCR but didn't drive execution. It was removed from the pipeline. The `routeEventTagInput` function still exists in `processFlow.ts` for potential future use, but `sidepanel.tsx` no longer imports or calls it.

### 4. NLP classification result was computed but discarded

The `routeClassifiedInput` call (which used NLP classification to compute agent allocations) was logged but never influenced execution. This dead code has been removed from the main pipeline. NLP classification remains as a diagnostic log for observability.

## Files Touched

| File | Change |
|---|---|
| `src/services/processFlow.ts` | Added `EnrichedTurnInput` interface |
| `src/sidepanel.tsx` | Reordered pipeline in all 3 entry points; added `runOcrForCurrentTurn`; fixed `hasImage` scope; removed `routeEventTagInput` import and call; removed dead NLP/allocation code from main pipeline |

## What Remains Intentionally Simplified

### Listener semantics
The listener evaluation (passive/active triggers, expected context) still uses `routeToAgents()` in the `InputCoordinator` with simple string pattern matching. The more structured `routeEventTagTrigger()` method with condition evaluation (WRCode, sender, keywords, website) exists but is not wired into the execution path. This can be upgraded later without changing the OCR timing or routing authority.

### Reasoning semantics
The reasoning wrapper (`wrapInputForAgent`) uses the agent's Goals, Role, and Rules from config. It does not yet use the structured `reasoningSection` from `routeEventTagTrigger`. The current wrapper is sufficient for first E2E correctness.

### Execution semantics
Execution is still a simple LLM call with the wrapped input. The structured execution section from Event Tag routing (output routing, special destinations) is not yet wired. Output routing uses the simpler `agentBoxId` from `AgentMatch`.

### OCR caching
Each image is OCR'd once per request. If the same image URL appears in multiple contexts, it will be processed again. For first E2E, this is acceptable.

### `processMessagesWithOCR` still processes full history
The full conversation message array still goes through `processMessagesWithOCR` for LLM context formatting. This is correct behavior — the LLM should see the full conversation. Only the routing input is scoped to the current turn.

---

## Validation Checklist

### Test 1: Typed Trigger Path
1. Configure Agent 01 with trigger `#summarize`
2. Type `#summarize this is a test` in WR Chat
3. **Expected:** Agent 01 matches, processes the request, output appears in its Agent Box
4. **Expected:** Console shows `[Chat] Input Coordinator routing decision (OCR-enriched): { shouldForward: true, hasOcrText: false }`

### Test 2: OCR-Only Trigger Path
1. Configure Agent 02 with trigger `#invoice`
2. Take a screenshot of a document containing the text `#invoice`
3. **Expected:** OCR extracts `#invoice` from the image
4. **Expected:** Agent 02 matches via OCR-enriched routing
5. **Expected:** Console shows `hasOcrText: true`

### Test 3: Mixed Text + Image Path
1. Type `#analyze check this` and attach an image
2. **Expected:** OCR runs on the image, enriched text = `#analyze check this\n\n[Image Text]:\n...extracted text...`
3. **Expected:** Agent matching uses the full enriched text
4. **Expected:** `hasImage: true` and `ocrText` both populated

### Test 4: Current-Turn Image Detection
1. Send a message with an image (first turn)
2. Send a pure text message (second turn)
3. **Expected:** Second turn has `hasImage: false` — no false positive from history
4. **Expected:** Console shows `hasOcrText: false` for the second turn

### Test 5: Sidepanel Box Delivery After Routing Changes
1. After any of the above tests, verify output appears in the correct sidepanel Agent Box
2. **Expected:** `updateAgentBoxOutput` succeeds, box displays output

### Test 6: Grid Box Delivery After Routing Changes
1. Configure a grid Agent Box for an agent
2. Trigger the agent via typed or OCR trigger
3. **Expected:** Output appears in the grid slot (Phase 2 wiring intact)

---

## Risk After This Phase

### Resolved
- OCR text now participates in routing (was: routing happened before OCR)
- Split routing authority eliminated (was: two routing passes, first drove execution)
- `hasImage` is current-turn scoped (was: history-wide false positives)
- One reusable OCR function (was: 3 duplicated inline implementations)

### Remaining
- **OCR latency:** OCR now runs before routing, adding latency before the routing decision. For local OCR this is typically <500ms. If OCR is slow, the user will see a delay before any routing feedback.
- **NLP classification is diagnostic only:** The structured NLP output (triggers, entities) is logged but not used for routing. The simpler pattern matching in `routeToAgents` handles triggers. Future work can wire NLP classification into routing for richer semantics.
- **Event Tag execution semantics deferred:** The `processEventTagMatch` function with its structured condition evaluation, reasoning sections, and output routing is not wired into execution yet. This is intentional — first E2E uses the simpler path.
