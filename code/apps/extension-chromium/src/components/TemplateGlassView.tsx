/// <reference types="chrome"/>
import React, { useState, useEffect, useMemo } from 'react';
import { MiniAppPanel } from '@optimandoai/code-block-library';
import { getSharedBridge, type ExtendedOrchestratorBridge } from '../services/ExtensionOrchestratorBridge';

const HTTP_API_BASE = 'http://127.0.0.1:51248';

// Demo data for testing
const DEMO_FILES = [
  'src/components/Button.tsx',
  'src/utils/helpers.ts',
  'src/App.tsx',
  'src/styles/theme.css'
];

const DEMO_DIFF = `@@ -1,10 +1,15 @@
-import React from 'react';
+import React, { useState, useCallback } from 'react';

 interface ButtonProps {
   label: string;
-  onClick: () => void;
+  onClick?: () => void;
+  variant?: 'primary' | 'secondary' | 'danger';
+  disabled?: boolean;
 }

-export const Button = ({ label, onClick }: ButtonProps) => {
+export const Button = ({ 
+  label, 
+  onClick, 
+  variant = 'primary',
+  disabled = false 
+}: ButtonProps) => {
+  const [isHovered, setIsHovered] = useState(false);
+  
   return (
-    <button onClick={onClick}>
+    <button 
+      onClick={onClick}
+      disabled={disabled}
+      className={\`btn btn-\${variant}\`}
+      onMouseEnter={() => setIsHovered(true)}
+      onMouseLeave={() => setIsHovered(false)}
+    >
       {label}
     </button>
   );
 };`;

interface TemplateGlassViewProps {
  /** Template name to load (without .template.md extension) */
  templateName: string;
  /** Called when close button is clicked */
  onClose?: () => void;
  /** Called when minimize button is clicked */
  onMinimize?: () => void;
  /** Called when app is ready */
  onReady?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

/**
 * Template-based GlassView Component
 * 
 * Upgraded version that uses MiniAppPanel with real OrchestratorBridge.
 * Loads templates from Electron via HTTP API or WebSocket fallback.
 * 
 * Features:
 * - HTTP API template loading (faster than WebSocket)
 * - WebSocket fallback for template loading
 * - Real OrchestratorBridge for orchestrator communication
 * - Hot reload support for template changes
 * - Error handling with retry capability
 */
export const TemplateGlassView: React.FC<TemplateGlassViewProps> = ({ 
  templateName,
  onClose,
  onMinimize,
  onReady,
  onError
}) => {
  const [template, setTemplate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [realDataMode, setRealDataMode] = useState(false);
  const [realDataLoading, setRealDataLoading] = useState(false);
  const [projectRoot, setProjectRoot] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [demoState, setDemoState] = useState({
    files: [] as string[],
    selectedIndex: 0,
    diff: '',
    aiResponse: ''
  });
  
  // Get shared bridge instance (singleton for performance)
  const bridge = useMemo<ExtendedOrchestratorBridge>(() => getSharedBridge(), []);

  // Load real data from Git via Orchestrator API
  const loadRealData = async (showLoading = true, preserveSelection = false) => {
    console.log('[TemplateGlassView] Loading real data from Git...', projectRoot || 'default', { preserveSelection });
    if (showLoading) setRealDataLoading(true);
    
    try {
      // Get changed files from the Orchestrator
      const url = projectRoot 
        ? `${HTTP_API_BASE}/api/cursor/changed-files?projectRoot=${encodeURIComponent(projectRoot)}`
        : `${HTTP_API_BASE}/api/cursor/changed-files`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      const files = result.files || [];
      
      console.log('[TemplateGlassView] Got', files.length, 'changed files');
      
      if (files.length === 0) {
        setDemoState(prev => ({
          ...prev,
          files: [],
          diff: projectRoot 
            ? `No changed files found in:\n${projectRoot}\n\nMake sure you have uncommitted changes.`
            : 'No changed files found in the current project.\n\nMake sure you:\n1. Have a Git repository initialized\n2. Have uncommitted changes\n3. Set the correct project folder below',
          aiResponse: ''
        }));
      } else {
        // Determine which file to show
        let newSelectedIndex = 0;
        
        if (preserveSelection) {
          // Try to keep the same file selected
          const currentFile = demoState.files[demoState.selectedIndex];
          if (currentFile) {
            const sameFileIndex = files.findIndex((f: string) => f === currentFile);
            if (sameFileIndex !== -1) {
              newSelectedIndex = sameFileIndex;
            }
          }
        }
        
        const selectedFile = files[newSelectedIndex];
        
        // Only load diff if selection changed or this is initial load
        const shouldLoadDiff = !preserveSelection || 
          newSelectedIndex !== demoState.selectedIndex || 
          demoState.files.length !== files.length ||
          !demoState.diff;
        
        if (shouldLoadDiff) {
          const diffUrl = projectRoot
            ? `${HTTP_API_BASE}/api/cursor/diff?filePath=${encodeURIComponent(selectedFile)}&projectRoot=${encodeURIComponent(projectRoot)}`
            : `${HTTP_API_BASE}/api/cursor/diff?filePath=${encodeURIComponent(selectedFile)}`;
          const diffResponse = await fetch(diffUrl);
          const diffResult = await diffResponse.json();
          
          setDemoState(prev => ({
            ...prev,
            files,
            selectedIndex: newSelectedIndex,
            diff: diffResult.diff || 'No diff available',
          }));
        } else {
          // Just update the file list, keep everything else
          setDemoState(prev => ({
            ...prev,
            files,
            selectedIndex: newSelectedIndex,
          }));
        }
      }
      
      setRealDataMode(true);
      setDemoMode(false);
    } catch (err) {
      console.error('[TemplateGlassView] Error loading real data:', err);
      setDemoState(prev => ({
        ...prev,
        files: [],
        diff: `Error loading data: ${err instanceof Error ? err.message : String(err)}\n\nMake sure the Orchestrator is running on port 51248.`,
        aiResponse: ''
      }));
      setRealDataMode(true);
    } finally {
      if (showLoading) setRealDataLoading(false);
    }
  };

  // Load diff when file selection changes in real data mode
  const loadDiffForFile = async (filePath: string) => {
    try {
      const url = projectRoot
        ? `${HTTP_API_BASE}/api/cursor/diff?filePath=${encodeURIComponent(filePath)}&projectRoot=${encodeURIComponent(projectRoot)}`
        : `${HTTP_API_BASE}/api/cursor/diff?filePath=${encodeURIComponent(filePath)}`;
      const response = await fetch(url);
      const result = await response.json();
      setDemoState(prev => ({
        ...prev,
        diff: result.diff || 'No diff available'
      }));
    } catch (err) {
      console.error('[TemplateGlassView] Error loading diff:', err);
    }
  };

  // Auto-refresh effect for real data mode
  useEffect(() => {
    if (!realDataMode || !autoRefresh) return;
    
    const interval = setInterval(() => {
      console.log('[TemplateGlassView] Auto-refreshing (preserving selection)...');
      loadRealData(false, true); // Don't show loading spinner, preserve selection
    }, 3000); // Refresh every 3 seconds
    
    return () => clearInterval(interval);
  }, [realDataMode, autoRefresh, projectRoot, demoState.selectedIndex, demoState.files]);

  // ============================================================
  // CURSOR EXTENSION REAL-TIME LISTENER
  // Connects to Orchestrator WebSocket to receive Cursor events
  // ============================================================
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    
    const connectWebSocket = () => {
      try {
        ws = new WebSocket('ws://127.0.0.1:51247');
        
        ws.onopen = () => {
          console.log('[TemplateGlassView] WebSocket connected to Orchestrator');
        };
        
        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('[TemplateGlassView] Received event:', message.type);
            
            // Handle Cursor extension events
            switch (message.type) {
              case 'cursor:files_changed':
                // Auto-detect project from Cursor
                if (message.projectRoot && message.projectRoot !== projectRoot) {
                  console.log('[TemplateGlassView] Auto-detected project:', message.projectRoot);
                  setProjectRoot(message.projectRoot);
                }
                // Update files from Cursor
                if (message.files && message.files.length > 0) {
                  setDemoState(prev => ({
                    ...prev,
                    files: message.files,
                    diff: prev.diff || 'Select a file to view diff'
                  }));
                  setRealDataMode(true);
                  setDemoMode(false);
                }
                break;
                
              case 'cursor:file_saved':
                // File was saved in Cursor - refresh
                console.log('[TemplateGlassView] File saved:', message.filePath);
                loadRealData(false, true);
                break;
                
              case 'cursor:connected':
                console.log('[TemplateGlassView] Cursor extension connected');
                // Request initial files
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'REQUEST_FILES' }));
                }
                break;
                
              case 'cursor:diff':
                // Received diff from Cursor
                if (message.diff) {
                  setDemoState(prev => ({
                    ...prev,
                    diff: message.diff
                  }));
                }
                break;
            }
          } catch (err) {
            console.error('[TemplateGlassView] Error parsing WebSocket message:', err);
          }
        };
        
        ws.onclose = () => {
          console.log('[TemplateGlassView] WebSocket disconnected, reconnecting in 5s...');
          reconnectTimer = setTimeout(connectWebSocket, 5000);
        };
        
        ws.onerror = (error) => {
          console.error('[TemplateGlassView] WebSocket error:', error);
        };
      } catch (err) {
        console.error('[TemplateGlassView] Failed to connect WebSocket:', err);
        reconnectTimer = setTimeout(connectWebSocket, 5000);
      }
    };
    
    // Connect on mount
    connectWebSocket();
    
    // Cleanup
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []); // Only run once on mount

  // Activate demo mode with sample data
  const activateDemoMode = () => {
    console.log('[TemplateGlassView] Activating Demo Mode');
    setDemoMode(true);
    setRealDataMode(false);
    setDemoState({
      files: DEMO_FILES,
      selectedIndex: 0,
      diff: DEMO_DIFF,
      aiResponse: ''
    });
    
    // Emit events directly to trigger useTemplateApp subscriptions
    // These match the event names in useTemplateApp.tsx
    bridge.emit('cursor:files_changed', { files: DEMO_FILES });
    bridge.emit('orchestrator:connection', { connected: true });
  };
  
  // Handle demo AI trigger
  const handleDemoTrigger = (color: string, label: string) => {
    console.log('[TemplateGlassView] Demo trigger:', color, label);
    setDemoState(prev => ({
      ...prev,
      aiResponse: `🤖 **${label}** Analysis:\n\nThis code change adds TypeScript interfaces with proper typing for the Button component. The additions include:\n\n• **useState hook** for hover state management\n• **variant prop** for styling flexibility (primary/secondary/danger)\n• **disabled prop** for accessibility\n• **Event handlers** for mouse interactions\n\n✅ Good practices observed:\n- Proper TypeScript typing\n- Default prop values\n- Accessible button state`
    }));
  };

  // Load template on mount and when templateName changes
  useEffect(() => {
    loadTemplate();
  }, [templateName]);

  /**
   * Load template from Electron
   * Tries HTTP API first, falls back to WebSocket
   */
  const loadTemplate = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('[TemplateGlassView] Loading template:', templateName);

      // Option 1: Try HTTP API first (faster)
      try {
        const response = await fetch(`${HTTP_API_BASE}/api/templates/${templateName}`);
        
        if (response.ok) {
          const result = await response.json();
          if (result.ok && result.content) {
            console.log('[TemplateGlassView] Template loaded via HTTP:', templateName);
            setTemplate(result.content);
            setLoading(false);
            return;
          }
        }
      } catch (httpErr) {
        console.log('[TemplateGlassView] HTTP failed, trying WebSocket...', httpErr);
      }

      // Option 2: Fall back to WebSocket via background.ts
      console.log('[TemplateGlassView] Requesting template via WebSocket:', templateName);
      chrome.runtime.sendMessage({ type: 'GET_TEMPLATE', name: templateName });
      // Response will come via onMessage listener below
      
    } catch (err) {
      const errorMsg = `Error loading template: ${err instanceof Error ? err.message : String(err)}`;
      console.error('[TemplateGlassView]', errorMsg);
      setError(errorMsg);
      setLoading(false);
      onError?.(err instanceof Error ? err : new Error(errorMsg));
    }
  };

  // Listen for WebSocket template responses and hot reload
  useEffect(() => {
    const handleMessage = (message: any) => {
      // Template loaded via WebSocket
      if (message.type === 'TEMPLATE_RESULT' && message.name === templateName) {
        console.log('[TemplateGlassView] Template received via WebSocket:', message.name);
        setTemplate(message.content);
        setLoading(false);
        setError(null);
      } 
      // Template error
      else if (message.type === 'TEMPLATE_ERROR' && message.name === templateName) {
        const errorMsg = `Template error: ${message.error}`;
        console.error('[TemplateGlassView]', errorMsg);
        setError(errorMsg);
        setLoading(false);
        onError?.(new Error(errorMsg));
      } 
      // Hot reload: template changed
      else if (message.type === 'TEMPLATE_CHANGED' && message.payload?.name === templateName) {
        console.log('[TemplateGlassView] Template changed, hot reloading...');
        setTemplate(message.payload.content);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [templateName, onError]);

  // Render loading state
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>Loading {templateName}...</span>
        </div>
        <div style={styles.loadingContent}>
          <div style={styles.spinner} />
          <span>Loading template from orchestrator...</span>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>Template Error</span>
          {onClose && (
            <button style={styles.closeButton} onClick={onClose} title="Close">✕</button>
          )}
        </div>
        <div style={styles.errorContent}>
          <div style={styles.errorBox}>
            <div style={styles.errorTitle}>Failed to load template</div>
            <div style={styles.errorMessage}>{error}</div>
          </div>
          <button style={styles.retryButton} onClick={loadTemplate}>
            ↻ Retry
          </button>
        </div>
      </div>
    );
  }

  // Render nothing if no template
  if (!template) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>No Template</span>
        </div>
        <div style={styles.emptyContent}>
          <span>No template loaded</span>
        </div>
      </div>
    );
  }

  // Render MiniAppPanel with template and real bridge
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Mode Toggle Bar - Always visible at top */}
      {!demoMode && !realDataMode && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '8px',
          backgroundColor: '#1a1a2e',
          borderBottom: '1px solid #404040',
          gap: '8px',
        }}>
          {/* Project folder input - shown initially */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="text"
              value={projectRoot}
              onChange={(e) => setProjectRoot(e.target.value)}
              placeholder="Enter project path (e.g., D:\projects\myapp)"
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '12px',
                backgroundColor: '#0f172a',
                color: '#e2e8f0',
                border: '1px solid #3b82f6',
                borderRadius: '4px',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  loadRealData();
                }
              }}
            />
          </div>
          {/* Buttons row */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => loadRealData()}
              disabled={realDataLoading}
              style={{
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                color: '#e2e8f0',
                border: '1px solid #3b82f6',
                borderRadius: '4px',
                padding: '6px 14px',
                fontSize: '12px',
                cursor: realDataLoading ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                opacity: realDataLoading ? 0.7 : 1,
              }}
              title={projectRoot ? `Load changes from: ${projectRoot}` : 'Load real Git changes from your project'}
            >
              {realDataLoading ? '⏳ Loading...' : '📂 Load Real Data'}
            </button>
            <button
              onClick={activateDemoMode}
              style={{
                background: 'linear-gradient(135deg, #4a5568, #2d3748)',
                color: '#e2e8f0',
                border: '1px solid #4a5568',
                borderRadius: '4px',
                padding: '6px 14px',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              title="Load sample data to test GlassView features"
            >
              🧪 Demo Mode
            </button>
          </div>
        </div>
      )}
      {/* Demo Mode Active Banner */}
      {demoMode && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '6px 8px',
          backgroundColor: '#2d4a2d',
          borderBottom: '1px solid #4a6a4a',
          gap: '8px',
        }}>
          <span style={{ color: '#90ee90', fontSize: '12px' }}>🧪 Demo Mode Active - Sample Data Loaded</span>
          <button
            onClick={() => setDemoMode(false)}
            style={{
              background: 'transparent',
              color: '#90ee90',
              border: '1px solid #4a6a4a',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '10px',
              cursor: 'pointer',
            }}
          >
            Exit
          </button>
        </div>
      )}
      
      {/* Real Data Mode Active Banner */}
      {realDataMode && !demoMode && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '8px',
          backgroundColor: '#1e3a5f',
          borderBottom: '1px solid #3b82f6',
          gap: '8px',
        }}>
          {/* Top row with title and controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#93c5fd', fontSize: '12px' }}>📂 Real Data Mode</span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {/* Auto-refresh toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  style={{ width: '12px', height: '12px' }}
                />
                <span style={{ color: '#93c5fd', fontSize: '10px' }}>Auto</span>
              </label>
              <button
                onClick={() => loadRealData(true)}
                style={{
                  background: 'transparent',
                  color: '#93c5fd',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                ↻
              </button>
              <button
                onClick={() => setRealDataMode(false)}
                style={{
                  background: 'transparent',
                  color: '#93c5fd',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
              >
                Exit
              </button>
            </div>
          </div>
          {/* Project folder input */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              type="text"
              value={projectRoot}
              onChange={(e) => setProjectRoot(e.target.value)}
              placeholder="Project folder (e.g., D:\projects\myapp)"
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: '11px',
                backgroundColor: '#0f172a',
                color: '#e2e8f0',
                border: '1px solid #3b82f6',
                borderRadius: '4px',
              }}
            />
            <button
              onClick={() => loadRealData(true)}
              style={{
                background: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '10px',
                cursor: 'pointer',
              }}
            >
              Load
            </button>
          </div>
        </div>
      )}
      
      {/* Demo Mode UI or Real Data UI - Standalone */}
      {(demoMode || realDataMode) ? (
        <DemoModeUI 
          files={demoState.files}
          selectedIndex={demoState.selectedIndex}
          diff={demoState.diff}
          aiResponse={demoState.aiResponse}
          onSelectFile={(idx) => {
            setDemoState(prev => ({ ...prev, selectedIndex: idx }));
            // Load diff for selected file in real data mode
            if (realDataMode && demoState.files[idx]) {
              loadDiffForFile(demoState.files[idx]);
            }
          }}
          onTrigger={handleDemoTrigger}
          isRealData={realDataMode}
        />
      ) : (
        /* Main MiniAppPanel */
        <div style={{ flex: 1, minHeight: 0 }}>
          <MiniAppPanel
            template={template}
            bridge={bridge}
            position="sidebar"
            showHeader={true}
            showFooter={true}
            onClose={onClose}
            onMinimize={onMinimize}
            onReady={() => {
              console.log('[TemplateGlassView] Mini-app ready:', templateName);
              onReady?.();
            }}
            onError={(err) => {
              console.error('[TemplateGlassView] Mini-app error:', err);
              setError(err.message);
              onError?.(err);
            }}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Demo Mode UI Component
 * Standalone UI that shows demo data without relying on template system
 */
interface DemoModeUIProps {
  files: string[];
  selectedIndex: number;
  diff: string;
  aiResponse: string;
  onSelectFile: (index: number) => void;
  onTrigger: (color: string, label: string) => void;
  isRealData?: boolean;
}

const DemoModeUI: React.FC<DemoModeUIProps> = ({
  files,
  selectedIndex,
  diff,
  aiResponse,
  onSelectFile,
  onTrigger,
  isRealData = false
}) => {
  const triggers = [
    { color: '#3b82f6', icon: 'ℹ️', label: 'Explain Code', key: 'blue' },
    { color: '#ef4444', icon: '🛡️', label: 'Security', key: 'red' },
    { color: '#22c55e', icon: '✨', label: 'Improve', key: 'green' },
    { color: '#f97316', icon: '⚡', label: 'Performance', key: 'orange' },
    { color: '#a855f7', icon: '🔧', label: 'Refactor', key: 'purple' },
  ];

  return (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column', 
      overflow: 'hidden',
      backgroundColor: '#1e1e1e',
      color: '#cccccc'
    }}>
      {/* Connection Status */}
      <div style={{ 
        padding: '8px 12px', 
        backgroundColor: isRealData ? '#1a2a4a' : '#1a3a1a', 
        borderBottom: isRealData ? '1px solid #2a4a6a' : '1px solid #2a5a2a',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isRealData ? '#3b82f6' : '#22c55e' }} />
        <span style={{ fontSize: '12px', color: isRealData ? '#93c5fd' : '#90ee90' }}>
          {isRealData ? 'Connected to Git' : 'Connected (Demo)'}
        </span>
      </div>

      {/* File Slider */}
      <div style={{ 
        padding: '12px', 
        borderBottom: '1px solid #3c3c3c',
        backgroundColor: '#252526'
      }}>
        <div style={{ fontSize: '11px', color: '#808080', marginBottom: '8px' }}>Changed Files ({files.length})</div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {files.map((file, idx) => (
            <button
              key={file}
              onClick={() => onSelectFile(idx)}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                backgroundColor: idx === selectedIndex ? '#0e639c' : '#3c3c3c',
                color: idx === selectedIndex ? '#ffffff' : '#cccccc',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
              }}
            >
              {file.split('/').pop()}
            </button>
          ))}
        </div>
      </div>

      {/* Diff Viewer */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto', 
        padding: '12px',
        fontFamily: 'Consolas, Monaco, monospace',
        fontSize: '12px',
        lineHeight: '1.5'
      }}>
        <div style={{ marginBottom: '8px', color: '#808080', fontSize: '11px' }}>
          📄 {files[selectedIndex]}
        </div>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {diff.split('\n').map((line, idx) => {
            let bgColor = 'transparent';
            let color = '#cccccc';
            if (line.startsWith('+') && !line.startsWith('+++')) {
              bgColor = 'rgba(35, 134, 54, 0.3)';
              color = '#7ee787';
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              bgColor = 'rgba(248, 81, 73, 0.3)';
              color = '#f85149';
            } else if (line.startsWith('@@')) {
              color = '#79c0ff';
            }
            return (
              <div key={idx} style={{ backgroundColor: bgColor, color, padding: '0 4px' }}>
                {line}
              </div>
            );
          })}
        </pre>
      </div>

      {/* AI Trigger Buttons */}
      <div style={{ 
        padding: '12px', 
        borderTop: '1px solid #3c3c3c',
        backgroundColor: '#252526'
      }}>
        <div style={{ fontSize: '11px', color: '#808080', marginBottom: '8px' }}>AI Analysis Triggers</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {triggers.map((t) => (
            <button
              key={t.key}
              onClick={() => onTrigger(t.key, t.label)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 10px',
                backgroundColor: t.color,
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 500,
              }}
              title={t.label}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* AI Response */}
      {aiResponse && (
        <div style={{ 
          padding: '12px', 
          borderTop: '1px solid #3c3c3c',
          backgroundColor: '#1a2a3a',
          maxHeight: '200px',
          overflow: 'auto'
        }}>
          <div style={{ fontSize: '11px', color: '#79c0ff', marginBottom: '8px' }}>🤖 AI Response</div>
          <div style={{ fontSize: '12px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
            {aiResponse}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Styles for loading/error states
 */
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#1e1e1e',
    color: '#cccccc',
    fontFamily: "'Segoe UI', Tahoma, sans-serif",
    fontSize: '13px',
    overflow: 'hidden',
    borderRadius: '4px',
    border: '1px solid #3c3c3c'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    backgroundColor: '#252526',
    borderBottom: '1px solid #3c3c3c',
    flexShrink: 0
  },
  headerTitle: {
    fontWeight: 600,
    color: '#e0e0e0'
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: '#808080',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '3px',
    fontSize: '12px'
  },
  loadingContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: '12px',
    color: '#808080'
  },
  spinner: {
    width: '24px',
    height: '24px',
    border: '2px solid #3c3c3c',
    borderTopColor: '#4ec9b0',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  errorContent: {
    display: 'flex',
    flexDirection: 'column',
    padding: '16px',
    gap: '12px'
  },
  errorBox: {
    padding: '12px',
    backgroundColor: '#3a1d1d',
    borderRadius: '4px',
    border: '1px solid #5a2d2d'
  },
  errorTitle: {
    fontWeight: 600,
    color: '#f44747',
    marginBottom: '8px'
  },
  errorMessage: {
    fontSize: '12px',
    color: '#f48771',
    fontFamily: 'Consolas, monospace',
    wordBreak: 'break-word'
  },
  retryButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '8px 16px',
    backgroundColor: '#0e639c',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500
  },
  emptyContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: '#808080'
  }
};

export default TemplateGlassView;
