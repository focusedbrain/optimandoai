# Capsule Import-Time Indexing

All indexing (parse, extract, embed, store) happens during capsule import. At query time, only `capsule_blocks` is searched — no capsule parsing.

## Database Schema: `capsule_blocks`

```sql
CREATE TABLE capsule_blocks (
  block_id TEXT NOT NULL,
  capsule_id TEXT NOT NULL,
  block_type TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  model_id TEXT NOT NULL,
  handshake_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('received','sent')),
  block_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (capsule_id, block_id, block_hash)
);
```

Indexes: `capsule_id`, `handshake_id`, `relationship_id`, `block_type`.

## Capsule Import Flow

1. **Receive** capsule (.beap, context_sync, etc.)
2. **Parse** context graph via `ingestContextBlocks`
3. **Extract** blocks: company, contact, opening_hours, services, user_manual sections
4. **Generate** embeddings for each block
5. **Store** in `capsule_blocks` (fire-and-forget after tx commit)

## Indexer: `capsuleBlockIndexer.ts`

- `indexCapsuleBlocks(db, handshakeId, relationshipId, embeddingService)` — indexes blocks not yet in `capsule_blocks`
- `backfillCapsuleBlocks(db, embeddingService)` — indexes existing `context_blocks` after migration

## Query Time

- `semanticSearch` prefers `capsule_blocks`; falls back to `context_blocks` + `context_embeddings` when empty
- No parsing at query time; only cosine similarity over pre-computed embeddings

## Block Types

Derived from `block_id` prefix: `company`, `contact`, `opening_hours`, `services`, `user_manual`, `manual`, `other`.
