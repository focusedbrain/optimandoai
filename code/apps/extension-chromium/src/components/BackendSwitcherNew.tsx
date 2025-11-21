import { useState, useEffect } from 'react';

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
  
  // LLM state
  const [llmStatus, setLlmStatus] = useState<any>(null);
  const [hardware, setHardware] = useState<any>(null);
  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installStatus, setInstallStatus] = useState('');

  // Load config on mount
  useEffect(() => {
    chrome.storage.local.get(['backendConfig'], (result) => {
      if (result.backendConfig) {
        setConfig(result.backendConfig);
      }
    });
    
    // Load LLM status if on LLM tab
    if (activeTab === 'llm') {
      loadLlmStatus();
    }
  }, [activeTab]);

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

  const handleTestConnection = async () => {
    if (!config.postgres?.config) return;

    setIsTesting(true);
    try {
      const response = await fetch('http://127.0.0.1:51248/api/db/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.postgres.config),
      });

      const result = await response.json();
      
      if (result.ok) {
        const newConfig = { ...config, postgres: { enabled: true, config: config.postgres.config } };
        setConfig(newConfig);
        chrome.storage.local.set({ backendConfig: newConfig });
        setNotification({ message: 'Connected successfully', type: 'success' });
      } else {
        setNotification({ message: result.message || 'Connection failed', type: 'error' });
      }
    } catch (error: any) {
      setNotification({ message: 'Connection failed', type: 'error' });
    } finally {
      setIsTesting(false);
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const loadLlmStatus = async () => {
    try {
      // Fetch from Electron app's HTTP API
      const [statusRes, hardwareRes] = await Promise.all([
        fetch('http://127.0.0.1:51248/api/llm/status'),
        fetch('http://127.0.0.1:51248/api/llm/hardware')
      ]);
      
      if (statusRes.ok) {
        const status = await statusRes.json();
        setLlmStatus(status);
      }
      
      if (hardwareRes.ok) {
        const hw = await hardwareRes.json();
        setHardware(hw);
      }
    } catch (error) {
      console.error('Failed to load LLM status:', error);
    }
  };

  const handleAutoInstallLlm = async () => {
    setInstalling(true);
    setInstallProgress(0);
    setInstallStatus('Starting installation...');

    try {
      // Start Ollama
      setInstallStatus('Starting Ollama server...');
      await fetch('http://127.0.0.1:51248/api/llm/start', { method: 'POST' });
      setInstallProgress(25);

      // Download model
      setInstallStatus('Downloading Mistral 7B...');
      const response = await fetch('http://127.0.0.1:51248/api/llm/download-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName: 'mistral:7b' })
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      setInstallProgress(100);
      setInstallStatus('✓ Installation complete!');
      setNotification({ message: 'LLM installed successfully', type: 'success' });
      
      // Reload status
      setTimeout(() => loadLlmStatus(), 1000);
    } catch (error: any) {
      setInstallStatus('Installation failed');
      setNotification({ message: error.message || 'Installation failed', type: 'error' });
    } finally {
      setInstalling(false);
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const bgColor = theme === 'default' ? 'rgba(17, 24, 39, 0.8)' : theme === 'dark' ? 'rgba(0, 0, 0, 0.8)' : 'rgba(248, 250, 252, 0.95)';
  const borderColor = theme === 'default' ? 'rgba(75, 85, 99, 0.5)' : theme === 'dark' ? 'rgba(55, 65, 81, 0.5)' : 'rgba(226, 232, 240, 0.8)';
  const textColor = theme === 'default' ? '#fff' : theme === 'dark' ? '#fff' : '#0f172a';

  return (
    <>
      <div style={{
        background: bgColor,
        padding: '12px',
        borderRadius: '10px',
        marginBottom: '16px',
        border: `1px solid ${borderColor}`,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
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
              gap: '4px',
              marginBottom: '16px',
              borderBottom: `1px solid ${borderColor}`,
              paddingBottom: '8px',
            }}>
              {(['localdb', 'vectordb', 'llm', 'automation'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  disabled={tab !== 'localdb' && tab !== 'llm'}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: activeTab === tab ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                    border: activeTab === tab ? `1px solid rgba(59, 130, 246, 0.4)` : `1px solid ${borderColor}`,
                    borderRadius: '4px',
                    color: textColor,
                    fontSize: '11px',
                    fontWeight: activeTab === tab ? '600' : '400',
                    cursor: (tab === 'localdb' || tab === 'llm') ? 'pointer' : 'not-allowed',
                    opacity: (tab === 'localdb' || tab === 'llm') ? 1 : 0.5,
                    transition: 'all 0.2s',
                  }}
                >
                  {tab === 'localdb' && `Local DB ${config.postgres?.enabled ? '✓' : ''}`}
                  {tab === 'vectordb' && 'Vector DB'}
                  {tab === 'llm' && `LLM ${llmStatus?.isReady ? '✓' : ''}`}
                  {tab === 'automation' && 'Automation'}
                </button>
              ))}
            </div>

            {/* Local DB Tab */}
            {activeTab === 'localdb' && config.postgres?.config && (
              <>
                {/* Status */}
                {config.postgres?.enabled && (
                  <div style={{
                    marginBottom: '12px',
                    padding: '8px 10px',
                    background: 'rgba(34, 197, 94, 0.12)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    borderRadius: '4px',
                    fontSize: '10px',
                    color: '#22c55e',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    <span style={{ fontSize: '12px' }}>✓</span>
                    <span>Connected</span>
                  </div>
                )}

                {/* Form */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.9 }}>Host</label>
                    <input
                      type="text"
                      value={config.postgres.config.host}
                      onChange={(e) => updatePostgresConfig('host', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px',
                        background: 'rgba(0,0,0,0.2)',
                        border: `1px solid ${borderColor}`,
                        color: textColor,
                        borderRadius: '4px',
                        fontSize: '11px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.9 }}>Port</label>
                    <input
                      type="number"
                      value={config.postgres.config.port}
                      onChange={(e) => updatePostgresConfig('port', parseInt(e.target.value) || 5432)}
                      style={{
                        width: '100%',
                        padding: '6px',
                        background: 'rgba(0,0,0,0.2)',
                        border: `1px solid ${borderColor}`,
                        color: textColor,
                        borderRadius: '4px',
                        fontSize: '11px',
                      }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.9 }}>Database</label>
                    <input
                      type="text"
                      value={config.postgres.config.database}
                      onChange={(e) => updatePostgresConfig('database', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px',
                        background: 'rgba(0,0,0,0.2)',
                        border: `1px solid ${borderColor}`,
                        color: textColor,
                        borderRadius: '4px',
                        fontSize: '11px',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.9 }}>User</label>
                    <input
                      type="text"
                      value={config.postgres.config.user}
                      onChange={(e) => updatePostgresConfig('user', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px',
                        background: 'rgba(0,0,0,0.2)',
                        border: `1px solid ${borderColor}`,
                        color: textColor,
                        borderRadius: '4px',
                        fontSize: '11px',
                      }}
                    />
                  </div>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.9 }}>Password</label>
                  <input
                    type="password"
                    value={config.postgres.config.password}
                    onChange={(e) => updatePostgresConfig('password', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px',
                      background: 'rgba(0,0,0,0.2)',
                      border: `1px solid ${borderColor}`,
                      color: textColor,
                      borderRadius: '4px',
                      fontSize: '11px',
                    }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: textColor, opacity: 0.9 }}>Schema</label>
                    <input
                      type="text"
                      value={config.postgres.config.schema}
                      onChange={(e) => updatePostgresConfig('schema', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px',
                        background: 'rgba(0,0,0,0.2)',
                        border: `1px solid ${borderColor}`,
                        color: textColor,
                        borderRadius: '4px',
                        fontSize: '11px',
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
                    padding: '10px',
                    background: config.postgres?.enabled ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                    border: config.postgres?.enabled ? '1px solid rgba(34, 197, 94, 0.4)' : '1px solid rgba(59, 130, 246, 0.4)',
                    borderRadius: '6px',
                    color: textColor,
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: isTesting ? 'wait' : 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {isTesting ? 'Connecting...' : config.postgres?.enabled ? '✓ Connected' : 'Connect Local PostgreSQL'}
                </button>
              </>
            )}

            {/* LLM Tab */}
            {activeTab === 'llm' && (
              <div>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: '600', color: textColor }}>
                  Local LLM (Ollama + Mistral 7B)
                </h4>

                {/* Hardware Info */}
                {hardware && (
                  <div style={{
                    padding: '10px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    fontSize: '11px',
                    color: textColor,
                  }}>
                    <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '10px', opacity: 0.8 }}>SYSTEM INFO</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px', fontSize: '10px' }}>
                      <span style={{ opacity: 0.7 }}>RAM:</span>
                      <span>{hardware.totalRamGb} GB ({hardware.recommendedTier})</span>
                      <span style={{ opacity: 0.7 }}>CPU:</span>
                      <span>{hardware.cpuCores} cores</span>
                      <span style={{ opacity: 0.7 }}>Status:</span>
                      <span style={{ color: hardware.canRunMistral7B ? '#22c55e' : '#f59e0b' }}>
                        {hardware.canRunMistral7B ? '✓ Compatible' : '⚠ Limited'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Status */}
                {llmStatus && (
                  <div style={{
                    padding: '10px',
                    background: llmStatus.isReady ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
                    border: `1px solid ${llmStatus.isReady ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`,
                    borderRadius: '6px',
                    marginBottom: '12px',
                    fontSize: '11px',
                    color: textColor,
                  }}>
                    <div style={{ fontWeight: '600', marginBottom: '6px', fontSize: '10px' }}>
                      {llmStatus.isReady ? '✓ READY' : 'NOT INSTALLED'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px', fontSize: '10px' }}>
                      <span style={{ opacity: 0.7 }}>Ollama:</span>
                      <span>{llmStatus.ollamaInstalled ? '✓ Installed' : '✗ Not found'}</span>
                      <span style={{ opacity: 0.7 }}>Model:</span>
                      <span>{llmStatus.modelAvailable ? `✓ ${llmStatus.modelName}` : '✗ Not downloaded'}</span>
                    </div>
                  </div>
                )}

                {/* Installation */}
                {!llmStatus?.isReady && (
                  <div style={{
                    padding: '10px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '6px',
                    marginBottom: '8px',
                  }}>
                    {!llmStatus?.ollamaInstalled && (
                      <div style={{
                        padding: '8px',
                        background: 'rgba(239,68,68,0.1)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '4px',
                        fontSize: '10px',
                        marginBottom: '8px',
                        color: textColor,
                      }}>
                        ⚠ Ollama not found. Install from <a href="https://ollama.ai" target="_blank" rel="noopener" style={{ color: '#60a5fa' }}>ollama.ai</a>
                      </div>
                    )}

                    {installing && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '10px', marginBottom: '4px', opacity: 0.8, color: textColor }}>
                          {installStatus}
                        </div>
                        <div style={{
                          width: '100%',
                          height: '4px',
                          background: 'rgba(255,255,255,0.1)',
                          borderRadius: '2px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${installProgress}%`,
                            height: '100%',
                            background: '#2563eb',
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                      </div>
                    )}

                    <button
                      onClick={handleAutoInstallLlm}
                      disabled={installing || !llmStatus?.ollamaInstalled}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: '#2563eb',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        borderRadius: '4px',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: '600',
                        cursor: (installing || !llmStatus?.ollamaInstalled) ? 'not-allowed' : 'pointer',
                        opacity: (installing || !llmStatus?.ollamaInstalled) ? 0.5 : 1,
                        transition: 'all 0.2s',
                      }}
                    >
                      {installing ? 'Installing...' : '⚡ Auto-Install Mistral 7B'}
                    </button>
                  </div>
                )}

                {/* Ready State */}
                {llmStatus?.isReady && (
                  <div style={{
                    padding: '10px',
                    background: 'rgba(34,197,94,0.1)',
                    border: '1px solid rgba(34,197,94,0.3)',
                    borderRadius: '6px',
                    fontSize: '11px',
                    color: textColor,
                  }}>
                    <div style={{ marginBottom: '6px', fontWeight: '600', fontSize: '10px' }}>
                      ✓ LOCAL LLM READY
                    </div>
                    <div style={{ fontSize: '10px', opacity: 0.9, marginBottom: '8px' }}>
                      Mistral 7B is available for AI features
                    </div>
                    <button
                      onClick={loadLlmStatus}
                      style={{
                        padding: '6px 10px',
                        background: 'rgba(34,197,94,0.2)',
                        border: '1px solid rgba(34,197,94,0.4)',
                        borderRadius: '4px',
                        color: textColor,
                        fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      Refresh Status
                    </button>
                  </div>
                )}
              </div>
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















