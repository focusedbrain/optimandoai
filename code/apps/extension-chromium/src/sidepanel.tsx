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
  const [sessionName, setSessionName] = useState('Loading...')
  const [sessionKey, setSessionKey] = useState<string>('')
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
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Load pinned state from localStorage
  useEffect(() => {
    chrome.storage.local.get(['commandChatPinned'], (result) => {
      if (result.commandChatPinned !== undefined) {
        setIsCommandChatPinned(result.commandChatPinned)
        
        // If pinned, ensure docked chat is created on the page
        if (result.commandChatPinned) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, { type: 'CREATE_DOCKED_CHAT' })
            }
          })
        }
      }
    })
  }, [])
  
  // Save pinned state and toggle docked chat
  const toggleCommandChatPin = () => {
    const newState = !isCommandChatPinned
    setIsCommandChatPinned(newState)
    chrome.storage.local.set({ commandChatPinned: newState })
    
    // Actually create or remove the docked chat
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        if (newState) {
          // Pin: Create docked chat
          chrome.tabs.sendMessage(tabs[0].id, { type: 'CREATE_DOCKED_CHAT' })
        } else {
          // Unpin: Remove docked chat  
          chrome.tabs.sendMessage(tabs[0].id, { type: 'REMOVE_DOCKED_CHAT' })
        }
      }
    })
  }

  // Original useEffect for connection status
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' })

    const handleMessage = (message: any) => {
      console.log('📨 Sidepanel received message:', message.type, message.data)
      
      if (message.type === 'STATUS_UPDATE') {
        setConnectionStatus(message.data)
        setIsLoading(false)
      }
      // Listen for agent box updates from content script
      else if (message.type === 'UPDATE_AGENT_BOXES') {
        console.log('📦 Updating agent boxes:', message.data)
        setAgentBoxes(message.data || [])
      }
      // Listen for session data updates
      else if (message.type === 'UPDATE_SESSION_DATA') {
        console.log('📥 Session data updated from broadcast:', message.data)
        if (message.data.sessionName !== undefined) {
          console.log('  → Setting session name:', message.data.sessionName)
          setSessionName(message.data.sessionName)
        }
        if (message.data.sessionKey !== undefined) {
          console.log('  → Setting session key:', message.data.sessionKey)
          setSessionKey(message.data.sessionKey)
        }
        if (message.data.isLocked !== undefined) {
          console.log('  → Setting locked state:', message.data.isLocked)
          setIsLocked(message.data.isLocked)
        }
        if (message.data.agentBoxes !== undefined) {
          console.log('  → Setting agent boxes:', message.data.agentBoxes.length)
          setAgentBoxes(message.data.agentBoxes)
        }
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

  // Load session data from active tab
  useEffect(() => {
    const loadSessionData = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SESSION_DATA' }, (response) => {
            if (chrome.runtime.lastError) {
              console.log('No active session in current tab')
              setSessionName('No Session')
              return
            }
            if (response) {
              console.log('📥 Received session data:', response)
              setSessionName(response.sessionName || 'New Session')
              setSessionKey(response.sessionKey || '')
              setIsLocked(response.isLocked || false)
              setAgentBoxes(response.agentBoxes || [])
            } else {
              setSessionName('No Session')
            }
          })
        }
      })
    }
    
    // Load immediately
    loadSessionData()
    
    // Retry after a short delay to ensure content script is ready
    const retryTimer = setTimeout(loadSessionData, 500)
    
    return () => clearTimeout(retryTimer)
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
        chrome.tabs.sendMessage(tabs[0].id, message)
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

  const openUnifiedAdmin = () => {
    console.log('🎯 Opening Unified Admin lightbox...')
    sendToContentScript('OPEN_UNIFIED_ADMIN_LIGHTBOX')
  }

  const openReasoningLightbox = () => {
    console.log('🧠 Opening Reasoning lightbox...')
    sendToContentScript('OPEN_REASONING_LIGHTBOX')
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

  // Notification helper - defined before quick actions so it can be used
  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }

  // Quick Actions functions - EXACTLY like the original buttons
  const openAddView = () => {
    sendToContentScript('OPEN_HELPER_GRID_LIGHTBOX')
  }

  const openSessions = () => {
    sendToContentScript('OPEN_SESSIONS_LIGHTBOX')
  }

  const syncSession = () => {
    sendToContentScript('SYNC_SESSION')
  }

  const importSession = () => {
    sendToContentScript('IMPORT_SESSION')
  }

  const openWRVault = () => {
    sendToContentScript('OPEN_WRVAULT_LIGHTBOX')
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
    // Send update to content script
    sendToContentScript('UPDATE_SESSION_NAME', { sessionName, isLocked })
  }

  const createNewSession = () => {
    console.log('🆕 Creating new session...')
    // Send message to content script to create new session
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        const tabId = tabs[0].id
        chrome.tabs.sendMessage(tabId, { type: 'CREATE_NEW_SESSION' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Error creating session:', chrome.runtime.lastError)
            showNotification('Failed to create session', 'error')
            return
          }
          console.log('✅ Session created:', response)
          
          // Poll for updated session data after creation - multiple attempts
          let pollAttempts = 0
          const pollInterval = setInterval(() => {
            pollAttempts++
            console.log(`🔄 Polling for new session data (attempt ${pollAttempts})...`)
            
            chrome.tabs.sendMessage(tabId, { type: 'GET_SESSION_DATA' }, (sessionResponse) => {
              if (chrome.runtime.lastError) {
                console.error('❌ Error getting session data:', chrome.runtime.lastError)
                if (pollAttempts >= 3) {
                  clearInterval(pollInterval)
                  showNotification('Session created but data not synced', 'error')
                }
                return
              }
              if (sessionResponse) {
                console.log('📥 Received new session data:', sessionResponse)
                console.log('  → sessionName:', sessionResponse.sessionName)
                console.log('  → sessionKey:', sessionResponse.sessionKey)
                console.log('  → isLocked:', sessionResponse.isLocked)
                console.log('  → agentBoxes:', sessionResponse.agentBoxes?.length || 0)
                
                setSessionName(sessionResponse.sessionName || 'New Session')
                setSessionKey(sessionResponse.sessionKey || '')
                setIsLocked(sessionResponse.isLocked || false)
                setAgentBoxes(sessionResponse.agentBoxes || [])
                
                // Show success notification
                showNotification(`🆕 New session "${sessionResponse.sessionName}" started!`, 'success')
                clearInterval(pollInterval)
              } else if (pollAttempts >= 3) {
                clearInterval(pollInterval)
                showNotification('Session created but no data received', 'error')
              }
            })
          }, 200) // Poll every 200ms, up to 3 times
        })
      }
    })
  }

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '0',
      margin: '0',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflowX: 'hidden'
    }}>
      {/* Session Controls at the very top - Single Row */}
      <div style={{ 
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        background: 'rgba(0,0,0,0.15)'
      }}>
        <button
          onClick={openReasoningLightbox}
          style={{
            width: '32px',
            height: '32px',
            flexShrink: 0,
            background: 'rgba(156, 39, 176, 0.8)',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            padding: 0
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(156, 39, 176, 1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(156, 39, 176, 0.8)'}
          title="Reasoning & Session Goals"
        >
          🧠
        </button>
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }}>
          <input
            type="text"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            onBlur={saveSession}
            placeholder="Session Name"
            style={{
              width: '100%',
              padding: '6px 10px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: 'white',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: '500',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          />
          {sessionKey && (
            <div style={{
              padding: '2px 10px',
              fontSize: '9px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              color: 'rgba(255,255,255,0.6)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              ID: <span style={{ color: '#FFD700' }}>{sessionKey}</span>
            </div>
          )}
        </div>
        <button
          onClick={createNewSession}
          style={{
            width: '32px',
            height: '32px',
            flexShrink: 0,
            background: '#4CAF50',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '18px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#45a049'}
          onMouseLeave={(e) => e.currentTarget.style.background = '#4CAF50'}
          title="New Session"
        >
          +
        </button>
        <button
          onClick={() => {
            console.log('💾 Save/Export session...')
            sendToContentScript('SAVE_SESSION')
          }}
          style={{
            width: '32px',
            height: '32px',
            flexShrink: 0,
            background: 'rgba(76, 175, 80, 0.8)',
            border: 'none',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(76, 175, 80, 1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(76, 175, 80, 0.8)'}
          title="Save/Export Session"
        >
          💾
        </button>
        <button
          onClick={openPopupChat}
          style={{
            width: '32px',
            height: '32px',
            flexShrink: 0,
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          title="Open Popup Chat"
        >
          💬
        </button>
        <button
          onClick={toggleCommandChatPin}
          style={{
            width: '32px',
            height: '32px',
            flexShrink: 0,
            background: isCommandChatPinned ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.1)',
            border: `1px solid ${isCommandChatPinned ? 'rgba(76,175,80,0.6)' : 'rgba(255,255,255,0.2)'}`,
            color: 'white',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = isCommandChatPinned ? 'rgba(76,175,80,0.5)' : 'rgba(255,255,255,0.2)'}
          onMouseLeave={(e) => e.currentTarget.style.background = isCommandChatPinned ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.1)'}
          title={isCommandChatPinned ? "Unpin Command Chat" : "Pin Command Chat"}
        >
          📌
        </button>
      </div>

      {/* Administration Section */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', width: '100%' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
            ADMIN
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1 }}>
            <button onClick={openUnifiedAdmin} title="Admin Configuration (Agents, Context, Memory)" style={{ width: '32px', height: '32px', flexShrink: 0, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}>⚙️</button>
            <button onClick={openAddView} title="Add View" style={{ width: '32px', height: '32px', flexShrink: 0, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}>⊞</button>
            <button onClick={openSessions} title="Sessions" style={{ width: '32px', height: '32px', flexShrink: 0, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}>📚</button>
            <button onClick={openSettings} title="Settings" style={{ width: '32px', height: '32px', flexShrink: 0, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}>🔧</button>
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
            padding: '16px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: '700', opacity: 0.95, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🔐</span> WR Code
          </div>
          <div style={{ 
            fontSize: '16px', 
            opacity: 0.7,
            transition: 'transform 0.2s ease',
            transform: isWRLoginCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'
          }}>
            ▼
          </div>
        </div>
        {!isWRLoginCollapsed && (
          <div style={{
            padding: '16px 20px 24px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px'
          }}>
            <div style={{
              width: '150px',
              height: '150px',
              background: 'white',
              borderRadius: '10px',
              padding: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}>
              <div style={{
                width: '100%',
                height: '100%',
                background: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Crect fill=\'%23000\' x=\'0\' y=\'0\' width=\'20\' height=\'20\'/%3E%3Crect fill=\'%23000\' x=\'0\' y=\'80\' width=\'20\' height=\'20\'/%3E%3Crect fill=\'%23000\' x=\'80\' y=\'0\' width=\'20\' height=\'20\'/%3E%3Crect fill=\'%23000\' x=\'10\' y=\'10\' width=\'5\' height=\'5\'/%3E%3Crect fill=\'%23000\' x=\'10\' y=\'85\' width=\'5\' height=\'5\'/%3E%3Crect fill=\'%23000\' x=\'85\' y=\'10\' width=\'5\' height=\'5\'/%3E%3Cpath fill=\'%23000\' d=\'M30,30 h5 v5 h-5 v-5 M40,30 h5 v5 h-5 v-5 M50,30 h5 v5 h-5 v-5 M60,30 h5 v5 h-5 v-5 M30,40 h5 v5 h-5 v-5 M40,40 h5 v5 h-5 v-5 M50,40 h5 v5 h-5 v-5 M60,40 h5 v5 h-5 v-5 M30,50 h5 v5 h-5 v-5 M40,50 h5 v5 h-5 v-5 M50,50 h5 v5 h-5 v-5 M60,50 h5 v5 h-5 v-5 M30,60 h5 v5 h-5 v-5 M40,60 h5 v5 h-5 v-5 M50,60 h5 v5 h-5 v-5 M60,60 h5 v5 h-5 v-5\'/%3E%3C/svg%3E") center/contain no-repeat'
              }}></div>
            </div>
            <div style={{ fontSize: '12px', opacity: 0.75, textAlign: 'center', lineHeight: '1.5' }}>
              Scan to connect your WR account
            </div>
            <button style={{
              width: '100%',
              padding: '12px 18px',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
              e.currentTarget.style.transform = 'translateY(0)'
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
              margin: '12px 16px',
              borderRadius: '8px',
              overflow: 'hidden',
              position: 'relative',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleChatDrop}
          >
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'linear-gradient(135deg,#667eea,#764ba2)',
              borderBottom: '1px solid rgba(255,255,255,0.20)',
              color: 'white'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: '700' }}>💬 Command Chat</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button 
                    onClick={handleBucketClick}
                    title="Context Bucket: Embed context directly into the session"
                    style={{
                      height: '32px',
                      minWidth: '32px',
                      background: 'rgba(255,255,255,0.12)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: '#ef4444',
                      borderRadius: '6px',
                      padding: '0 10px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                  >
                    🪣
                  </button>
                  <button 
                    onClick={handleScreenSelect}
                    title="LmGTFY - Capture a screen area as screenshot or stream"
                    style={{
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: 'white',
                      borderRadius: '6px',
                      padding: '0 10px',
                      height: '32px',
                      minWidth: '32px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  >
                    ✎
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button 
                      onClick={() => setShowTagsMenu(!showTagsMenu)}
                      title="Tags - Quick access to saved triggers"
                      style={{
                        background: 'rgba(255,255,255,0.12)',
                        border: '1px solid rgba(255,255,255,0.25)',
                        color: 'white',
                        borderRadius: '6px',
                        padding: '0 12px',
                        height: '32px',
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                    >
                      Tags <span style={{ fontSize: '11px', opacity: 0.9 }}>▾</span>
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
                gap: '10px',
                background: 'rgba(255,255,255,0.06)',
                borderBottom: '1px solid rgba(255,255,255,0.20)',
                padding: '14px'
              }}
            >
              {chatMessages.length === 0 ? (
                <div style={{ fontSize: '13px', opacity: 0.6, textAlign: 'center', padding: '32px 20px' }}>
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
                      maxWidth: '80%',
                      padding: '10px 14px',
                      borderRadius: '12px',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      background: msg.role === 'user' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.12)',
                      border: msg.role === 'user' ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.25)'
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
              gridTemplateColumns: '1fr 40px 40px 72px',
              gap: '8px',
              alignItems: 'center',
              padding: '12px 14px'
            }}>
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="Type your message..."
                style={{
                  boxSizing: 'border-box',
                  height: '40px',
                  minHeight: '40px',
                  resize: 'vertical',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.20)',
                  color: 'white',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  lineHeight: '1.5'
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
                  height: '40px',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  color: 'white',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              >
                📎
              </button>
              <button 
                title="Voice" 
                style={{
                  height: '40px',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.25)',
                  color: 'white',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
              >
                🎙️
              </button>
              <button
                onClick={handleSendMessage}
                style={{
                  height: '40px',
                  background: '#22c55e',
                  border: '1px solid #16a34a',
                  color: '#0b1e12',
                  borderRadius: '8px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  fontSize: '13px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#16a34a'
                  e.currentTarget.style.transform = 'translateY(-1px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#22c55e'
                  e.currentTarget.style.transform = 'translateY(0)'
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

      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        overflowX: 'hidden', 
        padding: '16px', 
        width: '100%', 
        boxSizing: 'border-box',
        WebkitOverflowScrolling: 'touch'
      } as React.CSSProperties}>
      {/* Agent Boxes Display */}
      {agentBoxes.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          {agentBoxes.map(box => {
            const currentHeight = agentBoxHeights[box.id] || 120
            return (
              <div key={box.id} style={{
                background: 'rgba(255,255,255,0.12)',
                borderRadius: '10px',
                overflow: 'hidden',
                marginBottom: '16px',
                border: '1px solid rgba(255,255,255,0.15)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}>
      <div style={{ 
                  background: box.color || '#4CAF50',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ fontSize: '14px', fontWeight: '700' }}>{box.title || 'Agent Box'}</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => editAgentBox(box.id)}
                      style={{
                        background: 'rgba(255,255,255,0.2)',
                        border: 'none',
                        color: 'white',
                        minWidth: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease',
                        opacity: 0.85
                      }}
                      title="Edit agent box"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                        e.currentTarget.style.background = 'rgba(33, 150, 243, 0.8)'
                        e.currentTarget.style.transform = 'scale(1.05)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.85'
                        e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        e.currentTarget.style.transform = 'scale(1)'
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
                        minWidth: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        transition: 'all 0.2s ease',
                        opacity: 0.85
                      }}
                      title="Delete agent box"
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                        e.currentTarget.style.background = 'rgba(211, 47, 47, 1)'
                        e.currentTarget.style.transform = 'scale(1.05)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.85'
                        e.currentTarget.style.background = 'rgba(244,67,54,0.9)'
                        e.currentTarget.style.transform = 'scale(1)'
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div 
                  style={{
                    background: 'rgba(255,255,255,0.96)',
                    color: '#1e293b',
                    borderRadius: '0 0 10px 10px',
                    padding: '16px',
                    minHeight: `${currentHeight}px`,
                    height: `${currentHeight}px`,
                    border: '1px solid rgba(0,0,0,0.1)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                    position: 'relative',
                    overflow: 'auto'
                  }}
                >
                  <div style={{ fontSize: '13px', color: '#1e293b', lineHeight: '1.6' }}>
                    {box.output || <span style={{ opacity: 0.5, color: '#64748b' }}>Ready for {box.title?.replace(/[📝🔍🎯🧮]/g, '').trim()}...</span>}
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
          padding: '16px 20px',
          background: 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(56,142,60,0.95))',
          border: '2px dashed rgba(76,175,80,1)',
          color: 'white',
          borderRadius: '10px',
          cursor: 'pointer',
          fontSize: '15px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          transition: 'all 0.2s ease',
          marginBottom: '28px',
          boxShadow: '0 4px 12px rgba(76,175,80,0.3)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 6px 20px rgba(76,175,80,0.5)'
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(56,142,60,1), rgba(46,125,50,1))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(76,175,80,0.3)'
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(76,175,80,0.95), rgba(56,142,60,0.95))'
        }}
      >
        ➕ Add New Agent Box
      </button>

      {/* Quick Actions Section */}
      <div style={{
        background: 'rgba(255,255,255,0.12)',
        padding: '16px',
          borderRadius: '10px',
        marginBottom: '28px',
        border: '1px solid rgba(255,255,255,0.15)'
      }}>
        <h3 style={{
          margin: '0 0 14px 0',
          fontSize: '13px',
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          opacity: 0.95,
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          ⚡ Quick Actions
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <button
            onClick={syncSession}
            style={{
              padding: '12px',
              background: '#2196F3',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(33,150,243,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            🔄 Sync
          </button>
          <button
            onClick={importSession}
            style={{
              padding: '12px',
              background: '#9C27B0',
              border: 'none',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(156,39,176,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            📥 Import
          </button>
          <button
            onClick={openWRVault}
            style={{
              padding: '12px',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: 'white',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
              gridColumn: '1 / span 2',
              boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(255,255,255,0.2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            🔒 WRVault
        </button>
      </div>
      </div>
      </div>
      
      {/* Notification Toast */}
      {notification && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          left: '20px',
          background: notification.type === 'success' ? 'rgba(76, 175, 80, 0.95)' : 
                      notification.type === 'error' ? 'rgba(244, 67, 54, 0.95)' : 
                      'rgba(33, 150, 243, 0.95)',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '8px',
          fontSize: '13px',
          fontWeight: '600',
          zIndex: 10000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          animation: 'slideInDown 0.3s ease',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>{notification.message}</span>
        </div>
      )}
    </div>
  )
}

// Render the sidepanel
const container = document.getElementById('sidepanel-root')
if (container) {
  const root = createRoot(container)
  root.render(<SidepanelOrchestrator />)
}
