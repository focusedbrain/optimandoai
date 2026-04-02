/**
 * Orchestrator SQLite Adapter for Extension
 * Proxies all storage operations to Electron's encrypted SQLite backend via HTTP API
 */

import type { StorageAdapter } from '@shared/storage/StorageAdapter'

const HTTP_API_BASE = 'http://127.0.0.1:51248/api/orchestrator'

// Module-level launch secret cache — fetched once from background service worker.
// background.ts receives it via WebSocket handshake and exposes it via GET_LAUNCH_SECRET.
let _cachedSecret: string | null = null
let _secretFetchPromise: Promise<string | null> | null = null

async function getLaunchSecret(): Promise<string | null> {
  if (_cachedSecret) return _cachedSecret

  // Deduplicate concurrent requests
  if (_secretFetchPromise) return _secretFetchPromise

  _secretFetchPromise = new Promise<string | null>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[OrchestratorSQLiteAdapter] Could not get launch secret:', chrome.runtime.lastError.message)
          _secretFetchPromise = null
          resolve(null)
          return
        }
        const secret = response?.secret ?? null
        if (secret) {
          _cachedSecret = secret
        }
        _secretFetchPromise = null
        resolve(secret)
      })
    } catch (e) {
      _secretFetchPromise = null
      resolve(null)
    }
  })

  return _secretFetchPromise
}

/** Build headers including X-Launch-Secret when available. */
async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const secret = await getLaunchSecret()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (secret) {
    headers['X-Launch-Secret'] = secret
  }
  return headers
}

/** Allow external callers (e.g. background.ts on WS handshake) to pre-seed the secret. */
export function setAdapterLaunchSecret(secret: string): void {
  _cachedSecret = secret
}

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
      const headers = await authHeaders()
      const response = await fetch(`${HTTP_API_BASE}/connect`, {
        method: 'POST',
        headers,
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
      const headers = await authHeaders()
      const response = await fetch(`${HTTP_API_BASE}/get?key=${encodeURIComponent(key)}`, {
        method: 'GET',
        headers,
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
      const headers = await authHeaders()
      const response = await fetch(`${HTTP_API_BASE}/set`, {
        method: 'POST',
        headers,
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
      const headers = await authHeaders()
      const response = await fetch(`${HTTP_API_BASE}/get-all`, {
        method: 'GET',
        headers,
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
      const headers = await authHeaders()
      const response = await fetch(`${HTTP_API_BASE}/set-all`, {
        method: 'POST',
        headers,
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
      const headers = await authHeaders()
      const response = await fetch(`${HTTP_API_BASE}/remove`, {
        method: 'POST',
        headers,
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
      const headers = await authHeaders()
      const response = await fetch(`${HTTP_API_BASE}/migrate`, {
        method: 'POST',
        headers,
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
