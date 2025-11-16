# 🚀 Development Startup Scripts

Quick startup scripts to run the Optimando development environment.

## Architecture Overview

```
┌─────────────────────────┐
│  Chrome Extension       │  ← Built with Vite (apps/extension-chromium)
│  (Frontend UI)          │     Runs in browser
└───────────┬─────────────┘
            │
            │ HTTP API calls to localhost:51248
            ↓
┌─────────────────────────┐
│  Electron Desktop App   │  ← Node.js app (apps/electron-vite-project)
│  (SQLite Backend)       │     Runs as native desktop app
└─────────────────────────┘
```

## 📜 Available Scripts

### Option 1: Quick Start (Electron Only)
```powershell
.\start-dev.ps1
```
- ✅ Starts Electron app in separate window
- ⏭️ You manually build extension later

### Option 2: Full Start (Electron + Build Extension)
```powershell
.\start-dev-full.ps1
```
- ✅ Starts Electron app in separate window
- ✅ Automatically builds Chrome extension
- 🎯 **Recommended for most development**

### Option 3: Custom Flags
```powershell
# Start Electron only (skip build)
.\start-dev-full.ps1 -ElectronOnly

# Start Electron and skip build
.\start-dev-full.ps1 -SkipBuild
```

## 📋 Manual Steps

If you prefer to run commands manually:

### 1. Start Electron Backend
```powershell
cd apps\electron-vite-project
npm run dev
```
Keep this terminal open - it runs the SQLite backend server.

### 2. Build Chrome Extension
```powershell
cd apps\extension-chromium
npm run build
```
Run this whenever you make changes to extension code.

### 3. Load Extension in Chrome
1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `apps/extension-chromium/dist/` folder

## 🔄 Development Workflow

### First Time Setup
```powershell
.\start-dev-full.ps1
```

### After Code Changes
```powershell
cd apps\extension-chromium
npm run build
```
Then reload extension in Chrome (`chrome://extensions/` → click reload)

### Restart Electron (if needed)
Close the Electron window and run:
```powershell
.\start-dev.ps1
```

## 🔍 Verify Everything is Running

### Check Electron API
Open in browser: http://127.0.0.1:51248/api/orchestrator/status

Should return:
```json
{
  "status": "ok",
  "database": "connected"
}
```

### Check Extension
1. Open Chrome DevTools on any page
2. Look for Optimando UI elements (side panel, reasoning panel, etc.)
3. Check console for `[getActiveAdapter] Using Orchestrator SQLite adapter`

## 🛠️ Troubleshooting

### "Cannot connect to Electron"
- ❌ Electron app not running
- ✅ Run `.\start-dev.ps1`

### "Extension not loading"
- ❌ Extension not built
- ✅ Run `cd apps\extension-chromium; npm run build`

### "Changes not appearing"
- ❌ Forgot to rebuild extension
- ✅ Run `npm run build` in extension folder
- ✅ Reload extension in `chrome://extensions/`

### "Port 51248 already in use"
- ❌ Electron already running
- ✅ Close existing Electron window
- ✅ Or kill process: `Stop-Process -Name electron -Force`

## 📁 Project Structure

```
code/
├── start-dev.ps1           ← Start Electron only
├── start-dev-full.ps1      ← Start Electron + Build extension
├── apps/
│   ├── electron-vite-project/
│   │   ├── electron/       ← Electron main process (SQLite backend)
│   │   └── package.json
│   └── extension-chromium/
│       ├── src/            ← Extension source code
│       ├── dist/           ← Built extension (load this in Chrome)
│       └── package.json
```

## 🎯 Quick Reference

| Task | Command |
|------|---------|
| **Start everything** | `.\start-dev-full.ps1` |
| **Start Electron only** | `.\start-dev.ps1` |
| **Build extension** | `cd apps\extension-chromium; npm run build` |
| **Check Electron API** | http://127.0.0.1:51248/api/orchestrator/status |
| **Reload extension** | Chrome → `chrome://extensions/` → Reload |

## 💡 Pro Tips

1. **Keep Electron running**: Start it once, leave it running all day
2. **Rebuild after changes**: Always `npm run build` after editing extension code
3. **Reload in Chrome**: Click reload in `chrome://extensions/` after building
4. **Check console**: Look for SQLite adapter messages to verify connectivity

---

**Happy coding! 🎉**




