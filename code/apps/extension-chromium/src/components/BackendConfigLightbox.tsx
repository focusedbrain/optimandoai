import { useState, useEffect, Component, ReactNode } from 'react';
import { LlmSettings } from './LlmSettings';
import { ImageEngineSettings } from './ImageEngineSettings';
import { electronRpc } from '../rpc/electronRpc';
import {
  getThemeTokens,
  overlayStyle,
  panelStyle,
  headerStyle,
  headerTitleStyle,
  headerMainTitleStyle,
  headerSubtitleStyle,
  closeButtonStyle,
  bodyStyle,
  tabBarStyle,
  tabStyle,
  inputStyle,
  labelStyle,
  cardStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  toastStyle,
} from '../shared/ui/lightboxTheme';

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

// ─── Electron RPC ────────────────────────────────────────────────────────
// All Electron HTTP calls now go through typed RPC methods defined in
// src/rpc/electronRpc.ts.  No direct fetch, no dynamic endpoints.
// ─────────────────────────────────────────────────────────────────────────

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
      const result = await electronRpc('db.testDataStats');
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
    console.log('[BackendConfigLightbox] Starting connection test:', config.postgres.config);
    
    try {
      const result = await electronRpc('db.testConnection', config.postgres.config, 10000);

      console.log('[BackendConfigLightbox] RPC response:', result);

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

  const t = getThemeTokens(theme);

  return (
    <div style={overlayStyle(t)}>
      <div style={panelStyle(t)}>
        {/* Header */}
        <div style={headerStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>⚙️</span>
            <div>
              <p style={headerMainTitleStyle()}>Backend Configuration</p>
              <p style={headerSubtitleStyle()}>Configure database, AI models, and automation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={closeButtonStyle(t)}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.closeHoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.closeBg; }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={tabBarStyle(t)}>
          {(['localdb', 'vectordb', 'llm', 'automation'] as const).map((tab) => {
            const isEnabled = tab === 'localdb' || tab === 'llm';
            const labels = {
              localdb: `🗄️ Local DB${config.postgres?.enabled ? ' ✓' : ''}`,
              vectordb: '🔢 Vector DB',
              llm: '🤖 LLM & Images',
              automation: '⚡ Automation',
            };
            return (
              <button
                key={tab}
                onClick={() => isEnabled && setActiveTab(tab)}
                disabled={!isEnabled}
                style={tabStyle(t, activeTab === tab, !isEnabled)}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={bodyStyle(t)}>
          {/* Desktop App Status Banner */}
          {desktopAppStatus === 'not-running' && (
            <div style={{
              marginBottom: '20px',
              padding: '18px 20px',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(217,119,6,0.18) 100%)',
              border: '1px solid rgba(245,158,11,0.4)',
              borderRadius: '12px',
              color: t.text,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontSize: '20px' }}>⚠️</span>
                <span style={{ fontWeight: 600, fontSize: '14px', color: t.warning }}>Desktop App Not Running</span>
              </div>
              <p style={{ fontSize: '13px', color: t.textMuted, margin: '0 0 12px 0', lineHeight: 1.5 }}>
                The OpenGiraffe desktop app is required for database and LLM connections. Please start it from:
              </p>
              <div style={{
                background: 'rgba(0,0,0,0.2)',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontFamily: 'monospace',
                color: t.textMuted,
                marginBottom: '14px',
              }}>
                Start Menu → OpenGiraffe<br />
                <span style={{ opacity: 0.7 }}>or check your system tray (bottom-right corner)</span>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  onClick={launchDesktopApp}
                  disabled={isLaunchingApp}
                  style={{
                    ...primaryButtonStyle(t, isLaunchingApp),
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isLaunchingApp ? '⏳ Starting...' : '🚀 Launch OpenGiraffe'}
                </button>
                <span style={{ fontSize: '12px', color: t.textMuted }}>
                  {isLaunchingApp ? 'Waiting for app to start...' : 'Click to start the desktop app'}
                </span>
              </div>
            </div>
          )}

          {desktopAppStatus === 'checking' && (
            <div style={{
              marginBottom: '20px',
              padding: '14px 18px',
              background: 'rgba(129,140,248,0.12)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              border: '1px solid rgba(129,140,248,0.3)',
            }}>
              <span style={{ fontSize: '18px' }}>🔄</span>
              <span style={{ fontSize: '13px', color: t.textMuted }}>Checking desktop app status...</span>
            </div>
          )}

          {/* Local DB Tab */}
          {activeTab === 'localdb' && config.postgres?.config && (
            <div style={{ maxWidth: '820px', margin: '0 auto' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                PostgreSQL Connection
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={labelStyle(t)}>Host</label>
                  <input type="text" value={config.postgres.config.host}
                    onChange={(e) => updatePostgresConfig('host', e.target.value)}
                    style={inputStyle(t)} />
                </div>
                <div>
                  <label style={labelStyle(t)}>Port</label>
                  <input type="number" value={config.postgres.config.port}
                    onChange={(e) => updatePostgresConfig('port', parseInt(e.target.value) || 5432)}
                    style={inputStyle(t)} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={labelStyle(t)}>Database</label>
                  <input type="text" value={config.postgres.config.database}
                    onChange={(e) => updatePostgresConfig('database', e.target.value)}
                    style={inputStyle(t)} />
                </div>
                <div>
                  <label style={labelStyle(t)}>User</label>
                  <input type="text" value={config.postgres.config.user}
                    onChange={(e) => updatePostgresConfig('user', e.target.value)}
                    style={inputStyle(t)} />
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={labelStyle(t)}>Password</label>
                <input type="password" value={config.postgres.config.password}
                  onChange={(e) => updatePostgresConfig('password', e.target.value)}
                  style={inputStyle(t)} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '18px' }}>
                <div>
                  <label style={labelStyle(t)}>Schema</label>
                  <input type="text" value={config.postgres.config.schema}
                    onChange={(e) => updatePostgresConfig('schema', e.target.value)}
                    style={inputStyle(t)} />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', color: t.text }}>
                    <input type="checkbox" checked={config.postgres.config.ssl}
                      onChange={(e) => updatePostgresConfig('ssl', e.target.checked)}
                      style={{ width: '15px', height: '15px', accentColor: t.accentColor }} />
                    Use SSL
                  </label>
                </div>
              </div>

              <button
                onClick={handleTestConnection}
                disabled={isTesting}
                style={{
                  width: '100%',
                  padding: '13px',
                  background: config.postgres?.enabled
                    ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
                    : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  border: 'none',
                  borderRadius: '10px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: isTesting ? 'wait' : 'pointer',
                  opacity: isTesting ? 0.7 : 1,
                  transition: 'all 0.18s',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                }}
              >
                {isTesting ? 'Connecting...' : config.postgres?.enabled ? '✓ PostgreSQL Connected' : 'Connect Local PostgreSQL'}
              </button>

              {config.postgres?.enabled && (
                <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{
                    ...cardStyle(t),
                    background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.25)',
                    fontSize: '12px',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '10px', color: t.success }}>🔗 DBeaver Connection Info</div>
                    <div style={{ marginBottom: '5px', color: t.textMuted }}><strong style={{ color: t.text }}>Connection:</strong> Local PostgreSQL (WR Desk)</div>
                    <div style={{ marginBottom: '5px', color: t.textMuted }}><strong style={{ color: t.text }}>Username:</strong> {config.postgres.config.user}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: t.textMuted }}>
                      <strong style={{ color: t.text }}>Password:</strong>
                      <code style={{ padding: '3px 7px', background: t.inputBg, borderRadius: '4px', fontSize: '11px', userSelect: 'all', color: t.text }}>
                        {config.postgres.config.password}
                      </code>
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '11px', color: t.textMuted, fontStyle: 'italic' }}>
                      💡 Copy password above if DBeaver prompts for it
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <button
                      onClick={async () => {
                        if (!config.postgres?.enabled || !config.postgres?.config) {
                          setNotification({ message: 'Please connect to PostgreSQL first', type: 'error' });
                          setTimeout(() => setNotification(null), 5000);
                          return;
                        }
                        try {
                          const result = await electronRpc('db.launchDbeaver', { postgresConfig: config.postgres.config });
                          if (result.success && result.data?.ok) {
                            setNotification({ message: 'DBeaver launched! Look for "Local PostgreSQL (WR Desk)" connection.', type: 'success' });
                            setTimeout(() => setNotification(null), 10000);
                          } else {
                            setNotification({ message: result.data?.message || result.error || 'Could not launch DBeaver.', type: 'error' });
                            setTimeout(() => setNotification(null), 5000);
                          }
                        } catch (error: any) {
                          setNotification({ message: `Could not connect to Electron app: ${error.message || 'Please start the desktop app first.'}`, type: 'error' });
                          setTimeout(() => setNotification(null), 5000);
                        }
                      }}
                      style={secondaryButtonStyle(t)}
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
                          const result = await electronRpc('db.insertTestData', { postgresConfig: config.postgres.config });
                          if (result.success && result.data?.ok) {
                            setNotification({ message: `Successfully inserted ${result.data.count} test data items`, type: 'success' });
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
                      style={secondaryButtonStyle(t, isInsertingTestData)}
                    >
                      {isInsertingTestData ? 'Inserting...' : '📝 Insert Test Data'}
                    </button>
                  </div>

                  <button
                    onClick={handleLoadStats}
                    disabled={isLoadingStats}
                    style={secondaryButtonStyle(t, isLoadingStats)}
                  >
                    {isLoadingStats ? 'Loading...' : '📊 View Data Stats'}
                  </button>

                  {testDataStats && (
                    <div style={{ ...cardStyle(t), fontSize: '12px' }}>
                      <div style={{ fontWeight: 600, marginBottom: '10px', fontSize: '13px', color: t.text }}>Database Statistics</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', color: t.textMuted }}>
                        <div>Total: <strong style={{ color: t.text }}>{testDataStats.total}</strong></div>
                        <div>Vault: <strong style={{ color: t.text }}>{testDataStats.vault}</strong></div>
                        <div>Logs: <strong style={{ color: t.text }}>{testDataStats.logs}</strong></div>
                        <div>Vectors: <strong style={{ color: t.text }}>{testDataStats.vectors}</strong></div>
                        <div>GIS: <strong style={{ color: t.text }}>{testDataStats.gis}</strong></div>
                        <div>Archived: <strong style={{ color: t.text }}>{testDataStats.archived}</strong></div>
                      </div>
                      {testDataStats.sampleKeys.length > 0 && (
                        <div style={{ marginTop: '10px', fontSize: '11px', color: t.textMuted }}>
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
            <div style={{ maxWidth: '820px', margin: '0 auto' }}>
              <ErrorBoundary fallback={<div style={{ padding: '20px', color: t.error }}>Error loading LLM settings. Check console for details.</div>}>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: `1px solid ${t.border}`, paddingBottom: '12px' }}>
                  {(['text', 'image'] as const).map((sub) => (
                    <button
                      key={sub}
                      onClick={() => setLlmSubTab(sub)}
                      style={{ ...tabStyle(t, llmSubTab === sub), flex: 1 }}
                    >
                      {sub === 'text' ? '💬 Text AI (LLM)' : '🖼️ Image AI'}
                    </button>
                  ))}
                </div>
                {llmSubTab === 'text' && <LlmSettings theme={theme} bridge="http" />}
                {llmSubTab === 'image' && <ImageEngineSettings theme={theme} />}
              </ErrorBoundary>
            </div>
          )}

          {/* Coming Soon tabs */}
          {activeTab !== 'localdb' && activeTab !== 'llm' && (
            <div style={{ padding: '60px 40px', textAlign: 'center', color: t.textMuted }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                {activeTab === 'vectordb' ? '🔢' : '⚡'}
              </div>
              <div style={{ fontSize: '15px', fontWeight: 500 }}>
                {activeTab === 'vectordb' && 'Vector Database configuration coming soon'}
                {activeTab === 'automation' && 'Automation platform configuration coming soon'}
              </div>
            </div>
          )}
        </div>
      </div>

      {notification && (
        <div style={toastStyle(notification.type)}>
          {notification.message}
        </div>
      )}
    </div>
  );
}


