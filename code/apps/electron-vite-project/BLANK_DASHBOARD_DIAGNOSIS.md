# Blank Dashboard in Linux AppImage — Diagnosis Report

## Findings

| Check | Result |
|-------|--------|
| **D1: Renderer files in AppImage** | *Not testable* — No AppImage found at `dist/release/WR Desk™-0.0.0.AppImage`. Release folder only contains `builder-debug.yml`. Build the AppImage first to inspect. |
| **D2: dist-electron contents** | `main.js`, `preload.mjs`, `main-D3EytrkH.js` (bundle), and chunks. **dist/** has `index.html`, `assets/index-*.js`, `assets/index-*.css`, `wrdesk-logo.png` ✓ |
| **D3: Main process loads** | `O.loadFile(n)` where `n = path.join(RENDERER_DIST, 'index.html')`. `RENDERER_DIST = path.join(APP_ROOT, 'dist')`, `APP_ROOT = path.join(__dirname, '..')` |
| **D4: Builder includes renderer** | **Yes** — `electron-builder.json` files: `["dist/**/*", "dist-electron/**/*", "package.json"]`. `builder-debug.yml` shows `!dist/release{,/**/*}` (output dir excluded) ✓ |
| **D5: Vite base path** | **`base: './'`** — Set in `vite.config.ts`. Built `index.html` uses `./assets/index-*.js` ✓ |
| **D6: Dev mode works** | *Not testable* — Electron binary failed to install (`delete node_modules/electron and try installing again`). Run `pnpm install` or `npm run postinstall` to fix. |

---

## Root Cause Analysis

Configuration appears correct:

- Renderer output (`dist/index.html`, `dist/assets/*`) exists and uses relative paths (`./`).
- electron-builder packs `dist/**/*` and `dist-electron/**/*`; `dist/release` is excluded.
- Main process loads `index.html` from `RENDERER_DIST` (derived from `__dirname`).

**Most likely causes of a blank page in packaged AppImage:**

1. **Path resolution when running from AppImage** — AppImage extracts to `/tmp/.mount_*`. `__dirname` inside `app.asar` may resolve differently; `loadFile` might receive a path Electron cannot resolve.
2. **Preload script path** — `preload: path.join(__dirname, 'preload.mjs')` may fail if `__dirname` is wrong in the packaged context.
3. **Sandbox / CSP** — `sandbox: true` and default CSP might block script execution or module loading in `file://` context.

---

## Fix

### 1. Use `app.getAppPath()` when packaged — **IMPLEMENTED**

In `electron/main.ts`, the production load now uses `app.getAppPath()` when packaged:

```ts
const indexPath = app.isPackaged
  ? path.join(app.getAppPath(), 'dist', 'index.html')
  : path.join(RENDERER_DIST, 'index.html')
win.loadFile(indexPath)
```

### 2. Exclude `dist/release` from `files` (belt-and-suspenders)

`builder-debug.yml` already excludes it, but add to `electron-builder.json` for clarity:

```json
"files": [
  "dist/**/*",
  "!dist/release/**",
  "dist-electron/**/*",
  "package.json"
]
```

### 3. Debug with `--enable-devtools`

Run the AppImage with DevTools to see console errors:

```bash
./"WR Desk™-0.0.0.AppImage" --enable-devtools
```

### 4. Reinstall Electron for dev testing

```bash
cd code/apps/electron-vite-project
rm -rf node_modules/electron
pnpm install
# or: npm run postinstall
npm run dev
```

---

## Next Steps

1. Build the AppImage: `npm run build` (or `vite build && electron-builder -c electron-builder.config.cjs`).
2. Extract and inspect: `./"WR Desk™-0.0.0.AppImage" --appimage-extract` then `ls squashfs-root/resources/`.
3. Run with DevTools: `./"WR Desk™-0.0.0.AppImage" --enable-devtools` and check the Console.
4. Apply Fix 1 if paths are wrong when packaged.
