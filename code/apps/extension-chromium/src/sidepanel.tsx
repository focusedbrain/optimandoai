/// <reference types="chrome-types"/>
import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

interface ConnectionStatus {
  isConnected: boolean
  readyState?: number
}

function SidepanelOrchestrator() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({ isConnected: false })
  const [isLoading, setIsLoading] = useState(true)
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
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    const timeout = setTimeout(() => {
      if (isLoading) {
        setIsLoading(false)
      }
    }, 3000)

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
      clearTimeout(timeout)
    }
  }, [])

  const getStatusColor = () => {
    if (isLoading) return '#FFA500'
    return connectionStatus.isConnected ? '#00FF00' : '#FF0000'
  }

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      fontFamily: 'Arial, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '20px',
      boxSizing: 'border-box'
    }}>
      <h1 style={{ 
        margin: '0 0 30px 0', 
        textAlign: 'center', 
        fontSize: '24px',
        fontWeight: 'bold',
        textShadow: '2px 2px 4px rgba(0,0,0,0.3)'
      }}>
        🦒 OpenGiraffe Orchestrator
      </h1>

      {/* Tab Status */}
      <div style={{ marginBottom: '25px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold' }}>Tab Status</h3>
        <div style={{
          height: '8px',
          backgroundColor: 'rgba(255,255,255,0.3)',
          borderRadius: '4px',
          marginBottom: '15px'
        }}></div>
        <div style={{
          height: '40px',
          backgroundColor: 'rgba(255,255,255,0.2)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.3)'
        }}></div>
      </div>

      {/* Input Stream */}
      <div style={{ marginBottom: '25px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold' }}>Input Stream</h3>
        <div style={{ fontSize: '16px', lineHeight: '2' }}>
          <div style={{ padding: '8px 0' }}>• selection.changed</div>
          <div style={{ padding: '8px 0' }}>• dom.changed</div>
          <div style={{ padding: '8px 0' }}>• form.submit</div>
        </div>
      </div>

      {/* Cost */}
      <div style={{ marginBottom: '25px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold' }}>Cost</h3>
        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FFD700' }}>$0.02/0.05</div>
      </div>

      {/* Mode Selection */}
      <div style={{ marginBottom: '25px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold' }}>Mode</h3>
        <div style={{ fontSize: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="mode"
              value="perTab"
              checked={mode === 'perTab'}
              onChange={(e) => setMode(e.target.value)}
              style={{ marginRight: '12px', transform: 'scale(1.3)' }}
            />
            Per-Tab
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="mode"
              value="master"
              checked={mode === 'master'}
              onChange={(e) => setMode(e.target.value)}
              style={{ marginRight: '12px', transform: 'scale(1.3)' }}
            />
            Master
          </label>
        </div>
      </div>

      {/* Agents */}
      <div style={{ marginBottom: '25px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold' }}>Agents</h3>
        <div style={{ fontSize: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={agents.summarize}
              onChange={(e) => setAgents({...agents, summarize: e.target.checked})}
              style={{ marginRight: '12px', transform: 'scale(1.3)' }}
            />
            Summarize
          </label>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={agents.refactor}
              onChange={(e) => setAgents({...agents, refactor: e.target.checked})}
              style={{ marginRight: '12px', transform: 'scale(1.3)' }}
            />
            Refactor
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={agents.entityExtract}
              onChange={(e) => setAgents({...agents, entityExtract: e.target.checked})}
              style={{ marginRight: '12px', transform: 'scale(1.3)' }}
            />
            Entity Extract
          </label>
        </div>
      </div>

      {/* Connection Status */}
      <div style={{ 
        marginTop: 'auto', 
        padding: '20px', 
        backgroundColor: 'rgba(0,0,0,0.2)', 
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: getStatusColor()
          }}></div>
          <span style={{ fontSize: '16px' }}>
            WebSocket: {isLoading ? 'Lädt...' : connectionStatus.isConnected ? 'Verbunden' : 'Nicht verbunden'}
          </span>
        </div>
      </div>

      {/* Settings Button */}
      <div style={{ marginTop: '20px' }}>
        <button style={{
          width: '100%',
          padding: '15px',
          backgroundColor: 'rgba(255,255,255,0.2)',
          color: 'white',
          border: '2px solid rgba(255,255,255,0.3)',
          borderRadius: '10px',
          cursor: 'pointer',
          fontSize: '16px',
          fontWeight: 'bold',
          transition: 'all 0.3s ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.3)'
          e.currentTarget.style.transform = 'translateY(-2px)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)'
          e.currentTarget.style.transform = 'translateY(0)'
        }}>
          ⚙️ Settings
        </button>
      </div>
    </div>
  )
}

// Render the sidepanel
const container = document.getElementById('sidepanel-root')
if (container) {
  const root = createRoot(container)
  root.render(<SidepanelOrchestrator />)
}
