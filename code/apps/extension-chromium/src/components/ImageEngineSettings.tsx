/**
 * Image Engine Settings Component
 * Manages cloud image generation APIs only
 * 
 * NOTE: Local image engines (ComfyUI, Automatic1111, etc.) are intentionally NOT supported
 * due to security concerns - they load untrusted dependencies at runtime.
 */

import React, { useState, useEffect } from 'react'
import {
  CloudImageProviderConfig,
  ImageProvidersConfig,
  DEFAULT_CLOUD_PROVIDERS
} from '../types/imageProviders'

interface ImageEngineSettingsProps {
  theme?: 'default' | 'dark' | 'professional'
}

export function ImageEngineSettings({ theme = 'default' }: ImageEngineSettingsProps) {
  const [config, setConfig] = useState<ImageProvidersConfig>({ cloud: [...DEFAULT_CLOUD_PROVIDERS] })
  const [loading, setLoading] = useState(true)
  const [testingApi, setTestingApi] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [expandedCloud, setExpandedCloud] = useState(true) // Expanded by default
  const [editingApiKey, setEditingApiKey] = useState<string | null>(null)

  const textColor = theme === 'default' || theme === 'dark' ? '#e5e5e5' : '#1f2937'
  const bgCard = 'rgba(255,255,255,0.05)'
  const borderColor = 'rgba(255,255,255,0.1)'

  // Load config on mount
  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const result = await chrome.storage.local.get(['imageProviders'])
      if (result.imageProviders?.cloud) {
        // Merge with defaults to ensure all providers exist
        const merged = mergeWithDefaults(result.imageProviders)
        setConfig(merged)
      }
    } catch (err) {
      console.error('[ImageEngineSettings] Failed to load config:', err)
    } finally {
      setLoading(false)
    }
  }

  const mergeWithDefaults = (saved: Partial<ImageProvidersConfig>): ImageProvidersConfig => {
    // Merge cloud providers
    const cloudProviders = DEFAULT_CLOUD_PROVIDERS.map(defaultProvider => {
      const savedProvider = saved.cloud?.find(p => p.id === defaultProvider.id)
      return savedProvider ? { ...defaultProvider, ...savedProvider } : defaultProvider
    })
    
    return {
      cloud: cloudProviders,
      defaultProviderId: saved.defaultProviderId,
      defaultModelId: saved.defaultModelId
    }
  }

  const saveConfig = async (newConfig: ImageProvidersConfig) => {
    setConfig(newConfig)
    try {
      await chrome.storage.local.set({ imageProviders: newConfig })
    } catch (err) {
      console.error('[ImageEngineSettings] Failed to save config:', err)
      showNotification('Failed to save configuration', 'error')
    }
  }

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 4000)
  }

  // Test cloud API
  const testCloudApi = async (provider: CloudImageProviderConfig) => {
    if (!provider.apiKey) {
      showNotification('Please enter an API key first', 'error')
      return
    }
    
    setTestingApi(provider.id)
    
    try {
      let testUrl = ''
      let headers: Record<string, string> = {}
      
      // Provider-specific API test endpoints
      switch (provider.id) {
        case 'replicate':
          testUrl = 'https://api.replicate.com/v1/models'
          headers = { 'Authorization': `Token ${provider.apiKey}` }
          break
        case 'openai-dalle':
          testUrl = 'https://api.openai.com/v1/models'
          headers = { 'Authorization': `Bearer ${provider.apiKey}` }
          break
        case 'stability':
          testUrl = 'https://api.stability.ai/v1/user/account'
          headers = { 'Authorization': `Bearer ${provider.apiKey}` }
          break
        case 'together':
          testUrl = 'https://api.together.xyz/v1/models'
          headers = { 'Authorization': `Bearer ${provider.apiKey}` }
          break
        case 'banana':
          // Banana uses a different auth mechanism
          testUrl = 'https://api.banana.dev/'
          headers = { 'Authorization': `Bearer ${provider.apiKey}` }
          break
        default:
          throw new Error('Unknown provider')
      }
      
      console.log(`[ImageEngineSettings] Testing ${provider.displayName} API`)
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)
      
      const response = await fetch(testUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok || response.status === 401) {
        // 401 means the endpoint exists but key is invalid
        if (response.status === 401) {
          throw new Error('Invalid API key')
        }
        
        const updatedCloud = config.cloud.map(p => 
          p.id === provider.id 
            ? { ...p, status: 'connected' as const, enabled: true, statusMessage: 'API key verified' }
            : p
        )
        await saveConfig({ ...config, cloud: updatedCloud })
        showNotification(`${provider.displayName} API connected successfully!`, 'success')
      } else {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch (err: any) {
      console.error(`[ImageEngineSettings] Failed to verify ${provider.displayName} API:`, err)
      
      const errorMessage = err.name === 'AbortError' 
        ? 'Request timeout' 
        : err.message || 'Verification failed'
      
      const updatedCloud = config.cloud.map(p => 
        p.id === provider.id 
          ? { ...p, status: 'error' as const, enabled: false, statusMessage: errorMessage }
          : p
      )
      await saveConfig({ ...config, cloud: updatedCloud })
      showNotification(`${provider.displayName} API error: ${errorMessage}`, 'error')
    } finally {
      setTestingApi(null)
    }
  }

  // Update cloud provider API key
  const updateApiKey = async (providerId: string, apiKey: string) => {
    const updatedCloud = config.cloud.map(p => 
      p.id === providerId 
        ? { ...p, apiKey, status: 'disconnected' as const }
        : p
    )
    await saveConfig({ ...config, cloud: updatedCloud })
    setEditingApiKey(null)
  }

  // Toggle provider enabled state
  const toggleProvider = async (providerId: string) => {
    const updatedCloud = config.cloud.map(p => 
      p.id === providerId ? { ...p, enabled: !p.enabled } : p
    )
    await saveConfig({ ...config, cloud: updatedCloud })
  }

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return '#22c55e'
      case 'checking': return '#f59e0b'
      case 'error': return '#ef4444'
      default: return '#6b7280'
    }
  }

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'connected': return '✓'
      case 'checking': return '⟳'
      case 'error': return '✗'
      default: return '○'
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: textColor, opacity: 0.7 }}>
        Loading image providers...
      </div>
    )
  }

  return (
    <div style={{ color: textColor }}>
      {/* Cloud Image APIs Section */}
      <div>
        <div 
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 0',
            cursor: 'pointer',
            borderBottom: `1px solid ${borderColor}`
          }}
          onClick={() => setExpandedCloud(!expandedCloud)}
        >
          <h4 style={{ margin: 0, fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
            ☁️ Cloud Image APIs
            <span style={{ fontSize: '10px', opacity: 0.6, fontWeight: '400' }}>
              (pay-per-use)
            </span>
          </h4>
          <span style={{ fontSize: '10px', opacity: 0.7, transform: expandedCloud ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            ▼
          </span>
        </div>

        {expandedCloud && (
          <div style={{ marginTop: '12px' }}>
            {/* Info banner */}
            <div style={{
              padding: '10px 12px',
              marginBottom: '12px',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '8px',
              fontSize: '10px',
              lineHeight: '1.5'
            }}>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                ✓ Secure Cloud APIs
              </div>
              <div style={{ opacity: 0.9 }}>
                These are official, audited API services from established providers.
                Your data is processed on their secure infrastructure.
              </div>
            </div>

            {/* Provider Cards */}
            {config.cloud.map(provider => (
              <div
                key={provider.id}
                style={{
                  background: bgCard,
                  border: `1px solid ${provider.status === 'connected' ? 'rgba(34, 197, 94, 0.3)' : borderColor}`,
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '8px'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '2px' }}>
                      {provider.displayName}
                    </div>
                    <div style={{ fontSize: '10px', opacity: 0.7, maxWidth: '280px' }}>
                      {provider.description}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Enable toggle */}
                    <button
                      onClick={() => toggleProvider(provider.id)}
                      style={{
                        padding: '3px 8px',
                        background: provider.enabled ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255,255,255,0.1)',
                        border: `1px solid ${provider.enabled ? 'rgba(34, 197, 94, 0.4)' : borderColor}`,
                        borderRadius: '12px',
                        fontSize: '9px',
                        color: provider.enabled ? '#22c55e' : textColor,
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      {provider.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    {/* Status badge */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      background: `${getStatusColor(provider.status)}20`,
                      borderRadius: '12px',
                      fontSize: '10px',
                      color: getStatusColor(provider.status),
                      fontWeight: '500'
                    }}>
                      {getStatusIcon(provider.status)} {provider.status}
                    </div>
                  </div>
                </div>

                {/* API Key */}
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'block', fontSize: '10px', opacity: 0.7, marginBottom: '4px' }}>
                    API Key
                  </label>
                  {editingApiKey === provider.id ? (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <input
                        type="password"
                        defaultValue={provider.apiKey || ''}
                        placeholder="Enter your API key"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updateApiKey(provider.id, (e.target as HTMLInputElement).value)
                          } else if (e.key === 'Escape') {
                            setEditingApiKey(null)
                          }
                        }}
                        autoFocus
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '4px',
                          color: textColor,
                          fontSize: '11px'
                        }}
                      />
                      <button
                        onClick={() => {
                          const input = document.querySelector(`input[type="password"]`) as HTMLInputElement
                          if (input) updateApiKey(provider.id, input.value)
                        }}
                        style={{
                          padding: '4px 8px',
                          background: 'rgba(34, 197, 94, 0.2)',
                          border: '1px solid rgba(34, 197, 94, 0.4)',
                          borderRadius: '4px',
                          color: '#22c55e',
                          fontSize: '10px',
                          cursor: 'pointer'
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingApiKey(null)}
                        style={{
                          padding: '4px 8px',
                          background: 'rgba(255,255,255,0.1)',
                          border: 'none',
                          borderRadius: '4px',
                          color: textColor,
                          fontSize: '10px',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px',
                        padding: '6px 8px',
                        background: 'rgba(0,0,0,0.2)',
                        borderRadius: '4px',
                        fontSize: '11px'
                      }}
                    >
                      <span style={{ flex: 1, fontFamily: 'monospace' }}>
                        {provider.apiKey ? '••••••••••••' + provider.apiKey.slice(-4) : 'Not configured'}
                      </span>
                      <button
                        onClick={() => setEditingApiKey(provider.id)}
                        style={{
                          padding: '2px 6px',
                          background: 'rgba(255,255,255,0.1)',
                          border: 'none',
                          borderRadius: '3px',
                          color: textColor,
                          fontSize: '9px',
                          cursor: 'pointer'
                        }}
                      >
                        {provider.apiKey ? 'Change' : 'Add Key'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Available Models */}
                {provider.models.length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '10px', opacity: 0.7, marginBottom: '4px' }}>
                      Available Models
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {provider.models.map(model => (
                        <span
                          key={model.id}
                          style={{
                            padding: '3px 8px',
                            background: 'rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            fontSize: '10px'
                          }}
                        >
                          {model.displayName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => testCloudApi(provider)}
                    disabled={testingApi === provider.id || !provider.apiKey}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: provider.status === 'connected' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                      border: `1px solid ${provider.status === 'connected' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(59, 130, 246, 0.4)'}`,
                      borderRadius: '4px',
                      color: textColor,
                      fontSize: '11px',
                      fontWeight: '500',
                      cursor: (testingApi === provider.id || !provider.apiKey) ? 'not-allowed' : 'pointer',
                      opacity: (testingApi === provider.id || !provider.apiKey) ? 0.5 : 1
                    }}
                  >
                    {testingApi === provider.id ? 'Verifying...' : (provider.status === 'connected' ? '✓ Verified' : 'Verify API Key')}
                  </button>
                  <a
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(255,255,255,0.1)',
                      border: `1px solid ${borderColor}`,
                      borderRadius: '4px',
                      color: textColor,
                      fontSize: '11px',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Docs
                  </a>
                  {provider.pricingUrl && (
                    <a
                      href={provider.pricingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.1)',
                        border: `1px solid ${borderColor}`,
                        borderRadius: '4px',
                        color: textColor,
                        fontSize: '11px',
                        textDecoration: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      Pricing
                    </a>
                  )}
                </div>

                {/* Status message */}
                {provider.statusMessage && provider.status === 'error' && (
                  <div style={{
                    marginTop: '8px',
                    padding: '6px 8px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '4px',
                    fontSize: '10px',
                    color: '#ef4444'
                  }}>
                    {provider.statusMessage}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notification */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 16px',
          background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)',
          border: `1px solid ${notification.type === 'success' ? '#22c55e' : '#ef4444'}`,
          borderRadius: '6px',
          color: '#fff',
          fontSize: '12px',
          fontWeight: '500',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          {notification.message}
        </div>
      )}
    </div>
  )
}
