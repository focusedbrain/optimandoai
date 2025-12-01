/**
 * useTemplateApp Hook
 * 
 * React hook for loading and running template-driven mini-apps.
 * Connects templates to the orchestrator bridge for IPC communication.
 * 
 * Usage:
 *   const { app, loading, error, metadata } = useTemplateApp({
 *     template: glassviewTemplate,
 *     orchestratorBridge: bridge
 *   });
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { templateBuilder, TemplateBuildResult } from '../builder/TemplateBuilder';

/**
 * Orchestrator Bridge Interface
 * Handles communication between mini-apps and the orchestrator
 */
export interface OrchestratorBridge {
  /** Send a message to the orchestrator */
  sendMessage: (type: string, data: unknown) => void;
  
  /** Subscribe to orchestrator events */
  subscribe: (event: string, handler: (data: unknown) => void) => () => void;
  
  /** Get current panel position */
  getPanel: () => 'sidebar' | 'overlay' | 'floating';
  
  /** Request AI analysis */
  requestAI?: (prompt: string, context?: unknown) => Promise<string>;
  
  /** Open file in editor */
  openFile?: (filePath: string, lineNumber?: number) => void;
}

export interface UseTemplateAppOptions {
  /** Template text content */
  template: string;
  
  /** Orchestrator bridge for IPC communication */
  orchestratorBridge?: OrchestratorBridge;
  
  /** Called when app is ready */
  onReady?: () => void;
  
  /** Called on build error */
  onError?: (error: Error) => void;
  
  /** Initial state overrides */
  initialState?: Record<string, unknown>;
}

export interface UseTemplateAppResult {
  /** Built React component or null if loading/error */
  app: React.ReactElement | null;
  
  /** Loading state */
  loading: boolean;
  
  /** Build error if any */
  error: Error | null;
  
  /** Template metadata (name, version, description) */
  metadata: { name: string; version: string; description: string } | null;
  
  /** Rebuild the app from template */
  reload: () => Promise<void>;
  
  /** Update app state externally */
  updateState: (key: string, value: unknown) => void;
  
  /** Get current app state */
  getState: () => Record<string, unknown>;
}

/**
 * Hook to load and run template-driven mini-apps
 */
export function useTemplateApp(options: UseTemplateAppOptions): UseTemplateAppResult {
  const { template, orchestratorBridge, onReady, onError, initialState } = options;
  
  const [app, setApp] = useState<React.ReactElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [metadata, setMetadata] = useState<{ name: string; version: string; description: string } | null>(null);
  
  const buildResultRef = useRef<TemplateBuildResult | null>(null);
  const stateRef = useRef<Record<string, unknown>>(initialState || {});
  const unsubscribersRef = useRef<(() => void)[]>([]);

  /**
   * Build the app from template
   */
  const buildApp = useCallback(async () => {
    if (!template) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      console.log('[useTemplateApp] Building app from template...');
      
      // Build from template text
      const result = templateBuilder.buildFromText(template);
      buildResultRef.current = result;
      
      if (result.buildErrors.length > 0 || result.parseErrors.length > 0) {
        const allErrors = [...result.parseErrors, ...result.buildErrors];
        throw new Error(`Template build failed: ${allErrors.join(', ')}`);
      }
      
      // Extract metadata from AST
      if (result.ast) {
        const appConfig = (result.ast as any);
        setMetadata({
          name: appConfig.name || 'Untitled',
          version: appConfig.version || '1.0.0',
          description: appConfig.bootstrap?.props?.description || ''
        });
      }
      
      // Create React element from built component
      const { Component } = result;
      const element = <Component />;
      setApp(element);
      
      console.log('[useTemplateApp] App built successfully:', result.metadata.blocksUsed);
      onReady?.();
      
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[useTemplateApp] Build error:', error);
      setError(error);
      onError?.(error);
    } finally {
      setLoading(false);
    }
  }, [template, onReady, onError]);

  /**
   * Initial build
   */
  useEffect(() => {
    buildApp();
  }, [buildApp]);

  /**
   * Set up orchestrator event subscriptions
   */
  useEffect(() => {
    if (!orchestratorBridge) return;
    
    console.log('[useTemplateApp] Setting up orchestrator subscriptions...');
    
    // Clean up previous subscriptions
    unsubscribersRef.current.forEach(unsub => unsub());
    unsubscribersRef.current = [];
    
    // Subscribe to cursor file changes
    const unsubFiles = orchestratorBridge.subscribe('cursor:files_changed', (data) => {
      console.log('[useTemplateApp] Cursor files changed:', data);
      stateRef.current.cursorChangedFiles = (data as any).files || [];
      stateRef.current.isConnected = true;
      // Note: State updates trigger rebuild in full implementation
    });
    unsubscribersRef.current.push(unsubFiles);
    
    // Subscribe to AI responses
    const unsubAI = orchestratorBridge.subscribe('ai:response', (data) => {
      console.log('[useTemplateApp] AI response:', data);
      stateRef.current.aiResponse = (data as any).result;
    });
    unsubscribersRef.current.push(unsubAI);
    
    // Subscribe to connection status
    const unsubConnection = orchestratorBridge.subscribe('orchestrator:connection', (data) => {
      console.log('[useTemplateApp] Connection status:', data);
      stateRef.current.isConnected = (data as any).connected;
    });
    unsubscribersRef.current.push(unsubConnection);
    
    return () => {
      unsubscribersRef.current.forEach(unsub => unsub());
      unsubscribersRef.current = [];
    };
  }, [orchestratorBridge]);

  /**
   * Update state externally
   */
  const updateState = useCallback((key: string, value: unknown) => {
    stateRef.current[key] = value;
    // In full implementation, this would trigger a re-render
  }, []);

  /**
   * Get current state
   */
  const getState = useCallback(() => {
    return { ...stateRef.current };
  }, []);

  return {
    app,
    loading,
    error,
    metadata,
    reload: buildApp,
    updateState,
    getState
  };
}

/**
 * Create a mock orchestrator bridge for testing
 */
export function createMockOrchestratorBridge(): OrchestratorBridge {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  
  return {
    sendMessage: (type, data) => {
      console.log('[MockBridge] Message sent:', type, data);
    },
    
    subscribe: (event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
      
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },
    
    getPanel: () => 'sidebar',
    
    requestAI: async (prompt) => {
      console.log('[MockBridge] AI request:', prompt);
      return `Mock AI response for: ${prompt.substring(0, 50)}...`;
    },
    
    openFile: (filePath, lineNumber) => {
      console.log('[MockBridge] Open file:', filePath, 'at line', lineNumber);
    }
  };
}
