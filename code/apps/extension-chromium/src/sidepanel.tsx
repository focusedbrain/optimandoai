/// <reference types="chrome-types"/>
import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

interface ConnectionStatus {
  isConnected: boolean
  readyState?: number
}

interface AgentBox {
  id: string
  title: string
  output: string
  color: string
  isMinimized: boolean
  timestamp?: string
}

function SidepanelOrchestrator() {
  // Original state
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

  // Additional state for new features
  const [sessionName, setSessionName] = useState('New Session')
  const [isLocked, setIsLocked] = useState(false)
  const [agentBoxes, setAgentBoxes] = useState<AgentBox[]>([])
  const [isWRLoginCollapsed, setIsWRLoginCollapsed] = useState(false)
  const [isCommandChatPinned, setIsCommandChatPinned] = useState(false)
  
  // Command chat state
  const [chatMessages, setChatMessages] = useState<Array<{role: 'user' | 'assistant', text: string}>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatHeight, setChatHeight] = useState(200)
  const [isResizingChat, setIsResizingChat] = useState(false)
  const [triggers, setTriggers] = useState<any[]>([])
  const [showTagsMenu, setShowTagsMenu] = useState(false)
  const [showEmbedDialog, setShowEmbedDialog] = useState(false)
  const [pendingItems, setPendingItems] = useState<any[]>([])
  const [embedTarget, setEmbedTarget] = useState<'session' | 'account'>('session')
  const chatRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Load pinned state from localStorage
  useEffect(() => {
    chrome.storage.local.get(['commandChatPinned'], (result) => {
      if (result.commandChatPinned !== undefined) {
        setIsCommandChatPinned(result.commandChatPinned)
      }
    })
  }, [])
  
  // Save pinned state and toggle docked chat
  const toggleCommandChatPin = () => {
    const newState = !isCommandChatPinned
    setIsCommandChatPinned(newState)
    chrome.storage.local.set({ commandChatPinned: newState })
  }

  // Original useEffect for connection status
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' })

    const handleMessage = (message: any) => {
      if (message.type === 'STATUS_UPDATE') {
        setConnectionStatus(message.data)
        setIsLoading(false)
      }
      // Also handle agent box updates
      if (message.type === 'UPDATE_AGENT_BOXES') {
        setAgentBoxes(message.data)
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

  // Load additional data (agent boxes, session)
  useEffect(() => {
    chrome.storage.local.get(['agentBoxes', 'sessionName', 'isLocked'], (result) => {
      if (result.agentBoxes) setAgentBoxes(result.agentBoxes)
      if (result.sessionName) setSessionName(result.sessionName)
      if (result.isLocked) setIsLocked(result.isLocked)
    })
  }, [])

  // Chat resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingChat) return
      const newHeight = Math.max(150, Math.min(600, e.clientY - (chatRef.current?.getBoundingClientRect().top || 0)))
      setChatHeight(newHeight)
    }

    const handleMouseUp = () => {
      if (isResizingChat) {
        setIsResizingChat(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    if (isResizingChat) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingChat])

  const getStatusColor = () => {
    if (isLoading) return '#FFA500'
    return connectionStatus.isConnected ? '#00FF00' : '#FF0000'
  }

  // Helper functions for new features
  const sendToContentScript = (action: string) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: action })
      }
    })
  }

  const openSettings = () => {
    sendToContentScript('OPEN_SETTINGS_LIGHTBOX')
  }

  const openMemory = () => {
    sendToContentScript('OPEN_MEMORY_LIGHTBOX')
  }

  const openContext = () => {
    sendToContentScript('OPEN_CONTEXT_LIGHTBOX')
  }

  const openAgentsLightbox = () => {
    sendToContentScript('OPEN_AGENTS_LIGHTBOX')
  }

  const openPopupChat = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_COMMAND_CENTER_POPUP', theme: 'default' })
  }


  const addAgentBox = () => {
    // Call the REAL openAddAgentBoxDialog function from content script
    // This will show the full dialog with:
    // - Box number calculation from session
    // - Color picker with 10 colors
    // - Agent number input
    // - Title input with validation
    sendToContentScript('ADD_AGENT_BOX')
  }

  const removeAgentBox = (id: string) => {
    const updated = agentBoxes.filter(box => box.id !== id)
    setAgentBoxes(updated)
    chrome.storage.local.set({ agentBoxes: updated })
  }

  const toggleMinimize = (id: string) => {
    const updated = agentBoxes.map(box => 
      box.id === id ? { ...box, isMinimized: !box.isMinimized } : box
    )
    setAgentBoxes(updated)
    chrome.storage.local.set({ agentBoxes: updated })
  }

  // Load triggers
  useEffect(() => {
    if (!isCommandChatPinned) return
    
    const loadTriggers = () => {
      chrome.storage?.local?.get(['optimando-tagged-triggers'], (data: any) => {
        const list = Array.isArray(data?.['optimando-tagged-triggers']) ? data['optimando-tagged-triggers'] : []
        setTriggers(list)
      })
    }
    
    loadTriggers()
    window.addEventListener('optimando-triggers-updated', loadTriggers)
    return () => window.removeEventListener('optimando-triggers-updated', loadTriggers)
  }, [isCommandChatPinned])

  // Chat resize handling
  useEffect(() => {
    if (!isResizingChat) return
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!chatRef.current) return
      const newHeight = e.clientY - chatRef.current.getBoundingClientRect().top
      setChatHeight(Math.max(120, Math.min(500, newHeight)))
    }
    
    const handleMouseUp = () => setIsResizingChat(false)
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingChat])

  // Command chat functions
  const parseDataTransfer = async (dt: DataTransfer): Promise<any[]> => {
    const out: any[] = []
    try {
      for (const f of Array.from(dt.files || [])) {
        const t = (f.type || '').toLowerCase()
        const kind = t.startsWith('image/') ? 'image' : t.startsWith('audio/') ? 'audio' : t.startsWith('video/') ? 'video' : 'file'
        out.push({ kind, payload: f, mime: f.type, name: f.name })
      }
      const url = dt.getData('text/uri-list') || dt.getData('text/url')
      if (url) out.push({ kind: 'url', payload: url })
      const txt = dt.getData('text/plain')
      if (txt && !url) out.push({ kind: 'text', payload: txt })
    } catch {}
    return out
  }

  const handleChatDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const items = await parseDataTransfer(e.dataTransfer)
    if (!items.length) return
    setPendingItems(items)
    setShowEmbedDialog(true)
  }

  const runEmbed = (items: any[], target: 'session' | 'account') => {
    setTimeout(() => {
      try {
        const key = target === 'session' ? 'optimando-context-bucket-session' : 'optimando-context-bucket-account'
        const prev = JSON.parse(localStorage.getItem(key) || '[]')
        const serialized = items.map(it => ({
          kind: it.kind,
          name: it.name || undefined,
          mime: it.mime || undefined,
          size: it.payload?.size || undefined,
          text: typeof it.payload === 'string' ? it.payload : undefined
        }))
        prev.push({ at: Date.now(), items: serialized })
        localStorage.setItem(key, JSON.stringify(prev))
      } catch {}
    }, 100)
  }

  const handleBucketClick = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const dt = new DataTransfer()
    Array.from(e.target.files || []).forEach(f => dt.items.add(f))
    const items = await parseDataTransfer(dt)
    if (items.length) {
      setPendingItems(items)
      setShowEmbedDialog(true)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleEmbedConfirm = () => {
    runEmbed(pendingItems, embedTarget)
    setShowEmbedDialog(false)
    setPendingItems([])
  }

  const handleScreenSelect = () => {
    chrome.runtime?.sendMessage({ type: 'ELECTRON_START_SELECTION', source: 'docked-chat' })
  }

  const handleSendMessage = () => {
    const text = chatInput.trim()
    if (!text) return
    
    setChatMessages([...chatMessages, 
      { role: 'user', text },
      { role: 'assistant', text: `Acknowledged: ${text}` }
    ])
    setChatInput('')
    
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    }, 0)
  }

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleTriggerClick = (trigger: any) => {
    setShowTagsMenu(false)
    chrome.runtime?.sendMessage({ type: 'ELECTRON_EXECUTE_TRIGGER', trigger })
  }

  const handleDeleteTrigger = (index: number) => {
    if (!confirm(`Delete trigger "${triggers[index].name || `Trigger ${index + 1}`}"?`)) return
    
    const key = 'optimando-tagged-triggers'
    chrome.storage?.local?.get([key], (data: any) => {
      const list = Array.isArray(data?.[key]) ? data[key] : []
      list.splice(index, 1)
      chrome.storage?.local?.set({ [key]: list }, () => {
        setTriggers(list)
        chrome.runtime?.sendMessage({ type: 'TRIGGERS_UPDATED' })
        window.dispatchEvent(new CustomEvent('optimando-triggers-updated'))
      })
    })
  }

  const saveSession = () => {
    chrome.storage.local.set({ sessionName, isLocked, agentBoxes })
  }

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      fontFamily: 'Arial, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '0',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* NEW: Session Controls at the very top */}
      <div style={{ 
        padding: '10px 15px',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <input
          type="text"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          disabled={isLocked}
          placeholder="Session Name"
          style={{
            flex: 1,
            padding: '6px 10px',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'white',
            borderRadius: '4px',
            fontSize: '13px',
            opacity: isLocked ? 0.6 : 1
          }}
        />
        <button
          onClick={() => {
            setIsLocked(!isLocked)
            saveSession()
          }}
          style={{
            width: '32px',
            height: '32px',
            background: isLocked ? 'rgba(255,215,0,0.3)' : 'rgba(255,255,255,0.1)',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
          title={isLocked ? 'Unlock' : 'Lock'}
        >
          {isLocked ? '🔒' : '🔓'}
        </button>
        <button
          onClick={() => {
            setSessionName('New Session')
            setIsLocked(false)
            setAgentBoxes([])
            setMessages([])
            saveSession()
          }}
          style={{
            width: '32px',
            height: '32px',
            background: 'rgba(76,175,80,0.8)',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '18px',
            fontWeight: 'bold'
          }}
          title="New Session"
        >
          +
        </button>
      </div>

      {/* Administration Section */}
      <div style={{
        padding: '10px 15px',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            ADMIN
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={openAgentsLightbox} title="Agents" style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🤖</button>
            <button onClick={openContext} title="Context" style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📄</button>
            <button onClick={openMemory} title="Memory" style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💽</button>
            <button onClick={openSettings} title="Settings" style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>⚙️</button>
            <button onClick={openPopupChat} title="Open Popup Chat" style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>💬</button>
            <button onClick={toggleCommandChatPin} title={isCommandChatPinned ? "Unpin Command Chat" : "Pin Command Chat"} style={{ width: '36px', height: '36px', background: isCommandChatPinned ? 'rgba(76,175,80,0.3)' : 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📌</button>
          </div>
        </div>
      </div>

      {/* WR Login Section */}
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(0,0,0,0.05)'
      }}>
        <div 
          onClick={() => setIsWRLoginCollapsed(!isWRLoginCollapsed)}
          style={{
            padding: '12px 15px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: '700', opacity: 0.9, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '16px' }}>🔐</span> WR Code
          </div>
          <div style={{ 
            fontSize: '14px', 
            opacity: 0.7,
            transition: 'transform 0.2s ease',
            transform: isWRLoginCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
          }}>
            ▼
          </div>
        </div>
        {!isWRLoginCollapsed && (
          <div style={{
            padding: '12px 15px 20px 15px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px'
          }}>
            <div style={{
              width: '140px',
              height: '140px',
              background: 'white',
              borderRadius: '8px',
              padding: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <div style={{
                width: '100%',
                height: '100%',
                background: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Crect fill=\'%23000\' x=\'0\' y=\'0\' width=\'20\' height=\'20\'/%3E%3Crect fill=\'%23000\' x=\'0\' y=\'80\' width=\'20\' height=\'20\'/%3E%3Crect fill=\'%23000\' x=\'80\' y=\'0\' width=\'20\' height=\'20\'/%3E%3Crect fill=\'%23000\' x=\'10\' y=\'10\' width=\'5\' height=\'5\'/%3E%3Crect fill=\'%23000\' x=\'10\' y=\'85\' width=\'5\' height=\'5\'/%3E%3Crect fill=\'%23000\' x=\'85\' y=\'10\' width=\'5\' height=\'5\'/%3E%3Cpath fill=\'%23000\' d=\'M30,30 h5 v5 h-5 v-5 M40,30 h5 v5 h-5 v-5 M50,30 h5 v5 h-5 v-5 M60,30 h5 v5 h-5 v-5 M30,40 h5 v5 h-5 v-5 M40,40 h5 v5 h-5 v-5 M50,40 h5 v5 h-5 v-5 M60,40 h5 v5 h-5 v-5 M30,50 h5 v5 h-5 v-5 M40,50 h5 v5 h-5 v-5 M50,50 h5 v5 h-5 v-5 M60,50 h5 v5 h-5 v-5 M30,60 h5 v5 h-5 v-5 M40,60 h5 v5 h-5 v-5 M50,60 h5 v5 h-5 v-5 M60,60 h5 v5 h-5 v-5\'/%3E%3C/svg%3E") center/contain no-repeat'
              }}></div>
            </div>
            <div style={{ fontSize: '11px', opacity: 0.7, textAlign: 'center' }}>
              Scan to connect your WR account
            </div>
            <button style={{
              width: '100%',
              padding: '10px 16px',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'white',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}>
              <span>🔗</span> WR Login
            </button>
          </div>
        )}
      </div>

      {/* Docked Command Chat - Full Featured (Only when pinned) */}
      {isCommandChatPinned && (
        <>
          <div 
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.20)',
              margin: '10px 15px',
              borderRadius: '8px',
              overflow: 'hidden',
              position: 'relative'
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleChatDrop}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              background: 'linear-gradient(135deg,#667eea,#764ba2)',
              borderBottom: '1px solid rgba(255,255,255,0.20)',
              color: 'white'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700' }}>💬 Command Chat</div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button 
                    onClick={handleBucketClick}
                    title="Context Bucket: Embed context directly into the session"
                    style={{
                      height: '28px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: '#ef4444',
                      borderRadius: '6px',
                      padding: '0 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    🪣
                  </button>
                  <button 
                    onClick={handleScreenSelect}
                    title="LmGTFY - Capture a screen area as screenshot or stream"
                    style={{
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      padding: '2px 6px',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    ✎
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button 
                      onClick={() => setShowTagsMenu(!showTagsMenu)}
                      title="Tags - Quick access to saved triggers"
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.20)',
                        color: 'white',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      Tags <span style={{ fontSize: '10px', opacity: 0.9 }}>▾</span>
                    </button>
                    
                    {/* Tags Dropdown Menu */}
                    {showTagsMenu && (
                      <div 
                        style={{
                          position: 'fixed',
                          minWidth: '220px',
                          width: '320px',
                          maxHeight: '260px',
                          overflow: 'auto',
                          zIndex: 2147483647,
                          background: '#111827',
                          color: 'white',
                          border: '1px solid rgba(255,255,255,0.20)',
                          borderRadius: '8px',
                          boxShadow: '0 10px 22px rgba(0,0,0,0.35)',
                          marginTop: '4px'
                        }}
                      >
                        {triggers.length === 0 ? (
                          <div style={{ padding: '8px 10px', fontSize: '12px', opacity: 0.8 }}>
                            No tags yet
                          </div>
                        ) : (
                          triggers.map((trigger, i) => (
                            <div 
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 8px',
                                borderBottom: '1px solid rgba(255,255,255,0.20)',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              <button
                                onClick={() => handleTriggerClick(trigger)}
                                style={{
                                  flex: 1,
                                  textAlign: 'left',
                                  padding: 0,
                                  fontSize: '12px',
                                  background: 'transparent',
                                  border: 0,
                                  color: 'inherit',
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  minWidth: 0
                                }}
                              >
                                {trigger.name || `Trigger ${i + 1}`}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteTrigger(i)
                                }}
                                style={{
                                  width: '20px',
                                  height: '20px',
                                  border: 'none',
                                  background: 'rgba(239,68,68,0.2)',
                                  color: '#ef4444',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '16px',
                                  lineHeight: 1,
                                  padding: 0,
                                  marginLeft: '8px',
                                  flexShrink: 0
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.4)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'}
                              >
                                ×
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button 
                  onClick={toggleCommandChatPin}
                  title="Unpin from sidepanel"
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    border: '1px solid rgba(255,255,255,0.20)',
                    color: 'white',
                    borderRadius: '6px',
                    padding: '4px 6px',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  ↗
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div 
              ref={chatRef}
              style={{
                height: `${chatHeight}px`,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                background: 'rgba(255,255,255,0.06)',
                borderBottom: '1px solid rgba(255,255,255,0.20)',
                padding: '8px'
              }}
            >
              {chatMessages.length === 0 ? (
                <div style={{ fontSize: '12px', opacity: 0.6, textAlign: 'center', padding: '20px' }}>
                  Start a conversation...
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <div 
                    key={i} 
                    style={{
                      display: 'flex',
                      justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <div style={{
                      maxWidth: '78%',
                      padding: '8px 10px',
                      borderRadius: '10px',
                      fontSize: '12px',
                      lineHeight: '1.45',
                      background: msg.role === 'user' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.10)',
                      border: msg.role === 'user' ? '1px solid rgba(34,197,94,0.45)' : '1px solid rgba(255,255,255,0.20)'
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Resize Handle */}
            <div 
              onMouseDown={(e) => {
                e.preventDefault()
                setIsResizingChat(true)
              }}
              style={{
                height: '4px',
                background: 'rgba(255,255,255,0.15)',
                cursor: 'ns-resize',
                borderTop: '1px solid rgba(255,255,255,0.10)',
                borderBottom: '1px solid rgba(255,255,255,0.10)'
              }}
            />

            {/* Compose Area */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 36px 36px 68px',
              gap: '6px',
              alignItems: 'center',
              padding: '8px'
            }}>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="Type..."
                style={{
                  boxSizing: 'border-box',
                  height: '36px',
                  resize: 'vertical',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.20)',
                  color: 'white',
                  borderRadius: '6px',
                  padding: '8px',
                  fontSize: '12px',
                  fontFamily: 'inherit'
                }}
              />
              <input 
                ref={fileInputRef}
                type="file" 
                multiple 
                style={{ display: 'none' }} 
                onChange={handleFileChange}
              />
              <button 
                onClick={handleBucketClick}
                title="Attach" 
                style={{
                  height: '36px',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.20)',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px'
                }}
              >
                📎
              </button>
              <button 
                title="Voice" 
                style={{
                  height: '36px',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.20)',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px'
                }}
              >
                🎙️
              </button>
              <button
                onClick={handleSendMessage}
                style={{
                  height: '36px',
                  background: '#22c55e',
                  border: '1px solid #16a34a',
                  color: '#0b1e12',
                  borderRadius: '6px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Send
              </button>
            </div>
          </div>

          {/* Embed Dialog */}
          {showEmbedDialog && (
            <div style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 2147483651,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(4px)'
            }}>
              <div style={{
                width: '420px',
                background: 'linear-gradient(135deg,#667eea,#764ba2)',
                color: 'white',
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.25)',
                boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '14px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.25)',
                  fontWeight: 700
                }}>
                  Where to embed?
                </div>
                <div style={{ padding: '14px 16px', fontSize: '12px' }}>
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <input 
                      type="radio" 
                      checked={embedTarget === 'session'}
                      onChange={() => setEmbedTarget('session')}
                    />
                    <span>Session Memory (this session only)</span>
                  </label>
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <input 
                      type="radio" 
                      checked={embedTarget === 'account'}
                      onChange={() => setEmbedTarget('account')}
                    />
                    <span>Account Memory (account-wide, long term)</span>
                  </label>
                  <div style={{ marginTop: '10px', opacity: 0.9 }}>
                    Content will be processed (OCR/ASR/Parsing), chunked, and embedded locally.
                  </div>
                </div>
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.08)',
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'flex-end'
                }}>
                  <button 
                    onClick={() => setShowEmbedDialog(false)}
                    style={{
                      padding: '6px 10px',
                      border: 0,
                      borderRadius: '6px',
                      background: 'rgba(255,255,255,0.18)',
                      color: 'white',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleEmbedConfirm}
                    style={{
                      padding: '6px 10px',
                      border: 0,
                      borderRadius: '6px',
                      background: '#22c55e',
                      color: '#0b1e12',
                      cursor: 'pointer'
                    }}
                  >
                    Embed
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
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

      {/* Agent Boxes */}
      <div style={{ marginBottom: '25px' }}>
        <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold' }}>📦 Agent Outputs ({agentBoxes.length})</h3>
        {agentBoxes.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: '20px', 
            opacity: 0.6,
            border: '2px dashed rgba(255,255,255,0.2)',
            borderRadius: '6px',
            fontSize: '12px'
          }}>
            No agent outputs yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
            {agentBoxes.map(box => (
              <div key={box.id} style={{
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '6px',
                overflow: 'hidden'
              }}>
                <div style={{
                  background: box.color,
                  padding: '8px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ fontSize: '12px', fontWeight: '600' }}>{box.title}</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={() => toggleMinimize(box.id)}
                      style={{
                        background: 'rgba(255,255,255,0.2)',
                        border: 'none',
                        color: 'white',
                        width: '22px',
                        height: '22px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '11px'
                      }}
                    >
                      {box.isMinimized ? '▼' : '▲'}
                    </button>
                    <button
                      onClick={() => removeAgentBox(box.id)}
                      style={{
                        background: 'rgba(244,67,54,0.8)',
                        border: 'none',
                        color: 'white',
                        width: '22px',
                        height: '22px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '11px'
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {!box.isMinimized && (
                  <div style={{
                    padding: '10px',
                    background: 'rgba(0,0,0,0.2)',
                    fontSize: '11px',
                    lineHeight: '1.5',
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    {box.output || <span style={{ opacity: 0.5 }}>No output yet...</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <button
          onClick={addAgentBox}
          style={{
            width: '100%',
            padding: '8px',
            background: 'rgba(76,175,80,0.8)',
            border: '2px dashed rgba(76,175,80,1)',
            color: 'white',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '600'
          }}
        >
          ➕ Add New Agent Box
        </button>
      </div>

      {/* Settings Button - Now wired to lightbox */}
      <div style={{ marginTop: '20px' }}>
        <button onClick={openSettings} style={{
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
    </div>
  )
}

// Render the sidepanel
const container = document.getElementById('sidepanel-root')
if (container) {
  const root = createRoot(container)
  root.render(<SidepanelOrchestrator />)
}
