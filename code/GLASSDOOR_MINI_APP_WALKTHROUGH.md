# GlassDoor Mini-App Implementation Walkthrough

This document outlines the implementation of the "WR-Code-GlassDoor" Mini-App, which enables real-time file monitoring and diff viewing within the browser sidepanel.

## Overview

The GlassDoor Mini-App integrates file watching capabilities from the Electron Orchestrator into the browser extension's sidepanel, allowing developers to monitor code changes in real-time while working in the browser.

## Changes Made

### 1. Orchestrator (Electron App)

#### Services Created
- **[FileWatcherService.ts](apps/electron-vite-project/electron/main/services/FileWatcherService.ts)**: Uses `chokidar` to monitor a specified directory for file changes (add, change, unlink events)
- **[DiffService.ts](apps/electron-vite-project/electron/main/services/DiffService.ts)**: Uses `simple-git` to generate diffs for specific files
- **[index.ts](apps/electron-vite-project/electron/main/services/index.ts)**: Exports both services

#### WebSocket Integration
Updated [main.ts](apps/electron-vite-project/electron/main.ts) to:
- Initialize `FileWatcherService` and `DiffService` instances
- Listen for `file-changed` events and broadcast to all WebSocket clients
- Handle incoming messages:
  - `START_WATCHING`: Start watching a directory
  - `STOP_WATCHING`: Stop watching
  - `GET_DIFF`: Generate and return diff for a file

### 2. Shared Component Library

Created reusable React components in `packages/shared/src/components/`:

- **[MiniAppContainer.tsx](packages/shared/src/components/MiniAppContainer.tsx)**: Container layout for mini-apps
- **[FileList.tsx](packages/shared/src/components/FileList.tsx)**: Displays list of changed files with click handlers
- **[DiffViewer.tsx](packages/shared/src/components/DiffViewer.tsx)**: Renders code diffs with syntax highlighting
- **[Button.tsx](packages/shared/src/components/Button.tsx)**: Reusable button with variants (primary, secondary, danger)
- **[Badge.tsx](packages/shared/src/components/Badge.tsx)**: Reusable badge component
- **[index.ts](packages/shared/src/components/index.ts)**: Exports all components

Updated [packages/shared/src/index.ts](packages/shared/src/index.ts) to export the components module.

### 3. Browser Extension

#### GlassDoor Mini-App Component
Created [GlassDoorMiniApp.tsx](apps/extension-chromium/src/components/GlassDoorMiniApp.tsx):
- Manages state for project path, watching status, changed files, selected file, and diff
- Listens for WebSocket messages from background script
- Sends `START_WATCHING`, `STOP_WATCHING`, and `GET_DIFF` messages
- Uses shared components for UI rendering

#### Sidepanel Integration
Updated [sidepanel.tsx](apps/extension-chromium/src/sidepanel.tsx):
- Imported `GlassDoorMiniApp` component
- Added state to control mini-app visibility
- Conditionally renders the mini-app when active

#### Background Script
Updated [background.ts](apps/extension-chromium/src/background.ts):
- Forwards file watching events from Electron to sidepanel:
  - `FILE_CHANGED`
  - `WATCHING_STARTED`
  - `WATCHING_STOPPED`
  - `DIFF_RESULT`
  - `DIFF_ERROR`
- Forwards requests from sidepanel to Electron Orchestrator

#### TypeScript Configuration
Updated [tsconfig.json](apps/extension-chromium/tsconfig.json):
- Added path aliases for `@shared` and `@shared-extension` to resolve imports correctly

## Merge Conflict Resolution

Successfully resolved merge conflicts in [main.ts](apps/electron-vite-project/electron/main.ts) after pulling from `main` branch:

- **Integrated LLM Services**: Preserved new LLM initialization, Ollama manager, and IPC handlers from `main` branch
- **Integrated GlassDoor Services**: Maintained FileWatcherService and DiffService initialization
- **Merged HTTP API Endpoints**: Combined Vault API and Orchestrator DB endpoints from `main` with existing code
- **Fixed Syntax Errors**: Resolved duplicate code blocks and missing braces
- **Fixed Extension Build**: Removed extra closing brace in `background.ts`

## Build Status

✅ **Electron App**: TypeScript compilation passes  
✅ **Browser Extension**: Build successful  
✅ **All Files Staged**: Ready for commit

## Files Modified/Created

### New Files
- `apps/electron-vite-project/electron/main/services/FileWatcherService.ts`
- `apps/electron-vite-project/electron/main/services/DiffService.ts`
- `apps/electron-vite-project/electron/main/services/index.ts`
- `packages/shared/src/components/MiniAppContainer.tsx`
- `packages/shared/src/components/FileList.tsx`
- `packages/shared/src/components/DiffViewer.tsx`
- `packages/shared/src/components/Button.tsx`
- `packages/shared/src/components/Badge.tsx`
- `packages/shared/src/components/index.ts`
- `apps/extension-chromium/src/components/GlassDoorMiniApp.tsx`

### Modified Files
- `apps/electron-vite-project/electron/main.ts`
- `apps/extension-chromium/src/sidepanel.tsx`
- `apps/extension-chromium/src/background.ts`
- `apps/extension-chromium/tsconfig.json`
- `packages/shared/src/index.ts`

## Verification Steps

To verify the implementation:

1. **Start the Electron App**: Run the desktop orchestrator
   ```bash
   cd apps/electron-vite-project
   npm run dev
   ```

2. **Build the Extension**: 
   ```bash
   cd apps/extension-chromium
   npm run build
   ```

3. **Load the Extension**: Load the unpacked extension from `apps/extension-chromium/dist` in Chrome

4. **Open Sidepanel**: Click the extension icon and open the sidepanel

5. **Activate GlassDoor Mini-App**: Click "Add Mini App" button

6. **Start Watching**: 
   - Enter an absolute path to a local project (e.g., `/Users/username/projects/myproject`)
   - Click "Start Watching"

7. **Modify a File**: Make changes to a file in the watched directory

8. **Verify UI**:
   - Changed file should appear in the "Changed Files" list
   - Click on a file to view its diff
   - Diff should display with syntax highlighting

9. **Stop Watching**: Click "Stop Watching" button

## Next Steps

1. **Commit Changes**: 
   ```bash
   git commit -m "Merge main and integrate GlassDoor Mini-App with file watching"
   ```

2. **End-to-End Testing**: Perform thorough testing of the file watching and diff generation

3. **UI Enhancements**: Consider adding:
   - File type icons
   - Line number indicators in diff viewer
   - Filter/search for changed files
   - Refresh button

4. **Error Handling**: Add more robust error handling for:
   - Invalid directory paths
   - Git repository detection
   - WebSocket disconnections

5. **Documentation**: Update user-facing documentation with GlassDoor Mini-App usage instructions