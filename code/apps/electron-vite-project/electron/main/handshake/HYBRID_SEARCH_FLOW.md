# Hybrid Search — Request Processing Flow

When a user question arrives, structured lookup and semantic retrieval run **in parallel**. If structured returns a confident result, return immediately; otherwise send retrieved blocks to the LLM.

## Flow Diagram

```
User Question
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│  PARALLEL (Promise.all)                                      │
│                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────┐ │
│  │ 1. Structured Path   │    │ 2. Semantic Path           │ │
│  │                      │    │                             │ │
│  │ • queryClassifier()  │    │ • embed query               │ │
│  │   (sync, fast)       │    │ • search capsule_blocks     │ │
│  │ • if matched:        │    │ • cosine similarity         │ │
│  │   fetchBlocksFor     │    │ • top 5 blocks               │ │
│  │   StructuredLookup() │    │                             │ │
│  │ • structuredLookup() │    │                             │ │
│  └──────────────────────┘    └─────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
      │                                    │
      ▼                                    ▼
┌─────────────────────────────────────────────────────────────┐
│  DECISION                                                    │
│                                                              │
│  if (structured.found && structured.value)                  │
│    → return structured answer immediately (no LLM)          │
│  else                                                        │
│    → apply governance filter → build prompt → call LLM       │
└─────────────────────────────────────────────────────────────┘
```

## Pseudocode

```ts
async function processQuery(query, filter, embeddingService) {
  // 1. Classify (sync) — skip structured path if no match
  const classifierResult = queryClassifier(query)

  // 2. Run both paths in parallel
  const [structuredResult, semanticBlocks] = await Promise.all([
    runStructuredPath(db, query, filter, classifierResult),
    runSemanticPath(db, query, filter, embeddingService),
  ])

  // 3. Decision: structured confident → return immediately
  if (structuredResult?.found && structuredResult?.value) {
    return { mode: 'structured', answer: structuredResult.value, sources: [...] }
  }

  // 4. Fallback: semantic blocks → governance filter → LLM
  const filtered = applyGovernanceFilter(semanticBlocks, isCloud)
  const { systemPrompt, userPrompt } = buildRagPrompt(filtered, query)
  const answer = await callLLM(systemPrompt, userPrompt)
  return { mode: 'semantic', answer, sources: filtered }
}

async function runStructuredPath(db, query, filter, classifierResult) {
  if (!classifierResult.matched || !classifierResult.fieldPath) return null
  const blocks = fetchBlocksForStructuredLookup(db, filter, classifierResult.fieldPath)
  if (blocks.length === 0) return { found: false }
  return structuredLookup(blocks, classifierResult.fieldPath)
}

async function runSemanticPath(db, query, filter, embeddingService) {
  return semanticSearch(db, query, filter, 5, embeddingService)
}
```

## Requirements

| Requirement | Implementation |
|-------------|----------------|
| **Concurrency** | `Promise.all([structuredPath, semanticPath])` |
| **Minimize latency** | Both paths run in parallel; structured returns without LLM when confident |
| **Deterministic fallback** | Structured takes precedence when `found && value`; else semantic + LLM |

## Structured Fields

- `opening_hours.schedule`
- `contact.support.email`, `contact.support.phone`
- `contact.general.phone`, `contact.general.email`
- `company.name`, `company.headquarters`, `company.address`
