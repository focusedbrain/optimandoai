import { useState, useEffect, Component, ReactNode } from 'react';
import { LlmSettings } from './LlmSettings';
import { ImageEngineSettings } from './ImageEngineSettings';

// Simple Error Boundary to prevent crashes from closing the lightbox
class ErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface PostgresConnectionConfig {
  postgres?: {
    enabled: boolean;
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

interface BackendConfigLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'default' | 'dark' | 'professional';
}

// Helper to proxy API calls through background script (avoids CORS issues in content scripts)
async function electronApiCall(
  endpoint: string, 
  options: { method?: string; body?: any; timeout?: number } = {}
): Promise<{ success: boolean; status?: number; statusText?: string; data?: any; error?: string }> {
  console.log('[electronApiCall] Calling:', endpoint, options.method || 'GET');
  
  // Try background script first
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      const bgResult = await new Promise<{ success: boolean; status?: number; statusText?: string; data?: any; error?: string } | null>((resolve) => {
        const timeout = setTimeout(() => {
          console.log('[electronApiCall] Background script timeout');
          resolve(null);
        }, (options.timeout || 15000) + 2000);
        
        chrome.runtime.sendMessage({
          type: 'ELECTRON_API_PROXY',
          endpoint,
          method: options.method || 'GET',
          body: options.body,
          timeout: options.timeout || 15000,
        }, (result) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            console.log('[electronApiCall] Chrome runtime error:', chrome.runtime.lastError.message);
            resolve(null); // Fall through to direct fetch
          } else if (result) {
            console.log('[electronApiCall] Background response:', result.success, result.status);
            resolve(result);
          } else {
            console.log('[electronApiCall] Empty response from background');
            resolve(null);
          }
        });
      });
      
      if (bgResult !== null) {
        return bgResult;
      }
    } catch (e) {
      console.log('[electronApiCall] Background script error:', e);
    }
  }
  
  // Fallback: direct fetch
  console.log('[electronApiCall] Falling back to direct fetch');
  try {
    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    if (options.body) {
      fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
    fetchOptions.signal = controller.signal;
    
    const response = await fetch(`http://127.0.0.1:51248${endpoint}`, fetchOptions);
    clearTimeout(timeoutId);
    
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    console.log('[electronApiCall] Direct fetch success:', response.status);
    return { success: response.ok, status: response.status, statusText: response.statusText, data };
  } catch (e: any) {
    console.log('[electronApiCall] Direct fetch failed:', e.message);
    return { success: false, error: `Network error: ${e.message}` };
  }
}

export function BackendConfigLightbox({ isOpen, onClose, theme = 'default' }: BackendConfigLightboxProps) {
  const [config, setConfig] = useState<PostgresConnectionConfig>({
    postgres: {
      enabled: false,
      config: {
        host: '127.0.0.1',
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        password: 'playboy906870',
        ssl: false,
        schema: 'public',
      },
    },
  });

  const [isTesting, setIsTesting] = useState(false);
  const [activeTab, setActiveTab] = useState<'localdb' | 'vectordb' | 'llm' | 'automation'>('localdb');
  const [llmSubTab, setLlmSubTab] = useState<'text' | 'image'>('text');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isInsertingTestData, setIsInsertingTestData] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [desktopAppStatus, setDesktopAppStatus] = useState<'checking' | 'running' | 'not-running'>('checking');
  const [isLaunchingApp, setIsLaunchingApp] = useState(false);
  const [testDataStats, setTestDataStats] = useState<{
    total: number;
    vault: number;
    logs: number;
    vectors: number;
    gis: number;
    archived: number;
    sampleKeys: string[];
  } | null>(null);

  // Check if desktop app is running - try multiple methods for reliability
  const checkDesktopApp = async (): Promise<boolean> => {
    console.log('[BackendConfigLightbox] Checking desktop app status...');
    
    // Method 1: Try background script first (most reliable in extension context)
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const bgResult = await new Promise<{ running: boolean } | null>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 3000);
          chrome.runtime.sendMessage({ type: 'CHECK_DESKTOP_APP_STATUS' }, (result) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              console.log('[BackendConfigLightbox] BG check failed:', chrome.runtime.lastError.message);
              resolve(null);
            } else {
              resolve(result);
            }
          });
        });
        
        if (bgResult !== null) {
          console.log('[BackendConfigLightbox] BG check result:', bgResult);
          setDesktopAppStatus(bgResult.running ? 'running' : 'not-running');
          return bgResult.running;
        }
      }
    } catch (e) {
      console.log('[BackendConfigLightbox] BG check error:', e);
    }
    
    // Method 2: Direct fetch as fallback
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch('http://127.0.0.1:51248/api/orchestrator/status', {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.log('[BackendConfigLightbox] Direct fetch succeeded:', response.status);
      setDesktopAppStatus('running');
      return true;
    } catch (e: any) {
      console.log('[BackendConfigLightbox] Direct fetch failed:', e.message);
      setDesktopAppStatus('not-running');
      return false;
    }
  };

  // Wait for desktop app to be started manually
  // 
  // IMPORTANT: Custom protocol launch (opengiraffe://start, wrcode://start) has been DISABLED
  // to prevent Windows "Open Electron?" prompts and errors when the protocol handler
  // is not correctly registered. Users must start the app manually.
  const launchDesktopApp = async () => {
    setIsLaunchingApp(true);
    
    // NOTE: Protocol handler launch removed - it caused Windows "Open Electron?" prompts
    // Instead, we ask the user to start the app manually and poll to detect when it's running
    console.log('[BackendConfigLightbox] Waiting for user to start app manually (protocol launch disabled)');
    
    // Poll for app to come online
    let attempts = 0;
    const maxAttempts = 25; // 25 seconds - give time for app to start
    
    setNotification({ 
      message: 'Please start WR Desk from the Start Menu. Waiting for app...', 
      type: 'success' 
    });
    
    const pollInterval = setInterval(async () => {
      attempts++;
      const isRunning = await checkDesktopApp();
      
      if (isRunning) {
        clearInterval(pollInterval);
        setIsLaunchingApp(false);
        setNotification({ message: 'Desktop app is now running!', type: 'success' });
        setTimeout(() => setNotification(null), 3000);
      } else if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        setIsLaunchingApp(false);
        setNotification({ 
          message: 'Could not detect app. Please launch WR Desk from Start Menu or desktop shortcut.', 
          type: 'error' 
        });
        setTimeout(() => setNotification(null), 8000);
      }
    }, 1000);
  };

  // Load config on mount and check desktop app status
  useEffect(() => {
    if (!isOpen) return;
    chrome.storage.local.get(['backendConfig'], (result) => {
      if (result.backendConfig) {
        // Merge with defaults to ensure all fields exist and ssl defaults to false
        const loadedConfig = result.backendConfig;
        if (loadedConfig.postgres?.config) {
          // Force SSL to false for local PostgreSQL (most common case)
          if (loadedConfig.postgres.config.host === '127.0.0.1' || loadedConfig.postgres.config.host === 'localhost') {
            loadedConfig.postgres.config.ssl = false;
          }
        }
        setConfig(loadedConfig);
      }
    });
    checkDesktopApp();
  }, [isOpen]);

  const updatePostgresConfig = (
    field: 'host' | 'port' | 'database' | 'user' | 'password' | 'ssl' | 'schema',
    value: string | number | boolean
  ) => {
    if (!config.postgres?.config) return;
    const newConfig = {
      ...config,
      postgres: {
        ...config.postgres,
        config: {
          ...config.postgres.config,
          [field]: value,
        },
      },
    };
    setConfig(newConfig);
    chrome.storage.local.set({ backendConfig: newConfig });
  };

  const handleLoadStats = async () => {
    if (!config.postgres?.enabled) return;
    setIsLoadingStats(true);
    try {
      const result = await electronApiCall('/api/db/test-data-stats', { method: 'GET' });
      if (result.success && result.data?.ok) {
        setTestDataStats(result.data.stats);
      } else {
        setNotification({
          message: result.data?.message || result.error || 'Failed to load stats',
          type: 'error'
        });
        setTimeout(() => setNotification(null), 5000);
      }
    } catch (error: any) {
      setNotification({
        message: `Error: ${error.message || 'Failed to load stats'}`,
        type: 'error'
      });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleTestConnection = async () => {
    if (!config.postgres?.config) return;

    setIsTesting(true);
    console.log('[BackendConfigLightbox] Starting connection test via proxy:', config.postgres.config);
    
    try {
      const result = await electronApiCall('/api/db/test-connection', {
        method: 'POST',
        body: config.postgres.config,
        timeout: 10000,
      });

      console.log('[BackendConfigLightbox] Proxy response:', result);

      if (!result.success) {
        // API call failed (network error, timeout, etc.)
        const newConfig = { ...config, postgres: { enabled: false, config: config.postgres.config } };
        setConfig(newConfig);
        chrome.storage.local.set({ backendConfig: newConfig });
        
        console.error('[BackendConfigLightbox] API call failed:', result);
        
        let errorMsg = result.error || 'Connection failed';
        if (result.error?.includes('timed out') || result.error?.includes('Abort')) {
          errorMsg = 'Connection timeout - Desktop app may not be responding';
        } else if (result.error?.includes('Network error') || result.error?.includes('Failed to fetch')) {
          errorMsg = 'Cannot connect to desktop app - Check if OpenGiraffe is running';
        }
        
        setNotification({ message: errorMsg, type: 'error' });
        setDesktopAppStatus('not-running');
        return;
      }

      // API call succeeded, check the result
      const data = result.data;
      
      if (data?.ok) {
        const newConfig = { ...config, postgres: { enabled: true, config: config.postgres.config } };
        setConfig(newConfig);
        chrome.storage.local.set({ backendConfig: newConfig });
        console.log('[BackendConfigLightbox] Connection successful, config saved');
        setNotification({ message: 'Connected successfully', type: 'success' });
      } else {
        const newConfig = { ...config, postgres: { enabled: false, config: config.postgres.config } };
        setConfig(newConfig);
        chrome.storage.local.set({ backendConfig: newConfig });
        console.error('[BackendConfigLightbox] Connection failed:', data);
        setNotification({ 
          message: data?.message || data?.details?.error || 'Connection failed', 
          type: 'error' 
        });
      }
    } catch (error: any) {
      const newConfig = { ...config, postgres: { enabled: false, config: config.postgres.config } };
      setConfig(newConfig);
      chrome.storage.local.set({ backendConfig: newConfig });
      
      let errorMessage = error.message || 'Connection failed';
      
      console.error('[BackendConfigLightbox] Exception caught:', error);
      setNotification({ message: errorMessage, type: 'error' });
    } finally {
      setIsTesting(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  if (!isOpen) return null;

  // Theme colors
  const bgColor = theme === 'professional' ? '#ffffff' : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)';
  const borderColor = theme === 'professional' ? '#e2e8f0' : 'rgba(255,255,255,0.15)';
  const textColor = theme === 'professional' ? '#0f172a' : '#fff';
  const inputBg = theme === 'professional' ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.3)';
  const inputBorder = theme === 'professional' ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      zIndex: 2147483651,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        width: '95%',
        maxWidth: '1100px',
        maxHeight: '85vh',
        background: bgColor,
        borderRadius: '16px',
        border: `1px solid ${borderColor}`,
        boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>⚙️</span>
            <div>
              <div style={{ fontSize: '18px', fontWeight: '700' }}>Backend Configuration</div>
              <div style={{ fontSize: '12px', opacity: 0.9 }}>Configure database, AI models, and automation</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.3)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)' }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: '8px',
          padding: '16px 24px',
          background: theme === 'professional' ? '#f8fafc' : 'rgba(0,0,0,0.2)',
          borderBottom: `1px solid ${borderColor}`,
          flexShrink: 0
        }}>
          {(['localdb', 'vectordb', 'llm', 'automation'] as const).map((tab) => {
            const isEnabled = tab === 'localdb' || tab === 'llm';
            const labels = {
              localdb: `🗄️ Local DB ${config.postgres?.enabled ? '✓' : ''}`,
              vectordb: '🔢 Vector DB',
              llm: '🤖 LLM & Images',
              automation: '⚡ Automation'
            };
            return (
              <button
                key={tab}
                onClick={() => isEnabled && setActiveTab(tab)}
                disabled={!isEnabled}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: activeTab === tab 
                    ? 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)' 
                    : theme === 'professional' ? 'white' : 'rgba(255,255,255,0.08)',
                  border: activeTab === tab ? 'none' : `1px solid ${borderColor}`,
                  borderRadius: '8px',
                  color: activeTab === tab ? 'white' : textColor,
                  fontSize: '13px',
                  fontWeight: activeTab === tab ? '600' : '500',
                  cursor: isEnabled ? 'pointer' : 'not-allowed',
                  opacity: isEnabled ? 1 : 0.5,
                  transition: 'all 0.2s',
                  boxShadow: activeTab === tab ? '0 4px 12px rgba(139, 92, 246, 0.3)' : 'none'
                }}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{
          padding: '24px',
          overflowY: 'auto',
          flex: 1,
          color: textColor
        }}>
          {/* Desktop App Status Banner */}
          {desktopAppStatus === 'not-running' && (
            <div style={{
              maxWidth: '800px',
              margin: '0 auto 20px auto',
              padding: '20px',
              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              borderRadius: '12px',
              color: 'white',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                <span style={{ fontSize: '24px' }}>⚠️</span>
                <div style={{ fontWeight: '600', fontSize: '15px' }}>Desktop App Not Running</div>
              </div>
              <div style={{ fontSize: '13px', opacity: 0.95, marginBottom: '16px', lineHeight: '1.5' }}>
                The OpenGiraffe desktop app is required for database and LLM connections. 
                Please start it from:
              </div>
              <div style={{ 
                background: 'rgba(0,0,0,0.2)', 
                padding: '12px 16px', 
                borderRadius: '8px', 
                fontSize: '12px',
                fontFamily: 'monospace',
                marginBottom: '16px'
              }}>
                Start Menu → OpenGiraffe<br/>
                <span style={{ opacity: 0.7 }}>or check your system tray (bottom-right corner)</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  onClick={launchDesktopApp}
                  disabled={isLaunchingApp}
                  style={{
                    padding: '12px 24px',
                    background: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#d97706',
                    fontSize: '14px',
                    fontWeight: '700',
                    cursor: isLaunchingApp ? 'wait' : 'pointer',
                    whiteSpace: 'nowrap',
                    opacity: isLaunchingApp ? 0.7 : 1,
                    transition: 'all 0.2s',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                  }}
                >
                  {isLaunchingApp ? '⏳ Starting...' : '🚀 Launch OpenGiraffe'}
                </button>
                <span style={{ fontSize: '12px', opacity: 0.8 }}>
                  {isLaunchingApp ? 'Waiting for app to start...' : 'Click to start the desktop app'}
                </span>
              </div>
            </div>
          )}

          {desktopAppStatus === 'checking' && (
            <div style={{
              maxWidth: '800px',
              margin: '0 auto 20px auto',
              padding: '16px 20px',
              background: theme === 'professional' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.2)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              border: '1px solid rgba(59, 130, 246, 0.3)'
            }}>
              <span style={{ fontSize: '20px' }}>🔄</span>
              <div style={{ fontSize: '13px', opacity: 0.9 }}>Checking desktop app status...</div>
            </div>
          )}

          {/* Local DB Tab */}
          {activeTab === 'localdb' && config.postgres?.config && (
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '600', opacity: 0.9 }}>
                PostgreSQL Connection
              </h4>
              
              {/* Form */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', opacity: 0.8, fontWeight: '500' }}>Host</label>
                  <input
                    type="text"
                    value={config.postgres.config.host}
                    onChange={(e) => updatePostgresConfig('host', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: inputBg,
                      border: `1px solid ${inputBorder}`,
                      color: textColor,
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', opacity: 0.8, fontWeight: '500' }}>Port</label>
                  <input
                    type="number"
                    value={config.postgres.config.port}
                    onChange={(e) => updatePostgresConfig('port', parseInt(e.target.value) || 5432)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: inputBg,
                      border: `1px solid ${inputBorder}`,
                      color: textColor,
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', opacity: 0.8, fontWeight: '500' }}>Database</label>
                  <input
                    type="text"
                    value={config.postgres.config.database}
                    onChange={(e) => updatePostgresConfig('database', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: inputBg,
                      border: `1px solid ${inputBorder}`,
                      color: textColor,
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', opacity: 0.8, fontWeight: '500' }}>User</label>
                  <input
                    type="text"
                    value={config.postgres.config.user}
                    onChange={(e) => updatePostgresConfig('user', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: inputBg,
                      border: `1px solid ${inputBorder}`,
                      color: textColor,
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  />
                </div>
              </div>
              
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', opacity: 0.8, fontWeight: '500' }}>Password</label>
                <input
                  type="password"
                  value={config.postgres.config.password}
                  onChange={(e) => updatePostgresConfig('password', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: inputBg,
                    border: `1px solid ${inputBorder}`,
                    color: textColor,
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', marginBottom: '6px', opacity: 0.8, fontWeight: '500' }}>Schema</label>
                  <input
                    type="text"
                    value={config.postgres.config.schema}
                    onChange={(e) => updatePostgresConfig('schema', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: inputBg,
                      border: `1px solid ${inputBorder}`,
                      color: textColor,
                      borderRadius: '8px',
                      fontSize: '13px',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={config.postgres.config.ssl}
                      onChange={(e) => updatePostgresConfig('ssl', e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    Use SSL
                  </label>
                </div>
              </div>

              {/* Connect Button */}
              <button
                onClick={handleTestConnection}
                disabled={isTesting}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: config.postgres?.enabled 
                    ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)' 
                    : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  border: 'none',
                  borderRadius: '10px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: isTesting ? 'wait' : 'pointer',
                  transition: 'all 0.2s',
                  opacity: isTesting ? 0.7 : 1,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                }}
              >
                {isTesting ? (
                  'Connecting...'
                ) : config.postgres?.enabled ? (
                  <>✓ PostgreSQL Connected</>
                ) : (
                  'Connect Local PostgreSQL'
                )}
              </button>

              {/* Admin Actions - Only show when connected */}
              {config.postgres?.enabled && (
                <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* Connection Info Box */}
                  <div style={{
                    padding: '16px',
                    background: theme === 'professional' ? 'rgba(34, 197, 94, 0.08)' : 'rgba(76, 175, 80, 0.1)',
                    border: '1px solid rgba(76, 175, 80, 0.3)',
                    borderRadius: '10px',
                    fontSize: '12px',
                  }}>
                    <div style={{ fontWeight: '600', marginBottom: '10px', opacity: 0.9 }}>
                      🔗 DBeaver Connection Info
                    </div>
                    <div style={{ marginBottom: '6px', opacity: 0.8 }}>
                      <strong>Connection:</strong> Local PostgreSQL (WR Desk)
                    </div>
                    <div style={{ marginBottom: '6px', opacity: 0.8 }}>
                      <strong>Username:</strong> {config.postgres.config.user}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.8 }}>
                      <strong>Password:</strong>
                      <code style={{
                        padding: '4px 8px',
                        background: theme === 'professional' ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.3)',
                        borderRadius: '4px',
                        fontSize: '11px',
                        userSelect: 'all',
                      }}>
                        {config.postgres.config.password}
                      </code>
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '11px', opacity: 0.7, fontStyle: 'italic' }}>
                      💡 Copy password above if DBeaver prompts for it
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                      onClick={async () => {
                        if (!config.postgres?.enabled || !config.postgres?.config) {
                          setNotification({ message: 'Please connect to PostgreSQL first', type: 'error' });
                          setTimeout(() => setNotification(null), 5000);
                          return;
                        }
                        try {
                          const result = await electronApiCall('/api/db/launch-dbeaver', {
                            method: 'POST',
                            body: { postgresConfig: config.postgres.config },
                          });
                          if (result.success && result.data?.ok) {
                            setNotification({
                              message: 'DBeaver launched! Look for "Local PostgreSQL (WR Desk)" connection.',
                              type: 'success'
                            });
                            setTimeout(() => setNotification(null), 10000);
                          } else {
                            setNotification({
                              message: result.data?.message || result.error || 'Could not launch DBeaver.',
                              type: 'error'
                            });
                            setTimeout(() => setNotification(null), 5000);
                          }
                        } catch (error: any) {
                          setNotification({
                            message: `Could not connect to Electron app: ${error.message || 'Please start the desktop app first.'}`,
                            type: 'error'
                          });
                          setTimeout(() => setNotification(null), 5000);
                        }
                      }}
                      style={{
                        padding: '12px',
                        background: theme === 'professional' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                        border: `1px solid ${inputBorder}`,
                        borderRadius: '8px',
                        color: textColor,
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s',
                      }}
                    >
                      🗄️ Connect DBeaver
                    </button>

                    <button
                      onClick={async () => {
                        if (!config.postgres?.enabled || !config.postgres?.config) {
                          setNotification({ message: 'Please connect to PostgreSQL first', type: 'error' });
                          setTimeout(() => setNotification(null), 5000);
                          return;
                        }
                        setIsInsertingTestData(true);
                        try {
                          const result = await electronApiCall('/api/db/insert-test-data', {
                            method: 'POST',
                            body: { postgresConfig: config.postgres.config },
                          });
                          if (result.success && result.data?.ok) {
                            setNotification({
                              message: `Successfully inserted ${result.data.count} test data items`,
                              type: 'success'
                            });
                            handleLoadStats();
                          } else {
                            setNotification({ message: result.data?.message || result.error || 'Failed to insert test data', type: 'error' });
                          }
                        } catch (error: any) {
                          setNotification({ message: `Error: ${error.message || 'Failed to insert test data'}`, type: 'error' });
                        } finally {
                          setIsInsertingTestData(false);
                          setTimeout(() => setNotification(null), 5000);
                        }
                      }}
                      disabled={isInsertingTestData}
                      style={{
                        padding: '12px',
                        background: theme === 'professional' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.2)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '8px',
                        color: textColor,
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: isInsertingTestData ? 'wait' : 'pointer',
                        opacity: isInsertingTestData ? 0.7 : 1,
                        transition: 'all 0.2s',
                      }}
                    >
                      {isInsertingTestData ? 'Inserting...' : '📝 Insert Test Data'}
                    </button>
                  </div>

                  <button
                    onClick={handleLoadStats}
                    disabled={isLoadingStats}
                    style={{
                      padding: '12px',
                      background: theme === 'professional' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                      border: `1px solid ${inputBorder}`,
                      borderRadius: '8px',
                      color: textColor,
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: isLoadingStats ? 'wait' : 'pointer',
                      opacity: isLoadingStats ? 0.7 : 1,
                      transition: 'all 0.2s',
                    }}
                  >
                    {isLoadingStats ? 'Loading...' : '📊 View Data Stats'}
                  </button>

                  {/* Stats Display */}
                  {testDataStats && (
                    <div style={{
                      padding: '16px',
                      background: theme === 'professional' ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.2)',
                      border: `1px solid ${inputBorder}`,
                      borderRadius: '10px',
                      fontSize: '12px',
                    }}>
                      <div style={{ fontWeight: '600', marginBottom: '10px', fontSize: '13px' }}>Database Statistics</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '12px' }}>
                        <div>Total: <strong>{testDataStats.total}</strong></div>
                        <div>Vault: <strong>{testDataStats.vault}</strong></div>
                        <div>Logs: <strong>{testDataStats.logs}</strong></div>
                        <div>Vectors: <strong>{testDataStats.vectors}</strong></div>
                        <div>GIS: <strong>{testDataStats.gis}</strong></div>
                        <div>Archived: <strong>{testDataStats.archived}</strong></div>
                      </div>
                      {testDataStats.sampleKeys.length > 0 && (
                        <div style={{ marginTop: '10px', fontSize: '11px', opacity: 0.7 }}>
                          Sample keys: {testDataStats.sampleKeys.slice(0, 3).join(', ')}...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* LLM & Images Tab */}
          {activeTab === 'llm' && (
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
              <ErrorBoundary fallback={<div style={{ padding: '20px', color: 'red' }}>Error loading LLM settings. Check console for details.</div>}>
              {/* Sub-tabs */}
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '20px',
                borderBottom: `1px solid ${borderColor}`,
                paddingBottom: '12px'
              }}>
                <button
                  onClick={() => setLlmSubTab('text')}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: llmSubTab === 'text' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                    border: llmSubTab === 'text' ? '1px solid rgba(59, 130, 246, 0.4)' : `1px solid ${borderColor}`,
                    borderRadius: '6px',
                    color: textColor,
                    fontSize: '13px',
                    fontWeight: llmSubTab === 'text' ? '600' : '400',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  💬 Text AI (LLM)
                </button>
                <button
                  onClick={() => setLlmSubTab('image')}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    background: llmSubTab === 'image' ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                    border: llmSubTab === 'image' ? '1px solid rgba(59, 130, 246, 0.4)' : `1px solid ${borderColor}`,
                    borderRadius: '6px',
                    color: textColor,
                    fontSize: '13px',
                    fontWeight: llmSubTab === 'image' ? '600' : '400',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px'
                  }}
                >
                  🖼️ Image AI
                </button>
              </div>

              {llmSubTab === 'text' && <LlmSettings theme={theme} bridge="http" />}
              {llmSubTab === 'image' && <ImageEngineSettings theme={theme} />}
              </ErrorBoundary>
            </div>
          )}

          {/* Other Tabs (Coming Soon) */}
          {activeTab !== 'localdb' && activeTab !== 'llm' && (
            <div style={{ 
              padding: '60px 40px', 
              textAlign: 'center', 
              opacity: 0.6 
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                {activeTab === 'vectordb' ? '🔢' : '⚡'}
              </div>
              <div style={{ fontSize: '16px', fontWeight: '500' }}>
                {activeTab === 'vectordb' && 'Vector Database configuration coming soon'}
                {activeTab === 'automation' && 'Automation platform configuration coming soon'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '14px 24px',
          background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)',
          border: `1px solid ${notification.type === 'success' ? '#22c55e' : '#ef4444'}`,
          borderRadius: '10px',
          color: '#fff',
          fontSize: '13px',
          fontWeight: '600',
          zIndex: 2147483652,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          {notification.message}
        </div>
      )}
    </div>
  );
}


