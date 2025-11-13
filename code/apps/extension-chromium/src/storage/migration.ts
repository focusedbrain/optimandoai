/**
 * Migration utility for migrating data from Chrome storage to SQLite
 */

import { OrchestratorSQLiteAdapter } from './OrchestratorSQLiteAdapter'

/**
 * Filter Chrome storage data for session-relevant keys
 */
function filterSessionData(chromeData: Record<string, any>): Record<string, any> {
  const sessionData: Record<string, any> = {};
  
  Object.entries(chromeData).forEach(([key, value]) => {
    // Include session keys, settings, UI state, agent data
    if (
      key.startsWith('session_') ||
      key.startsWith('optimando-') ||
      key === 'currentSessionKey' ||
      key === 'viewMode' ||
      key === 'accountAgents' ||
      key === 'orchestratorConfig' ||
      key === 'backendConfig'
    ) {
      sessionData[key] = value;
    }
  });
  
  return sessionData;
}

/**
 * Migrate all data from Chrome storage to encrypted SQLite
 * @param filterOnly If true, only migrate session-related data
 * @returns Promise that resolves when migration is complete
 */
export async function migrateToSQLite(filterOnly: boolean = false): Promise<{
  success: boolean
  message: string
  keyCount?: number
}> {
  try {
    console.log('[Migration] Starting migration from Chrome storage to SQLite...')

    // Step 1: Get all data from Chrome storage
    console.log('[Migration] Reading all data from Chrome storage...')
    let chromeData = await new Promise<Record<string, any>>((resolve) => {
      chrome.storage.local.get(null, (items) => {
        resolve(items || {})
      })
    })

    // Filter for session data if requested
    if (filterOnly) {
      console.log('[Migration] Filtering for session-relevant data only...')
      chromeData = filterSessionData(chromeData);
    }

    const keyCount = Object.keys(chromeData).length
    console.log(`[Migration] Found ${keyCount} keys to migrate`)

    if (keyCount === 0) {
      return {
        success: true,
        message: 'No data to migrate',
        keyCount: 0,
      }
    }

    // Step 2: Connect to SQLite backend
    console.log('[Migration] Connecting to SQLite backend...')
    const adapter = new OrchestratorSQLiteAdapter()
    await adapter.connect()

    // Step 3: Migrate data
    console.log('[Migration] Migrating data to SQLite...')
    await adapter.migrateFromChromeStorage(chromeData)

    // Step 4: Verify migration by reading back a few keys
    console.log('[Migration] Verifying migration...')
    const sampleKeys = Object.keys(chromeData).slice(0, 3)
    for (const key of sampleKeys) {
      const sqliteValue = await adapter.get(key)
      const chromeValue = chromeData[key]
      
      // Basic verification (deep equality check would be better but this is sufficient)
      if (JSON.stringify(sqliteValue) !== JSON.stringify(chromeValue)) {
        console.warn(`[Migration] Verification failed for key "${key}"`)
        throw new Error(`Migration verification failed for key "${key}"`)
      }
    }

    console.log('[Migration] ✅ Migration completed successfully')
    return {
      success: true,
      message: `Successfully migrated ${keyCount} keys to encrypted SQLite`,
      keyCount,
    }
  } catch (error: any) {
    console.error('[Migration] ❌ Migration failed:', error)
    return {
      success: false,
      message: `Migration failed: ${error?.message || error}`,
    }
  }
}

/**
 * Auto-migrate to SQLite on first startup (if Electron is available)
 * This will be called from content-script.tsx initialization
 */
export async function autoMigrateIfNeeded(): Promise<void> {
  try {
    // Check if already migrated
    const status = await getMigrationStatus();
    if (status.migrated) {
      console.log('[AutoMigration] Already migrated, skipping');
      return;
    }

    // Check if Electron is available
    const available = await checkSQLiteAvailability();
    if (!available) {
      console.log('[AutoMigration] Electron not available, skipping auto-migration');
      return;
    }

    console.log('[AutoMigration] Electron available, starting automatic migration...');
    
    // Perform migration (filter for session data only)
    const result = await migrateToSQLite(true);
    
    if (result.success) {
      // Mark as migrated
      await setMigrationStatus(true, true);
      console.log(`[AutoMigration] ✅ Successfully migrated ${result.keyCount} keys`);
      
      // Show notification to user
      showMigrationNotification(result.keyCount || 0);
    } else {
      console.error('[AutoMigration] Migration failed:', result.message);
    }
  } catch (error) {
    console.error('[AutoMigration] Error during auto-migration:', error);
  }
}

/**
 * Show a notification to the user about the migration
 * Note: Only works in content script context (not background service worker)
 */
function showMigrationNotification(keyCount: number): void {
  // Check if we're in a DOM context (content script) vs background worker
  if (typeof document === 'undefined' || !document.body) {
    console.log(`✅ [Migration] ${keyCount} items migrated to SQLite (notification skipped - no DOM context)`);
    return;
  }
  
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 60px;
    right: 20px;
    background: rgba(34, 197, 94, 0.95);
    color: white;
    padding: 16px 20px;
    border-radius: 8px;
    font-size: 13px;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    max-width: 400px;
    animation: slideIn 0.3s ease;
  `;
  notification.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 6px;">
      🔐 Data Migrated to Encrypted Storage
    </div>
    <div style="font-size: 12px; opacity: 0.95;">
      ${keyCount} items moved to secure SQLite database. Your data is now encrypted at rest.
    </div>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

/**
 * Check if SQLite backend is available and connected
 */
export async function checkSQLiteAvailability(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:51248/api/orchestrator/status', {
      method: 'GET',
    })

    if (!response.ok) {
      return false
    }

    const result = await response.json()
    return result.success === true
  } catch (error) {
    console.error('[Migration] SQLite backend not available:', error)
    return false
  }
}

/**
 * Get the migration status from config
 */
export async function getMigrationStatus(): Promise<{
  migrated: boolean
  sqliteEnabled: boolean
}> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['orchestratorConfig'], (result) => {
      const config = result.orchestratorConfig || {}
      resolve({
        migrated: config.migrated === true,
        sqliteEnabled: config.sqliteEnabled === true,
      })
    })
  })
}

/**
 * Update the migration status in config
 */
export async function setMigrationStatus(migrated: boolean, sqliteEnabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['orchestratorConfig'], (result) => {
      const config = result.orchestratorConfig || {}
      config.migrated = migrated
      config.sqliteEnabled = sqliteEnabled
      chrome.storage.local.set({ orchestratorConfig: config }, () => {
        resolve()
      })
    })
  })
}

