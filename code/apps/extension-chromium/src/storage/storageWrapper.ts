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
const READ_CACHE_TTL = 0; // Disabled: Cache reads for 0ms to ensure fresh data

// Key patterns that should use the active adapter (SQLite/PostgreSQL) instead of Chrome Storage
const ADAPTER_KEY_PATTERNS = [
  /^session_/,         // Session data (NEW: routed to SQLite by default)
  /^vault_/,           // Password vault entries
  /^log_/,             // Application logs
  /^vector_/,          // Vector embeddings
  /^gis_/,             // GIS/spatial data
  /^archive_session_/, // Archived sessions (optional)
];

/**
 * Determine if a key should be stored via active adapter (SQLite/PostgreSQL)
 */
function shouldUseAdapter(key: string): boolean {
  return ADAPTER_KEY_PATTERNS.some(pattern => pattern.test(key));
}

/**
 * Legacy function for backward compatibility
 */
function shouldUsePostgres(key: string): boolean {
  return shouldUseAdapter(key);
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
 * Wrapper for chrome.storage.local.get with smart routing
 * Sessions → Active Adapter (SQLite/PostgreSQL)
 * UI state → Chrome Storage (fast, fallback)
 */
export function storageGet(
  keys: string | string[] | null,
  callback: (items: { [key: string]: any }) => void
): void {
  if (keys === null) {
    // Get all: fetch from both Chrome Storage and active adapter
    chrome.storage.local.get(null, (chromeResults) => {
      // Try to get from active adapter as well
      import('./getActiveAdapter').then(({ getActiveAdapter }) => {
        return getActiveAdapter();
      }).then((adapter) => {
        adapter.getAll().then((adapterResults) => {
          // Merge results (adapter takes precedence for its keys)
          const merged = { ...chromeResults };
          Object.entries(adapterResults).forEach(([key, value]) => {
            if (shouldUseAdapter(key)) {
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
  const adapterKeys: string[] = [];
  
  keysArray.forEach((key) => {
    if (shouldUseAdapter(key)) {
      adapterKeys.push(key);
    } else {
      chromeKeys.push(key);
    }
  });
  
  // Get from Chrome Storage for non-adapter keys (or fallback for adapter keys)
  chrome.storage.local.get(chromeKeys.length > 0 ? chromeKeys : null, (chromeResults) => {
    if (adapterKeys.length === 0) {
      callback(chromeResults);
      return;
    }
    
    // Get from active adapter for session/enhanced data
    import('./getActiveAdapter').then(({ getActiveAdapter }) => {
      return getActiveAdapter();
    }).then((adapter) => {
      const now = Date.now();
      const results: { [key: string]: any } = { ...chromeResults };
      const keysToFetch: string[] = [];
      
      // Check cache first
      adapterKeys.forEach((key) => {
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
      
      // Fetch remaining keys from adapter
      Promise.all(keysToFetch.map(key => adapter.get(key)))
        .then((adapterResults) => {
          adapterResults.forEach((value, index) => {
            const key = keysToFetch[index];
            if (value !== undefined) {
              results[key] = value;
              readCache.set(key, { value, timestamp: now });
            }
          });
          callback(results);
        })
        .catch((error) => {
          console.error('[storageWrapper] Error getting from adapter:', error);
          // Fallback: try Chrome Storage for adapter keys
          chrome.storage.local.get(adapterKeys, (fallbackResults) => {
            Object.assign(results, fallbackResults);
            callback(results);
          });
        });
    }).catch((error) => {
      console.error('[storageWrapper] Error getting adapter:', error);
      // Fallback to Chrome Storage for adapter keys
      chrome.storage.local.get(adapterKeys, (fallbackResults) => {
        Object.assign(chromeResults, fallbackResults);
        callback(chromeResults);
      });
    });
  });
}

/**
 * Wrapper for chrome.storage.local.set with smart routing
 * Sessions → Active Adapter (SQLite/PostgreSQL)
 * UI state → Chrome Storage (fast, fallback)
 */
export function storageSet(
  items: { [key: string]: any },
  callback?: () => void
): void {
  // Split items by destination
  const chromeItems: { [key: string]: any } = {};
  const adapterItems: { [key: string]: any } = {};
  
  Object.entries(items).forEach(([key, value]) => {
    if (shouldUseAdapter(key)) {
      adapterItems[key] = value;
    } else {
      chromeItems[key] = value;
    }
  });
  
  // Save to Chrome Storage (for UI state and fallback)
  chrome.storage.local.set(chromeItems, () => {
    // Invalidate backend config cache if backendConfig changes
    if (items.backendConfig || items.orchestratorConfig) {
      invalidateBackendConfigCache();
    }
    
    if (Object.keys(adapterItems).length === 0) {
      // All items went to Chrome Storage
      if (callback) callback();
      return;
    }
    
    // Save session/enhanced data to active adapter
    import('./getActiveAdapter').then(({ getActiveAdapter }) => {
      return getActiveAdapter();
    }).then((adapter) => {
      // Invalidate cache for keys being written
      const keysToInvalidate = Object.keys(adapterItems);
      invalidateReadCache(keysToInvalidate);
      
      const keyCount = keysToInvalidate.length;
      const startTime = performance.now();
      console.log(`[storageWrapper] Saving ${keyCount} keys to active adapter (SQLite/PostgreSQL)`);
      
      adapter.setAll(adapterItems)
        .then(() => {
          const duration = performance.now() - startTime;
          console.log(`[storageWrapper] Adapter setAll() completed in ${duration.toFixed(2)}ms for ${keyCount} keys`);
          
          // Update read cache with new values
          const now = Date.now();
          Object.entries(adapterItems).forEach(([key, value]) => {
            readCache.set(key, { value, timestamp: now });
          });
          if (callback) callback();
        })
        .catch((error) => {
          console.error('[storageWrapper] Error setting items in adapter:', error);
          // Fallback: also save to Chrome Storage
          chrome.storage.local.set(adapterItems, () => {
            console.log('[storageWrapper] Fallback: Saved to Chrome Storage');
            if (callback) callback();
          });
        });
    }).catch((error) => {
      console.error('[storageWrapper] Error getting adapter:', error);
      // Fallback: save to Chrome Storage
      chrome.storage.local.set(adapterItems, () => {
        console.log('[storageWrapper] Fallback: Saved to Chrome Storage');
        if (callback) callback();
      });
    });
  });
}

/**
 * Wrapper for chrome.storage.local.remove with smart routing
 */
export function storageRemove(
  keys: string | string[],
  callback?: () => void
): void {
  const keysArray = Array.isArray(keys) ? keys : [keys];
  
  // Split keys by destination
  const chromeKeys: string[] = [];
  const adapterKeys: string[] = [];
  
  keysArray.forEach((key) => {
    if (shouldUseAdapter(key)) {
      adapterKeys.push(key);
    } else {
      chromeKeys.push(key);
    }
  });
  
  // IMPORTANT: Remove adapter keys from Chrome Storage too (for fallback/migration cleanup)
  const allKeysToRemoveFromChrome = [...chromeKeys, ...adapterKeys];
  
  // Remove from Chrome Storage
  chrome.storage.local.remove(allKeysToRemoveFromChrome, () => {
    if (adapterKeys.length === 0) {
      if (callback) callback();
      return;
    }
    
    // Remove from adapter using the remove() method
    import('./getActiveAdapter').then(({ getActiveAdapter }) => {
      return getActiveAdapter();
    }).then((adapter) => {
      // Invalidate cache for these keys
      invalidateReadCache(adapterKeys);
      
      // Call adapter's remove method
      adapter.remove(adapterKeys).then(() => {
        console.log('[storageRemove] ✅ Removed keys from SQLite:', adapterKeys);
        if (callback) callback();
      }).catch((error) => {
        console.error('[storageRemove] ❌ Failed to remove from adapter:', error);
        // Fallback: try using set with undefined
        const items: { [key: string]: any } = {};
        adapterKeys.forEach((key) => {
          items[key] = undefined;
        });
        storageSet(items, callback);
      });
    }).catch((error) => {
      console.error('[storageRemove] ❌ Failed to get adapter:', error);
      if (callback) callback();
    });
  });
}

/**
 * Wrapper for chrome.storage.local.clear
 * Clears Chrome Storage (always)
 * Optionally clears adapter data (SQLite/PostgreSQL)
 */
export function storageClear(callback?: () => void): void {
  // Always clear Chrome Storage
  chrome.storage.local.clear(() => {
    // Try to clear adapter as well
    import('./getActiveAdapter').then(({ getActiveAdapter }) => {
      return getActiveAdapter();
    }).then((adapter) => {
      adapter.getAll().then((allItems) => {
        const adapterKeys = Object.keys(allItems).filter(key => shouldUseAdapter(key));
        if (adapterKeys.length === 0) {
          invalidateReadCache();
          if (callback) callback();
          return;
        }
        // Clear read cache
        invalidateReadCache();
        // Remove adapter keys
        const items: { [key: string]: any } = {};
        adapterKeys.forEach((key) => {
          items[key] = undefined;
        });
        storageSet(items, callback);
      }).catch((error) => {
        console.error('[storageWrapper] Error clearing adapter:', error);
        invalidateReadCache();
        if (callback) callback();
      });
    }).catch((error) => {
      console.error('[storageWrapper] Error getting adapter:', error);
      invalidateReadCache();
      if (callback) callback();
    });
  });
}

