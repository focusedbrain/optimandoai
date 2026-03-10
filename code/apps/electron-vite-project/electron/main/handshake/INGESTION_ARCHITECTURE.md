# Ingestion & Retrieval Architecture

## Pipeline Overview

```
Capsule ingestion
  → cryptographic verification (context_commitment, block_hash)
  → block extraction (contextIngestion → context_blocks)
  → text normalization (blockExtraction)
  → embeddings (capsuleBlockIndexer)
  → searchable index (capsule_blocks)
  → retrieval during queries (semanticSearch, hybridSearch)
```

The cryptographic proof chain remains intact. Embeddings are derived artifacts and do not alter the original capsule hash.

---

## Block Extraction Rules

### 1. Deterministic Vault Profiles

Structured fields (company, contact, opening_hours, services, departments) are formatted deterministically for predictable embeddings.

**Example input:**
```json
{
  "schedule": {
    "monday": "09:00-18:00",
    "tuesday": "09:00-18:00",
    "wednesday": "09:00-18:00",
    "thursday": "09:00-18:00",
    "friday": "09:00-17:00",
    "saturday": "closed",
    "sunday": "closed"
  }
}
```

**Generated block:**
```
block_id: opening_hours.schedule
text:
Opening hours:
Monday 09:00-18:00
Tuesday 09:00-18:00
Wednesday 09:00-18:00
Thursday 09:00-18:00
Friday 09:00-17:00
Saturday closed
Sunday closed

metadata:
  source_path: context_blocks.opening_hours.schedule
  chunk_index: 0
  parent_block_id: opening_hours.schedule
```

### 2. Large Unstructured Attachments

Documents (manuals, PDFs, long text) are chunked at 500–800 tokens, preserving paragraph/sentence boundaries.

**Example blocks:**
```
block_id: user_manual.section_3.chunk_0
text: (first 600 tokens of section 3)
source_path: context_blocks.user_manual.section_3
chunk_index: 0

block_id: user_manual.section_3.chunk_1
text: (next 600 tokens)
source_path: context_blocks.user_manual.section_3
chunk_index: 1
```

### 3. Context Graph Nodes (future)

When `context_nodes` references exist, generate a block per node:
```
block_id: node_hours
text: Opening Hours information for ExampleTech Solutions GmbH.
source_path: context_graph.node_hours
```

---

## Index Storage Schema (capsule_blocks)

| Column | Type | Description |
|--------|------|-------------|
| block_id | TEXT | Unique block identifier (e.g. `opening_hours.schedule` or `user_manual.section_3.chunk_2`) |
| capsule_id | TEXT | Capsule identifier (= handshake_id for handshake scope) |
| handshake_id | TEXT | Handshake ID |
| relationship_id | TEXT | Relationship ID |
| block_type | TEXT | company, contact, opening_hours, services, user_manual, manual, other |
| title | TEXT | Human-readable title |
| text | TEXT | Indexed text content |
| embedding | BLOB | Vector embedding |
| source_path | TEXT | Traceability path (e.g. `context_blocks.opening_hours.schedule`) |
| chunk_index | INTEGER | 0 for single blocks; 0,1,2... for chunks |
| parent_block_id | TEXT | Originating block_id (for governance join) |
| block_hash | TEXT | Content hash (deterministic for chunks) |
| source | TEXT | received \| sent |
| created_at | TEXT | ISO timestamp |

---

## Traceability

Every embedded block is traceable to its handshake capsule:

```json
{
  "block_id": "user_manual.section_3.chunk_2",
  "capsule_id": "cg_demo_001",
  "handshake_id": "hs-1c2c70aa",
  "relationship_id": "rel-xyz",
  "source_path": "context_blocks.user_manual.section_3",
  "chunk_index": 2
}
```

---

## Retrieval Flow

1. Identify active handshake (from scope: `hs-xxx` or `rel-xxx`)
2. Restrict search to `capsule_blocks` where `handshake_id` matches
3. Vector search retrieves top 3–5 blocks by cosine similarity
4. Retrieved blocks are passed to the LLM with `[block_id: X]` citations
5. Response includes source reference: `capsule_id: X, block: Y`

---

## Migration Strategy

### For existing capsules (pre-v23)

1. **Schema migration v23** runs automatically at startup:
   - Adds `source_path`, `chunk_index`, `parent_block_id`
   - Backfills existing rows: `parent_block_id = block_id`, `source_path = 'context_blocks.' || block_id`

2. **Optional full re-index** (for large docs that need chunking):
   ```ts
   import { reindexHandshakeCapsule } from './capsuleBlockIndexer'
   await reindexHandshakeCapsule(db, handshakeId, relationshipId, embeddingService)
   ```
   This clears `capsule_blocks` for the handshake and rebuilds with the new extraction (including chunking).

3. **Backfill new handshakes** (blocks ingested before capsule_blocks existed):
   ```ts
   import { backfillCapsuleBlocks } from './capsuleBlockIndexer'
   await backfillCapsuleBlocks(db, embeddingService, 20)
   ```
