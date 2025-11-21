# Auto-Start Fix for Headless Service

## Problem
Two Electron apps were configured to auto-start on Windows login:
1. **Legacy app** (`apps/desktop`) - older standalone version
2. **Current app** (`apps/electron-vite-project`) - Vite-based version with all features

Both were opening windows on startup instead of running as headless services.

## Solution Applied

### 1. Disabled Auto-Start for Legacy App
The `apps/desktop/main.js` file has been updated to disable auto-start. This prevents the old app from launching on startup.

### 2. Already Configured: Current App Auto-Start
The `apps/electron-vite-project/electron/main.ts` is already configured to:
- Auto-start on Windows/macOS login with `--hidden` flag
- Start as a headless service (window hidden)
- Show/hide via system tray or extension DevTools

## Manual Steps Required

### For Windows Users:

If the old app was previously installed and is still auto-starting, you need to disable it manually:

#### Option 1: Using Windows Settings (Recommended)
1. Press `Win + I` to open Settings
2. Go to **Apps** → **Startup**
3. Look for **"OpenGiraffe"** entries
4. Disable the older one (check the file path to identify which is which)
5. Keep only the one from `electron-vite-project` enabled

#### Option 2: Using Task Manager
1. Press `Ctrl + Shift + Esc` to open Task Manager
2. Go to the **Startup** tab
3. Find **"OpenGiraffe"** entries
4. Right-click and **Disable** the old/duplicate entry

#### Option 3: Using Registry (Advanced)
1. Press `Win + R`, type `regedit`, and press Enter
2. Navigate to: `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`
3. Look for **"OpenGiraffe"** entries
4. Delete the old/duplicate entry (backup first!)

#### Option 4: Uninstall Old App
1. Go to **Settings** → **Apps** → **Installed Apps**
2. Find the old **"OpenGiraffe"** installation
3. Uninstall it
4. Keep only the current version

### Verify the Fix

After applying the fix:
1. **Restart your computer**
2. Check that only **ONE** Electron window appears (and it should be hidden)
3. Look for the **system tray icon** (if visible, the app is running)
4. Open the Chrome extension and check the **Dev Tools** section to see connection status

## Current App Configuration

The current app (`apps/electron-vite-project`) is configured to:
- ✅ Auto-start with `--hidden` flag
- ✅ Window starts hidden (headless mode)
- ✅ System tray shows "Show/Hide Window" toggle
- ✅ Extension DevTools panel allows remote window control
- ✅ Vite dev server runs for hot-reload (in development mode)

## Troubleshooting

### Both apps still starting?
- Check Windows Startup settings and disable duplicate entries
- Uninstall the old app from Control Panel

### No apps starting?
- The current app should auto-start
- Verify it's enabled in Windows Startup settings

### Window still showing on startup?
- Check that the startup command includes `--hidden` flag
- Restart the app to apply changes

## For Future Reference

If you need to **disable** auto-start completely:
```typescript
// In apps/electron-vite-project/electron/main.ts, around line 539
app.setLoginItemSettings({ openAtLogin: false }) // Change true to false
```

If you need to **change the auto-start behavior**:
```typescript
app.setLoginItemSettings({ 
  openAtLogin: true, 
  args: ['--hidden'],  // Remove this to show window on startup
  name: 'OpenGiraffe'
})
```








