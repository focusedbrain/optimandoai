# 11 — OCR, NLP, Routing, and Input Coordinator

**Status:** Analysis-only.  
**Date:** 2026-04-01  
**Evidence basis:** `sidepanel.tsx`, `processFlow.ts`, `InputCoordinator.ts`, `NlpClassifier.ts`, `ocr/router.ts`.

---

## Current Routing Order

The following is the **confirmed** order of operations in `handleSendMessage` (sidepanel.tsx):

```
1. routeInput(rawText, hasImage)            ← NO OCR, NO NLP
2. processMessagesWithOCR(messages)         ← OCR runs here
3. build inputTextForNlp = rawText + ocrText
4. nlpClassifier.classify(inputTextForNlp) ← NLP on OCR-enriched text
5. routeClassifiedInput(classifiedInput)   ← LOGGED ONLY
6. routeEventTagInput(inputTextForNlp)     ← LOGGED ONLY (when triggers found)
7. for each match in routeInput result:    ← ACTUALLY EXECUTES
     processWithAgent(match, ...)
```

**OCR is step 2. Authoritative routing is step 1.** OCR text arrives too late to influence which agents are selected for execution.

---

## Where OCR Is Triggered

### In sidepanel.tsx: `processMessagesWithOCR` (lines 2373–2414)

Called at line 2943, after `routeInput` has already returned.

- Iterates `chatMessages` with `Promise.all`
- For each user message with `imageUrl`: `POST ${baseUrl}/api/ocr/process` with body `{ image: msg.imageUrl }`
- On success: extracts `ocrResult.data.text`, stores as `ocrText`, appends to message content
- Returns `{ processedMessages, ocrText }` where `ocrText` is the **last successful** OCR result

### In Electron: `OCRRouter.processImage` (ocr/router.ts lines 136–215)

- Decides cloud vs local via `shouldUseCloud(options, cloudConfig)`
- Cloud path: calls `processWithCloud` (OpenAI/Claude/Gemini/Grok vision API)
- Local path: calls `ocrService.processImage` (Tesseract)
- Cloud errors fall back to local
- Returns `OCRResult`: `{ text, confidence, language, method, provider?, processingTimeMs, words?, warnings? }`

---

## How OCR Result Is Represented

### At the Electron level
`OCRResult` from `ocr/types.ts` lines 72–103:
```
{
  text: string,
  confidence: number,
  language: string,
  method: 'local_tesseract' | 'cloud_vision',
  provider?: string,
  processingTimeMs: number,
  cached?: boolean,
  words?: { text, confidence, bbox }[],
  warnings?: string[]
}
```

### At the extension level
After `processMessagesWithOCR`:
- `ocrText` = plain string of extracted text (last successful)
- The message content array is enriched: each image message's `content` becomes `originalText + "\n\n[Local OCR extracted text]:\n" + ocrText` (or Cloud Vision variant)
- `ClassifiedInput.source` can be set to `'ocr'` when the NLP call is made with `source` argument at line 2969: `ocrText ? 'ocr' : 'inline_chat'`
- `ClassifiedInput.ocrConfidence` is in the type definition but not populated by this path (only stored if explicitly provided in `classify` options)

---

## Whether OCR Currently Influences Routing

**OCR does not influence the authoritative routing decision.**

The routing decision that drives agent execution comes from `routeInput` (step 1), which runs on `llmRouteText` — the raw text before any OCR processing.

OCR text does influence:
1. **NLP classification** (step 4): `inputTextForNlp = llmRouteText + "\n[Image Text]: " + ocrText` — so trigger extraction and entity detection see the OCR text
2. **`routeClassifiedInput`** (step 5): receives the OCR-enriched `ClassifiedInput` — but its result is only logged
3. **`routeEventTagInput`** (step 6): called with OCR-enriched text — but its result is also only logged
4. **LLM system prompt**: `wrapInputForAgent` receives `ocrText` and appends a `[Extracted Image Text]` block to the system message
5. **LLM message content**: `processedMessages` include OCR text in the message content array sent to the model

So OCR enriches the **LLM call** but does not change **which agents run**.

---

## Where NLP Classification Happens

`nlpClassifier.classify(inputTextForNlp, source, options)` at sidepanel.tsx line 2967–2970.

`inputTextForNlp` is built at lines 2964–2966:
```javascript
const inputTextForNlp = ocrText
  ? `${llmRouteText}\n\n[Image Text]: ${ocrText}`
  : llmRouteText
```

`source` is `'ocr'` if OCR ran, `'inline_chat'` otherwise.

### What `classify` produces

`NlpClassifier.classify()` (NlpClassifier.ts lines 100–165):
1. Initializes wink-nlp (dynamic import; fallback to regex if init fails)
2. Calls `parseWithWink(rawText)` or `parseWithRegex(rawText)`
3. Extracts `triggers` = tokens starting with `#`
4. Extracts `entities` via wink entity detection + regex merge
5. Optional intent detection (keyword buckets)
6. Returns `ClassificationResult { success, input: ClassifiedInput, processingTimeMs }`

`ClassifiedInput` carries: `rawText`, `normalizedText`, `triggers[]`, `entities[]`, `intents[]`, `source`, `errors[]`, `timestampIso`, optional `ocrConfidence`, `sourceUrl`, `sessionKey`.

**`source` does not affect how `#` triggers are extracted** — the parser uses only `rawText`. `source` is stored on the result and used downstream by `InputCoordinator.routeClassifiedInput` to infer `hasImage` (line 661–663).

---

## What `routeClassifiedInput` Actually Does

`InputCoordinator.routeClassifiedInput` (lines 646–758):

1. Strips `#` from trigger names for matching (lines 655–658)
2. Infers `inputType` and `hasImage`: if `source === 'ocr'` or any entity is an image URL → `hasImage = true`, `inputType = 'mixed'` (lines 661–663)
3. Loops all enabled agents (line 670)
4. Calls `evaluateAgentListener(agent, inputTriggers, rawText, inputType, hasImage, currentUrl)` (lines 677–684)
5. Skips if `matchType === 'none'` (lines 687–688)
6. Calls `findAgentBoxesForAgent` → resolves output box (lines 692–693)
7. Reads `agent.reasoning` (flat, top-level only) to build `AgentReasoning` (lines 696–702)
8. Resolves `outputSlot.destination` as box label or `'Inline Chat'` (lines 705–712)
9. Builds `AgentAllocation` with LLM model from box or fallbacks (lines 725–740)
10. Deduplicates by `agentId` (lines 747–749)
11. Returns `{ ...classifiedInput, agentAllocations: uniqueAllocations }` (lines 754–757)

**The result (`agentAllocations`) is enriched onto the `ClassifiedInput` object and returned, but in the WR Chat main path, this return value is not used to run agents.** It is logged to console at sidepanel.tsx lines 2992–2993.

---

## How Event-Tag Routing Works

`routeEventTagInput` in `processFlow.ts` (lines 928–990):

1. Calls `nlpClassifier.classify(input, source, { sourceUrl, sessionKey })` — performs a second NLP classification
2. Loads agents and boxes from session
3. Calls `inputCoordinator.routeEventTagTrigger(classifiedInput, agents, boxes, ...)`
4. `routeEventTagTrigger` (InputCoordinator lines 808–946): extracts trigger names from `classifiedInput.triggers`, iterates agents, calls `extractEventTagTriggers` per agent, evaluates `evaluateEventTagConditions`, builds `EventTagRoutingResult` per match
5. Returns `{ batch: EventTagRoutingBatch, classificationTimeMs, routingTimeMs }`

This path honors `reasoningSections[].applyForList` and `resolveExecutionConfig` — it is the more complete routing pipeline. But its result is also only logged in the WR Chat path (sidepanel.tsx lines 3033–3043).

---

## Whether There Are Multiple Competing Routing Concepts

**Yes. There are three active routing concepts running in every WR Chat send:**

| # | Routing concept | Input | When runs | Result used for execution? |
|---|---|---|---|---|
| 1 | `routeInput` → `routeToAgents` | Raw text + hasImage | Before OCR | **Yes** — drives `processWithAgent` loop |
| 2 | `routeClassifiedInput` | OCR-enriched NLP output | After OCR + NLP | **No** — logged only |
| 3 | `routeEventTagInput` → `routeEventTagTrigger` | OCR-enriched NLP output | After OCR + NLP (when triggers found) | **No** — logged only |

These three concepts are architecturally distinct:
- **Concept 1** (`routeInput`): raw text → `evaluateAgentListener` → trigger/context/applyFor matching
- **Concept 2** (`routeClassifiedInput`): NLP-classified `ClassifiedInput` → same `evaluateAgentListener` but with enriched trigger names and input type inference
- **Concept 3** (`routeEventTagTrigger`): NLP-classified `ClassifiedInput` → event-tag-specific trigger matching with conditions, `resolveReasoningConfig`, `resolveExecutionConfig`

Only concept 1 is wired to execution. Concepts 2 and 3 are effectively development scaffolding — they run, produce results, log them, and do nothing else.

---

## Why OCR-Aware Routing Is Not Yet Truly Canonical

Three structural reasons:

**1. The authoritative routing call precedes OCR.**  
`routeInput` is called at line 2925. `processMessagesWithOCR` is called at line 2943. There is no mechanism to re-run routing after OCR results arrive.

**2. The OCR-enriched routing path (`routeClassifiedInput`) is wired to logging, not execution.**  
Even though step 6 (`routeClassifiedInput`) sees the OCR-enriched text and produces agent allocations, the execution loop at step 8 does not use those allocations. The two paths are computationally parallel but only the pre-OCR path has execution consequences.

**3. OCR is image-message-only — it does not apply to text-only input.**  
If the current send has no `imageUrl` in any message, `ocrText = ''` and the `inputTextForNlp` is identical to `llmRouteText`. This means the OCR enrichment path is irrelevant for text-only WR Chat — routing concept 1 and routing concept 2 would produce identical results anyway.

**4. `hasImage` in `routeInput` is set from prior message history, not the current turn.**  
`hasImage = chatMessages.some(msg => msg.imageUrl)` — this looks at the entire chat history. An agent configured to only respond to `applyFor: 'image'` input would be incorrectly activated if any prior turn (even much earlier in the session) had an image.

---

## Minimum Clean Redesign to Make OCR Part of Routing

A minimal, non-breaking redesign that would make OCR-aware routing canonical:

**Step 1: Move `processMessagesWithOCR` before `routeInput`.**

Currently at line 2943 (after `routeInput`). Move to before line 2925. Pass `ocrText` into `routeInput` as an optional argument.

**Step 2: Pass `ocrText` into `matchInputToAgents` / `routeToAgents`.**

`routeInput` in `processFlow.ts` builds `inputText` from `input` only. Extend it to accept an `ocrText?: string` and merge them: `const enrichedInput = ocrText ? input + '\n' + ocrText : input`.

**Step 3: Unify the execution routing path.**

Replace the `routeInput` → `routeToAgents` → `evaluateAgentListener` call chain with a single call to `routeClassifiedInput` after OCR+NLP. The `routeClassifiedInput` result already contains `agentAllocations` — wire these into the execution loop instead of `routingDecision.matchedAgents`.

**Step 4: Fix `hasImage` detection.**

`hasImage` should be derived from the **current turn's messages**, not from the full chat history. Change `chatMessages.some(msg => msg.imageUrl)` to the current turn's user message specifically.

**What this avoids changing:**
- `processWithAgent` signature — unchanged
- `wrapInputForAgent` — unchanged (already receives `ocrText`)
- `updateAgentBoxOutput` — unchanged
- Electron OCR endpoint — unchanged
- `NlpClassifier` — unchanged

This is a 4-step change confined to `handleSendMessage` and minor extensions to `routeInput` / `routeClassifiedInput` parameter passing.
