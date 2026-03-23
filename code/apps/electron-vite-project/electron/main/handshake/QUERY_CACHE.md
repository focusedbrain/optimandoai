# RAG Query Cache

Caches frequently asked questions to reduce latency for repeated queries.

## Cache Key

`capsule_id` + `normalized_query`

- **capsule_id**: `handshake_id` when scope is `hs-*`, or `rel:{relationship_id}` when scope is `rel-*`
- **normalized_query**: trim, lowercase, collapse whitespace to single space

## Cache Value

```ts
{
  answer: string
  sources: Array<{ handshake_id, block_id, source, score }>
  timestamp: string  // ISO
}
```

## Policy

- **TTL**: 24 hours
- **Invalidation**: When capsule changes (context blocks ingested, blocks deleted, handshake revoked)

## Example Cached Queries

- "opening hours" → `opening_hours.schedule`
- "support email" → `contact.support.email`
- "company location" → `company.address` / `company.headquarters`

## When Cache Is Used

Cache is only consulted when scope is cacheable:
- `hs-{handshakeId}` — cache per handshake
- `rel-{relationshipId}` — cache per relationship
- `all`, `context-graph`, `capsules`, `attachments` — no cache (scope too broad)

## Integration

1. **Lookup**: At start of `chatWithContextRag`, before hybrid search
2. **Store**: After successful answer (structured or semantic path)
3. **Invalidate**: In `ingestContextBlocks`, `markContextBlocksInactiveByHandshake`, `deleteBlocksByHandshake`
