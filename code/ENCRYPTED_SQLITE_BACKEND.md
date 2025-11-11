# Encrypted SQLite Backend Implementation

## Overview
Successfully implemented an encrypted SQLite backend for the orchestrator, replacing Chrome storage as the default data storage mechanism. This provides security, performance, and prepares for future session template export/import functionality.

## What Was Implemented

### Backend (Electron)

1. **orchestrator-db/types.ts**
   - Defined all type interfaces for sessions, settings, UI state, templates
   - Export/import data structures for JSON/YAML/MD formats

2. **orchestrator-db/db.ts**
   - Database creation and opening with SQLCipher encryption
   - Same security configuration as the vault (SQLCipher 4, 64000 KDF iterations)
   - Hardcoded password "123" for temporary auto-login
   - Schema with 5 tables:
     - `orchestrator_meta` - database metadata
     - `sessions` - session configurations (export-ready)
     - `settings` - key-value store for settings
     - `ui_state` - temporary UI states
     - `templates` - for future session templates

3. **orchestrator-db/service.ts**
   - `OrchestratorService` class with CRUD operations
   - Chrome Storage-compatible API (`get`, `set`, `getAll`, `setAll`, `remove`, `clear`)
   - Session management methods
   - Migration from Chrome storage
   - Export/import methods (future-ready for JSON/YAML/MD)

4. **electron/main.ts** (Updated)
   - Added 10 new HTTP API endpoints:
     - `POST /api/orchestrator/connect` - Auto-connect with password "123"
     - `GET /api/orchestrator/status` - Connection status
     - `GET /api/orchestrator/get` - Get value by key
     - `POST /api/orchestrator/set` - Set value
     - `GET /api/orchestrator/get-all` - Get all data
     - `POST /api/orchestrator/set-all` - Set multiple values
     - `POST /api/orchestrator/remove` - Remove keys
     - `POST /api/orchestrator/migrate` - Migrate from Chrome storage
     - `POST /api/orchestrator/export` - Export data
     - `POST /api/orchestrator/import` - Import data

### Frontend (Extension)

1. **storage/OrchestratorSQLiteAdapter.ts**
   - `StorageAdapter` implementation for SQLite backend
   - Proxies all operations to Electron via HTTP API
   - Auto-connection on first use
   - Migration support

2. **storage/migration.ts**
   - `migrateToSQLite()` - Full migration from Chrome to SQLite
   - `checkSQLiteAvailability()` - Check if backend is available
   - `getMigrationStatus()` / `setMigrationStatus()` - Track migration state
   - Automatic data verification after migration

3. **storage/getActiveAdapter.ts** (Updated)
   - Added Orchestrator SQLite as highest priority adapter
   - Priority: Orchestrator SQLite > PostgreSQL > Chrome Storage
   - Auto-connection in background

4. **components/BackendSwitcherInline.tsx**
   - New inline backend switcher component
   - Replaces WR Login QR code section
   - Toggle switch between Chrome Storage and Encrypted SQLite
   - Connection status indicator
   - Migration progress indicator
   - Notifications for success/error/info
   - Backend availability check

5. **sidepanel.tsx** (Updated)
   - Integrated `BackendSwitcherInline` component
   - Replaced temporary WR Login section

## Database Location
- **Path:** `~/.opengiraffe/electron-data/orchestrator.db`
- **Encryption:** SQLCipher 4 with same parameters as vault
- **Password:** "123" (temporary, will be replaced by WR Login)

## Schema Design (Export-Ready)
All tables use JSON columns for easy export/import:
- `config_json` in sessions table
- `value_json` in settings table
- `data_json` in templates table

This makes it trivial to export data to JSON/YAML/MD formats in the future.

## Migration Flow

1. User toggles "Use Encrypted SQLite" switch
2. Extension checks if Electron app is running
3. Reads all data from `chrome.storage.local`
4. Sends data to `/api/orchestrator/migrate`
5. Backend creates database and stores all data
6. Verifies migration by reading back sample keys
7. Updates config to enable SQLite
8. Reloads page to use new backend

## How to Use

### First Time Setup
1. Start the Electron app (`npm run dev` or `opengiraffe.exe`)
2. Open the extension sidepanel
3. Expand "WR Login / Backend" section
4. Toggle "Use Encrypted SQLite" to ON
5. Wait for migration to complete (~2-5 seconds)
6. Page will reload automatically

### After Setup
- Data is automatically stored in encrypted SQLite
- Auto-connects on app startup
- Falls back to Chrome storage if Electron not running
- Toggle can be switched back to Chrome storage anytime

## Security
- All data encrypted at rest using SQLCipher
- Same encryption parameters as the vault (proven security)
- 64000 KDF iterations (SQLCipher 4 default)
- AES-256 encryption
- Temporary password "123" (will be replaced by WR Login authentication)

## Performance
- Local SQLite is faster than remote PostgreSQL
- Similar performance to Chrome storage for small datasets
- Better for large datasets due to proper indexing
- WAL mode for concurrent access

## Future Enhancements
- Replace hardcoded password with WR Login website authentication
- Session template export/import (JSON/YAML/MD)
- Multi-device sync via WR Login
- Session versioning and rollback
- Automatic backups

## Testing
1. Build Electron: `cd apps/electron-vite-project && npm run build`
2. Build Extension: `cd apps/extension-chromium && npm run build`
3. Load extension in Chrome
4. Start Electron app
5. Toggle SQLite backend in sidepanel
6. Test CRUD operations
7. Toggle back to Chrome storage to verify fallback

## Branch
- **Branch name:** `feature/encrypted-sqlite-backend`
- **Status:** Ready for testing and merge

