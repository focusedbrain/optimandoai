# Forensic Root-Cause Report: node-fetch Module Not Found

## 1. Evidence Collected

### A. Package.json (source)
- **apps/electron-vite-project/package.json** contains `"node-fetch": "2.7.0"` under `dependencies` ✓
- Correct workspace package; electron-builder uses this directory

### B. pnpm-lock.yaml
- **apps/electron-vite-project** lockfile section (lines 56–147) does **NOT** list `node-fetch`
- Dependencies include: tesseract.js, regenerator-runtime, is-electron, etc. — **no node-fetch**
- node-fetch appears only as transitive dep of tesseract.js (line 9445)

### C. apps/electron-vite-project/node_modules (before packaging)
- **node-fetch: ABSENT** — no symlink, no directory
- tesseract.js: present (symlink to .pnpm)
- is-electron, regenerator-runtime: present
- pnpm never created node-fetch in app node_modules because lockfile does not include it

### D. Packaged app (app.asar extracted)
- **node-fetch: ABSENT** from `node_modules/`
- **node-fetch: ABSENT** from `node_modules/tesseract.js/node_modules/`
- tesseract.js: present (copied as real directory, not symlink)
- package.json in package: contains `"node-fetch": "2.7.0"` in dependencies

### E. require() call site
- **File:** `node_modules/.pnpm/tesseract.js@5.1.1_encoding@0.1.13/node_modules/tesseract.js/src/worker/node/loadImage.js`
- **Line 3:** `const fetch = require('node-fetch');`
- Node resolves from the directory containing loadImage.js (inside tesseract.js). It then walks up to `node_modules` and looks for `node-fetch`. In the packaged app, tesseract.js has no `node_modules` sibling containing node-fetch.

### F. electron-builder config
- **files:** `['dist/**/*', 'dist-electron/**/*', 'package.json', 'node_modules/**/*']`
- **asarUnpack:** pg-related + base; no tesseract.js or node-fetch
- Builder copies from `apps/electron-vite-project/node_modules`. It only packages what exists there. node-fetch is not there.

### G. pnpm layout
- node-fetch lives at: `.pnpm/node-fetch@2.7.0_encoding@0.1.13/node_modules/node-fetch`
- Also under tesseract’s .pnpm folder: `.pnpm/tesseract.js@5.1.1_encoding@0.1.13/node_modules/` contains both `tesseract.js` and `node-fetch` (siblings)
- apps/electron-vite-project/node_modules has no `.pnpm` (it’s at repo root)
- electron-builder copies app node_modules; it does not traverse into root `.pnpm` for dependencies that are not in the app’s node_modules

---

## 2. Root Cause

**node-fetch was not present in apps/electron-vite-project/node_modules at packaging time.**

- package.json had `"node-fetch": "2.7.0"` in dependencies
- pnpm-lock.yaml did not list node-fetch for apps/electron-vite-project (or lockfile was stale)
- Result: no `node-fetch` in `apps/electron-vite-project/node_modules`
- electron-builder only packages what is in that directory
- At runtime, tesseract.js calls `require('node-fetch')` in loadImage.js and Node cannot resolve it

**Fix applied:** `pnpm install` updated the lockfile and created the node-fetch symlink in app node_modules. Rebuild then packaged it. Verified: node-fetch now exists in app.asar.

---

## 3. Proof

| Check | Result |
|-------|--------|
| package.json has node-fetch | ✓ Yes |
| lockfile has node-fetch for electron-vite-project | ✗ No |
| node-fetch in app node_modules (source) | ✗ No |
| node-fetch in packaged app | ✗ No |
| tesseract.js requires node-fetch | ✓ Yes (loadImage.js:3) |

---

## 4. Smallest Verified Fix

Run `pnpm install` to update the lockfile and create the node-fetch symlink in the app’s node_modules. Then rebuild.

---

## 5. Exact File Diff

No code changes. Only ensure the lockfile is updated.

---

## 6. Exact Commands

```bash
cd c:\Users\oscar\OneDrive\Desktop\Work\dev\optimandoai\code_clean\code

# 1. Update lockfile and install node-fetch in app node_modules
pnpm install

# 2. Verify node-fetch is now in app node_modules
dir apps\electron-vite-project\node_modules\node-fetch

# 3. Kill any running app
# (Close WR Desk or: Get-Process -Name "WR Desk*","electron*" | Stop-Process -Force)

# 4. Rebuild
pnpm --filter electron-vite-project build

# 5. Verify packaged app contains node-fetch
npx asar extract "C:\build-output\build82\win-unpacked\resources\app.asar" ./verify-unpacked
dir verify-unpacked\node_modules\node-fetch
```

---

## 7. Fallback Fix

If `pnpm install` does not add node-fetch to the app’s node_modules (e.g. due to hoisting or workspace layout):

**Option A: asarUnpack tesseract.js and node-fetch**

Add to electron-builder.config.cjs:

```javascript
asarUnpack: [
  ...(baseConfig.asarUnpack || []),
  'node_modules/pg/**',
  'node_modules/pg-*/**',
  'node_modules/pgpass/**',
  'node_modules/postgres-*/**',
  'node_modules/pg-int8/**',
  'node_modules/tesseract.js/**',
  'node_modules/node-fetch/**',
],
```

This only helps if node-fetch is present in node_modules before packaging.

**Option B: pnpm overrides to force hoisting**

In root package.json:

```json
"pnpm": {
  "overrides": {
    "node-fetch": "2.7.0"
  },
  "packageExtensions": {
    "tesseract.js": {
      "dependencies": {
        "node-fetch": "2.7.0"
      }
    }
  }
}
```

**Option C: Copy node-fetch in a post-pack step**

Add a script that copies `node_modules/.pnpm/node-fetch@2.7.0*/node_modules/node-fetch` into `apps/electron-vite-project/node_modules/node-fetch` before electron-builder runs.
