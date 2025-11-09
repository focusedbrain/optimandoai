import type { BackendConfig } from '@shared/core/storage/StorageAdapter';

/**
 * Hybrid Storage Wrapper
 * Chrome Storage is always the primary backend for UI state (fast, <10ms)
 * PostgreSQL is an enhancement for specific features (vault, logs, vectors, GIS)
 */

// Extended BackendConfig type for hybrid approach
interface HybridBackendConfig {
  postgres?: {
    enabled: boolean;  // Is PostgreSQL connected and available?
    config?: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      ssl: boolean;
      schema: string;
    };
  };
}

let cachedBackendConfig: HybridBackendConfig | null = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 5000; // Cache config for 5 seconds

// Read cache for PostgreSQL backend
const readCache: Map<string, { value: any; timestamp: number }> = new Map();
const READ_CACHE_TTL = 2000; // Cache reads for 2 seconds

// Key patterns that should use PostgreSQL (enhanced features)
const POSTGRES_KEY_PATTERNS = [
  /^vault_/,           // Password vault entries
  /^log_/,             // Application logs
  /^vector_/,          // Vector embeddings
  /^gis_/,             // GIS/spatial data
  /^archive_session_/, // Archived sessions (optional)
];

/**
 * Determine if a key should be stored in PostgreSQL
 */
function shouldUsePostgres(key: string): boolean {
  return POSTGRES_KEY_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Get the current backend configuration (with caching)
 * Supports both old format (with active field) and new format (hybrid)
 */
async function getBackendConfig(): Promise<HybridBackendConfig & { postgresEnabled?: boolean }> {
  const now = Date.now();
  if (cachedBackendConfig && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return {
      ...cachedBackendConfig,
      postgresEnabled: cachedBackendConfig.postgres?.enabled || false,
    };
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(['backendConfig'], (result) => {
      const storedConfig: BackendConfig | HybridBackendConfig = result.backendConfig || {};
      
      // Migrate old format to new format
      let config: HybridBackendConfig;
      if ('active' in storedConfig && storedConfig.active === 'postgres') {
        // Old format: migrate to new format
        config = {
          postgres: {
            enabled: true,
            config: storedConfig.postgres,
          },
        };
        // Save migrated config
        chrome.storage.local.set({ backendConfig: config });
      } else {
        // New format or Chrome Storage only
        config = storedConfig as HybridBackendConfig;
      }
      
      cachedBackendConfig = config;
      configCacheTime = now;
      resolve({
        ...config,
        postgresEnabled: config.postgres?.enabled || false,
      });
    });
  });
}

/**
 * Invalidate the backend config cache (call when config changes)
 */
export function invalidateBackendConfigCache(): void {
  cachedBackendConfig = null;
  configCacheTime = 0;
}

/**
 * Invalidate read cache for specific keys or all keys
 */
function invalidateReadCache(keys?: string[]): void {
  if (!keys) {
    readCache.clear();
  } else {
    keys.forEach(key => readCache.delete(key));
  }
}

/**
 * Wrapper for chrome.storage.local.get with hybrid routing
 * UI state → Chrome Storage (fast)
 * Enhanced features → PostgreSQL (if enabled)
 */
export function storageGet(
  keys: string | string[] | null,
  callback: (items: { [key: string]: any }) => void
): void {
  getBackendConfig().then((config) => {
    const postgresEnabled = config.postgresEnabled || false;
    
    if (keys === null) {
      // Get all: fetch from both Chrome Storage and PostgreSQL
      chrome.storage.local.get(null, (chromeResults) => {
        if (!postgresEnabled) {
          callback(chromeResults);
          return;
        }
        
        // Also fetch from PostgreSQL for enhanced features
        import('./getActiveAdapter').then(({ getActiveAdapter }) => {
          return getActiveAdapter();
        }).then((adapter) => {
          adapter.getAll().then((postgresResults) => {
            // Merge results (PostgreSQL takes precedence for its keys)
            const merged = { ...chromeResults };
            Object.entries(postgresResults).forEach(([key, value]) => {
              if (shouldUsePostgres(key)) {
                merged[key] = value;
              }
            });
            callback(merged);
          }).catch(() => {
            // Fallback to Chrome Storage only
            callback(chromeResults);
          });
        }).catch(() => {
          callback(chromeResults);
        });
      });
      return;
    }
    
    // Get specific keys: route by pattern
    const keysArray = Array.isArray(keys) ? keys : [keys];
    const chromeKeys: string[] = [];
    const postgresKeys: string[] = [];
    
    keysArray.forEach((key) => {
      if (shouldUsePostgres(key) && postgresEnabled) {
        postgresKeys.push(key);
      } else {
        chromeKeys.push(key);
      }
    });
    
    // Get from Chrome Storage (always fast)
    chrome.storage.local.get(chromeKeys.length > 0 ? chromeKeys : null, (chromeResults) => {
      if (postgresKeys.length === 0) {
        callback(chromeResults);
        return;
      }
      
      // Get from PostgreSQL for enhanced features
      import('./getActiveAdapter').then(({ getActiveAdapter }) => {
        return getActiveAdapter();
      }).then((adapter) => {
        const now = Date.now();
        const results: { [key: string]: any } = { ...chromeResults };
        const keysToFetch: string[] = [];
        
        // Check cache first
        postgresKeys.forEach((key) => {
          const cached = readCache.get(key);
          if (cached && (now - cached.timestamp) < READ_CACHE_TTL) {
            results[key] = cached.value;
          } else {
            keysToFetch.push(key);
          }
        });
        
        if (keysToFetch.length === 0) {
          callback(results);
          return;
        }
        
        // Fetch remaining keys from PostgreSQL
        Promise.all(keysToFetch.map(key => adapter.get(key)))
          .then((postgresResults) => {
            postgresResults.forEach((value, index) => {
              const key = keysToFetch[index];
              if (value !== undefined) {
                results[key] = value;
                readCache.set(key, { value, timestamp: now });
              }
            });
            callback(results);
          })
          .catch((error) => {
            console.error('[storageWrapper] Error getting from PostgreSQL:', error);
            // Return Chrome Storage results only
            callback(chromeResults);
          });
      }).catch((error) => {
        console.error('[storageWrapper] Error getting adapter:', error);
        callback(chromeResults);
      });
    });
  });
}

/**
 * Wrapper for chrome.storage.local.set with hybrid routing
 * UI state → Chrome Storage (fast)
 * Enhanced features → PostgreSQL (if enabled)
 */
export function storageSet(
  items: { [key: string]: any },
  callback?: () => void
): void {
  getBackendConfig().then((config) => {
    const postgresEnabled = config.postgresEnabled || false;
    
    // Split items by destination
    const chromeItems: { [key: string]: any } = {};
    const postgresItems: { [key: string]: any } = {};
    
    Object.entries(items).forEach(([key, value]) => {
      if (shouldUsePostgres(key) && postgresEnabled) {
        postgresItems[key] = value;
      } else {
        chromeItems[key] = value;
      }
    });
    
    // Always save to Chrome Storage (for UI state and fallback)
    chrome.storage.local.set(chromeItems, () => {
      // Invalidate backend config cache if backendConfig changes
      if (items.backendConfig) {
        invalidateBackendConfigCache();
      }
      
      if (Object.keys(postgresItems).length === 0) {
        // All items went to Chrome Storage
        if (callback) callback();
        return;
      }
      
      // Save enhanced features to PostgreSQL
      import('./getActiveAdapter').then(({ getActiveAdapter }) => {
        return getActiveAdapter();
      }).then((adapter) => {
        // Invalidate cache for keys being written
        const keysToInvalidate = Object.keys(postgresItems);
        invalidateReadCache(keysToInvalidate);
        
        const keyCount = keysToInvalidate.length;
        const startTime = performance.now();
        console.log(`[storageWrapper] Saving ${keyCount} enhanced feature keys to PostgreSQL`);
        
        adapter.setAll(postgresItems)
          .then(() => {
            const duration = performance.now() - startTime;
            console.log(`[storageWrapper] PostgreSQL setAll() completed in ${duration.toFixed(2)}ms for ${keyCount} keys`);
            
            // Update read cache with new values
            const now = Date.now();
            Object.entries(postgresItems).forEach(([key, value]) => {
              readCache.set(key, { value, timestamp: now });
            });
            if (callback) callback();
          })
          .catch((error) => {
            console.error('[storageWrapper] Error setting items in PostgreSQL:', error);
            // Chrome Storage already saved, so we're good
            if (callback) callback();
          });
      }).catch((error) => {
        console.error('[storageWrapper] Error getting adapter:', error);
        // Chrome Storage already saved
        if (callback) callback();
      });
    });
  });
}

/**
 * Wrapper for chrome.storage.local.remove with hybrid routing
 */
export function storageRemove(
  keys: string | string[],
  callback?: () => void
): void {
  getBackendConfig().then((config) => {
    const postgresEnabled = config.postgresEnabled || false;
    const keysArray = Array.isArray(keys) ? keys : [keys];
    
    // Split keys by destination
    const chromeKeys: string[] = [];
    const postgresKeys: string[] = [];
    
    keysArray.forEach((key) => {
      if (shouldUsePostgres(key) && postgresEnabled) {
        postgresKeys.push(key);
      } else {
        chromeKeys.push(key);
      }
    });
    
    // Remove from Chrome Storage
    chrome.storage.local.remove(chromeKeys, () => {
      if (postgresKeys.length === 0) {
        if (callback) callback();
        return;
      }
      
      // Remove from PostgreSQL (set to undefined)
      const items: { [key: string]: any } = {};
      postgresKeys.forEach((key) => {
        items[key] = undefined;
        invalidateReadCache([key]);
      });
      storageSet(items, callback);
    });
  });
}

/**
 * Wrapper for chrome.storage.local.clear
 * Clears Chrome Storage (always)
 * Optionally clears PostgreSQL enhanced features (if enabled)
 */
export function storageClear(callback?: () => void): void {
  getBackendConfig().then((config) => {
    const postgresEnabled = config.postgresEnabled || false;
    
    // Always clear Chrome Storage
    chrome.storage.local.clear(() => {
      if (!postgresEnabled) {
        invalidateReadCache();
        if (callback) callback();
        return;
      }
      
      // Optionally clear PostgreSQL enhanced features
      import('./getActiveAdapter').then(({ getActiveAdapter }) => {
        return getActiveAdapter();
      }).then((adapter) => {
        adapter.getAll().then((allItems) => {
          const postgresKeys = Object.keys(allItems).filter(key => shouldUsePostgres(key));
          if (postgresKeys.length === 0) {
            invalidateReadCache();
            if (callback) callback();
            return;
          }
          // Clear read cache
          invalidateReadCache();
          // Remove PostgreSQL keys
          const items: { [key: string]: any } = {};
          postgresKeys.forEach((key) => {
            items[key] = undefined;
          });
          storageSet(items, callback);
        }).catch((error) => {
          console.error('[storageWrapper] Error clearing PostgreSQL:', error);
          invalidateReadCache();
          if (callback) callback();
        });
      }).catch((error) => {
        console.error('[storageWrapper] Error getting adapter:', error);
        invalidateReadCache();
        if (callback) callback();
      });
    });
  });
}

