# Fine-Grained Governance Implementation Plan

## Step 1: Implementation Plan Summary

### Files to Change

| File | Change |
|------|--------|
| `electron/main/handshake/db.ts` | Add migration v19 (governance_json on context_blocks, context_store); add default_policy_json to handshakes |
| `electron/main/handshake/types.ts` | Add ContextItemGovernance, ContentType, Sensitivity, UsagePolicy, provenance types |
| `packages/shared/src/handshake/contextGovernance.ts` | New: shared governance types, defaults, inference logic |
| `electron/main/handshake/contextGovernance.ts` | New: resolveItemGovernance, inferFromLegacy |
| `electron/main/handshake/contextBlocks.ts` | Extend queryContextBlocks to return governance; add updateContextBlockGovernance |
| `electron/main/handshake/db.ts` | insertContextStoreEntry with governance; getContextStoreByHandshake returns governance |
| `electron/main/handshake/contextIngestion.ts` | Ingest with inferred governance |
| `electron/main/handshake/ipc.ts` | Pass governance when building blocks; add handshake:updateContextItemGovernance IPC |
| `electron/main/handshake/contextSyncEnqueue.ts` | Include governance in context_sync blocks (optional field for backward compat) |
| `electron/main/enforcement/authorizeToolInvocation.ts` | Add per-item policy check when tool targets specific blocks |
| `electron/main/handshake/contextEscaping.ts` | Filter blocks by local_ai_allowed before buildDataWrapper |
| `src/components/PolicyCheckboxes.tsx` | Reframe as "Default policy for newly attached context" |
| `src/components/HandshakeContextSection.tsx` | Per-item display with badges; edit action |
| `src/components/ContextItemEditor.tsx` | New: compact drawer for item-level policy edit |
| `src/components/RelationshipDetail.tsx` | Wire ContextItemEditor, pass governance to section |
| `src/components/HandshakeChatSidebar.tsx` | Filter blocks by local_ai_allowed before chat |
| `preload.ts` / `main.ts` | Add handshake:updateContextItemGovernance, handshake:getDefaultPolicy |

### Schema Changes

**Migration v19:**
- `context_blocks`: ADD COLUMN `governance_json TEXT`
- `context_store`: ADD COLUMN `governance_json TEXT`
- `handshakes`: ADD COLUMN `default_policy_json TEXT` (stores UsagePolicy as baseline for new items)

### IPC/API Changes

- `handshake:queryContextBlocks` — response includes `governance` per block (resolved or inferred)
- `handshake:updateContextItemGovernance` — (handshakeId, blockId, senderUserId, governance) → update context_blocks + context_store
- `handshake:getDefaultPolicy` — returns handshake default policy (from policy_selections + effective_policy)
- `handshake:updateDefaultPolicy` — updates default policy for new items (reuses policy_selections or new default_policy_json)
- `handshake:chatWithContext` — accepts optional blockIds filter; backend filters by local_ai_allowed

### Frontend Changes

- PolicyCheckboxes: label "Default policy for newly attached context"
- HandshakeContextSection: each item shows type, sensitivity, local/cloud AI, searchable, storage badges; Edit button opens ContextItemEditor
- ContextItemEditor: drawer with content_type, sensitivity, usage_policy toggles
- RelationshipDetail: passes defaultPolicy, onUpdateItemGovernance

### Enforcement Changes

- New: `resolveEffectiveGovernanceForItem(block, handshakeRecord)` — merges handshake default + item override
- authorizeToolInvocation: when request includes block_ids, check each block's governance
- buildDataWrapper / chat: filter blocks where governance.local_ai_allowed
- Semantic search: filter blocks where governance.searchable
- Export: filter blocks where governance.export_allowed
- Context sync: filter blocks where governance.transmit_to_peer_allowed (or use handshake-level for sync—sync is peer transmission)

### Migration/Compatibility Strategy

- Legacy items (governance_json IS NULL): infer via `inferGovernanceFromLegacy(block, handshakeRecord)`
- Inference rules: type→content_type, data_classification→sensitivity, effective_policy→usage_policy defaults, policy_selections→cloud_ai/internal_ai
- Mark inferred in governance: `inferred: true` flag so UI can show "defaults applied"
