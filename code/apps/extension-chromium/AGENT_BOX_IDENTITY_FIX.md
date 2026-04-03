# Agent Box Identity Fix Implementation

## 1. Confirmed Bug

`session.agentBoxes` rows were upserted only by `identifier`, where `identifier` was defined as `AB{boxNumber}{agentNumber}`. In the display grid save path, changing the assigned AI agent recomputed `identifier`, so the background `findIndex` no longer matched the existing row and **appended** a second row. Hydration could then surface a stale duplicate or an inconsistent merge. The sidebar edit dialog used **`agentBox.boxNumber || 1`** as the last-resort default for the allocated-agent field, conflating **display port / box index** with **AI agent** assignment. Persistence is a single JSON blob per session in SQLite (`value_json`); the failure was **client-side merge identity**, not a missing DB column.

## 2. Files Changed

| File | Why |
|------|-----|
| `src/background.ts` | Stable keys (`stableAgentBoxKey`, `findAgentBoxIndexByStableKey`, `dedupeAgentBoxesByStableKey`); `SAVE_AGENT_BOX_TO_SQLITE` and `GRID_SAVE` upsert; dedupe on `GET_SESSION_FROM_SQLITE` (HTTP + Chrome fallback) and `SAVE_SESSION_TO_SQLITE` |
| `public/grid-script-v2.js` | Persisted `id` = `locationId`; `identifier` remains display-only `AB…`; optional `agentId` on `agentBox` |
| `src/content-script.tsx` | Labels “AI Agent”; edit form default removes `boxNumber` fallback; `updateAgentBox` syncs display `identifier` after allocation changes |

## 3. Exact Code Changes

### `background.ts`

- Added `stableAgentBoxKey(box)` — order: **`slot:{gridSessionId}:{gridLayout}:{slotId}`** (grid canonical), then `locationId`, then stable `id`, then `identifier` (legacy).
- Added `findAgentBoxIndexByStableKey(agentBoxes, incoming)` — match stable key first, then legacy `identifier`.
- Added `dedupeAgentBoxesByStableKey(agentBoxes)` — group by key, keep newest / most complete per group.
- **`SAVE_AGENT_BOX_TO_SQLITE`:** replace `identifier`-only `findIndex` with `findAgentBoxIndexByStableKey`; then `session.agentBoxes = dedupeAgentBoxesByStableKey(...)`.
- **`GRID_SAVE`:** same upsert + dedupe.
- **`GET_SESSION_FROM_SQLITE`:** dedupe `agentBoxes` on read (HTTP + Chrome fallback).
- **`SAVE_SESSION_TO_SQLITE`:** dedupe `session.agentBoxes` before `set`.

### `grid-script-v2.js`

- `newConfig.id` and `agentBox.id` use **`locationId`** (stable per slot), not `identifier`.
- `identifier` still `AB{box}{agent}` for on-screen labels only.
- `agentBox.agentId` set from `agent` string.

### `content-script.tsx`

- Add / Edit dialogs: label **“AI Agent”** (was “Agent Number” for those fields).
- Edit `#edit-agent-number` default: **`agentNumber > 0`**, or parse `agentId` / `model`, else **`''`** (no `boxNumber` fallback).
- `updateAgentBox`: after updates, if `boxNumber`/`number` and `agentNumber` are set, **`identifier = AB{box}{agent}`** for display/reference only.

## 4. Stable Identity Rule

**Canonical merge key for a persisted agent box (in order):**

1. **Display grid (same physical port):** `slot:{gridSessionId}:{gridLayout}:{slotId}` when all three are present.
2. **Else** `loc:{locationId}` when `locationId` is present (legacy / redundant with slot for grid).
3. **Else** `id:{id}` for sidebar boxes (stable `custom-…` uuid).
4. **Else** `idf:{identifier}` — legacy only; **not** authoritative when it encodes AI agent.

**`AB{boxNumber}{agentNumber}` is display/reference, not the merge key.**

## 5. Merge Logic Changes

- Upsert uses **`findAgentBoxIndexByStableKey`**: same grid slot → **same row updated**, even when `identifier` changes after an AI agent edit.
- After each merge path, **`dedupeAgentBoxesByStableKey`** removes duplicate rows left from older sessions.
- **GET** / **SAVE_SESSION** also run dedupe so loaded and saved sessions stay canonical.

## 6. Sidebar Default Fix

- Removed **`agentBox.boxNumber || 1`** from the edit template’s value expression for **AI Agent**.
- Empty / unset allocation now shows **empty** (with placeholder), not the box index.

## 7. Legacy Deduplication Handling

- Rows that share the same stable key (especially **`slot:`** for grid) are collapsed to one: **newer `timestamp` wins**, tie-break **more populated object keys**.
- Rows with no stable key fall back to per-index `orphan:{i}` so unrelated rows are not merged.
- Identifier-only legacy rows still group under `idf:` when no slot/`id` exists.

## 8. Manual Test Checklist

1. Open a display grid, set slot AI agent to **3**, Save, reload the grid tab → still **3** in modal and slot.
2. Change the same slot from **3 → 2**, Save → **one** row in session for that slot (inspect session JSON or count boxes with same `gridSessionId`+`layout`+`slotId`).
3. Sidebar **Edit Agent Box** on a master-tab box: set **AI Agent** to **2**, save, refresh → **2**; open edit again → must not show box index as agent when unset.
4. Two different slots in the same grid → editing one does not change the other’s `agentNumber`.
5. Master-tab box: change AI agent, confirm `identifier` in JSON updates to `AB{box}{agent}` but **id** stays the stable `custom-…` value.

## 9. Remaining Risks

- **Very old** `agentBoxes` entries with **no** `gridSessionId` / `gridLayout` / `slotId` / `locationId` / stable `id` still dedupe only by `identifier` or `orphan:{i}`; rare manual cleanup may be needed.
- Callers that pass **`agentBoxId`** equal only to an old **AB…** string may need to pass **`locationId`** or **`id`** if routing is updated elsewhere (output update paths still accept `identifier`).
