# Tagged Triggers - Implementation Study

## Overview
Tagged Triggers allow users to save screen regions with names for quick reuse. They work differently for screenshots (headless) vs streams (visible).

## Data Structure

### Storage Location
- **Extension**: `chrome.storage.local` with key `'optimando-tagged-triggers'`
- **Electron**: `presets.ts` functions (`loadPresets`, `upsertRegion`)
  - File: `~/.opengiraffe/lmgtfy/regions.json`

### Data Format

**Extension Format**:
```typescript
{
  name: string,           // User-provided name
  at: number,             // Timestamp (Date.now())
  image: string,          // Thumbnail data URL
  rect: {                 // Screen coordinates
    x: number,
    y: number, 
    w: number,
    h: number
  },
  mode: 'screenshot' | 'stream',  // Capture type
  displayId?: number      // For Electron multi-monitor support
}
```

**Electron Format** (presets.ts:5-17):
```typescript
interface RegionPreset {
  id: string              // Auto-generated: "r_" + Date.now()
  name?: string           // User-provided name
  displayId?: number      // Monitor ID (for multi-screen)
  x: number               // Logical pixels
  y: number
  w: number
  h: number
  mode?: 'screenshot' | 'stream'
  headless?: boolean      // true for screenshot, false for stream
  createdAt: number       // Timestamp
  updatedAt: number       // Timestamp
}
```

**Perfect Match!** The Electron data structure already supports everything we need:
- ✅ `mode`: 'screenshot' | 'stream'
- ✅ `headless`: boolean (screenshot=true, stream=false)
- ✅ `displayId`: For multi-monitor support
- ✅ Auto-generated IDs and timestamps

## User Flow

### 1. Creating a Tagged Trigger

**Extension Implementation** (content-script.tsx:5176-5212):
1. User checks "Create Tagged Trigger" checkbox in overlay
2. User captures screenshot or starts stream
3. After capture, `renderTriggerPrompt()` is called
4. Shows input bar with:
   - Label: "Tagged Trigger name:"
   - Text input (placeholder: "Trigger name")
   - Save button (blue)
   - Cancel button (gray)
5. On Save:
   - Gets name from input (or auto-generates: "Trigger " + timestamp)
   - Saves to `chrome.storage.local`:
     ```typescript
     { name, at: Date.now(), image: url, rect, mode }
     ```
   - Dispatches `'optimando-triggers-updated'` event
   - Sends `TRIGGERS_UPDATED` message to background
6. On Cancel: removes the input bar

**UI Location**: Below the compose area (`#ccd-compose` or `#ccf-compose`)

### 2. Displaying Tagged Triggers

**Extension Implementation** (content-script.tsx:9791-9870):
- **Tags Button**: Next to pencil button
  - Shows "Tags ▾"
  - Opens dropdown on click
- **Dropdown Menu**:
  - Fixed position popup
  - Shows all saved triggers by name
  - Hover effect on items
  - Click to execute trigger
- **Auto-refresh**: Listens to `'optimando-triggers-updated'` event

### 3. Executing Tagged Triggers

**Screenshot Mode** (content-script.tsx:9832-9850):
- **Headless** - no overlay visible
- Process:
  1. Capture full visible tab via `chrome.runtime.sendMessage({ type:'CAPTURE_VISIBLE_TAB' })`
  2. Crop to saved `rect` coordinates (accounting for DPR)
  3. Post cropped image directly to chat
  4. No user interaction needed

**Stream Mode** (content-script.tsx:9829-9830):
- **Visible** - overlay shown
- Process:
  1. Call `beginScreenSelect(msgs, { rect: t.rect, mode: 'stream' })`
  2. Opens overlay with rectangle pre-positioned at saved coordinates
  3. User sees recording controls
  4. User clicks Stream → Record → Stop manually
  5. Video posts to chat and overlay closes

## Key Functions in Extension

### content-script.tsx
- **Line 5176**: `renderTriggerPrompt()` - Shows save UI after capture
- **Line 5194**: Save button handler - Persists to chrome.storage
- **Line 9807**: `openMenu()` - Opens Tags dropdown
- **Line 9816**: `renderItems()` - Populates dropdown with saved triggers
- **Line 9826**: Item click handler - Executes screenshot (headless) or stream (visible)
- **Line 9858**: `refreshMenu()` - Reloads triggers from storage

### Storage Operations
```typescript
// Save
chrome.storage.local.get([key], (data) => {
  const prev = Array.isArray(data?.[key]) ? data[key] : []
  prev.push({ name, at: Date.now(), image: url, rect, mode })
  chrome.storage.local.set({ [key]: prev }, callback)
})

// Load
chrome.storage.local.get([key], (data) => {
  const list = Array.isArray(data?.[key]) ? data[key] : []
  renderItems(list)
})
```

## Electron Implementation Plan

### File Locations
- **Storage**: `apps/electron-vite-project/electron/lmgtfy/presets.ts` (already exists!)
- **Overlay UI**: `apps/electron-vite-project/electron/lmgtfy/overlay.ts`
- **Main Process**: `apps/electron-vite-project/electron/main.ts`

### Key Differences from Extension
1. **Storage**: Use `presets.ts` functions instead of chrome.storage
2. **Display**: Electron app needs its own dropdown in the popup command chat
3. **Multi-monitor**: Must save `displayId` for each trigger
4. **Communication**: Use IPC instead of chrome.runtime.sendMessage
5. **Headless Screenshot**: Use `captureScreenshot()` from `capture.ts`
6. **Visible Stream**: Call `beginOverlay()` with preset rect

### Implementation Steps
1. Add "Tagged Trigger" checkbox to `overlay.ts`
2. Add save bar UI after capture (similar to extension)
3. Use `upsertRegion()` to save triggers (mode: 'screenshot' or 'stream', headless: true/false)
4. Add Tags dropdown to popup command chat
5. Load triggers using `loadPresets()`
6. Execute:
   - Screenshot: Call `captureScreenshot()` with saved rect + post via WebSocket
   - Stream: Call `beginOverlay()` with preset rect, user stops manually

### Data Flow
```
User creates trigger:
  Overlay checkbox → Capture → Save bar → upsertRegion() → File saved

User executes trigger:
  Tags dropdown → Click trigger
    → If screenshot: captureScreenshot() + WebSocket post (headless)
    → If stream: beginOverlay() with preset + user controls (visible)
```

## Important Notes
- **Screenshot triggers** = fully automated (headless)
- **Stream triggers** = semi-automated (overlay shown, user controls recording)
- Extension stores triggers per browser profile
- Electron should store triggers globally (in `~/.opengiraffe/lmgtfy/presets.json`)
- Extension uses chrome.storage.local, Electron uses file system
- Both need to handle multi-monitor setups (extension has less control than Electron)

