# Cascading Transitive Dependency Fix (whatwg-url)

## Diagnosis

### Error
```
Error: Cannot find module 'whatwg-url'
```
Stack: `node_modules/node-fetch/index.js` → tesseract.js `loadImage.js` → `createWorker.js`

### Root Cause
- **node-fetch** is now present (fixed by adding it as a direct dependency).
- **whatwg-url** is a transitive dependency of node-fetch (`node-fetch` → `whatwg-url@5.0.0`).
- With pnpm's default **isolated** layout, transitive deps live in `.pnpm/<pkg>@<ver>/node_modules/`, not in the app's top-level `node_modules`.
- electron-builder copies from `apps/electron-vite-project/node_modules/**/*`. The app's `node_modules` contains `node-fetch` (symlink) but **not** `whatwg-url` — it lives only in `.pnpm/node-fetch@2.7.0_encoding@0.1.13/node_modules/whatwg-url`.
- When the packaged app runs, `node-fetch` does `require('whatwg-url')`. Node resolves from `node-fetch`'s directory; in the packaged app, there is no sibling `whatwg-url`, so resolution fails.

### Does asarUnpack Fix This?
**No.** `asarUnpack` only unpacks files that are **already in the asar**. The problem is that `whatwg-url` is never packaged — it is not in the app's `node_modules` at all. Unpacking `node-fetch` does not add `whatwg-url`; it only extracts `node-fetch` to `app.asar.unpacked/`.

### Does Unpacking node-fetch Alone Help?
Unpacking `node_modules/node-fetch/**` ensures node-fetch itself is outside the asar (useful for worker_threads or path resolution). It does **not** make `whatwg-url` resolvable, because `whatwg-url` is a separate package that must exist in the packaged `node_modules`.

---

## Fix Applied

### 1. asarUnpack (electron-builder.config.cjs)
Added unpack rules for:
- `node_modules/tesseract.js/**`
- `node_modules/node-fetch/**`

These ensure tesseract.js and node-fetch are extracted to `app.asar.unpacked/` for any asar-specific resolution or worker issues.

### 2. pnpm node-linker: hoisted (.npmrc)
Added at workspace root:
```
node-linker=hoisted
```

Creates a flatter layout; with pnpm workspaces, transitive deps may still land in root `node_modules` only.

### 3. Pre-build copy script (scripts/copy-pnpm-transitive-deps.cjs)
electron-builder rejects `from` paths starting with `..`, so FileSet copies from `.pnpm` fail. Instead, a script runs before `electron-builder` and copies from the pnpm store into `apps/electron-vite-project/node_modules/`:
- `whatwg-url`, `tr46`, `webidl-conversions`

The build script runs: `node scripts/copy-pnpm-transitive-deps.cjs && vite build && electron-builder ...`

### 4. whatwg-url as direct dependency (package.json)
Added `"whatwg-url": "^5.0.0"` so the lockfile includes it; the explicit copy ensures it is packaged.

---

## Exact Config Diff

### electron-builder.config.cjs
```diff
   asarUnpack: [
     ...
     'node_modules/pg-int8/**',
+    'node_modules/tesseract.js/**',
+    'node_modules/node-fetch/**',
+    'node_modules/whatwg-url/**',
+    'node_modules/tr46/**',
+    'node_modules/webidl-conversions/**',
   ],
   files: [
     ...
     'node_modules/**/*',
+    { from: '../../node_modules/.pnpm/whatwg-url@5.0.0/node_modules/whatwg-url', to: 'node_modules/whatwg-url', filter: ['**/*'] },
+    { from: '../../node_modules/.pnpm/whatwg-url@5.0.0/node_modules/tr46', to: 'node_modules/tr46', filter: ['**/*'] },
+    { from: '../../node_modules/.pnpm/whatwg-url@5.0.0/node_modules/webidl-conversions', to: 'node_modules/webidl-conversions', filter: ['**/*'] },
   ],
```

### .npmrc (new file at workspace root)
```
node-linker=hoisted
```

### package.json (apps/electron-vite-project)
```diff
+    "whatwg-url": "^5.0.0",
```

---

## Rebuild Commands

```powershell
# 1. Reinstall with hoisted layout (regenerates node_modules)
cd c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code
pnpm install

# 2. Rebuild native modules for Electron
cd apps\electron-vite-project
pnpm run rebuild:native

# 3. Build the app
pnpm run build
```

Output: `C:\build-output\build77\win-unpacked\WR DeskT.exe`

---

## Fallback if Build Still Fails

1. **Verify whatwg-url is in packaged node_modules**
   ```powershell
   npx asar extract "C:\build-output\build77\win-unpacked\resources\app.asar" ./app-unpacked
   dir app-unpacked\node_modules\whatwg-url
   dir app-unpacked\node_modules\tr46
   ```
   If missing, the FileSet copy may have failed (check path `../../node_modules/.pnpm/whatwg-url@5.0.0/`).

2. **Use shamefully-hoist** (if explicit copy fails)
   In `.npmrc`:
   ```
   node-linker=hoisted
   shamefully-hoist=true
   ```
   Then ensure electron-builder copies from monorepo root (e.g. set `project` or adjust `files` paths).

3. **Bundle node-fetch in the main process** (alternative)
   Configure Vite/rollup to bundle node-fetch (and whatwg-url) into the main process instead of loading from node_modules at runtime. Requires changing how tesseract.js is loaded.
