# Inbox AI analysis — runtime audit report

**Status:** Logging only (no business-logic changes). **Runtime captures:** not executed in this environment — only the Cursor/agent workspace was available; the WR Desk Electron app, sandbox device, host device, DevTools, and main-process logs were not. Complete Sections A–C after you rebuild, run the test sequence, and paste or save `[INBOX_AUDIT]` lines from **renderer DevTools** and **main process** (Electron stdout / your usual main log).

**How to capture main-process logs:** Run the app from a terminal or enable whatever you already use so `console.log` from `ipc.ts` appears; filter that stream for `INBOX_AUDIT` alongside renderer console.

**Revert:** Grep the repo for `INBOX_AUDIT` and revert the listed files in one commit.

---

## Section A — Sandbox capture (one analysis run, end-to-end)

| Field | Value |
|--------|--------|
| Full system prompt | *Paste `analysis_prompt_built` → `systemPrompt_full` from sandbox main log* |
| User prompt (first 1000 + last 500 chars) | *Same object: `userPrompt_first1000`, `userPrompt_last500`, `userPrompt_length`* |
| Full model response | *`analysis_stream_complete` → `finalText_full` (note `finalText_truncated` if true)* |
| Validation outcome | *`analysis_validation` → `outcome`, `reason`, `parsed_keys`, `missing_keys` as applicable* |
| Renderer panel state after run | *Last `renderer_panel_state` for that `messageId` after loading finishes* |
| What the user actually sees | *Describe analysis panel (fields / banner / empty)* |

Ordered log sequence to collect (sandbox):

1. `[INBOX_AUDIT] analysis_prompt_built`
2. `[INBOX_AUDIT] analysis_stream_complete`
3. `[INBOX_AUDIT] analysis_validation` (accepted \| rejected)
4. Either `[INBOX_AUDIT] analysis_done_sent` **or** `[INBOX_AUDIT] analysis_error_sent`
5. Renderer: `[INBOX_AUDIT] renderer_analysis_subscribe` → `renderer_first_chunk` (if any chunk) → `renderer_stream_chunks_summary` → `renderer_done_parsed_ok` **or** `renderer_done_parse_failed` **or** `renderer_error_received` → `renderer_panel_state` updates

---

## Section B — Host capture

Same table and log sequence as Section A, on the host, ideally the same `messageId` and message type (native BEAP vs plain email).

---

## Section C — Diff (fill after both captures)

- **System prompts character-identical?** *Compare `systemPrompt_full` from both `analysis_prompt_built` logs.*
- **User prompts identical?** *Compare `userPrompt_length` and head/tail; middle not fully logged.*
- **Model responses** *Compare `finalText_full` / length / shape.*
- **Validation** *Pass vs fail each side (`analysis_validation.outcome`).*
- **Renderer** *`renderer_done_parsed_ok` vs `renderer_done_parse_failed` vs `renderer_error_received`; final `renderer_panel_state`.*

---

## Section D — Single most important finding

*To be determined from real `[INBOX_AUDIT]` lines — not from code review. Map to (i)–(v) from the investigation brief or describe a sixth path if needed.*

---

## Section E — What this rules out

*Populate only after captures. Examples: identical prompts rule out divergent templates; identical `finalText_full` on both sides rules out transport mangling; etc.*

---

## Section F — Shape of the next fix (one paragraph, no prompt text)

*After Section D: e.g. “the next fix should address X, evidenced by log lines Y” — no concrete patch or prompt wording.*

---

## Files touched (single revert commit)

| File | Purpose |
|------|---------|
| `electron/main/email/ipc.ts` | `analysis_prompt_built`, `analysis_stream_complete`, `analysis_validation` (in `assertMinimumAnalysisOutput`), `analysis_done_sent`, `analysis_error_sent` |
| `src/components/EmailInboxView.tsx` | `renderer_analysis_subscribe`, `renderer_first_chunk`, `renderer_stream_chunks_summary`, `renderer_done_parsed_ok` / `renderer_done_parse_failed`, `renderer_error_received`, `renderer_panel_state` (`useEffect`) |

All new lines are prefixed with `[INBOX_AUDIT]` for grep-based cleanup.
