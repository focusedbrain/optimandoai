# @repo/ingestion-core

Portable BEAP ingestion and validation. **Zero dependencies** on Electron, DB, or app state.

Can run in:
- Electron main process
- child_process (local VM relay)
- Standalone Node.js service (remote relay)
- Docker container

## Dependencies

- **Node.js built-in only:** `crypto`, `Buffer`
- **No external deps** — no Electron, better-sqlite3, or app-specific modules

## Usage

```ts
import { validateInput, ingestInput, validateCapsule } from '@repo/ingestion-core';

// Full pipeline: raw input → validated + distribution
const result = validateInput(
  { body: JSON.stringify(capsule) },
  'p2p',
  {}
);

// Individual steps
const candidate = ingestInput(rawInput, 'email', transportMeta);
const validation = validateCapsule(candidate);
```

## Build & Test

```bash
pnpm install
pnpm run build
pnpm test
```
