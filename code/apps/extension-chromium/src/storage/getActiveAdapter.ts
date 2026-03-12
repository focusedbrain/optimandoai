import { ChromeStorageAdapter } from '@shared-extension/storage/ChromeStorageAdapter';
import type { StorageAdapter, BackendConfig } from '@shared/storage/StorageAdapter';
import { OrchestratorSQLiteAdapter } from './OrchestratorSQLiteAdapter';

const ORCHESTRATOR_STATUS_URL = 'http://127.0.0.1:51248/api/orchestrator/status';

type ConnectionResult = { available: boolean; error?: string; corsOk?: boolean; status?: number };

/**
 * Check if Electron backend is available. Returns diagnostic info for logging.
 */
async function checkElectronAvailability(): Promise<ConnectionResult> {
  try {
    const response = await fetch(ORCHESTRATOR_STATUS_URL, {
      method: 'GET',
      mode: 'cors',
      signal: AbortSignal.timeout(1000),
    });
    const corsOk = response.type !== 'opaque';
    return {
      available: response.ok,
      corsOk,
      status: response.status,
    };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const isCorsOrPna = /cors|blocked|network|failed|refused/i.test(errMsg);
    return {
      available: false,
      error: errMsg,
      corsOk: !isCorsOrPna,
    };
  }
}

function logConnectionDiagnostics(
  origin: string,
  result: ConnectionResult,
  adapter: 'electron-backend' | 'postgres' | 'chrome-storage',
  orchestratorExpected: boolean
): void {
  const payload = {
    origin,
    allowed: result.available,
    corsOk: result.corsOk,
    status: result.status,
    error: result.error,
    adapter,
    orchestratorExpected,
  };
  console.log('[ORCHESTRATOR_CONNECTION]', JSON.stringify(payload));
}

/**
 * Get the active storage adapter based on configuration
 * Priority: Orchestrator SQLite (if Electron available) > PostgreSQL > Chrome Storage
 *
 * Fallback to Chrome Storage only when orchestrator is explicitly disabled.
 * When orchestrator is expected but unreachable, logs a clear error.
 */
export async function getActiveAdapter(): Promise<StorageAdapter> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['backendConfig', 'orchestratorConfig'], async (result) => {
      const config: BackendConfig | any = result.backendConfig || {};
      const orchestratorConfig: any = result.orchestratorConfig || {};
      const origin =
        typeof chrome !== 'undefined' && chrome.runtime?.getURL
          ? new URL(chrome.runtime.getURL('')).origin
          : 'unknown';

      const sqliteExplicitlyDisabled = orchestratorConfig.sqliteEnabled === false;

      if (!sqliteExplicitlyDisabled) {
        const connResult = await checkElectronAvailability();

        if (connResult.available) {
          logConnectionDiagnostics(origin, connResult, 'electron-backend', true);
          console.log('[getActiveAdapter] Using Orchestrator SQLite adapter (Electron available)');
          const adapter = new OrchestratorSQLiteAdapter();
          adapter.connect().catch((err) => {
            console.error('[getActiveAdapter] Failed to connect to Orchestrator SQLite:', err);
          });
          resolve(adapter);
          return;
        }

        logConnectionDiagnostics(origin, connResult, 'electron-backend', true);
        const errDetail = connResult.error ? connResult.error : `HTTP ${connResult.status}`;
        console.error(
          '[getActiveAdapter] Orchestrator backend expected but unreachable. ' +
            'Tier detection and feature gating may be incorrect. ' +
            'Ensure the WRDesk Electron app is running. ' +
            errDetail
        );

        const postgresEnabled =
          config.postgres?.enabled || config.active === 'postgres';
        if (postgresEnabled) {
          console.log('[getActiveAdapter] Using PostgreSQL proxy adapter');
          resolve(createPostgresProxyAdapter());
          return;
        }

        const err = new Error(
          `Orchestrator backend expected but unreachable (${errDetail}). ` +
            'Start the WRDesk Electron app for correct tier and feature gating.'
        );
        reject(err);
        return;
      }

      const postgresEnabled =
        config.postgres?.enabled || config.active === 'postgres';
      if (postgresEnabled) {
        logConnectionDiagnostics(origin, { available: false }, 'postgres', false);
        console.log('[getActiveAdapter] Using PostgreSQL proxy adapter');
        resolve(createPostgresProxyAdapter());
        return;
      }

      logConnectionDiagnostics(origin, { available: false }, 'chrome-storage', false);
      console.log('[getActiveAdapter] Using Chrome Storage adapter (orchestrator explicitly disabled)');
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

