# WR Desk logo assets

- **`wrdesk-logo.svg`** — Source vector (shield, WR / DESK, briefcase). Edit this, not random PNGs.
- **`wrdesk-logo.png`** — Raster for Electron (tray, window icon, OAuth loopback HTML) and the Chromium extension (`<img>`). **Do not** replace this with a UI screenshot.

Regenerate PNG from SVG after editing:

```bash
cd apps/electron-vite-project
pnpm run logo:png
```

This updates both `apps/electron-vite-project/public/wrdesk-logo.png` and `apps/extension-chromium/public/wrdesk-logo.png`.
