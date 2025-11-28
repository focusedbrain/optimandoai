import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface AppState {
  [key: string]: any;
}

interface EventBus {
  on: (event: string, handler: Function) => () => void;
  emit: (event: string, data?: any) => void;
}

interface ReactAppContextValue {
  state: AppState;
  setState: (updates: Partial<AppState>) => void;
  updateState: (key: string, value: any) => void;
  eventBus: EventBus;
  appName: string;
}

const ReactAppContext = createContext<ReactAppContextValue | undefined>(undefined);

export const useApp = () => {
  const context = useContext(ReactAppContext);
  if (!context) {
    throw new Error('useApp must be used within ReactAppBootstrap');
  }
  return context;
};

interface ReactAppBootstrapProps {
  appName: string;
  initialState?: AppState;
  theme?: {
    primaryColor?: string;
    backgroundColor?: string;
    fontFamily?: string;
    spacing?: number;
  };
  children: React.ReactNode;
}

/**
 * React App Bootstrap Component
 * 
 * Provides the foundation for all GlassView apps:
 * - Centralized state management via React Context
 * - Event bus for inter-component communication
 * - Theme configuration
 * - Lifecycle management
 * 
 * All other blocks should be wrapped in this component.
 */
export const ReactAppBootstrap: React.FC<ReactAppBootstrapProps> = ({
  appName,
  initialState = {},
  theme = {},
  children
}) => {
  const [state, setStateInternal] = useState<AppState>(initialState);
  const [eventHandlers] = useState<Map<string, Set<Function>>>(new Map());

  // State management
  const setState = useCallback((updates: Partial<AppState>) => {
    setStateInternal(prev => ({ ...prev, ...updates }));
  }, []);

  const updateState = useCallback((key: string, value: any) => {
    setStateInternal(prev => ({ ...prev, [key]: value }));
  }, []);

  // Event bus implementation
  const eventBus: EventBus = {
    on: useCallback((event: string, handler: Function) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event)!.add(handler);

      // Return unsubscribe function
      return () => {
        const handlers = eventHandlers.get(event);
        if (handlers) {
          handlers.delete(handler);
        }
      };
    }, [eventHandlers]),

    emit: useCallback((event: string, data?: any) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        handlers.forEach(handler => {
          try {
            handler(data);
          } catch (error) {
            console.error(`Error in event handler for "${event}":`, error);
          }
        });
      }
    }, [eventHandlers])
  };

  // Apply theme
  useEffect(() => {
    if (theme.primaryColor) {
      document.documentElement.style.setProperty('--primary-color', theme.primaryColor);
    }
    if (theme.backgroundColor) {
      document.documentElement.style.setProperty('--bg-color', theme.backgroundColor);
    }
    if (theme.fontFamily) {
      document.documentElement.style.setProperty('--font-family', theme.fontFamily);
    }
  }, [theme]);

  const contextValue: ReactAppContextValue = {
    state,
    setState,
    updateState,
    eventBus,
    appName
  };

  return (
    <ReactAppContext.Provider value={contextValue}>
      <div className="react-app-root" data-app-name={appName}>
        {children}
      </div>
    </ReactAppContext.Provider>
  );
};
