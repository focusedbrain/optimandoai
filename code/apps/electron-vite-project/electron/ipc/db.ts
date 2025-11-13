import { ipcMain } from 'electron';
import { PostgresAdapter, type PostgresConfig } from '../storage/PostgresAdapter';
import type { AdapterResult } from '../../../../packages/shared/src/storage/StorageAdapter';

// Global adapter instance
let postgresAdapter: PostgresAdapter | null = null;

/**
 * Get the current Postgres adapter instance
 */
export function getPostgresAdapter(): PostgresAdapter | null {
  return postgresAdapter;
}

/**
 * Redact password from config for logging
 */
function redactPassword(config: PostgresConfig): Omit<PostgresConfig, 'password'> & { password: string } {
  return {
    ...config,
    password: '***REDACTED***',
  };
}

/**
 * Test Postgres connection and run migrations
 */
export async function testConnection(config: PostgresConfig): Promise<AdapterResult> {
  try {
    // Close existing adapter if any
    if (postgresAdapter) {
      await postgresAdapter.close();
      postgresAdapter = null;
    }

    // Create new adapter
    const adapter = new PostgresAdapter(config);
    await adapter.connect();

    // Store adapter for future use
    postgresAdapter = adapter;

    console.log('[DB] Connection test successful:', redactPassword(config));

    return {
      ok: true,
      message: 'Connection successful',
      details: {
        host: config.host,
        port: config.port,
        database: config.database,
        schema: config.schema,
      },
    };
  } catch (error: any) {
    console.error('[DB] Connection test failed:', error);
    const errorDetails: any = {
      error: error.toString(),
      message: error.message || 'Connection failed',
    };
    
    // Add more specific error information if available
    if (error.code) {
      errorDetails.code = error.code;
    }
    if (error.stack) {
      errorDetails.stack = error.stack;
    }
    if (error.host) {
      errorDetails.host = error.host;
    }
    if (error.port) {
      errorDetails.port = error.port;
    }
    
    return {
      ok: false,
      message: error.message || error.toString() || 'Connection failed',
      details: errorDetails,
    };
  }
}

/**
 * Sync Chrome Storage → Postgres
 * This reads all keys from Chrome storage and upserts them to Postgres
 * Currently unused
 */
/*
async function syncChromeToPostgres(): Promise<AdapterResult> {
  try {
    if (!postgresAdapter) {
      return {
        ok: false,
        message: 'Postgres adapter not initialized. Please test connection first.',
      };
    }

    // This function will be called from the extension via WebSocket
    // The extension will send all Chrome storage data
    // For now, return a placeholder that expects data to be passed
    return {
      ok: false,
      message: 'Sync requires Chrome storage data to be passed',
    };
  } catch (error: any) {
    console.error('[DB] Sync error:', error.message);
    return {
      ok: false,
      message: error.message || 'Sync failed',
      details: {
        error: error.toString(),
      },
    };
  }
}
*/

/**
 * Sync Chrome Storage data to Postgres
 * Receives the data from extension
 */
export async function syncChromeDataToPostgres(data: Record<string, any>): Promise<AdapterResult> {
  try {
    if (!postgresAdapter) {
      return {
        ok: false,
        message: 'Postgres adapter not initialized. Please test connection first.',
      };
    }

    const keys = Object.keys(data);
    if (keys.length === 0) {
      return {
        ok: true,
        message: 'No data to sync',
        count: 0,
      };
    }

    await postgresAdapter.setAll(data);

    console.log(`[DB] Synced ${keys.length} items from Chrome Storage to Postgres`);

    return {
      ok: true,
      message: `Successfully synced ${keys.length} items`,
      count: keys.length,
    };
  } catch (error: any) {
    console.error('[DB] Sync error:', error.message);
    return {
      ok: false,
      message: error.message || 'Sync failed',
      details: {
        error: error.toString(),
      },
    };
  }
}

/**
 * Get current backend configuration
 */
export async function getConfig(): Promise<AdapterResult> {
  try {
    // Return config if adapter exists
    if (postgresAdapter) {
      return {
        ok: true,
        message: 'Postgres adapter is active',
        details: {
          active: 'postgres',
        },
      };
    }

    return {
      ok: true,
      message: 'Chrome Storage is active',
      details: {
        active: 'chrome',
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      message: error.message || 'Failed to get config',
    };
  }
}

/**
 * Register IPC handlers
 */
export function registerDbHandlers(): void {
  ipcMain.handle('db:testConnection', async (_event, config: PostgresConfig) => {
    return testConnection(config);
  });

  ipcMain.handle('db:sync', async (_event, data: Record<string, any>) => {
    return syncChromeDataToPostgres(data);
  });

  ipcMain.handle('db:getConfig', async () => {
    return getConfig();
  });

  console.log('[DB] IPC handlers registered');
}

