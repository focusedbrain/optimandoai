import { ChromeStorageAdapter } from '@shared-extension/storage/ChromeStorageAdapter';
import type { StorageAdapter } from '@shared/core/storage/StorageAdapter';
import type { BackendConfig } from '@shared/core/storage/StorageAdapter';
import { OrchestratorSQLiteAdapter } from './OrchestratorSQLiteAdapter';

/**
 * Check if Electron backend is available
 */
async function checkElectronAvailability(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:51248/api/orchestrator/status', {
      method: 'GET',
      signal: AbortSignal.timeout(1000) // 1 second timeout
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Get the active storage adapter based on configuration
 * Priority: Orchestrator SQLite (if Electron available) > PostgreSQL > Chrome Storage
 */
export async function getActiveAdapter(): Promise<StorageAdapter> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['backendConfig', 'orchestratorConfig'], async (result) => {
      const config: BackendConfig | any = result.backendConfig || {};
      const orchestratorConfig: any = result.orchestratorConfig || {};
      
      // PRIORITY 1: Use SQLite if Electron is available (unless explicitly disabled)
      const sqliteExplicitlyDisabled = orchestratorConfig.sqliteEnabled === false;
      
      if (!sqliteExplicitlyDisabled) {
        const electronAvailable = await checkElectronAvailability();
        
        if (electronAvailable) {
          console.log('[getActiveAdapter] Using Orchestrator SQLite adapter (Electron available)')
          const adapter = new OrchestratorSQLiteAdapter();
          // Auto-connect in the background
          adapter.connect().catch(err => {
            console.error('[getActiveAdapter] Failed to connect to Orchestrator SQLite:', err)
          });
          resolve(adapter);
          return;
        } else {
          console.log('[getActiveAdapter] Electron backend not available, checking alternatives')
        }
      }
      
      // PRIORITY 2: Check if PostgreSQL is enabled (hybrid format)
      const postgresEnabled = config.postgres?.enabled || 
                             (config.active === 'postgres'); // Support old format
      
      if (postgresEnabled) {
        console.log('[getActiveAdapter] Using PostgreSQL proxy adapter')
        resolve(createPostgresProxyAdapter());
        return;
      }
      
      // PRIORITY 3: Fallback to Chrome Storage adapter
      console.log('[getActiveAdapter] Using Chrome Storage adapter (fallback)')
      resolve(new ChromeStorageAdapter());
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

