# node-fetch Module Not Found — Root-Cause Diagnosis & Fix Plan

## 1. Root-Cause Identification

**Most likely root cause: Indirect dependency not packaged correctly with pnpm + electron-builder**

| Hypothesis | Likelihood | Evidence |
|------------|------------|----------|
| Missing dependency in package.json | **High** | `node-fetch` is only a transitive dep of `tesseract.js`; not declared in electron-vite-project |
| pnpm layout + electron-builder packaging | **High** | pnpm uses `.pnpm` store; `node-fetch` lives under `tesseract.js`'s nested node_modules; electron-builder `files: ['node_modules/**/*']` may not preserve resolution paths |
| ESM/CommonJS incompatibility | **Low** | Error is "Cannot find module", not "require() of ES Module"; tesseract.js uses `require('node-fetch')`; lockfile shows node-fetch@2.7.0 (CommonJS) |
| Version mismatch | **Low** | tesseract.js@5.1.1 → node-fetch@2.7.0; both compatible |
| Bundler externalization | **N/A** | tesseract.js is externalized; it loads at runtime from node_modules, so bundler does not touch node-fetch |

**Conclusion:** `node-fetch` is required by `tesseract.js` (via `loadImage.js` → `createWorker.js` → `index.js`) for fetching language data and images. It is an indirect dependency. With pnpm's strict `node_modules` layout, it resides at `node_modules/.pnpm/tesseract.js@5.1.1(encoding@0.1.13)/node_modules/node-fetch/` and is not hoisted to a path that Node's `require()` can resolve when the app runs from inside `app.asar`.

---

## 2. Why This Happens in Packaged Electron Apps

1. **tesseract.js is externalized** in `vite.config.ts` — it is not bundled; it is loaded at runtime via `require('tesseract.js')` from the main process.

2. **tesseract.js uses `require('node-fetch')`** in `loadImage.js` (and related code) to fetch images and language data from URLs (e.g. CDN).

3. **pnpm layout:** pnpm installs dependencies in `.pnpm` and uses symlinks. `node-fetch` is installed as a dependency of `tesseract.js` at:
   ```
   node_modules/.pnpm/tesseract.js@5.1.1(encoding@0.1.13)/node_modules/node-fetch/
   ```
   Node's `require('node-fetch')` from inside `tesseract.js` resolves relative to `tesseract.js`'s location. In development, the symlink structure works. In the packaged app, electron-builder copies `node_modules/**/*` into `app.asar`. The resolution path can break if:
   - `.pnpm` is not fully copied
   - Symlinks are not preserved or dereferenced incorrectly
   - The packaged structure differs from the dev structure

4. **"Cannot find module"** means Node's module resolver could not find `node-fetch` at the expected path when `tesseract.js` calls `require('node-fetch')`.

---

## 3. Verification Steps

### Step 1: Inspect package.json
```bash
cd apps/electron-vite-project
grep -E "node-fetch|tesseract" package.json
```
- **Expected:** `tesseract.js` present; `node-fetch` absent (indirect only).

### Step 2: Inspect lockfile
```bash
pnpm why node-fetch
# or
grep -A2 "node-fetch" pnpm-lock.yaml
```
- **Expected:** `node-fetch` only under `tesseract.js` dependencies.

### Step 3: Inspect packaged app contents
```bash
# Extract app.asar (use asar tool from npm)
npx asar extract "C:\build-output\build55\win-unpacked\resources\app.asar" ./app-unpacked

# Check for node-fetch
dir app-unpacked\node_modules\node-fetch /s
dir app-unpacked\node_modules\.pnpm\node-fetch* /s
dir app-unpacked\node_modules\tesseract.js\node_modules\node-fetch /s
```
- **Expected:** If `node-fetch` is missing or not under a path Node can resolve from `tesseract.js`, that confirms the cause.

### Step 4: Identify which dependency requires node-fetch
```bash
grep -r "node-fetch" node_modules/tesseract.js --include="*.js" | head -5
```
- **Expected:** `loadImage.js` or similar does `require('node-fetch')` or `require("node-fetch")`.

### Step 5: Check node-fetch version (v2 vs v3)
```bash
cat node_modules/tesseract.js/node_modules/node-fetch/package.json | grep -E '"type"|"main"|"exports"'
# or with pnpm:
cat node_modules/.pnpm/node-fetch@2.7.0*/node_modules/node-fetch/package.json
```
- **v2:** `"main": "lib/index.js"` or similar, no `"type": "module"` → CommonJS, `require()` works.
- **v3:** `"type": "module"` → ESM-only, `require()` throws. Your error would then be different; "Cannot find module" suggests the module is not found at all, not an ESM load error.

---

## 4. Fix Options (Priority Order)

| Fix | Pros | Cons |
|-----|------|------|
| **1. Add node-fetch@2 as direct dependency** | Minimal change; ensures it's packaged; CommonJS compatible | Extra direct dep for a transitive need |
| **2. Unpack tesseract.js + node-fetch from asar** | Preserves exact node_modules layout | Larger unpacked footprint; more config |
| **3. Use pnpm `node-linker: hoisted`** | Flatter node_modules, easier packaging | Affects monorepo; may change other resolutions |
| **4. Replace node-fetch with global fetch** | Node 18+ has `fetch`; no extra dep | Requires patching tesseract.js; may break on older Node |
| **5. Pin tesseract.js version** | Avoids future dep changes | Does not fix current packaging; node-fetch still needed |
| **6. Move OCR to renderer** | Different module resolution context | Major refactor; workers/comms complexity |

---

## 5. Concrete Code/Config Examples

### Fix 1: Add node-fetch@2 (recommended)

**package.json:**
```json
{
  "dependencies": {
    "node-fetch": "^2.7.0",
    "tesseract.js": "^5.1.1"
  }
}
```

**Why v2:** tesseract.js uses `require('node-fetch')`. node-fetch v3 is ESM-only; `require()` fails. v2 is CommonJS.

### Fix 2: asarUnpack for tesseract.js

**electron-builder.config.cjs:**
```javascript
asarUnpack: [
  'node_modules/pg/**',
  'node_modules/tesseract.js/**',
  'node_modules/node-fetch/**',
],
```

### Fix 3: pnpm hoisted layout (root .npmrc)

```
node-linker=hoisted
```

### Fix 4: Patch tesseract.js (not recommended)

Would require maintaining a patch that replaces `require('node-fetch')` with `globalThis.fetch` or a custom implementation. Fragile and high maintenance.

---

## 6. Most Likely Fix Based on Stack Trace

The stack shows:
- `loadImage.js` → `createWorker.js` → `tesseract.js/index.js`
- Error: `Cannot find module 'node-fetch'`

So `node-fetch` is required by tesseract.js and is not resolvable in the packaged app. The most likely fix is **Fix 1: add `node-fetch@2` as a direct dependency** so it is installed and packaged in a way Node can resolve.

---

## 7. Minimal Recommended Fix

**Add to `apps/electron-vite-project/package.json`:**

```json
"node-fetch": "^2.7.0",
```

Then:
```bash
pnpm install
# Kill any running WR Desk process
pnpm --filter electron-vite-project build
```

Run from: `C:\build-output\build55\win-unpacked\WR DeskT.exe`

---

## 8. Clean Long-Term Fix

1. **Short term:** Add `node-fetch@^2.7.0` as a direct dependency (as above).

2. **Optional hardening:** Add to `asarUnpack` if resolution still fails:
   ```javascript
   'node_modules/tesseract.js/**',
   'node_modules/node-fetch/**',
   ```

3. **Future:** When tesseract.js drops `node-fetch` or switches to `fetch`, remove the direct dependency. Until then, pin `node-fetch@2` to avoid v3 (ESM-only).
