/// <reference types="chrome-types"/>
import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

interface ConnectionStatus {
  isConnected: boolean
  readyState?: number
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
  const [agentBoxes, setAgentBoxes] = useState<Array<any>>([])
  const [agentBoxHeights, setAgentBoxHeights] = useState<Record<string, number>>({})
  const [resizingBoxId, setResizingBoxId] = useState<string | null>(null)
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
      // Listen for agent box updates from content script
      if (message.type === 'UPDATE_AGENT_BOXES') {
        setAgentBoxes(message.data || [])
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

  // Load additional data (session and agent boxes)
  useEffect(() => {
    chrome.storage.local.get(['sessionName', 'isLocked', 'agentBoxes', 'agentBoxHeights'], (result) => {
      if (result.sessionName) setSessionName(result.sessionName)
      if (result.isLocked) setIsLocked(result.isLocked)
      if (result.agentBoxes) setAgentBoxes(result.agentBoxes)
      if (result.agentBoxHeights) setAgentBoxHeights(result.agentBoxHeights)
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
  const sendToContentScript = (action: string, data?: any) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        const message = data ? { type: action, data } : { type: action }
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Error sending message:', chrome.runtime.lastError)
          } else if (response?.success) {
            console.log('✅ Message sent successfully:', action)
          } else {
            console.warn('⚠️ Message sent but function not available:', action, response)
          }
        })
      } else {
        console.error('❌ No active tab found')
      }
    })
  }

  const openSettings = () => {
    console.log('🎯 Opening Settings lightbox...')
    sendToContentScript('OPEN_SETTINGS_LIGHTBOX')
  }

  const openMemory = () => {
    console.log('🎯 Opening Memory lightbox...')
    sendToContentScript('OPEN_MEMORY_LIGHTBOX')
  }

  const openContext = () => {
    console.log('🎯 Opening Context lightbox...')
    sendToContentScript('OPEN_CONTEXT_LIGHTBOX')
  }

  const openAgentsLightbox = () => {
    console.log('🎯 Opening Agents lightbox...')
    sendToContentScript('OPEN_AGENTS_LIGHTBOX')
  }

  const openPopupChat = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_COMMAND_CENTER_POPUP', theme: 'default' })
  }


  const addAgentBox = () => {
    console.log('🎯 Opening Add Agent Box dialog...')
    sendToContentScript('ADD_AGENT_BOX')
  }

  const removeAgentBox = (id: string) => {
    const updated = agentBoxes.filter(box => box.id !== id)
    setAgentBoxes(updated)
    chrome.storage.local.set({ agentBoxes: updated })
    
    // Also notify content script to delete the box
    sendToContentScript('DELETE_AGENT_BOX', { agentId: id })
  }

  const editAgentBox = (boxId: string) => {
    console.log('✏️ Editing agent box:', boxId)
    sendToContentScript('EDIT_AGENT_BOX', { box: { id: boxId } })
  }

  // Resize handler for agent boxes
  const startResizing = (boxId: string, e: React.MouseEvent) => {
    e.preventDefault()
    setResizingBoxId(boxId)
    
    const startY = e.clientY
    const startHeight = agentBoxHeights[boxId] || 120
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY
      const newHeight = Math.max(80, Math.min(400, startHeight + deltaY))
      setAgentBoxHeights(prev => ({ ...prev, [boxId]: newHeight }))
    }
    
    const handleMouseUp = () => {
      setResizingBoxId(null)
      // Save to storage
      const finalHeight = agentBoxHeights[boxId] || 120
      chrome.storage.local.set({ agentBoxHeights: { ...agentBoxHeights, [boxId]: finalHeight } })
      
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
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
      {/* Agent Boxes Display */}
      {agentBoxes.length > 0 && (
        <div style={{ marginBottom: '15px' }}>
          {agentBoxes.map(box => {
            const currentHeight = agentBoxHeights[box.id] || 120
            return (
              <div key={box.id} style={{
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '8px',
                overflow: 'hidden',
                marginBottom: '12px'
              }}>
      <div style={{ 
                  background: box.color || '#4CAF50',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ fontSize: '13px', fontWeight: '700' }}>{box.title || 'Agent Box'}</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => editAgentBox(box.id)}
                      style={{
                        background: 'rgba(255,255,255,0.2)',
                        border: 'none',
                        color: 'white',
                        width: '26px',
                        height: '26px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease',
                        opacity: 0.7
                      }}
                      title="Edit agent box"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                        e.currentTarget.style.background = 'rgba(33, 150, 243, 0.8)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.7'
                        e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeAgentBox(box.id)}
                      style={{
                        background: 'rgba(244,67,54,0.9)',
                        border: 'none',
                        color: 'white',
                        width: '26px',
                        height: '26px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        transition: 'all 0.2s ease',
                        opacity: 0.7
                      }}
                      title="Delete agent box"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                        e.currentTarget.style.background = 'rgba(211, 47, 47, 1)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.7'
                        e.currentTarget.style.background = 'rgba(244,67,54,0.9)'
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div 
                  style={{
                    background: 'rgba(255,255,255,0.95)',
                    color: '#333',
                    borderRadius: '0 0 8px 8px',
                    padding: '12px',
                    minHeight: `${currentHeight}px`,
                    height: `${currentHeight}px`,
                    border: '1px solid rgba(0,0,0,0.1)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    position: 'relative',
                    overflow: 'auto'
                  }}
                >
                  <div style={{ fontSize: '12px', color: '#333', lineHeight: '1.4' }}>
                    {box.output || <span style={{ opacity: 0.5, color: '#666' }}>Ready for {box.title?.replace(/[📝🔍🎯🧮]/g, '').trim()}...</span>}
                  </div>
                  <div 
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '8px',
                      cursor: 'ns-resize',
                      background: 'rgba(0,0,0,0.1)',
                      borderRadius: '0 0 8px 8px',
                      opacity: resizingBoxId === box.id ? 1 : 0,
                      transition: 'opacity 0.2s'
                    }}
                    onMouseDown={(e) => startResizing(box.id, e)}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '0.6'}
                    onMouseLeave={(e) => {
                      if (resizingBoxId !== box.id) {
                        e.currentTarget.style.opacity = '0'
                      }
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
      
      {/* Add Agent Box Button */}
      <button
        onClick={addAgentBox}
        style={{
          width: '100%',
          padding: '14px',
          background: 'linear-gradient(135deg, rgba(76,175,80,0.9), rgba(56,142,60,0.9))',
          border: '2px solid rgba(76,175,80,1)',
          color: 'white',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '15px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'all 0.2s ease',
          marginBottom: '25px'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 6px 16px rgba(76,175,80,0.5)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        ➕ Add New Agent Box
      </button>

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
