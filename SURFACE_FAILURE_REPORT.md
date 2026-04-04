# Surface Failure Report

Generated: 2026-04-04 (read-only diagnosis; no code changes)

## F1 — Image Not Reaching LLM

### Image in UI state

- **Is imageUrl stored in component state after capture?** **YES** (when the trigger flow runs with an image).
- **Variable / location:** `handleSendMessageWithTrigger` builds `newMessages` with `{ role: 'user', text: displayLine, imageUrl }` when `imageUrl` is passed (`sidepanel.tsx` ~2894–2909). Chat list state is updated via `setChatMessages` (~2911).

### Image in fetch payload

- **Does the fetch body to `/api/llm/chat` include imageUrl or base64?** **NO** (not as a dedicated image field or multimodal block).
- **Butler path (no agent match)** — request body shape (strings only for `content`):

```json
{
  "modelId": "<currentModel>",
  "messages": [
    { "role": "system", "content": "<butlerPrompt string>" },
    { "role": "user", "content": "<enrichedTriggerText string>" }
  ]
}
```

  - `enrichedTriggerText` = `enrichRouteTextWithOcr(routeText, ocrText)` = `[routeText, ocrText].filter(Boolean).join('\n\n[OCR]:\n')` (`processFlow.ts` ~1169–1171).
  - **File / line where image is dropped:** The HTTP body never includes `imageUrl`. Image is only reflected indirectly if **OCR returns non-empty text** (`sidepanel.tsx` ~2925–2932, ~3034–3051).

- **Agent path:** `buildLlmRequestBody` produces `{ modelId, messages?, provider?, apiKey? }` with `messages: Array<{ role: string; content: string }>` only (`processFlow.ts` ~1483–1491). `triggerLlmMessages` uses `wrappedInput` (system) and `enrichedTriggerText` (user) — again **text only** (`sidepanel.tsx` ~2980–3001).

### LLM server image handling

- **Does `/api/llm/chat` forward image data to the model?** **NO** (not in addition to text; no `images` array is constructed here).
- **Handler:** `httpApp.post('/api/llm/chat', …)` reads `modelId`, `messages`, optional `provider`/`apiKey`; for local path calls `ollamaManager.chat(activeModelId, messages)` (`main.ts` ~7965–7998).
- **`ollamaManager.chat`:** POST body to Ollama is `{ model, messages, stream: false, keep_alive }` — **`messages` is `ChatMessage[]` where `content` is a `string`** (`types.ts` ~95–98; `ollama-manager.ts` ~549–558). There is **no** branch that maps vision / `images` / multimodal `content` arrays from the HTTP request.
- **Format used:** Plain Ollama chat **text** messages only. **OpenAI-style `image_url` blocks or Ollama `images` base64 array are not implemented** in this path.

### OCR as sole image representation

- **Is OCR the ONLY way image content reaches the LLM in this pipeline?** **YES** for semantic “what’s on screen” — the **only** channel into the string sent to `/api/llm/chat` is **OCR text** embedded in `enrichedTriggerText` / `processedMessages[].content` (see PopupChatView: image → OCR string in `content`, not raw pixels; `PopupChatView.tsx` ~773–788, ~877–884).
- **If OCR returns empty:** User message to the model is effectively **plain text** (e.g. “Analyse the screenshot”) with **no** OCR block — consistent with a model reply that it sees **no attachment**.
- **OCR service status at time of failure:** **UNKNOWN** (not observable from code read). If OCR failed or returned empty, `enrichRouteTextWithOcr` adds no visual context.

### Butler path image inclusion

- **Does the Butler (no-trigger) path include image/OCR in the prompt?** **Indirectly only:** Butler uses `…processedMessages` (PopupChatView) or `enrichedTriggerText` (sidepanel). **No raw image** is sent. **If OCR is empty, Butler path has no image-derived text** (sidepanel Butler: user message is **only** `enrichedTriggerText` — `sidepanel.tsx` ~3034–3050).

### Root cause (one sentence)

**Confidence: High** — End-to-end WR Chat sends **text-only** `messages` to `/api/llm/chat`; the server forwards **string** `content` to Ollama with **no** vision/`images` field, so the model never receives pixels; when OCR is empty or unavailable, even the text description of the screenshot is missing, matching “no attachment” behavior.

---

## F2 — Capture Button Non-Functional (Docked WRChat Mode)

### Button render

- **How many `WrChatCaptureButton` instances in `sidepanel.tsx`?** **3** (JSX at ~4534, ~6525, ~7882).
- **Source prop:** All use `source="sidepanel-docked-chat"`.
- **createTrigger / addCommand:** All use `createTrigger={createTriggerChecked}` and `addCommand={addCommandChecked}`.
- **Variants:** One block uses `sidepanelPreset="enterprise"` (~4537); two use `sidepanelPreset="appBar"` (~6528, ~7885).
- **Disabled / pointer-events:** No `disabled` prop; compact button uses `cursor: 'pointer'` (`WrChatCaptureButton.tsx` ~126–133, ~245–262). **No evidence of pointer-events: none** on the button.

### Click handler

- **Does onClick call `startWrChatScreenCapture`?** **YES** — `onClick` → `startWrChatScreenCapture({ source, createTrigger, addCommand })` (`WrChatCaptureButton.tsx` ~47–49).
- **Gating:** **None** in the button — always calls dispatch.

### Dispatch path

- **`LETmeGIRAFFETHATFORYOU` in sidepanel context?** **NO** — sidepanel is an **extension page**, not the Electron renderer; `wrChatCaptureDispatch.ts` reads `globalThis.LETmeGIRAFFETHATFORYOU` (~16–20). Unless injected elsewhere, **bridge is typically undefined** in extension-only contexts.
- **Fallback `chrome.runtime.sendMessage({ type: 'ELECTRON_START_SELECTION', … })`:** **YES** — runs when bridge is missing (`wrChatCaptureDispatch.ts` ~42–53).
- **`ELECTRON_START_SELECTION` in `background.ts`?** **YES** — `case 'ELECTRON_START_SELECTION':` at ~2769.
- **WebSocket relay:** **Conditional** — if `WS_ENABLED && ws && ws.readyState === WebSocket.OPEN`, sends on main `ws`; **else** opens **on-demand** `WebSocket` to `ws://127.0.0.1:51247/` and sends `START_SELECTION` on `open` (~2775–2805). **Not unconditional** on the primary socket; fallback path exists.

### Root cause (one sentence)

**Confidence: Medium** — Clicks always invoke `startWrChatScreenCapture`; if capture “does nothing,” likely **dispatch failure** (Electron not running, WebSocket to `51247` not opening, or **duplicate UI**: user expects a different capture control in another docked branch while the working capture is only in layouts that render one of the three instances).

---

## F3 — Blank Popup

### Build status

- **`popup-chat.html` exists in dist?** **YES** — e.g. `apps/extension-chromium/build781/src/popup-chat.html` (~2934 bytes; last write ~2026-04-04 per listing).
- **JS bundle:** **No** `popup-chat.tsx` or emitted `popup-chat-*.js` under `build781/src/`; HTML contains `<script type="module" src="./popup-chat.tsx"></script>`. **`Test-Path` on `build781/src/popup-chat.tsx` = False.** The referenced module file **is not present** next to the HTML in the build output tree inspected.
- **Implication:** The popup page likely hits a **failed module load** (404 for `./popup-chat.tsx`), producing a **blank** `#root` — **High** confidence structural issue unless another mechanism rewrites the script URL at runtime (not visible in the emitted HTML).
- **Last build timestamp vs source:** build781 artifacts dated **2026-04-04**; source `popup-chat.tsx` is large and actively maintained (see git log).

### Runtime

- **DevTools console errors:** **Not captured** (screenshot-only prompt).
- **Auth loading state:** First gated render is `isLoggedIn === null` → **“Loading...”** (not pure white if CSS loads; `popup-chat.tsx` ~2005–2021). A **3s fallback** sets `isLoggedIn` to false if still null (~238–241).
- **TypeScript (`tsc --noEmit` filtered for “popup”):** **No matching lines** in the filtered output from the runs executed (workspace may still have many unrelated `tsc` errors).

### Manifest

- **`action`:** `default_title` only — **no `default_popup`** in `manifest.config.ts` (~58–60). Popup is opened via **`chrome.runtime.getURL('src/popup-chat.html')`** from background (~1162, ~3857–3862 in `background.ts` grep), not toolbar popup.

### Root cause (one sentence)

**Confidence: High (build artifact mismatch)** — Built `popup-chat.html` references `./popup-chat.tsx` but that file **does not exist** in the packaged `build781/src/` tree, so the popup **module script likely fails to load** and the UI stays blank; **Medium** if failures are instead auth/network (requires DevTools).

---

## Cross-cutting — No-trigger / Butler

- **When no `#tag`:** `routeInput` can leave **Butler** path; sidepanel Butler fetch uses **`enrichedTriggerText` only** (no image). **PopupChatView** Butler uses **`…processedMessages`** where user messages are **OCR-based strings** — still **no raw image** to Ollama (`PopupChatView.tsx` ~877–884).

---

## Fix Priority Order

1. **F1** — Restores core promise (screenshot → model): requires **either** reliable OCR + text, **or** true **vision** payload (`images` / multimodal) through `/api/llm/chat` + Ollama.
2. **F3** — Popup unusable if script does not load: ensure **Vite/CRX emits** a resolvable JS entry for `popup-chat` (or rewrite HTML to hashed asset).
3. **F2** — Narrower impact if capture works in Command Session: verify **which** `WrChatCaptureButton** instance is visible per mode and trace **WS / Electron** when bridge is absent.

## Files to Edit (hypotheses only — not implemented)

- `code/apps/electron-vite-project/electron/main.ts` — `/api/llm/chat`: accept vision payloads and/or map `images` for Ollama; avoid stripping multimodal content.
- `code/apps/electron-vite-project/electron/main/llm/ollama-manager.ts` — `chat()`: support Ollama vision (`images` / multimodal) if product requires pixels, not OCR-only.
- `code/apps/electron-vite-project/electron/main/llm/types.ts` — `ChatMessage` today is `content: string` only; extend if multimodal is required.
- `code/apps/extension-chromium/src/sidepanel.tsx` — `handleSendMessageWithTrigger` Butler branch: include image/OCR in user message consistently; optionally pass structured image data if HTTP API supports it.
- `code/apps/extension-chromium/src/ui/components/PopupChatView.tsx` — Same: today OCR-only text in `processedMessages`; align with server vision support.
- `code/apps/extension-chromium/src/services/processFlow.ts` — `wrapInputForAgent` / `buildLlmRequestBody`: text-only today; extend if images are first-class.
- `code/apps/extension-chromium/vite.config.ts` / CRX pipeline — Ensure `popup-chat` entry is built and `popup-chat.html` references emitted JS (fix blank popup).
- `code/apps/extension-chromium/src/ui/components/wrChatCaptureDispatch.ts` / `background.ts` — Only if F2 confirmed: diagnostics or stronger fallback when WS closed.

## Git — last commits touching popup surfaces

```
f1dc2252 chore(build020441): stamp Electron and extension; WR Desk recovery fixes
0cd50e74 fix(wrchat): build0017 -- fix cross-pkg import, promptContext guards, capture button props, duplicate border
a54fe2df chore(build): build0015 stamp; WR Chat pipeline tests; ...
...
7ae20c16 feat: replace stub CommandChatView with full PopupChatView in popup WR Chat ...
```

(Command: `git log --oneline -12 -- code/apps/extension-chromium/src/popup-chat.tsx code/apps/extension-chromium/src/ui/components/PopupChatView.tsx` from repo root `code_clean/code`.)

## Confidence summary

| Finding | Confidence |
|--------|------------|
| F1: Text-only HTTP + no Ollama `images` | **High** |
| F2: Button always calls dispatch; failure downstream | **Medium** |
| F3: Missing `popup-chat` module file next to built HTML | **High** (artifact inspection) |
