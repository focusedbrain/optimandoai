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
  const [downloadDetails, setDownloadDetails] = useState<{
    completed?: number
    total?: number
    speed?: number
  }>({});
  const [installedModels, setInstalledModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  // Available opensource models
  const availableModels = [
    { id: 'tinyllama', name: 'TinyLlama (Ultra Fast)', ram: '1GB', size: '0.6GB', desc: 'Best for very old hardware' },
    { id: 'phi3:mini', name: 'Phi-3 Mini (Very Fast)', ram: '2-3GB', size: '2.3GB', desc: 'Recommended for low-end PCs' },
    { id: 'mistral:7b-instruct-q4_0', name: 'Mistral 7B Q4 (Fast)', ram: '4GB', size: '2.6GB', desc: 'Default - Good balance' },
    { id: 'mistral:7b-instruct-q5_K_M', name: 'Mistral 7B Q5 (Balanced)', ram: '5GB', size: '3.2GB', desc: 'Better quality' },
    { id: 'mistral:7b', name: 'Mistral 7B (Best Quality)', ram: '8GB', size: '4.1GB', desc: 'High-end hardware only' },
    { id: 'llama3:8b', name: 'Llama 3 8B', ram: '8GB', size: '4.7GB', desc: 'Alternative to Mistral' },
  ];

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
      const [statusRes, hardwareRes, modelsRes] = await Promise.all([
        fetch('http://127.0.0.1:51248/api/llm/status'),
        fetch('http://127.0.0.1:51248/api/llm/hardware'),
        fetch('http://127.0.0.1:51248/api/llm/models')
      ]);
      
      if (statusRes.ok) {
        const status = await statusRes.json();
        setLlmStatus(status);
      }
      
      if (hardwareRes.ok) {
        const hw = await hardwareRes.json();
        setHardware(hw);
      }
      
      if (modelsRes.ok) {
        const models = await modelsRes.json();
        if (models.ok && models.data) {
          setInstalledModels(models.data);
        }
      }
    } catch (error) {
      console.error('Failed to load LLM status:', error);
    }
  };
  
  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`Delete model "${modelName}"? This will free up disk space but you'll need to download it again if you want to use it.`)) {
      return;
    }
    
    setDeleting(modelName);
    try {
      const response = await fetch('http://127.0.0.1:51248/api/llm/model', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName })
      });
      
      const result = await response.json();
      if (result.ok) {
        setNotification({ message: `Model deleted successfully`, type: 'success' });
        await loadLlmStatus();  // Refresh
      } else {
        setNotification({ message: result.error || 'Deletion failed', type: 'error' });
      }
    } catch (error: any) {
      setNotification({ message: 'Failed to delete model', type: 'error' });
    } finally {
      setDeleting(null);
      setTimeout(() => setNotification(null), 3000);
    }
  };
  
  const handleInstallModel = async (modelId: string) => {
    setInstalling(true);
    setInstallProgress(0);
    setInstallStatus(`Installing ${modelId}...`);
    setDownloadDetails({});

    try {
      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch('http://127.0.0.1:51248/api/llm/status');
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (status.downloadProgress) {
              setInstallProgress(status.downloadProgress.progress || 0);
              setInstallStatus(status.downloadProgress.status || 'Downloading...');
              
              if (status.downloadProgress.completed && status.downloadProgress.total) {
                setDownloadDetails({
                  completed: status.downloadProgress.completed,
                  total: status.downloadProgress.total
                });
              }
            }
          }
        } catch (e) {
          console.error('Poll error:', e);
        }
      }, 500);

      // Start installation
      const response = await fetch('http://127.0.0.1:51248/api/llm/download-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName: modelId })
      });

      clearInterval(pollInterval);

      if (response.ok) {
        setInstallProgress(100);
        setInstallStatus('Installation complete!');
        setNotification({ message: 'Model installed successfully!', type: 'success' });
        setTimeout(() => {
          setInstalling(false);
          loadLlmStatus();
        }, 2000);
      } else {
        throw new Error('Installation failed');
      }
    } catch (error: any) {
      setInstallStatus('Installation failed');
      setNotification({ message: error.message || 'Installation failed', type: 'error' });
      setTimeout(() => setInstalling(false), 2000);
    } finally {
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleAutoInstallLlm = async () => {
    // Default to recommended model if none selected
    const modelToInstall = selectedModel || hardware?.recommendedModel || 'mistral:7b-instruct-q4_0';
    await handleInstallModel(modelToInstall);
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
                      <div style={{ 
                        marginBottom: '10px',
                        padding: '10px',
                        background: 'rgba(59,130,246,0.1)',
                        border: '1px solid rgba(59,130,246,0.3)',
                        borderRadius: '6px'
                      }}>
                        {/* Status Message */}
                        <div style={{ 
                          fontSize: '11px', 
                          marginBottom: '8px', 
                          fontWeight: '600',
                          color: textColor,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <span style={{ 
                            animation: 'pulse 2s ease-in-out infinite',
                            display: 'inline-block'
                          }}>📥</span>
                          {installStatus}
                        </div>
                        
                        {/* Progress Bar */}
                        <div style={{
                          width: '100%',
                          height: '8px',
                          background: 'rgba(255,255,255,0.1)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          marginBottom: '8px'
                        }}>
                          <div style={{
                            width: `${installProgress}%`,
                            height: '100%',
                            background: installProgress < 100 ? 'linear-gradient(90deg, #2563eb, #3b82f6, #2563eb)' : '#059669',
                            backgroundSize: '200% 100%',
                            animation: installProgress < 100 ? 'gradient 2s ease infinite' : 'none',
                            transition: 'width 0.5s ease'
                          }} />
                        </div>
                        
                        {/* Progress Percentage */}
                        <div style={{ 
                          fontSize: '18px', 
                          fontWeight: 'bold',
                          color: installProgress < 100 ? '#3b82f6' : '#059669',
                          textAlign: 'center',
                          marginBottom: '8px'
                        }}>
                          {Math.round(installProgress)}%
                        </div>

                        {/* Download Details */}
                        {downloadDetails.completed && downloadDetails.total && (
                          <div style={{
                            fontSize: '10px',
                            opacity: 0.8,
                            textAlign: 'center',
                            color: textColor
                          }}>
                            {(downloadDetails.completed / (1024**3)).toFixed(2)} GB / {(downloadDetails.total / (1024**3)).toFixed(2)} GB
                          </div>
                        )}

                        {/* Activity Indicator */}
                        <div style={{
                          fontSize: '10px',
                          textAlign: 'center',
                          opacity: 0.6,
                          marginTop: '6px',
                          fontStyle: 'italic',
                          color: textColor
                        }}>
                          {installProgress > 0 && installProgress < 100 ? '⚡ Download in progress...' : ''}
                        </div>
                      </div>
                    )}

                    <style>{`
                      @keyframes pulse {
                        0%, 100% { transform: scale(1); opacity: 1; }
                        50% { transform: scale(1.2); opacity: 0.7; }
                      }
                      @keyframes gradient {
                        0% { background-position: 0% 50%; }
                        50% { background-position: 100% 50%; }
                        100% { background-position: 0% 50%; }
                      }
                    `}</style>

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















