/// <reference types="chrome-types"/>
import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

interface ConnectionStatus {
  isConnected: boolean
  readyState?: number
}

function Popup() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ isConnected: false })
  const [isLoading, setIsLoading] = useState(true)
  const [logs, setLogs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState('helper')
  const [bottomTab, setBottomTab] = useState('logs')
  const [mode, setMode] = useState('master')
  const [agents, setAgents] = useState({
    summarize: true,
    refactor: true,
    entityExtract: false
  })

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' })

    const handleMessage = (message: any) => {
      if (message.type === 'STATUS_UPDATE') {
        setConnectionStatus(message.data)
        setIsLoading(false)
        setLogs(prev => [...prev, `📊 Status: ${message.data.isConnected ? 'Verbunden' : 'Nicht verbunden'}`])
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    const timeout = setTimeout(() => {
      if (isLoading) {
        setIsLoading(false)
        setLogs(prev => [...prev, '⏳ Warte auf Status-Update...'])
      }
    }, 3000)

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
      clearTimeout(timeout)
    }
  }, [])

  const testConnection = () => {
    setLogs(prev => [...prev, '🧪 Teste Verbindung...'])
    chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' })
  }

  const disconnect = () => {
    setLogs(prev => [...prev, '🔌 Trenne Verbindung...'])
    chrome.runtime.sendMessage({ type: 'DISCONNECT' })
  }

  const clearLogs = () => {
    setLogs([])
  }

  const getStatusText = () => {
    if (isLoading) return 'Lädt...'
    return connectionStatus.isConnected ? 'Verbunden' : 'Nicht verbunden'
  }

  const getStatusColor = () => {
    if (isLoading) return '#FFA500'
    return connectionStatus.isConnected ? '#00FF00' : '#FF0000'
  }

  return (
    <div style={{ 
      width: '800px', 
      height: '600px',
      fontFamily: 'Arial, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      borderRadius: '8px',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Top Header - Browser Frame */}
      <div style={{
        height: '40px',
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 15px',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FF5F56' }}></div>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#FFBD2E' }}></div>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#27CA3F' }}></div>
        </div>
        <div style={{
          flex: 1,
          margin: '0 20px',
          height: '24px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 15px',
          color: 'rgba(255,255,255,0.7)',
          fontSize: '12px'
        }}>
          ---/---/---
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ width: '20px', height: '20px', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '4px' }}>←</div>
          <div style={{ width: '20px', height: '20px', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: '4px' }}>→</div>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', padding: '15px', gap: '15px' }}>
        
        {/* Left Sidebar */}
        <div style={{
          width: '180px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          {/* Tab Status */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Tab Status</h4>
            <div style={{
              height: '4px',
              backgroundColor: 'rgba(255,255,255,0.3)',
              borderRadius: '2px',
              marginBottom: '10px'
            }}></div>
            <div style={{
              height: '20px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.1)'
            }}></div>
          </div>

          {/* Input Stream */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Input Stream</h4>
            <div style={{ fontSize: '12px', lineHeight: '1.6' }}>
              <div>• selection.changed</div>
              <div>• dom.changed</div>
              <div>• form.submit</div>
            </div>
          </div>

          {/* Cost */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Cost</h4>
            <div style={{ fontSize: '16px', fontWeight: 'bold' }}>$0.02/0.05</div>
          </div>

          {/* Audit Log */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Audit Log</h4>
            <div style={{ fontSize: '12px' }}>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}></div>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}></div>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)' }}></div>
            </div>
          </div>
        </div>

        {/* Center Content Area */}
        <div style={{
          flex: 1,
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* Top Tabs */}
          <div style={{ display: 'flex', marginBottom: '20px' }}>
            <button
              onClick={() => setActiveTab('helper')}
              style={{
                padding: '10px 20px',
                backgroundColor: activeTab === 'helper' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                marginRight: '5px'
              }}
            >
              Helper Tab
            </button>
            <button
              onClick={() => setActiveTab('master')}
              style={{
                padding: '10px 20px',
                backgroundColor: activeTab === 'master' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer'
              }}
            >
              Master
            </button>
          </div>

          {/* Content Display Area */}
          <div style={{
            flex: 1,
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '8px',
            marginBottom: '20px',
            border: '1px solid rgba(255,255,255,0.1)'
          }}></div>

          {/* Bottom Tabs */}
          <div style={{ display: 'flex' }}>
            <button
              onClick={() => setBottomTab('logs')}
              style={{
                padding: '8px 16px',
                backgroundColor: bottomTab === 'logs' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                marginRight: '5px',
                fontSize: '12px'
              }}
            >
              Logs
            </button>
            <button
              onClick={() => setBottomTab('liveStream')}
              style={{
                padding: '8px 16px',
                backgroundColor: bottomTab === 'liveStream' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                marginRight: '5px',
                fontSize: '12px'
              }}
            >
              Live Stream
            </button>
            <button
              onClick={() => setBottomTab('metrics')}
              style={{
                padding: '8px 16px',
                backgroundColor: bottomTab === 'metrics' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                color: 'white',
                border: 'none',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Metrics
            </button>
          </div>

          {/* Log/Stream/Metrics Display */}
          <div style={{
            height: '80px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: '0 0 8px 8px',
            padding: '10px',
            border: '1px solid rgba(255,255,255,0.1)',
            borderTop: 'none'
          }}>
            <div style={{ fontSize: '12px' }}>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}></div>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)', marginBottom: '8px' }}></div>
              <div style={{ height: '2px', backgroundColor: 'rgba(255,255,255,0.3)' }}></div>
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div style={{
          width: '180px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          {/* WRScan */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <button style={{
                padding: '6px 12px',
                backgroundColor: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}>
                WRScan
              </button>
              <div style={{
                width: '40px',
                height: '20px',
                backgroundColor: 'rgba(255,255,255,0.1)',
                borderRadius: '4px'
              }}></div>
            </div>
          </div>

          {/* QR Code */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '80px',
              height: '80px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              margin: '0 auto 10px auto',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '8px',
              color: 'rgba(255,255,255,0.6)'
            }}>
              QR Code
            </div>
            <div style={{ fontSize: '12px', fontWeight: 'bold' }}>Master</div>
          </div>

          {/* Mode Selection */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Mode</h4>
            <div style={{ fontSize: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                <input
                  type="radio"
                  name="mode"
                  value="perTab"
                  checked={mode === 'perTab'}
                  onChange={(e) => setMode(e.target.value)}
                  style={{ marginRight: '8px' }}
                />
                Per-Tab
              </label>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="mode"
                  value="master"
                  checked={mode === 'master'}
                  onChange={(e) => setMode(e.target.value)}
                  style={{ marginRight: '8px' }}
                />
                Master
              </label>
            </div>
          </div>

          {/* Agents */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Agents</h4>
            <div style={{ fontSize: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                <input
                  type="checkbox"
                  checked={agents.summarize}
                  onChange={(e) => setAgents({...agents, summarize: e.target.checked})}
                  style={{ marginRight: '8px' }}
                />
                Summarize
              </label>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                <input
                  type="checkbox"
                  checked={agents.refactor}
                  onChange={(e) => setAgents({...agents, refactor: e.target.checked})}
                  style={{ marginRight: '8px' }}
                />
                Refactor
              </label>
              <label style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={agents.entityExtract}
                  onChange={(e) => setAgents({...agents, entityExtract: e.target.checked})}
                  style={{ marginRight: '8px' }}
                />
                Entity Extract
              </label>
            </div>
          </div>

          {/* Settings */}
          <div style={{ marginTop: 'auto' }}>
            <button style={{
              width: '100%',
              padding: '8px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}>
              Settings
            </button>
          </div>
        </div>
      </div>

      {/* Connection Status Bar */}
      <div style={{
        height: '30px',
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderTop: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 15px',
        fontSize: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: getStatusColor()
          }}></div>
          <span>WebSocket: {getStatusText()}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
          <button
            onClick={testConnection}
            style={{
              padding: '4px 8px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '10px'
            }}
          >
            Connect
          </button>
          <button
            onClick={disconnect}
            style={{
              padding: '4px 8px',
              backgroundColor: 'rgba(255,0,0,0.2)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '10px'
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  )
}

const container = document.getElementById('app')
if (container) {
  const root = createRoot(container)
  root.render(<Popup />)
}
