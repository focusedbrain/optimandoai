import { useState, useEffect } from 'react';
import { LlmSettings } from './LlmSettings';

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

interface BackendSwitcherProps {
  theme?: 'default' | 'dark' | 'professional';
}

export function BackendSwitcher({ theme = 'default' }: BackendSwitcherProps) {
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'localdb' | 'vectordb' | 'llm' | 'automation'>('localdb');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isInsertingTestData, setIsInsertingTestData] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [testDataStats, setTestDataStats] = useState<{
    total: number;
    vault: number;
    logs: number;
    vectors: number;
    gis: number;
    archived: number;
    sampleKeys: string[];
  } | null>(null);

  // Load config on mount
  useEffect(() => {
    chrome.storage.local.get(['backendConfig'], (result) => {
      if (result.backendConfig) {
        setConfig(result.backendConfig);
      }
    });
  }, []);

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
      const response = await fetch('http://127.0.0.1:51248/api/db/test-data-stats', {
        method: 'GET',
      });
      const result = await response.json();
      if (result.ok) {
        setTestDataStats(result.stats);
      } else {
        setNotification({
          message: result.message || 'Failed to load stats',
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
    const logSteps: any[] = [];
    
    try {
      logSteps.push({ step: 'Starting connection test', timestamp: new Date().toISOString(), config: config.postgres.config });
      console.log('[BackendSwitcher] Starting connection test:', config.postgres.config);
      
      const response = await fetch('http://127.0.0.1:51248/api/db/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.postgres.config),
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      logSteps.push({ step: 'Received response', status: response.status, statusText: response.statusText, ok: response.ok });
      console.log('[BackendSwitcher] Response received:', { status: response.status, statusText: response.statusText, ok: response.ok });

      if (!response.ok) {
        const errorText = await response.text();
        logSteps.push({ step: 'HTTP error', errorText });
        console.error('[BackendSwitcher] HTTP error:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      logSteps.push({ step: 'Parsed JSON result', result });
      console.log('[BackendSwitcher] Connection test result:', result);
      
      if (result.ok) {
        // Connection successful - set enabled to true
        const newConfig = { ...config, postgres: { enabled: true, config: config.postgres.config } };
        setConfig(newConfig);
        chrome.storage.local.set({ backendConfig: newConfig });
        logSteps.push({ step: 'Success - config saved', enabled: true });
        console.log('[BackendSwitcher] ✅ Connection successful, config saved');
        setNotification({ message: 'Connected successfully', type: 'success' });
      } else {
        // Connection failed - ensure enabled is false
        const newConfig = { ...config, postgres: { enabled: false, config: config.postgres.config } };
        setConfig(newConfig);
        chrome.storage.local.set({ backendConfig: newConfig });
        logSteps.push({ step: 'Connection failed', message: result.message, details: result.details });
        console.error('[BackendSwitcher] ❌ Connection failed:', result);
        console.log('[BackendSwitcher] Full error log:', JSON.stringify({ logSteps, result }, null, 2));
        setNotification({ 
          message: result.message || result.details?.error || 'Connection failed', 
          type: 'error' 
        });
      }
    } catch (error: any) {
      // Connection error - ensure enabled is false
      const newConfig = { ...config, postgres: { enabled: false, config: config.postgres.config } };
      setConfig(newConfig);
      chrome.storage.local.set({ backendConfig: newConfig });
      
      let errorMessage = 'Connection failed';
      
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        errorMessage = 'Connection timeout - Please ensure Electron app is running';
        logSteps.push({ step: 'Timeout error', errorName: error.name });
      } else if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        errorMessage = 'Cannot reach Electron app - Please start the desktop application';
        logSteps.push({ step: 'Network error', errorMessage: error.message });
      } else if (error.message) {
        errorMessage = error.message;
        logSteps.push({ step: 'Generic error', errorMessage: error.message, errorStack: error.stack });
      }
      
      console.error('[BackendSwitcher] ❌ Exception caught:', error);
      console.log('[BackendSwitcher] Full error log:', JSON.stringify({ logSteps, error: { name: error.name, message: error.message, stack: error.stack } }, null, 2));
      setNotification({ message: errorMessage, type: 'error' });
    } finally {
      setIsTesting(false);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  // Match Quick Actions section styling
  const bgColor = theme === 'default' 
    ? 'rgba(118,75,162,0.5)' 
    : 'rgba(255,255,255,0.12)';
  const borderColor = 'rgba(255,255,255,0.15)';
  const textColor = theme === 'default' ? '#fff' : theme === 'dark' ? '#fff' : '#0f172a';

  return (
    <>
      <div style={{
        background: bgColor,
        padding: '16px',
        borderRadius: '10px',
        marginBottom: '28px',
        border: `1px solid ${borderColor}`,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '14px',
          cursor: 'pointer',
        }} onClick={() => setIsExpanded(!isExpanded)}>
          <h3 style={{
            margin: 0,
            fontSize: '13px',
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            opacity: 0.95,
            color: textColor,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            ⚙️ Backend Configuration
          </h3>
          <span style={{
            fontSize: '12px',
            color: textColor,
            opacity: 0.7,
            transition: 'transform 0.2s',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>
            ▼
          </span>
        </div>

        {/* Content */}
        {isExpanded && (
          <>
            {/* Tabs */}
            <div style={{
              display: 'flex',
              gap: '6px',
              marginBottom: '14px',
            }}>
              {(['localdb', 'vectordb', 'llm', 'automation'] as const).map((tab) => {
                const isEnabled = tab === 'localdb' || tab === 'llm';
                return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  disabled={!isEnabled}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    background: activeTab === tab ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                    border: 'none',
                    borderRadius: '6px',
                    color: textColor,
                    fontSize: '11px',
                    fontWeight: activeTab === tab ? '600' : '500',
                    cursor: isEnabled ? 'pointer' : 'not-allowed',
                    opacity: isEnabled ? 1 : 0.5,
                    transition: 'all 0.2s',
                  }}
                >
                  {tab === 'localdb' && `Local DB ${config.postgres?.enabled ? '✓' : ''}`}
                  {tab === 'vectordb' && 'Vector DB'}
                  {tab === 'llm' && 'LLM'}
                  {tab === 'automation' && 'Automation'}
                </button>
              );
              })}
            </div>

            {/* Local DB Tab */}
            {activeTab === 'localdb' && config.postgres?.config && (
              <>
                {/* Form */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.8 }}>Host</label>
                    <input
                      type="text"
                      value={config.postgres.config.host}
                      onChange={(e) => updatePostgresConfig('host', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: textColor,
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.8 }}>Port</label>
                    <input
                      type="number"
                      value={config.postgres.config.port}
                      onChange={(e) => updatePostgresConfig('port', parseInt(e.target.value) || 5432)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: textColor,
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.8 }}>Database</label>
                    <input
                      type="text"
                      value={config.postgres.config.database}
                      onChange={(e) => updatePostgresConfig('database', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: textColor,
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.8 }}>User</label>
                    <input
                      type="text"
                      value={config.postgres.config.user}
                      onChange={(e) => updatePostgresConfig('user', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: textColor,
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.8 }}>Password</label>
                  <input
                    type="password"
                    value={config.postgres.config.password}
                    onChange={(e) => updatePostgresConfig('password', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      color: textColor,
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.8 }}>Schema</label>
                    <input
                      type="text"
                      value={config.postgres.config.schema}
                      onChange={(e) => updatePostgresConfig('schema', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: textColor,
                        borderRadius: '6px',
                        fontSize: '12px',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '11px',
                      color: textColor,
                      cursor: 'pointer',
                    }}>
                      <input
                        type="checkbox"
                        checked={config.postgres.config.ssl}
                        onChange={(e) => updatePostgresConfig('ssl', e.target.checked)}
                      />
                      SSL
                    </label>
                  </div>
                </div>

                {/* Button */}
                <button
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: config.postgres?.enabled ? '#4CAF50' : '#2196F3',
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: isTesting ? 'wait' : 'pointer',
                    transition: 'all 0.2s',
                    opacity: isTesting ? 0.7 : 1,
                  }}
                >
                  {isTesting ? (
                    'Connecting...'
                  ) : config.postgres?.enabled ? (
                    <>
                      <span style={{ marginRight: '6px' }}>✓</span>
                      PostgreSQL Connected
                    </>
                  ) : (
                    'Connect Local PostgreSQL'
                  )}
                </button>

                {/* Admin Actions - Only show when connected */}
                {config.postgres?.enabled && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Connection Info Box */}
                    <div style={{
                      padding: '12px',
                      background: 'rgba(76, 175, 80, 0.1)',
                      border: '1px solid rgba(76, 175, 80, 0.3)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: textColor,
                    }}>
                      <div style={{ fontWeight: '600', marginBottom: '8px', opacity: 0.9 }}>
                        🔗 DBeaver Connection Info
                      </div>
                      <div style={{ marginBottom: '4px', opacity: 0.8 }}>
                        <strong>Connection:</strong> Local PostgreSQL (WR Code)
                      </div>
                      <div style={{ marginBottom: '4px', opacity: 0.8 }}>
                        <strong>Username:</strong> {config.postgres.config.user}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.8 }}>
                        <strong>Password:</strong>
                        <code style={{
                          padding: '2px 6px',
                          background: 'rgba(0,0,0,0.3)',
                          borderRadius: '4px',
                          fontSize: '10px',
                          userSelect: 'all',
                        }}>
                          {config.postgres.config.password}
                        </code>
                      </div>
                      <div style={{ marginTop: '8px', fontSize: '10px', opacity: 0.7, fontStyle: 'italic' }}>
                        💡 Copy password above if DBeaver prompts for it
                      </div>
                    </div>

                    {/* Open DBeaver Button - Automatically configures connection and downloads drivers */}
                    <button
                      onClick={async () => {
                        if (!config.postgres?.enabled || !config.postgres?.config) {
                          setNotification({
                            message: 'Please connect to PostgreSQL first',
                            type: 'error'
                          });
                          setTimeout(() => setNotification(null), 5000);
                          return;
                        }
                        // Launch DBeaver and configure connection automatically
                        try {
                          const response = await fetch('http://127.0.0.1:51248/api/db/launch-dbeaver', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ postgresConfig: config.postgres.config }),
                          });
                          const result = await response.json();
                          if (result.ok) {
                            setNotification({
                              message: 'DBeaver launched! Look for "Local PostgreSQL (WR Code)" connection. Double-click to connect and enter password if prompted.',
                              type: 'success'
                            });
                            setTimeout(() => setNotification(null), 10000);
                          } else {
                            setNotification({
                              message: result.message || 'Could not launch DBeaver. Please open it manually from Start Menu.',
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
                        width: '100%',
                        padding: '10px',
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '6px',
                        color: textColor,
                        fontSize: '12px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                      }}
                    >
                      <span>🗄️</span>
                      <span>Connect DBeaver</span>
                    </button>

                    {/* Insert Test Data Button */}
                    <button
                      onClick={async () => {
                        if (!config.postgres?.enabled || !config.postgres?.config) {
                          setNotification({
                            message: 'Please connect to PostgreSQL first',
                            type: 'error'
                          });
                          setTimeout(() => setNotification(null), 5000);
                          return;
                        }
                        setIsInsertingTestData(true);
                        try {
                          const response = await fetch('http://127.0.0.1:51248/api/db/insert-test-data', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ postgresConfig: config.postgres.config }),
                          });
                          const result = await response.json();
                          if (result.ok) {
                            setNotification({
                              message: `Successfully inserted ${result.count} test data items`,
                              type: 'success'
                            });
                            // Refresh stats
                            handleLoadStats();
                          } else {
                            setNotification({
                              message: result.message || 'Failed to insert test data',
                              type: 'error'
                            });
                          }
                        } catch (error: any) {
                          setNotification({
                            message: `Error: ${error.message || 'Failed to insert test data'}`,
                            type: 'error'
                          });
                        } finally {
                          setIsInsertingTestData(false);
                          setTimeout(() => setNotification(null), 5000);
                        }
                      }}
                      disabled={isInsertingTestData}
                      style={{
                        width: '100%',
                        padding: '10px',
                        background: isInsertingTestData ? 'rgba(255,255,255,0.1)' : 'rgba(59, 130, 246, 0.2)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '6px',
                        color: textColor,
                        fontSize: '12px',
                        fontWeight: '500',
                        cursor: isInsertingTestData ? 'wait' : 'pointer',
                        opacity: isInsertingTestData ? 0.7 : 1,
                        transition: 'all 0.2s',
                      }}
                    >
                      {isInsertingTestData ? 'Inserting...' : '📝 Insert Test Data'}
                    </button>

                    {/* View Test Data Stats Button */}
                    <button
                      onClick={handleLoadStats}
                      disabled={isLoadingStats}
                      style={{
                        width: '100%',
                        padding: '10px',
                        background: 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '6px',
                        color: textColor,
                        fontSize: '12px',
                        fontWeight: '500',
                        cursor: isLoadingStats ? 'wait' : 'pointer',
                        opacity: isLoadingStats ? 0.7 : 1,
                        transition: 'all 0.2s',
                      }}
                    >
                      {isLoadingStats ? 'Loading...' : '📊 View Data Stats'}
                    </button>

                    {/* Test Data Stats Display */}
                    {testDataStats && (
                      <div style={{
                        marginTop: '8px',
                        padding: '10px',
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        color: textColor,
                      }}>
                        <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '12px' }}>Database Statistics</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '10px' }}>
                          <div>Total: <strong>{testDataStats.total}</strong></div>
                          <div>Vault: <strong>{testDataStats.vault}</strong></div>
                          <div>Logs: <strong>{testDataStats.logs}</strong></div>
                          <div>Vectors: <strong>{testDataStats.vectors}</strong></div>
                          <div>GIS: <strong>{testDataStats.gis}</strong></div>
                          <div>Archived: <strong>{testDataStats.archived}</strong></div>
                        </div>
                        {testDataStats.sampleKeys.length > 0 && (
                          <div style={{ marginTop: '6px', fontSize: '9px', opacity: 0.7 }}>
                            Sample keys: {testDataStats.sampleKeys.slice(0, 3).join(', ')}...
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* LLM Tab */}
            {activeTab === 'llm' && (
              <LlmSettings theme={theme} bridge="http" />
            )}

            {/* Other Tabs */}
            {activeTab !== 'localdb' && activeTab !== 'llm' && (
              <div style={{ padding: '20px', textAlign: 'center', color: textColor, opacity: 0.6, fontSize: '11px' }}>
                {activeTab === 'vectordb' && 'Vector Database configuration coming soon'}
                {activeTab === 'automation' && 'Automation platform configuration coming soon'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Notification */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 16px',
          background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)',
          border: `1px solid ${notification.type === 'success' ? '#22c55e' : '#ef4444'}`,
          borderRadius: '6px',
          color: '#fff',
          fontSize: '12px',
          fontWeight: '500',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {notification.message}
        </div>
      )}
    </>
  );
}

