/// <reference types="chrome"/>
/**
 * Extension Orchestrator Bridge
 * 
 * Real implementation of OrchestratorBridge for Chrome extension.
 * Connects mini-apps to the Electron orchestrator via:
 * - WebSocket (port 51247) for real-time events
 * - HTTP API (port 51248) for data operations
 * 
 * This replaces the mock bridge used in development/testing.
 */

import type { OrchestratorBridge } from '@optimandoai/code-block-library';

const HTTP_API_BASE = 'http://127.0.0.1:51248';
const WS_PORT = 51247;

type EventHandler = (data: unknown) => void;

/**
 * Manages event subscriptions for the bridge
 */
class EventManager {
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private chromeListener: ((message: any) => void) | null = null;

  constructor() {
    this.setupChromeListener();
  }

  private setupChromeListener(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      this.chromeListener = (message: any) => {
        if (message && message.type) {
          this.emit(message.type, message.data || message);
        }
      };
      chrome.runtime.onMessage.addListener(this.chromeListener);
    }
  }

  subscribe(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.listeners.get(event);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.listeners.delete(event);
        }
      }
    };
  }

  emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[ExtensionBridge] Error in handler for ${event}:`, err);
        }
      });
    }
  }

  destroy(): void {
    if (this.chromeListener && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.chromeListener);
    }
    this.listeners.clear();
  }
}

/**
 * Create a real OrchestratorBridge for Chrome extension
 * 
 * This bridge:
 * - Sends messages via chrome.runtime.sendMessage → background.ts → WebSocket
 * - Receives events from background.ts → chrome.runtime.onMessage
 * - Calls HTTP API for AI requests and data operations
 * - Can open files in the editor via IPC
 */
export function createExtensionBridge(): OrchestratorBridge {
  const eventManager = new EventManager();
  
  console.log('[ExtensionBridge] Creating real orchestrator bridge');

  return {
    /**
     * Send a message to the orchestrator via background.ts → WebSocket
     */
    sendMessage: (type: string, data: unknown): void => {
      console.log('[ExtensionBridge] Sending message:', type, data);
      
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type,
          ...(typeof data === 'object' && data !== null ? data : { data })
        }).catch(err => {
          console.error('[ExtensionBridge] Failed to send message:', err);
        });
      } else {
        console.warn('[ExtensionBridge] chrome.runtime not available');
      }
    },

    /**
     * Subscribe to orchestrator events
     * Events come from background.ts via chrome.runtime.onMessage
     */
    subscribe: (event: string, handler: EventHandler): (() => void) => {
      console.log('[ExtensionBridge] Subscribing to:', event);
      return eventManager.subscribe(event, handler);
    },

    /**
     * Get current panel position (always sidebar in extension context)
     */
    getPanel: (): 'sidebar' | 'overlay' | 'floating' => {
      return 'sidebar';
    },

    /**
     * Request AI analysis via HTTP API
     * Uses Ollama/LLM endpoint at :51248
     */
    requestAI: async (prompt: string, context?: unknown): Promise<string> => {
      console.log('[ExtensionBridge] Requesting AI:', prompt.substring(0, 50) + '...');
      
      try {
        const response = await fetch(`${HTTP_API_BASE}/api/llm/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'system', content: "your are a comedian" },{ role: 'user', content: prompt }],// todo: added { role: 'system', content: "your are a comedian" } to test from where the request is going
            context,
            stream: false
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.error) {
          throw new Error(result.error);
        }

        return result.response || result.message?.content || '';
      } catch (err) {
        console.error('[ExtensionBridge] AI request failed:', err);
        throw err;
      }
    },

    /**
     * Open file in editor (Cursor/VS Code)
     * Sends command to Electron which opens the file
     */
    openFile: (filePath: string, lineNumber?: number): void => {
      console.log('[ExtensionBridge] Opening file:', filePath, 'at line:', lineNumber);
      
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'OPEN_FILE_IN_EDITOR',
          filePath,
          lineNumber
        }).catch(err => {
          console.error('[ExtensionBridge] Failed to open file:', err);
        });
      }
    }
  };
}

/**
 * Extended bridge with additional capabilities for Glassview
 */
export interface ExtendedOrchestratorBridge extends OrchestratorBridge {
  /** Load a template by name from Electron */
  loadTemplate: (templateName: string) => Promise<string>;
  
  /** Get current connection status */
  getConnectionStatus: () => Promise<{ isConnected: boolean; readyState?: number }>;
  
  /** Send trigger to agent box */
  sendTrigger: (triggerId: string, context: unknown) => void;
  
  /** Get Cursor changed files */
  getCursorChangedFiles: () => Promise<string[]>;
  
  /** Emit an event (for demo mode / testing) */
  emit: (event: string, data: unknown) => void;
  
  /** Destroy bridge and cleanup */
  destroy: () => void;
}

/**
 * Create an extended bridge with additional Glassview-specific features
 */
export function createExtendedBridge(): ExtendedOrchestratorBridge {
  const baseBridge = createExtensionBridge();
  const eventManager = new EventManager();

  return {
    ...baseBridge,

    /**
     * Load a template from Electron via HTTP API
     */
    loadTemplate: async (templateName: string): Promise<string> => {
      console.log('[ExtensionBridge] Loading template:', templateName);
      
      try {
        // Try HTTP API first (faster)
        const response = await fetch(`${HTTP_API_BASE}/api/templates/${templateName}`);
        
        if (response.ok) {
          const result = await response.json();
          if (result.ok && result.content) {
            return result.content;
          }
        }
        
        // Fallback to WebSocket via background.ts
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Template load timeout'));
          }, 10000);

          const unsubscribe = eventManager.subscribe('TEMPLATE_RESULT', (data: any) => {
            if (data.name === templateName) {
              clearTimeout(timeout);
              unsubscribe();
              resolve(data.content);
            }
          });

          const errorUnsubscribe = eventManager.subscribe('TEMPLATE_ERROR', (data: any) => {
            if (data.name === templateName) {
              clearTimeout(timeout);
              errorUnsubscribe();
              reject(new Error(data.error));
            }
          });

          // Request via WebSocket
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'GET_TEMPLATE', name: templateName });
          }
        });
      } catch (err) {
        console.error('[ExtensionBridge] Failed to load template:', err);
        throw err;
      }
    },

    /**
     * Get current WebSocket connection status
     */
    getConnectionStatus: async (): Promise<{ isConnected: boolean; readyState?: number }> => {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
            resolve({
              isConnected: response?.isConnected || false,
              readyState: response?.readyState
            });
          });
        } else {
          resolve({ isConnected: false });
        }
      });
    },

    /**
     * Send a trigger to the orchestrator for agent processing
     */
    sendTrigger: (triggerId: string, context: unknown): void => {
      console.log('[ExtensionBridge] Sending trigger:', triggerId);
      
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'EXECUTE_TRIGGER',
          triggerId,
          context
        });
      }
    },

    /**
     * Get list of files changed in current Cursor session
     */
    getCursorChangedFiles: async (): Promise<string[]> => {
      console.log('[ExtensionBridge] Getting Cursor changed files');
      
      try {
        // Try HTTP API
        const response = await fetch(`${HTTP_API_BASE}/api/cursor/changed-files`);
        
        if (response.ok) {
          const result = await response.json();
          return result.files || [];
        }
        
        // Fallback to WebSocket
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve([]), 5000);

          const unsubscribe = eventManager.subscribe('cursor:files_changed', (data: any) => {
            clearTimeout(timeout);
            unsubscribe();
            resolve(data.files || []);
          });

          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            chrome.runtime.sendMessage({ type: 'GET_CURSOR_FILES' });
          }
        });
      } catch (err) {
        console.error('[ExtensionBridge] Failed to get Cursor files:', err);
        return [];
      }
    },

    /**
     * Emit an event to all subscribers (for demo mode / testing)
     */
    emit: (event: string, data: unknown): void => {
      console.log('[ExtensionBridge] Emitting event:', event, data);
      eventManager.emit(event, data);
    },

    /**
     * Cleanup subscriptions
     */
    destroy: (): void => {
      eventManager.destroy();
    }
  };
}

/**
 * Singleton instance for shared bridge across components
 */
let sharedBridge: ExtendedOrchestratorBridge | null = null;

/**
 * Get or create a shared bridge instance
 * Use this for components that need the same bridge
 */
export function getSharedBridge(): ExtendedOrchestratorBridge {
  if (!sharedBridge) {
    sharedBridge = createExtendedBridge();
  }
  return sharedBridge;
}

/**
 * Reset the shared bridge (useful for testing)
 */
export function resetSharedBridge(): void {
  if (sharedBridge) {
    sharedBridge.destroy();
    sharedBridge = null;
  }
}

// Default export
export default createExtensionBridge;
