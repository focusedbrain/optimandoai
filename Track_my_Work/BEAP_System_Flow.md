# BEAP Mini‑App System Flow

This document explains the end‑to‑end flow used by the BEAP runtime to create working mini‑apps from Tier‑3 atomic JSON blocks. It complements [Track_my_Work/BEAP_README.md](Track_my_Work/BEAP_README.md) and links directly to the source files.

---

## Overview
- Purpose: Select relevant Tier‑3 atomic blocks based on a user query (Title + Description), assemble them into a `MiniApp`, then render a functional UI with simple state and event handling.
- Approach: Deterministic text embeddings + cosine similarity (no LLM). Vector math is performed via TensorFlow.js.
- Key guarantee: Only UI blocks render; logic blocks run behaviours but are never shown as visual elements.

---

## Flowchart Overview (High‑Level)

```mermaid
flowchart TD
  Start([Start]) --> Bootstrap{Bootstrap blocks available?}
  Bootstrap -- Yes --> LoadBlocks[Load Tier‑3 blocks]
  Bootstrap -- No --> Fallback[Fallback: fetch index + JSON]
  LoadBlocks --> PrepareText[Combine intent_tags + description]
  PrepareText --> Embed[Deterministic embedding (TF.js)]
  Embed --> Rank[Cosine similarity ranking]
  Rank --> TopN{Top N >= 1?}
  TopN -- Yes --> Assemble[Assemble MiniApp{id, blocks}]
  TopN -- No --> NoBlocks[Show 'No blocks selected' message]
  Assemble --> Render[Render UI blocks only]
  Render --> Interact[User interacts]
  Interact --> Emit[Emit events]
  Emit --> Logic{Logic behaviours handle event?}
  Logic -- Yes --> Persist[Persist state to sessionStorage]
  Persist --> Success[Show success toast]
  Logic -- No --> Idle[No‑op]
  Success --> End([End])
```

Legend: rectangles = actions, diamonds = decisions, circles = terminals.

## Component Map
- Loader: [code/apps/extension-chromium/src/beap/loader.ts](code/apps/extension-chromium/src/beap/loader.ts)
- Embeddings: [code/apps/extension-chromium/src/beap/embedding.ts](code/apps/extension-chromium/src/beap/embedding.ts)
- Runtime State: [code/apps/extension-chromium/src/beap/runtime.ts](code/apps/extension-chromium/src/beap/runtime.ts)
- Renderer: [code/apps/extension-chromium/src/beap/renderer.ts](code/apps/extension-chromium/src/beap/renderer.ts)
- Orchestration: [code/apps/extension-chromium/src/beap/index.ts](code/apps/extension-chromium/src/beap/index.ts)
- Content Script Bootstrap: [code/apps/extension-chromium/src/content-script.tsx](code/apps/extension-chromium/src/content-script.tsx)
- Tier‑3 Blocks (JSON):
  - [code/apps/electron-vite-project/electron/main/miniapps/tier3/ui-label.json](code/apps/electron-vite-project/electron/main/miniapps/tier3/ui-label.json)
  - [code/apps/electron-vite-project/electron/main/miniapps/tier3/ui-text-input.json](code/apps/electron-vite-project/electron/main/miniapps/tier3/ui-text-input.json)
  - [code/apps/electron-vite-project/electron/main/miniapps/tier3/ui-textarea.json](code/apps/electron-vite-project/electron/main/miniapps/tier3/ui-textarea.json)
  - [code/apps/electron-vite-project/electron/main/miniapps/tier3/ui-button.json](code/apps/electron-vite-project/electron/main/miniapps/tier3/ui-button.json)
  - [code/apps/electron-vite-project/electron/main/miniapps/tier3/logic-state-set.json](code/apps/electron-vite-project/electron/main/miniapps/tier3/logic-state-set.json)

---

## Data & Control Flow

### 1) Bootstrap (content script)
- At load, the content script pre‑populates `window.__BEAP_TIER3_BLOCKS` with 5 atomic blocks (label, text input, textarea, button, logic).
- The text input block’s intent tags are adjusted to `["input","field","title"]` so it won’t match generic “notes” queries.
- Reference: [code/apps/extension-chromium/src/content-script.tsx](code/apps/extension-chromium/src/content-script.tsx)

### 2) Load Blocks (loader)
- Loader tries, in order:
  1. Bundler‑time glob import if available
  2. `window.__BEAP_TIER3_BLOCKS` (recommended for Electron‑fed data)
  3. Fallback fetch of `miniapps/tier3/index.json` and listed files
- Returns an array of `AtomicBlock` objects.
- Reference: [code/apps/extension-chromium/src/beap/loader.ts](code/apps/extension-chromium/src/beap/loader.ts)

### 3) Embedding (deterministic)
- Normalize text (lowercase, remove punctuation, collapse whitespace).
- Hash unigrams + bigrams via `fnv1a` into a fixed‑dim vector (default 256).
- Convert to TensorFlow.js tensor, normalize, compute cosine similarity.
- Reference: [code/apps/extension-chromium/src/beap/embedding.ts](code/apps/extension-chromium/src/beap/embedding.ts)

### 4) Ranking (index orchestrator)
- `ensureBlocks()` loads Tier‑3 blocks and precomputes an embedding for each using `intent_tags + description`.
- `createMiniAppFromQuery(title, description, topN=4)` embeds the query, ranks blocks by cosine similarity, picks top N.
- Reference: [code/apps/extension-chromium/src/beap/index.ts](code/apps/extension-chromium/src/beap/index.ts)

### 5) Assembly (runtime)
- Selected blocks are assembled into a `MiniApp` with a runtime‑generated id.
- `createRuntimeState(namespace?)` provides `state`, `set`, `get`, `persist` and saves under `sessionStorage[beap_state_${namespace}]` when namespaced.
- Reference: [code/apps/extension-chromium/src/beap/runtime.ts](code/apps/extension-chromium/src/beap/runtime.ts)

### 6) Rendering (UI + behaviours)
- Only blocks with `ui.kind` render (text/label, input, textarea, button). Logic‑only blocks are skipped visually.
- UI wiring:
  - `input`/`textarea` honour `behaviour.onChange.action === 'state.set'` with a provided key.
  - `button` honours `behaviour.onClick.action === 'event.emit'` (e.g., `button_clicked`).
- Event handling scans logic blocks for matching `onEvent:*` behaviours:
  - `state.persist` reads a source key and writes state to sessionStorage.
  - Shows green success feedback that auto‑dismisses.
- Reference: [code/apps/extension-chromium/src/beap/renderer.ts](code/apps/extension-chromium/src/beap/renderer.ts)

#### Flowchart: UI Rendering Rules

```mermaid
flowchart LR
  Block[AtomicBlock] --> HasUI{Has ui.kind?}
  HasUI -- Yes --> MapUI[Map kind → DOM (text|input|textarea|button)]
  MapUI --> Wire[Wire behaviours (onChange/onClick)]
  Wire --> Append[Append to container]
  HasUI -- No --> Skip[Skip render (logic‑only)]
```

---

## End‑to‑End Sequence (Notes Panel)

```mermaid
flowchart TD
  A[Bootstrap: __BEAP_TIER3_BLOCKS] --> B[User: Title+Description]
  B --> C[createMiniAppFromQuery]
  C --> D[ensureBlocks: load+embed]
  D --> E[Rank by cosineSimilarity]
  E --> F[Select top N blocks]
  F --> G[assembleMiniApp]
  G --> H[renderMiniApp]
  H --> I[User interacts]
  I --> J[emitEvent(button_clicked)]
  J --> K[state.persist to sessionStorage]
  K --> L[Success message]
```

### Rendered UI (Notes query)
- Heading: `ui-label-v1` → “Notes”
- Textarea: `ui-textarea-v1` → multi‑line notes; onChange → `state.set('textarea_value')`
- Button: `ui-button-v1` → “Save Notes”; onClick → `emit('button_clicked')`
- Logic: `logic-state-set-v1` listens for `button_clicked` → `state.persist('textarea_value')`

---

## Storage Model
- Scope: Browser `sessionStorage`
- Key: `beap_state_${appId}`
- Example data: `{ "textarea_value": "My first note" }`
- Visibility: DevTools → Application → Session Storage → site URL

---

## Intent Tags (selection control)
- Notes flow relies primarily on blocks tagged with `notes` and `save`.
- `ui-text-input-v1` is intentionally tagged `input, field, title` to avoid notes selection except for title‑focused queries.

---

## Testing (quick)
1. Rebuild extension: run `pnpm build` in the Chromium extension folder.
2. Reload in Chrome: `chrome://extensions/` → reload.
3. Hard refresh the target page to clear caches.
4. In the extension UI, open Mini‑App Builder.
5. Use Title: “Notes Panel”; Description: “Small panel to write and save notes.”
6. Click Run Test and verify the rendered Notes UI + success message after save.

See detailed steps in [Track_my_Work/BEAP_README.md](Track_my_Work/BEAP_README.md).

---

## Troubleshooting
- Check console for `[BEAP]` logs: initialization, import, ranking, errors.
- Ensure the bootstrap ran (“Initialized tier3 blocks: 5 blocks”).
- If the test output shows an error, inspect console stack traces.

---

## Design Principles
- Determinism: Embeddings use hashing and TF.js math; no model variability.
- Minimalism: No framework dependency in renderer; pure DOM + events.
- Safety: Logic blocks don’t render; they only provide behaviours.
- Separation: Loader, embedding, runtime, renderer, and orchestrator are cleanly isolated.

---

## References
- README: [Track_my_Work/BEAP_README.md](Track_my_Work/BEAP_README.md)
- Loader: [code/apps/extension-chromium/src/beap/loader.ts](code/apps/extension-chromium/src/beap/loader.ts)
- Embedding: [code/apps/extension-chromium/src/beap/embedding.ts](code/apps/extension-chromium/src/beap/embedding.ts)
- Runtime: [code/apps/extension-chromium/src/beap/runtime.ts](code/apps/extension-chromium/src/beap/runtime.ts)
- Renderer: [code/apps/extension-chromium/src/beap/renderer.ts](code/apps/extension-chromium/src/beap/renderer.ts)
- Orchestration: [code/apps/extension-chromium/src/beap/index.ts](code/apps/extension-chromium/src/beap/index.ts)
- Bootstrap & Tests: [code/apps/extension-chromium/src/content-script.tsx](code/apps/extension-chromium/src/content-script.tsx)
- Tier‑3 Blocks: [code/apps/electron-vite-project/electron/main/miniapps/tier3](code/apps/electron-vite-project/electron/main/miniapps/tier3)

---

## Full BEAP System Flow (Detailed)

### Inputs & Preconditions
- Title and Description provided by the user in the Mini‑App Builder or Edit Test frame.
- Tier‑3 atomic blocks available via bootstrap (preferred) or loader fallbacks.
- TensorFlow.js available to perform vector math in the browser context.

### Bootstrap & Availability
- The content script populates `window.__BEAP_TIER3_BLOCKS` with five canonical blocks (label, text input, textarea, button, logic set/persist) on load.
- Intent tags for `ui-text-input-v1` are set to `input, field, title` to avoid selection in notes‑centric queries.
- Reference: [code/apps/extension-chromium/src/content-script.tsx](code/apps/extension-chromium/src/content-script.tsx)

### Loading Strategies
1. Bundler glob: `import.meta.glob('../../electron/main/miniapps/tier3/*.json', { eager: true, as: 'json' })` (when available at build‑time).
2. Runtime global: read `window.__BEAP_TIER3_BLOCKS` (preferred when Electron/main pre‑injects data).
3. Fallback fetch: attempt `miniapps/tier3/index.json` → then fetch listed JSONs.
- Reference: [code/apps/extension-chromium/src/beap/loader.ts](code/apps/extension-chromium/src/beap/loader.ts)

### Embedding Algorithm (Deterministic)
- Normalize text: lowercase, strip punctuation, collapse whitespace.
- Tokenize to unigrams and bigrams; hash with lightweight `fnv1a` into fixed dimension (default 256).
- Build TF.js tensor and L2‑normalize the vector.
- Cosine similarity: $\mathrm{cos}(a,b) = \frac{a\cdot b}{\lVert a \rVert \, \lVert b \rVert}$. Vector ops are executed in TF.js.
- Reference: [code/apps/extension-chromium/src/beap/embedding.ts](code/apps/extension-chromium/src/beap/embedding.ts)

### Scoring & Selection
- `ensureBlocks()` loads blocks and caches `intent_tags + description` embeddings.
- `createMiniAppFromQuery(title, description, topN=4)` embeds the query and computes cosine similarity against each block.
- Top‑N selection returns the most relevant set; logic blocks can be selected to enable behaviours but are not rendered.
- Reference: [code/apps/extension-chromium/src/beap/index.ts](code/apps/extension-chromium/src/beap/index.ts)

### Assembly Rules
- `assembleMiniApp(blocks)` assigns a runtime id and produces `{ id, blocks }`.
- Each mini‑app receives a scoped runtime state via `createRuntimeState(app.id)`.
- Reference: [code/apps/extension-chromium/src/beap/runtime.ts](code/apps/extension-chromium/src/beap/runtime.ts)

### Rendering Rules & UI Mapping
- Only blocks with `ui.kind` are rendered: `text/label`, `input`, `textarea`, `button`.
- `input`/`textarea`: honour `behaviour.onChange.action === 'state.set'` targeting the provided key (e.g., `textarea_value`).
- `button`: honour `behaviour.onClick.action === 'event.emit'` (e.g., `button_clicked`).
- Styling: clean card, labeled fields, hover effects, success toast for persistence.
- Reference: [code/apps/extension-chromium/src/beap/renderer.ts](code/apps/extension-chromium/src/beap/renderer.ts)

### Event & State Flow
- `emitEvent(evt)` scans all blocks for behaviours keyed as `onEvent:evt`.
- Supported actions:
  - `state.set`: copy/assign values within runtime state.
  - `state.persist`: write selected keys to `sessionStorage` via runtime helper.
- `createRuntimeState(namespace?)` returns `{ state, set, get, persist }` and persists under `beap_state_${namespace}`.
- Reference: [code/apps/extension-chromium/src/beap/runtime.ts](code/apps/extension-chromium/src/beap/runtime.ts)

### Persistence Model
- Storage: browser `sessionStorage` per mini‑app.
- Key: `beap_state_${appId}`.
- Example value (Notes): `{ "textarea_value": "My first note" }`.
- Success UI: a green confirmation message auto‑dismisses after ~3s.

### Error Handling & Instrumentation
- Console prefixes: `[BEAP]` for bootstrap, test handlers, module import, ranking results, and errors.
- UI fallback when no blocks selected: display user‑friendly message in the Test Frame.
- Reference: [code/apps/extension-chromium/src/content-script.tsx](code/apps/extension-chromium/src/content-script.tsx)

### Testing Hooks
- Builder Test and Edit Test frames dynamically import the BEAP orchestrator and render the selected mini‑app.
- Display top selections (block id, intent tags, truncated description, score).
- Validate Notes flow: textarea capture → save button → success message → sessionStorage updated.
- Reference: [code/apps/extension-chromium/src/content-script.tsx](code/apps/extension-chromium/src/content-script.tsx)

### Extensibility
- Add new Tier‑3 JSON blocks under Electron’s `tier3/` with appropriate `intent_tags`, `ui` config, and `behaviour` actions.
- To bundle JSON at build‑time, enable/adjust the glob in the loader.
- Renderer can be extended with new `ui.kind` mappings and styles.

### Comprehensive Sequence Diagram

```mermaid
sequenceDiagram
  participant U as User
  participant CS as Content Script
  participant IDX as beap/index.ts
  participant LDR as beap/loader.ts
  participant EMB as beap/embedding.ts
  participant RT as beap/runtime.ts
  participant RND as beap/renderer.ts
  participant DOM as Page DOM
  participant SS as sessionStorage

  U->>CS: Enter Title + Description
  CS->>IDX: createMiniAppFromQuery(title, description)
  IDX->>LDR: ensureBlocks() → load Tier‑3 blocks
  LDR-->>IDX: AtomicBlock[]
  IDX->>EMB: Embed blocks + query (deterministic)
  EMB-->>IDX: Block tensors + query tensor
  IDX->>IDX: Rank by cosineSimilarity; select topN
  IDX->>RT: assembleMiniApp(selectedBlocks)
  RT-->>IDX: MiniApp{id, blocks}
  IDX->>RND: renderMiniApp(app)
  RND->>RT: createRuntimeState(app.id)
  RND->>DOM: Build UI (label, textarea, button)
  U->>DOM: Type notes; click Save
  DOM->>RND: onChange/onClick events
  RND->>RT: set('textarea_value'); emit('button_clicked')
  RND->>RT: persist('textarea_value')
  RT->>SS: Write beap_state_${appId}
  RND->>DOM: Show success message
```

---

## Concrete Notes Panel Composition
- UI: `ui-label-v1`, `ui-textarea-v1`, `ui-button-v1`.
- Logic: `logic-state-set-v1` with `onEvent:button_clicked → state.persist`.
- Excluded by tags: `ui-text-input-v1` (title‑specific; not selected for notes‑only queries).
- Result: Three UI elements only (heading, textarea, save button), with durable session persistence for the current tab.

Generated: Dec 19, 2025