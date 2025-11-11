/**
 * Orchestrator SQLite Adapter for Extension
 * Proxies all storage operations to Electron's encrypted SQLite backend via HTTP API
 */

import type { StorageAdapter } from '@shared/core/storage/StorageAdapter'

const HTTP_API_BASE = 'http://127.0.0.1:51248/api/orchestrator'

/**
 * Create a proxy adapter that routes all operations through Electron's orchestrator SQLite
 */
export class OrchestratorSQLiteAdapter implements StorageAdapter {
  private connected: boolean = false

  /**
   * Connect to the orchestrator database (auto-creates if doesn't exist)
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return
    }

    try {
      const response = await fetch(`${HTTP_API_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to connect')
      }

      this.connected = true
      console.log('[OrchestratorSQLiteAdapter] ✅ Connected to encrypted SQLite backend')
    } catch (error: any) {
      console.error('[OrchestratorSQLiteAdapter] ❌ Connection failed:', error)
      throw error
    }
  }

  /**
   * Ensure connected before operations
   */
  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect()
    }
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    await this.ensureConnected()

    try {
      const response = await fetch(`${HTTP_API_BASE}/get?key=${encodeURIComponent(key)}`, {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to get value')
      }

      return result.data
    } catch (error: any) {
      console.error('[OrchestratorSQLiteAdapter] Error in get:', error)
      throw error
    }
  }

  async set<T = any>(key: string, value: T): Promise<void> {
    await this.ensureConnected()

    try {
      const response = await fetch(`${HTTP_API_BASE}/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to set value')
      }
    } catch (error: any) {
      console.error('[OrchestratorSQLiteAdapter] Error in set:', error)
      throw error
    }
  }

  async getAll(): Promise<Record<string, any>> {
    await this.ensureConnected()

    try {
      const response = await fetch(`${HTTP_API_BASE}/get-all`, {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to get all values')
      }

      return result.data || {}
    } catch (error: any) {
      console.error('[OrchestratorSQLiteAdapter] Error in getAll:', error)
      throw error
    }
  }

  async setAll(payload: Record<string, any>): Promise<void> {
    await this.ensureConnected()

    try {
      const response = await fetch(`${HTTP_API_BASE}/set-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to set all values')
      }
    } catch (error: any) {
      console.error('[OrchestratorSQLiteAdapter] Error in setAll:', error)
      throw error
    }
  }

  /**
   * Remove key(s) from storage
   */
  async remove(keys: string | string[]): Promise<void> {
    await this.ensureConnected()

    try {
      const response = await fetch(`${HTTP_API_BASE}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to remove keys')
      }
    } catch (error: any) {
      console.error('[OrchestratorSQLiteAdapter] Error in remove:', error)
      throw error
    }
  }

  /**
   * Migrate data from Chrome storage
   */
  async migrateFromChromeStorage(chromeData: Record<string, any>): Promise<void> {
    await this.ensureConnected()

    try {
      const response = await fetch(`${HTTP_API_BASE}/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chromeData }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to migrate data')
      }

      console.log('[OrchestratorSQLiteAdapter] ✅ Migration completed successfully')
    } catch (error: any) {
      console.error('[OrchestratorSQLiteAdapter] ❌ Migration failed:', error)
      throw error
    }
  }
}

