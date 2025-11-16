# Headless Service Fix - Complete Guide

## Problem
The Electron app was opening visible windows on startup (both manual and auto-start), instead of running as a headless background service.

## Root Cause
The `--hidden` flag wasn't being passed to Electron during development because:
1. **Vite Plugin**: The `vite-plugin-electron` was launching Electron without any arguments
2. **PowerShell Scripts**: Were trying to pass `--hidden` via `npm run dev -- --hidden`, but this doesn't work with Vite
3. **Auto-start**: Was configured correctly but only applied when app starts on login, not during manual development runs

## Solutions Implemented

### 1. Vite Configuration (`apps/electron-vite-project/vite.config.ts`)

Added `onstart` hook to automatically pass `--hidden` flag to Electron:

```typescript
electron({
  main: {
    entry: 'electron/main.ts',
    // ... other config ...
    onstart(args) {
      if (!args.startup.includes('--hidden')) {
        args.startup.push('--hidden')
      }
    },
  },
  // ... rest of config
})
```

**This is the key fix** - it ensures Electron always starts with `--hidden` flag in development mode.

### 2. Main Process Detection (`apps/electron-vite-project/electron/main.ts`)

Added logging to verify the flag is being detected:

```typescript
const isHidden = process.argv.includes('--hidden')
console.log('[MAIN] ===== STARTUP MODE =====')
console.log('[MAIN] Process arguments:', process.argv)
console.log('[MAIN] Hidden mode:', isHidden ? 'ENABLED' : 'DISABLED')
```

Window creation respects the flag:

```typescript
win = new BrowserWindow({
  show: !isHidden,  // Don't show if hidden
  // ...
})

// Extra safety: hide after loading
if (isHidden) {
  win.hide()
}
```

### 3. System Tray Updates

Tray menu now shows dynamic "Show/Hide Window" toggle:

```typescript
{ 
  label: win?.isVisible() ? 'Hide Window' : 'Show Window', 
  click: () => { 
    if (win.isVisible()) {
      win.hide()
    } else {
      win.show()
      win.focus()
    }
    setTimeout(() => updateTrayMenu(), 100)
  } 
}
```

### 4. Legacy App Disabled (`apps/desktop/main.js`)

Disabled auto-start for the old desktop app to prevent conflicts:

```javascript
// Auto-start disabled - this is the legacy desktop app
// The main app is in apps/electron-vite-project
```

### 5. HTTP API Endpoints

Added window control endpoints:
- `GET /api/window/status` - Check window visibility
- `POST /api/window/show` - Show window
- `POST /api/window/hide` - Hide window

### 6. Chrome Extension DevTools Component

Created `DevTools.tsx` component in extension sidebar:
- Real-time connection status (checks every 5 seconds)
- Window visibility indicator
- Show/Hide buttons
- Restart service button
- Toast notifications

## How to Test

### Step 1: Stop All Running Instances
```powershell
# Kill all Electron processes
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Stop-Process -Force
```

### Step 2: Start the App
```powershell
# Option A: Full startup script
.\start-dev-full.ps1

# Option B: Simple startup script
.\start-dev.ps1

# Option C: Manual
cd apps\electron-vite-project
npm run dev
```

### Step 3: Verify Headless Mode
```powershell
# Run verification script
.\verify-headless.ps1
```

### Step 4: Check Console Output

Look for this in the Electron console:
```
[MAIN] ===== STARTUP MODE =====
[MAIN] Process arguments: [..., '--hidden']
[MAIN] Hidden mode: ENABLED (--hidden flag detected)
```

### Step 5: Test Controls

**Via System Tray:**
1. Look for app icon in system tray (bottom-right on Windows)
2. Right-click the icon
3. Select "Show Window" or "Hide Window"

**Via Chrome Extension:**
1. Open Chrome extension sidepanel
2. Scroll to "Dev Tools" section (below Backend Configuration)
3. See connection status and window status
4. Click "Show" or "Hide" button

## Troubleshooting

### Window Still Shows on Startup

**Check 1: Verify Vite Config**
```powershell
cat apps\electron-vite-project\vite.config.ts | Select-String "onstart"
```
Should show the `onstart` hook with `--hidden` flag.

**Check 2: Check Console Output**
Look for `[MAIN] Hidden mode: ENABLED` in the Electron terminal window.

**Check 3: Clear Node Modules**
```powershell
cd apps\electron-vite-project
rm -Recurse -Force node_modules
npm install
npm run dev
```

### Multiple Windows Opening

**Problem:** Both old and new Electron apps are auto-starting.

**Solution:**
1. Press `Win + I` → **Apps** → **Startup**
2. Disable all **"OpenGiraffe"** entries
3. Uninstall old app: **Apps** → **Installed Apps** → Find "OpenGiraffe" → Uninstall
4. Restart computer
5. The current app will auto-start correctly on next login

### Vite Window Still Visible

**Note:** The Vite dev server terminal window will still be visible - this is normal!
- The **Vite terminal** stays open (for logs and hot-reload)
- The **Electron window** should be hidden (the actual app UI)

These are two separate things:
- ✅ Vite terminal window = visible (expected)
- ✅ Electron app window = hidden (headless mode)

### API Not Responding

```powershell
# Check if port is in use
netstat -ano | findstr :51248

# Test API manually
Invoke-RestMethod -Uri "http://127.0.0.1:51248/api/window/status"
```

## Auto-Start Configuration

### Current Setup
- **Development:** Starts hidden automatically (via vite.config.ts)
- **Production/Login:** Starts hidden automatically (via setLoginItemSettings)

### To Disable Auto-Start on Login
Edit `apps/electron-vite-project/electron/main.ts` line 539:
```typescript
app.setLoginItemSettings({ openAtLogin: false })  // Change true to false
```

### To Show Window on Startup
Edit `apps/electron-vite-project/vite.config.ts` line 22:
```typescript
onstart(args) {
  // Comment out or remove this function to show window
}
```

## Files Modified

1. ✅ `apps/electron-vite-project/vite.config.ts` - Added `onstart` hook
2. ✅ `apps/electron-vite-project/electron/main.ts` - Added logging, window control
3. ✅ `apps/desktop/main.js` - Disabled auto-start
4. ✅ `start-dev-full.ps1` - Updated messaging (no longer passes --hidden manually)
5. ✅ `start-dev.ps1` - Updated messaging (no longer passes --hidden manually)
6. ✅ `apps/extension-chromium/src/components/DevTools.tsx` - New component
7. ✅ `apps/extension-chromium/src/sidepanel.tsx` - Added DevTools component

## Additional Resources

- **Verify Script:** `verify-headless.ps1` - Quick check if headless mode is working
- **Auto-start Fix:** `AUTOSTART_FIX.md` - Guide to fix duplicate auto-starts
- **Extension DevTools:** Access via Chrome extension sidepanel

## Expected Behavior

### On Manual Start (`npm run dev`)
✅ Vite terminal window opens (visible)
✅ Electron app window stays hidden
✅ System tray icon appears
✅ HTTP API starts on port 51248
✅ WebSocket server starts on port 51247

### On Computer Login (Auto-start)
✅ App starts automatically
✅ Window stays hidden
✅ System tray icon appears
✅ No visible windows (true headless service)

### Window Control
✅ Show/Hide via system tray
✅ Show/Hide via Chrome extension
✅ HTTP API endpoints work
✅ Tray menu updates dynamically



