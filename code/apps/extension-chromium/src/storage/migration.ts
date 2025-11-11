/**
 * Migration utility for migrating data from Chrome storage to SQLite
 */

import { OrchestratorSQLiteAdapter } from './OrchestratorSQLiteAdapter'

/**
 * Migrate all data from Chrome storage to encrypted SQLite
 * @returns Promise that resolves when migration is complete
 */
export async function migrateToSQLite(): Promise<{
  success: boolean
  message: string
  keyCount?: number
}> {
  try {
    console.log('[Migration] Starting migration from Chrome storage to SQLite...')

    // Step 1: Get all data from Chrome storage
    console.log('[Migration] Reading all data from Chrome storage...')
    const chromeData = await new Promise<Record<string, any>>((resolve) => {
      chrome.storage.local.get(null, (items) => {
        resolve(items || {})
      })
    })

    const keyCount = Object.keys(chromeData).length
    console.log(`[Migration] Found ${keyCount} keys in Chrome storage`)

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

