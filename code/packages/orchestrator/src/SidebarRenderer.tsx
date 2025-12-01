/**
 * SidebarRenderer
 * 
 * React component for rendering mini-apps in the sidebar.
 * This runs in the renderer process (Electron/browser) and
 * communicates with SidebarManager via IPC.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { MiniAppPanel, OrchestratorBridge, createMockOrchestratorBridge } from '@optimandoai/code-block-library';

export interface SidebarRendererProps {
  /** Initial template text (if not loading via IPC) */
  initialTemplate?: string;
  
  /** Sidebar position */
  position?: 'left' | 'right';
  
  /** Initial width */
  width?: number;
  
  /** Whether to use Electron IPC or mock bridge */
  useElectronIPC?: boolean;
  
  /** Called when sidebar should close */
  onClose?: () => void;
  
  /** Called when sidebar is minimized */
  onMinimize?: () => void;
}

interface SidebarState {
  visible: boolean;
  activeApp: string | null;
  template: string | null;
  loading: boolean;
  error: string | null;
  cursorFiles: string[];
  connected: boolean;
}

/**
 * Create orchestrator bridge that connects to Electron IPC
 */
function createElectronBridge(): OrchestratorBridge {
  // Check if we're in Electron
  const isElectron = typeof window !== 'undefined' && 
    (window as any).electronAPI !== undefined;
  
  if (!isElectron) {
    console.log('[SidebarRenderer] Not in Electron, using mock bridge');
    return createMockOrchestratorBridge();
  }
  
  const electronAPI = (window as any).electronAPI;
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  
  return {
    sendMessage: (type, data) => {
      console.log('[ElectronBridge] Sending message:', type);
      electronAPI.send('sidebar:message', { type, data });
    },
    
    subscribe: (event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
        
        // Set up IPC listener for this event
        electronAPI.on(event, (_: any, data: any) => {
          listeners.get(event)?.forEach(h => h(data));
        });
      }
      listeners.get(event)!.add(handler);
      
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },
    
    getPanel: () => 'sidebar',
    
    requestAI: async (prompt, context) => {
      console.log('[ElectronBridge] Requesting AI:', prompt);
      return electronAPI.invoke('ai:request', { prompt, context });
    },
    
    openFile: (filePath, lineNumber) => {
      console.log('[ElectronBridge] Opening file:', filePath);
      electronAPI.send('file:open', { path: filePath, line: lineNumber });
    }
  };
}

/**
 * SidebarRenderer - Main sidebar component for mini-apps
 */
export function SidebarRenderer({
  initialTemplate,
  position = 'right',
  width = 380,
  useElectronIPC = false,
  onClose,
  onMinimize
}: SidebarRendererProps): React.ReactElement {
  const [state, setState] = useState<SidebarState>({
    visible: true,
    activeApp: null,
    template: initialTemplate || null,
    loading: !initialTemplate,
    error: null,
    cursorFiles: [],
    connected: false
  });
  
  const [bridge] = useState<OrchestratorBridge>(() => 
    useElectronIPC ? createElectronBridge() : createMockOrchestratorBridge()
  );
  
  // Set up IPC listeners
  useEffect(() => {
    if (!useElectronIPC) return;
    
    const unsubscribers: (() => void)[] = [];
    
    // Listen for template loads
    unsubscribers.push(
      bridge.subscribe('sidebar:template-loaded', (data: any) => {
        console.log('[SidebarRenderer] Template loaded:', data);
        setState(prev => ({
          ...prev,
          template: data.template,
          loading: false,
          error: null
        }));
      })
    );
    
    // Listen for cursor file changes
    unsubscribers.push(
      bridge.subscribe('sidebar:cursor-files', (data: any) => {
        console.log('[SidebarRenderer] Cursor files:', data.files);
        setState(prev => ({
          ...prev,
          cursorFiles: data.files || []
        }));
      })
    );
    
    // Listen for connection status
    unsubscribers.push(
      bridge.subscribe('orchestrator:connection', (data: any) => {
        setState(prev => ({
          ...prev,
          connected: data.connected
        }));
      })
    );
    
    // Listen for errors
    unsubscribers.push(
      bridge.subscribe('sidebar:error', (data: any) => {
        console.error('[SidebarRenderer] Error:', data.error);
        setState(prev => ({
          ...prev,
          error: data.error,
          loading: false
        }));
      })
    );
    
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [useElectronIPC, bridge]);
  
  // Handle close
  const handleClose = useCallback(() => {
    setState(prev => ({ ...prev, visible: false }));
    onClose?.();
  }, [onClose]);
  
  // Handle minimize
  const handleMinimize = useCallback(() => {
    onMinimize?.();
  }, [onMinimize]);
  
  // Loading state
  if (state.loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.spinner} />
          <span>Loading mini-app...</span>
        </div>
      </div>
    );
  }
  
  // Error state
  if (state.error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <h3>Failed to load mini-app</h3>
          <p>{state.error}</p>
          <button 
            onClick={() => setState(prev => ({ ...prev, loading: true, error: null }))}
            style={styles.retryButton}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  
  // No template loaded
  if (!state.template) {
    return (
      <div style={styles.container}>
        <div style={styles.empty}>
          <h3>No mini-app loaded</h3>
          <p>Select a template to get started</p>
        </div>
      </div>
    );
  }
  
  // Render mini-app panel
  return (
    <div style={{ ...styles.container, width }}>
      <MiniAppPanel
        template={state.template}
        bridge={bridge}
        position="sidebar"
        showHeader={true}
        showFooter={true}
        onClose={handleClose}
        onMinimize={handleMinimize}
        onReady={() => console.log('[SidebarRenderer] Mini-app ready')}
        onError={(err) => setState(prev => ({ ...prev, error: err.message }))}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    backgroundColor: '#1e1e1e',
    display: 'flex',
    flexDirection: 'column'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#808080'
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #3c3c3c',
    borderTopColor: '#4ec9b0',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '16px'
  },
  error: {
    padding: '24px',
    color: '#f44747',
    textAlign: 'center'
  },
  retryButton: {
    marginTop: '16px',
    padding: '8px 16px',
    backgroundColor: '#4ec9b0',
    color: '#1e1e1e',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 600
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#808080',
    textAlign: 'center'
  }
};

export default SidebarRenderer;
