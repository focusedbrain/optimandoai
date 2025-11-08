import { ChromeStorageAdapter } from '@shared-extension/storage/ChromeStorageAdapter';
import type { StorageAdapter } from '@shared/core/storage/StorageAdapter';
import type { BackendConfig } from '@shared/core/storage/StorageAdapter';

/**
 * Get the active storage adapter based on backend configuration
 * When Postgres is active, routes through Electron via WebSocket
 */
export async function getActiveAdapter(): Promise<StorageAdapter> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['backendConfig'], (result) => {
      const config: BackendConfig = result.backendConfig || { active: 'chrome' };
      
      if (config.active === 'chrome') {
        // Use Chrome Storage directly
        resolve(new ChromeStorageAdapter());
      } else {
        // For Postgres, we need to route through Electron
        // Create a proxy adapter that makes WebSocket calls
        resolve(createPostgresProxyAdapter());
      }
    });
  });
}

/**
 * Create a proxy adapter that routes Postgres operations through Electron via WebSocket
 */
function createPostgresProxyAdapter(): StorageAdapter {
  return {
    async get<T = any>(key: string): Promise<T | undefined> {
      return new Promise((resolve, reject) => {
        const listener = (message: any) => {
          if (message.type === 'DB_GET_RESULT') {
            chrome.runtime.onMessage.removeListener(listener);
            if (message.ok) {
              resolve(message.value);
            } else {
              reject(new Error(message.message || 'Failed to get value'));
            }
          }
        };
        chrome.runtime.onMessage.addListener(listener);
        
        chrome.runtime.sendMessage(
          {
            type: 'DB_WEBSOCKET_MESSAGE',
            wsType: 'DB_GET',
            data: { key },
          },
          () => {
            if (chrome.runtime.lastError) {
              chrome.runtime.onMessage.removeListener(listener);
              reject(new Error(chrome.runtime.lastError.message));
            }
          }
        );
        
        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error('Timeout waiting for DB_GET_RESULT'));
        }, 10000);
      });
    },

    async set<T = any>(key: string, value: T): Promise<void> {
      return new Promise((resolve, reject) => {
        const listener = (message: any) => {
          if (message.type === 'DB_SET_RESULT') {
            chrome.runtime.onMessage.removeListener(listener);
            if (message.ok) {
              resolve();
            } else {
              reject(new Error(message.message || 'Failed to set value'));
            }
          }
        };
        chrome.runtime.onMessage.addListener(listener);
        
        chrome.runtime.sendMessage(
          {
            type: 'DB_WEBSOCKET_MESSAGE',
            wsType: 'DB_SET',
            data: { key, value },
          },
          () => {
            if (chrome.runtime.lastError) {
              chrome.runtime.onMessage.removeListener(listener);
              reject(new Error(chrome.runtime.lastError.message));
            }
          }
        );
        
        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error('Timeout waiting for DB_SET_RESULT'));
        }, 10000);
      });
    },

    async getAll(): Promise<Record<string, any>> {
      return new Promise((resolve, reject) => {
        const listener = (message: any) => {
          if (message.type === 'DB_GET_ALL_RESULT') {
            chrome.runtime.onMessage.removeListener(listener);
            if (message.ok) {
              resolve(message.data || {});
            } else {
              reject(new Error(message.message || 'Failed to get all values'));
            }
          }
        };
        chrome.runtime.onMessage.addListener(listener);
        
        chrome.runtime.sendMessage(
          {
            type: 'DB_WEBSOCKET_MESSAGE',
            wsType: 'DB_GET_ALL',
            data: {},
          },
          () => {
            if (chrome.runtime.lastError) {
              chrome.runtime.onMessage.removeListener(listener);
              reject(new Error(chrome.runtime.lastError.message));
            }
          }
        );
        
        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error('Timeout waiting for DB_GET_ALL_RESULT'));
        }, 10000);
      });
    },

    async setAll(payload: Record<string, any>): Promise<void> {
      return new Promise((resolve, reject) => {
        const listener = (message: any) => {
          if (message.type === 'DB_SET_ALL_RESULT') {
            chrome.runtime.onMessage.removeListener(listener);
            if (message.ok) {
              resolve();
            } else {
              reject(new Error(message.message || 'Failed to set all values'));
            }
          }
        };
        chrome.runtime.onMessage.addListener(listener);
        
        chrome.runtime.sendMessage(
          {
            type: 'DB_WEBSOCKET_MESSAGE',
            wsType: 'DB_SET_ALL',
            data: { payload },
          },
          () => {
            if (chrome.runtime.lastError) {
              chrome.runtime.onMessage.removeListener(listener);
              reject(new Error(chrome.runtime.lastError.message));
            }
          }
        );
        
        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(listener);
          reject(new Error('Timeout waiting for DB_SET_ALL_RESULT'));
        }, 10000);
      });
    },
  };
}

