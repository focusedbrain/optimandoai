/**
 * MiniAppPanel Component
 * 
 * Sidebar panel wrapper for template-driven mini-apps.
 * Provides header, footer, controls, and orchestrator bridge integration.
 * 
 * This component wraps a template-built app and displays it in the
 * orchestrator's sidebar with consistent UI chrome.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTemplateApp, OrchestratorBridge, createMockOrchestratorBridge } from '../hooks/useTemplateApp';

export interface MiniAppPanelProps {
  /** Template text content */
  template: string;
  
  /** Orchestrator bridge instance */
  bridge?: OrchestratorBridge;
  
  /** Panel position */
  position?: 'sidebar' | 'overlay' | 'floating';
  
  /** Show header with app name and controls */
  showHeader?: boolean;
  
  /** Show footer with status */
  showFooter?: boolean;
  
  /** Custom header actions */
  headerActions?: React.ReactNode;
  
  /** Called when close button clicked */
  onClose?: () => void;
  
  /** Called when minimize button clicked */
  onMinimize?: () => void;
  
  /** Called when app is ready */
  onReady?: () => void;
  
  /** Called on error */
  onError?: (error: Error) => void;
  
  /** Additional CSS class */
  className?: string;
}

/**
 * Panel container styles
 */
const panelStyles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
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
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  appName: {
    fontWeight: 600,
    color: '#e0e0e0'
  },
  appVersion: {
    fontSize: '11px',
    color: '#808080'
  },
  headerControls: {
    display: 'flex',
    gap: '4px'
  },
  controlButton: {
    background: 'transparent',
    border: 'none',
    color: '#808080',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '3px',
    fontSize: '12px'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '8px'
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    backgroundColor: '#252526',
    borderTop: '1px solid #3c3c3c',
    fontSize: '11px',
    flexShrink: 0
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  loadingSpinner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: '#808080'
  },
  errorContainer: {
    padding: '16px',
    color: '#f44747',
    backgroundColor: '#3a1d1d',
    borderRadius: '4px',
    margin: '8px'
  },
  errorTitle: {
    fontWeight: 600,
    marginBottom: '8px'
  },
  errorMessage: {
    fontSize: '12px',
    fontFamily: 'Consolas, monospace'
  }
};

/**
 * MiniAppPanel - Sidebar wrapper for template-driven apps
 */
export function MiniAppPanel({
  template,
  bridge,
  position = 'sidebar',
  showHeader = true,
  showFooter = true,
  headerActions,
  onClose,
  onMinimize,
  onReady,
  onError,
  className
}: MiniAppPanelProps): React.ReactElement {
  const [isConnected, setIsConnected] = useState(false);
  
  // Use provided bridge or create mock
  const orchestratorBridge = bridge || createMockOrchestratorBridge();
  
  // Build app from template
  const { app, loading, error, metadata, reload } = useTemplateApp({
    template,
    orchestratorBridge,
    onReady,
    onError
  });
  
  // Track connection status
  useEffect(() => {
    const unsub = orchestratorBridge.subscribe('orchestrator:connection', (data) => {
      setIsConnected((data as any).connected);
    });
    
    return unsub;
  }, [orchestratorBridge]);
  
  // Handle reload
  const handleReload = useCallback(() => {
    reload();
  }, [reload]);
  
  // Render loading state
  if (loading) {
    return (
      <div style={panelStyles.container} className={className}>
        {showHeader && (
          <div style={panelStyles.header}>
            <div style={panelStyles.headerTitle}>
              <span style={panelStyles.appName}>Loading...</span>
            </div>
          </div>
        )}
        <div style={panelStyles.loadingSpinner}>
          <span>Building mini-app from template...</span>
        </div>
      </div>
    );
  }
  
  // Render error state
  if (error) {
    return (
      <div style={panelStyles.container} className={className}>
        {showHeader && (
          <div style={panelStyles.header}>
            <div style={panelStyles.headerTitle}>
              <span style={panelStyles.appName}>Error</span>
            </div>
            <div style={panelStyles.headerControls}>
              <button 
                style={panelStyles.controlButton}
                onClick={handleReload}
                title="Retry"
              >
                ↻
              </button>
              {onClose && (
                <button 
                  style={panelStyles.controlButton}
                  onClick={onClose}
                  title="Close"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
        <div style={panelStyles.errorContainer}>
          <div style={panelStyles.errorTitle}>Failed to build mini-app</div>
          <div style={panelStyles.errorMessage}>{error.message}</div>
        </div>
      </div>
    );
  }
  
  // Render app
  return (
    <div style={panelStyles.container} className={className}>
      {/* Header */}
      {showHeader && (
        <div style={panelStyles.header}>
          <div style={panelStyles.headerTitle}>
            <span style={panelStyles.appName}>{metadata?.name || 'Mini App'}</span>
            {metadata?.version && (
              <span style={panelStyles.appVersion}>v{metadata.version}</span>
            )}
          </div>
          <div style={panelStyles.headerControls}>
            {headerActions}
            <button 
              style={panelStyles.controlButton}
              onClick={handleReload}
              title="Reload"
            >
              ↻
            </button>
            {onMinimize && (
              <button 
                style={panelStyles.controlButton}
                onClick={onMinimize}
                title="Minimize"
              >
                −
              </button>
            )}
            {onClose && (
              <button 
                style={panelStyles.controlButton}
                onClick={onClose}
                title="Close"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Content - Template-built app */}
      <div style={panelStyles.content}>
        {app}
      </div>
      
      {/* Footer */}
      {showFooter && (
        <div style={panelStyles.footer}>
          <div style={panelStyles.statusIndicator}>
            <div 
              style={{
                ...panelStyles.statusDot,
                backgroundColor: isConnected ? '#4ec9b0' : '#808080'
              }} 
            />
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <span>{position}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Hook to load GlassView template
 */
export function useGlassViewTemplate(): string {
  const [template, setTemplate] = useState<string>('');
  
  useEffect(() => {
    // In production, this would load from the bundled template
    // For now, return a placeholder that imports the template
    const loadTemplate = async () => {
      try {
        // Try to load template from file
        const response = await fetch('/templates/glassview.template.md');
        if (response.ok) {
          const text = await response.text();
          setTemplate(text);
        }
      } catch (err) {
        console.warn('[useGlassViewTemplate] Could not load template:', err);
      }
    };
    
    loadTemplate();
  }, []);
  
  return template;
}

/**
 * GlassViewPanel - Pre-configured MiniAppPanel for GlassView
 */
export function GlassViewPanel(props: Omit<MiniAppPanelProps, 'template'>): React.ReactElement {
  const template = useGlassViewTemplate();
  
  if (!template) {
    return (
      <div style={panelStyles.container}>
        <div style={panelStyles.loadingSpinner}>
          <span>Loading GlassView template...</span>
        </div>
      </div>
    );
  }
  
  return <MiniAppPanel {...props} template={template} />;
}

export default MiniAppPanel;
