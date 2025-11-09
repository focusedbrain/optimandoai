import { ChromeStorageAdapter } from '@shared-extension/storage/ChromeStorageAdapter';
import type { StorageAdapter } from '@shared/core/storage/StorageAdapter';
import type { BackendConfig } from '@shared/core/storage/StorageAdapter';

/**
 * Get the PostgreSQL adapter for enhanced features
 * Returns a proxy adapter that routes through Electron via HTTP API
 * Chrome Storage is always used for UI state (handled by storageWrapper)
 */
export async function getActiveAdapter(): Promise<StorageAdapter> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['backendConfig'], (result) => {
      const config: BackendConfig | any = result.backendConfig || {};
      
      // Check if PostgreSQL is enabled (new hybrid format)
      const postgresEnabled = config.postgres?.enabled || 
                             (config.active === 'postgres'); // Support old format
      
      if (postgresEnabled) {
        // Return PostgreSQL proxy adapter
        resolve(createPostgresProxyAdapter());
      } else {
        // Fallback to Chrome Storage adapter (shouldn't normally be used with hybrid approach)
        resolve(new ChromeStorageAdapter());
      }
    });
  });
}

const HTTP_API_BASE = 'http://127.0.0.1:51248/api/db';

/**
 * Create a proxy adapter that routes Postgres operations through Electron via HTTP API
 */
function createPostgresProxyAdapter(): StorageAdapter {
  return {
    async get<T = any>(key: string): Promise<T | undefined> {
      try {
        const response = await fetch(`${HTTP_API_BASE}/get?keys=${encodeURIComponent(key)}`, {
          method: 'GET',
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        if (!result.ok) {
          throw new Error(result.message || 'Failed to get value');
        }
        return result.data?.[key];
      } catch (error: any) {
        console.error('[PostgresProxyAdapter] Error in get:', error);
        throw error;
      }
    },

    async set<T = any>(key: string, value: T): Promise<void> {
      try {
        const response = await fetch(`${HTTP_API_BASE}/set`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        if (!result.ok) {
          throw new Error(result.message || 'Failed to set value');
        }
      } catch (error: any) {
        console.error('[PostgresProxyAdapter] Error in set:', error);
        throw error;
      }
    },

    async getAll(): Promise<Record<string, any>> {
      try {
        const response = await fetch(`${HTTP_API_BASE}/get-all`, {
          method: 'GET',
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        if (!result.ok) {
          throw new Error(result.message || 'Failed to get all values');
        }
        return result.data || {};
      } catch (error: any) {
        console.error('[PostgresProxyAdapter] Error in getAll:', error);
        throw error;
      }
    },

    async setAll(payload: Record<string, any>): Promise<void> {
      try {
        const response = await fetch(`${HTTP_API_BASE}/set-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        if (!result.ok) {
          throw new Error(result.message || 'Failed to set all values');
        }
      } catch (error: any) {
        console.error('[PostgresProxyAdapter] Error in setAll:', error);
        throw error;
      }
    },
  };
}

