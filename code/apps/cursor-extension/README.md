# OptimandoAI Cursor Extension

Connects Cursor IDE to the OptimandoAI Orchestrator for real-time GlassView integration.

## Features

- 🔄 **Real-time sync**: Automatically sends file changes to GlassView
- 📁 **Git integration**: Tracks staged and unstaged changes
- 🔗 **WebSocket + HTTP**: Reliable connection with fallback
- ⚡ **Bidirectional**: Orchestrator can open files in Cursor

## Installation

### Development Install

1. Build the extension:
   ```powershell
   cd apps/cursor-extension
   npm install
   npm run compile
   ```

2. Install in Cursor/VS Code:
   - Press `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
   - Or copy this folder to `~/.cursor/extensions/optimandoai-cursor-0.0.1`

### From VSIX

```powershell
npm run package
# This creates optimandoai-cursor-0.0.1.vsix
```

Then install the .vsix file in Cursor.

## Configuration

Open Settings (`Ctrl+,`) and search for "OptimandoAI":

| Setting | Default | Description |
|---------|---------|-------------|
| `orchestratorHttpUrl` | `http://127.0.0.1:51248` | Orchestrator HTTP API URL |
| `orchestratorWsUrl` | `ws://127.0.0.1:51247` | Orchestrator WebSocket URL |
| `autoConnect` | `true` | Auto-connect on startup |
| `sendOnSave` | `true` | Send changes on file save |
| `sendSelections` | `false` | Send code selections (verbose) |

## Commands

Press `Ctrl+Shift+P` and search for:

- **OptimandoAI: Send Changed Files** - Manually sync Git changes
- **OptimandoAI: Send Current File** - Send current file content
- **OptimandoAI: Reconnect** - Reconnect to Orchestrator
- **OptimandoAI: Show Status** - View connection status

## Status Bar

Look for the OptimandoAI indicator in the bottom-right status bar:

- ✓ **Green check**: Connected to Orchestrator
- ✕ **Red X**: Disconnected (click for options)
- ⚠ **Warning**: Connection error

## Events Sent to Orchestrator

| Event | Description |
|-------|-------------|
| `cursor:connected` | Extension connected |
| `cursor:files_changed` | List of Git changed files |
| `cursor:file_saved` | File was saved |
| `cursor:file_changed` | File modified on disk |
| `cursor:file_created` | New file created |
| `cursor:file_deleted` | File deleted |
| `cursor:active_file` | Active editor changed |
| `cursor:current_file` | Full file content (manual) |
| `cursor:diff` | Diff for specific file |
| `cursor:selection_changed` | Code selection (optional) |

## Events Received from Orchestrator

| Event | Description |
|-------|-------------|
| `OPEN_FILE` | Open file at line |
| `REQUEST_DIFF` | Request diff for file |
| `REQUEST_FILES` | Request changed files list |
| `PING` | Keep-alive ping |

## Requirements

- Cursor IDE or VS Code 1.80+
- OptimandoAI Orchestrator running on port 51247/51248
- Git repository in workspace

## Architecture

```
┌─────────────────────┐     WebSocket      ┌──────────────────────┐
│    Cursor IDE       │ ──────────────────>│  Electron Orchestrator│
│                     │                    │     (Port 51247)      │
│  ┌───────────────┐  │   HTTP fallback    │                      │
│  │This Extension │──┼───────────────────>│     (Port 51248)      │
│  └───────────────┘  │                    │                      │
└─────────────────────┘                    └──────────┬───────────┘
                                                      │
                                                      │ broadcast
                                                      ▼
                                           ┌──────────────────────┐
                                           │   Chrome Extension    │
                                           │     (GlassView)       │
                                           └──────────────────────┘
```

## License

MIT - OptimandoAI
