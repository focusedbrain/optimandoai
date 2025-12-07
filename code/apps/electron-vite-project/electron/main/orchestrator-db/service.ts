/**
 * Orchestrator Service - Core business logic for orchestrator database
 * Handles CRUD operations, session management, and data migration
 */

import type { OrchestratorStatus, Session, ExportData, ExportOptions } from './types'
import {
  createOrchestratorDB,
  openOrchestratorDB,
  closeOrchestratorDB,
  orchestratorDBExists,
  getOrchestratorDBPath,
} from './db'

export class OrchestratorService {
  private db: any | null = null
  private connected: boolean = false

  constructor() {
    console.log('[ORCHESTRATOR] Service initialized')
    console.log('[ORCHESTRATOR] DB path:', getOrchestratorDBPath())
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Connect to orchestrator database (auto-creates if doesn't exist)
   * Uses hardcoded password "123" for temporary solution
   */
  async connect(): Promise<void> {
    if (this.connected && this.db) {
      console.log('[ORCHESTRATOR] Already connected')
      return
    }

    try {
      // Create or open database
      if (!orchestratorDBExists()) {
        console.log('[ORCHESTRATOR] Database does not exist, creating...')
        this.db = await createOrchestratorDB()
      } else {
        console.log('[ORCHESTRATOR] Opening existing database...')
        this.db = await openOrchestratorDB()
      }

      // Create session (for future use with WR Login)
      // this.session = {
      //   dek: Buffer.from('temporary-dek-placeholder'),
      //   lastActivity: Date.now(),
      //   connected: true,
      // }

      this.connected = true
      console.log('[ORCHESTRATOR] ✅ Connected to database')
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Failed to connect:', error)
      throw new Error(`Failed to connect to orchestrator database: ${error?.message || error}`)
    }
  }

  /**
   * Disconnect from database
   */
  disconnect(): void {
    if (this.db) {
      closeOrchestratorDB(this.db)
      this.db = null
    }
    this.connected = false
    console.log('[ORCHESTRATOR] Disconnected')
  }

  /**
   * Get connection status
   */
  getStatus(): OrchestratorStatus {
    return {
      exists: orchestratorDBExists(),
      connected: this.connected,
      dbPath: getOrchestratorDBPath(),
    }
  }

  /**
   * Ensure connection before operations - auto-connects if not connected
   */
  private async ensureConnected(): Promise<void> {
    if (!this.connected || !this.db) {
      console.log('[ORCHESTRATOR] Auto-connecting...')
      await this.connect()
    }
  }

  // ==========================================================================
  // Generic Key-Value Operations (Chrome Storage Compatible)
  // ==========================================================================

  /**
   * Get value by key (from settings table)
   */
  async get<T = any>(key: string): Promise<T | undefined> {
    await this.ensureConnected()

    try {
      const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key)
      if (!row) {
        return undefined
      }
      return JSON.parse(row.value_json) as T
    } catch (error: any) {
      console.error(`[ORCHESTRATOR] Error getting key "${key}":`, error)
      throw error
    }
  }

  /**
   * Set value by key (to settings table)
   */
  async set<T = any>(key: string, value: T): Promise<void> {
    await this.ensureConnected()

    try {
      const now = Date.now()
      const valueJson = JSON.stringify(value)
      this.db.prepare('INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
        key,
        valueJson,
        now
      )
      console.log(`[ORCHESTRATOR] Set key "${key}"`)
    } catch (error: any) {
      console.error(`[ORCHESTRATOR] Error setting key "${key}":`, error)
      throw error
    }
  }

  /**
   * Get all key-value pairs (from settings table)
   */
  async getAll(): Promise<Record<string, any>> {
    await this.ensureConnected()

    try {
      const rows = this.db.prepare('SELECT key, value_json FROM settings').all()
      const result: Record<string, any> = {}
      for (const row of rows) {
        result[row.key] = JSON.parse(row.value_json)
      }
      return result
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Error getting all data:', error)
      throw error
    }
  }

  /**
   * Set multiple key-value pairs at once
   */
  async setAll(data: Record<string, any>): Promise<void> {
    await this.ensureConnected()

    try {
      const now = Date.now()
      const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)')
      
      // Use transaction for bulk insert
      const transaction = this.db.transaction((entries: Array<[string, any]>) => {
        for (const [key, value] of entries) {
          const valueJson = JSON.stringify(value)
          stmt.run(key, valueJson, now)
        }
      })
      
      transaction(Object.entries(data))
      console.log(`[ORCHESTRATOR] Set ${Object.keys(data).length} keys`)
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Error setting all data:', error)
      throw error
    }
  }

  /**
   * Remove key(s)
   */
  async remove(keys: string | string[]): Promise<void> {
    await this.ensureConnected()

    try {
      const keysArray = Array.isArray(keys) ? keys : [keys]
      const stmt = this.db.prepare('DELETE FROM settings WHERE key = ?')
      
      for (const key of keysArray) {
        stmt.run(key)
      }
      
      console.log(`[ORCHESTRATOR] Removed ${keysArray.length} keys`)
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Error removing keys:', error)
      throw error
    }
  }

  /**
   * Clear all data from settings table
   */
  async clear(): Promise<void> {
    await this.ensureConnected()

    try {
      this.db.prepare('DELETE FROM settings').run()
      console.log('[ORCHESTRATOR] Cleared all settings data')
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Error clearing data:', error)
      throw error
    }
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * List all sessions
   */
  async listSessions(): Promise<Session[]> {
    await this.ensureConnected()

    try {
      const rows = this.db.prepare('SELECT id, name, config_json, created_at, updated_at, tags FROM sessions ORDER BY updated_at DESC').all()
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        config: JSON.parse(row.config_json),
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
      }))
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Error listing sessions:', error)
      throw error
    }
  }

  /**
   * Get session by ID
   */
  async getSession(id: string): Promise<Session | undefined> {
    await this.ensureConnected()

    try {
      const row = this.db.prepare('SELECT id, name, config_json, created_at, updated_at, tags FROM sessions WHERE id = ?').get(id)
      if (!row) {
        return undefined
      }
      return {
        id: row.id,
        name: row.name,
        config: JSON.parse(row.config_json),
        created_at: row.created_at,
        updated_at: row.updated_at,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
      }
    } catch (error: any) {
      console.error(`[ORCHESTRATOR] Error getting session "${id}":`, error)
      throw error
    }
  }

  /**
   * Save/update session
   */
  async saveSession(session: Session): Promise<void> {
    await this.ensureConnected()

    try {
      const now = Date.now()
      const configJson = JSON.stringify(session.config)
      const tagsJson = session.tags ? JSON.stringify(session.tags) : null
      
      this.db.prepare(`
        INSERT OR REPLACE INTO sessions (id, name, config_json, created_at, updated_at, tags)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        session.name,
        configJson,
        session.created_at || now,
        now,
        tagsJson
      )
      
      console.log(`[ORCHESTRATOR] Saved session "${session.name}" (${session.id})`)
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Error saving session:', error)
      throw error
    }
  }

  /**
   * Delete session
   */
  async deleteSession(id: string): Promise<void> {
    await this.ensureConnected()

    try {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
      console.log(`[ORCHESTRATOR] Deleted session ${id}`)
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Error deleting session:', error)
      throw error
    }
  }

  // ==========================================================================
  // Migration from Chrome Storage
  // ==========================================================================

  /**
   * Migrate data from Chrome storage to SQLite
   * @param chromeData All data from chrome.storage.local
   */
  async migrateFromChromeStorage(chromeData: Record<string, any>): Promise<void> {
    await this.ensureConnected()

    try {
      console.log(`[ORCHESTRATOR] Migrating ${Object.keys(chromeData).length} keys from Chrome storage...`)
      
      // Use setAll for bulk insert
      await this.setAll(chromeData)
      
      console.log('[ORCHESTRATOR] ✅ Migration completed successfully')
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Migration failed:', error)
      throw new Error(`Migration failed: ${error?.message || error}`)
    }
  }

  // ==========================================================================
  // Export/Import (Future-Ready)
  // ==========================================================================

  /**
   * Export data to JSON/YAML/MD format
   */
  async exportData(options: ExportOptions): Promise<ExportData> {
    await this.ensureConnected()

    try {
      const exportData: ExportData = {
        version: '1.0.0',
        exported_at: Date.now(),
      }

      if (options.includeSessions !== false) {
        const sessions = await this.listSessions()
        if (options.sessionFilter && options.sessionFilter.length > 0) {
          exportData.sessions = sessions.filter(s => options.sessionFilter!.includes(s.id))
        } else {
          exportData.sessions = sessions
        }
      }

      if (options.includeSettings !== false) {
        const allSettings = await this.getAll()
        exportData.settings = Object.entries(allSettings).map(([key, value]) => ({
          key,
          value,
          updated_at: Date.now(),
        }))
      }

      // UI state and templates are optional
      if (options.includeUIState) {
        // TODO: Implement UI state export if needed
      }

      if (options.includeTemplates) {
        // TODO: Implement templates export when template feature is added
      }

      console.log('[ORCHESTRATOR] Exported data:', Object.keys(exportData))
      return exportData
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Export failed:', error)
      throw error
    }
  }

  /**
   * Import data from JSON format
   */
  async importData(data: ExportData): Promise<void> {
    await this.ensureConnected()

    try {
      console.log('[ORCHESTRATOR] Importing data...')

      // Import sessions
      if (data.sessions && data.sessions.length > 0) {
        for (const session of data.sessions) {
          await this.saveSession(session)
        }
        console.log(`[ORCHESTRATOR] Imported ${data.sessions.length} sessions`)
      }

      // Import settings
      if (data.settings && data.settings.length > 0) {
        const settingsObj: Record<string, any> = {}
        for (const setting of data.settings) {
          settingsObj[setting.key] = setting.value
        }
        await this.setAll(settingsObj)
        console.log(`[ORCHESTRATOR] Imported ${data.settings.length} settings`)
      }

      console.log('[ORCHESTRATOR] ✅ Import completed successfully')
    } catch (error: any) {
      console.error('[ORCHESTRATOR] Import failed:', error)
      throw error
    }
  }
}

// Singleton instance
let orchestratorServiceInstance: OrchestratorService | null = null

/**
 * Get singleton orchestrator service instance
 */
export function getOrchestratorService(): OrchestratorService {
  if (!orchestratorServiceInstance) {
    orchestratorServiceInstance = new OrchestratorService()
  }
  return orchestratorServiceInstance
}

