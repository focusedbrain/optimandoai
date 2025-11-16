/// <reference types="chrome-types"/>
import React, { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { BackendSwitcher } from './components/BackendSwitcher'
import { BackendSwitcherInline } from './components/BackendSwitcherInline'

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
  const [sessionName, setSessionName] = useState('')
  const [sessionKey, setSessionKey] = useState<string>('')
  const [isLocked, setIsLocked] = useState(false)
  const [agentBoxes, setAgentBoxes] = useState<Array<any>>([])
  const [agentBoxHeights, setAgentBoxHeights] = useState<Record<string, number>>({})
  const [resizingBoxId, setResizingBoxId] = useState<string | null>(null)
  const [isWRLoginCollapsed, setIsWRLoginCollapsed] = useState(false)
  const [isCommandChatPinned, setIsCommandChatPinned] = useState(false)
  const [showMinimalUI, setShowMinimalUI] = useState(false) // Show minimal UI on display grids and Edge startpage
  const [viewMode, setViewMode] = useState<'app' | 'admin'>('app') // App or Admin view
  const [isAdminDisabled, setIsAdminDisabled] = useState(false) // Disable admin on display grids and Edge startpage
  
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
  const [theme, setTheme] = useState<'default' | 'dark' | 'professional'>('default')
  const [masterTabId, setMasterTabId] = useState<string | null>(null) // For Master Tab (01), (02), (03), etc. (01 = first tab, doesn't show title in UI)
  const [showTriggerPrompt, setShowTriggerPrompt] = useState<{mode: string, rect: any, imageUrl: string, videoUrl?: string, createTrigger: boolean, addCommand: boolean, name?: string, command?: string, bounds?: any} | null>(null)
  const [createTriggerChecked, setCreateTriggerChecked] = useState(false)
  const [addCommandChecked, setAddCommandChecked] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Load pinned state and viewMode from storage
  useEffect(() => {
    import('./storage/storageWrapper').then(({ storageGet }) => {
      storageGet(['commandChatPinned', 'viewMode'], (result) => {
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
        if (result.viewMode) {
          setViewMode(result.viewMode as 'app' | 'admin')
        }
      });
    });
  }, [])

  // Load and listen for theme changes
  useEffect(() => {
    // Load initial theme
    import('./storage/storageWrapper').then(({ storageGet }) => {
      storageGet(['optimando-ui-theme'], (result) => {
        const savedTheme = result['optimando-ui-theme'] || 'default'
        setTheme(savedTheme as 'default' | 'dark' | 'professional')
      });
    });

    // Listen for theme changes
    const handleStorageChange = (changes: any, namespace: string) => {
      if (namespace === 'local' && changes['optimando-ui-theme']) {
        const newTheme = changes['optimando-ui-theme'].newValue || 'default'
        console.log('🎨 Sidepanel: Theme changed to:', newTheme)
        setTheme(newTheme as 'default' | 'dark' | 'professional')
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  // Detect if this is a Master Tab and get its ID, and check if we should show minimal UI
  useEffect(() => {
    const checkTabType = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id && tabs[0]?.url) {
          const tabId = tabs[0].id
          const storageKey = `masterTabId_${tabId}`
          
          try {
            const url = new URL(tabs[0].url)
            const hybridMasterId = url.searchParams.get('hybrid_master_id')
            const isDisplayGrid = url.pathname.includes('grid-display.html')
            const isEdgeStartpage = url.hostname === 'www.msn.com' || url.hostname === 'msn.com' || url.protocol === 'edge:'
            
            // Check if we should show minimal UI (display grid without master ID, or Edge startpage)
            const shouldShowMinimal = (isDisplayGrid && hybridMasterId === null) || isEdgeStartpage
            setShowMinimalUI(shouldShowMinimal)
            
            // Admin is disabled on display grids and Edge startpage
            setIsAdminDisabled(shouldShowMinimal)
            
            // First, check if we have a stored master tab ID for this tab (persists across page refreshes)
            chrome.storage.local.get([storageKey], (result) => {
              const storedMasterTabId = result[storageKey]
              
              if (hybridMasterId) {
                // Convert hybrid_master_id to display format (Master Tab 01, 02, 03, etc.)
                // Main tab (no hybrid_master_id) = Master Tab 01
                // hybrid_master_id 0 = Master Tab 02, 1 = Master Tab 03, etc.
                const displayId = String(parseInt(hybridMasterId) + 2).padStart(2, '0')
                setMasterTabId(displayId)
                // Store it for this tab so it persists across page refreshes
                chrome.storage.local.set({ [storageKey]: displayId })
                console.log('🖥️ Detected Master Tab ID:', displayId, '(stored for tab', tabId, ')')
              } else if (storedMasterTabId) {
                // No hybrid_master_id in URL, but we have a stored value (page refreshed)
                setMasterTabId(storedMasterTabId)
                console.log('🖥️ Using stored Master Tab ID:', storedMasterTabId, '(tab', tabId, ')')
              } else {
                // No hybrid_master_id and no stored value - this is Master Tab (01)
                setMasterTabId("01")
                // Store it for this tab so it persists across page refreshes
                chrome.storage.local.set({ [storageKey]: "01" })
                console.log('🖥️ Main master tab - Master Tab (01)')
              }
              
              if (shouldShowMinimal) {
                console.log('📱 Showing minimal UI - Display grid or Edge startpage')
              }
            })
          } catch (e) {
            console.error('Error parsing tab URL:', e)
            setShowMinimalUI(false)
            // On error, try to use stored master tab ID
            chrome.storage.local.get([storageKey], (result) => {
              const storedMasterTabId = result[storageKey]
              if (storedMasterTabId) {
                setMasterTabId(storedMasterTabId)
                console.log('🖥️ Using stored Master Tab ID after error:', storedMasterTabId)
              } else {
                setMasterTabId(null)
              }
            })
          }
        }
      })
    }

    // Check initially
    checkTabType()

    // Listen for tab updates (URL changes)
    const handleTabUpdate = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (changeInfo.url || changeInfo.status === 'complete') {
        console.log('🔄 Tab URL changed, rechecking tab type')
        checkTabType()
      }
    }

    // Listen for when user switches tabs
    const handleTabActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      console.log('🔄 Tab activated, rechecking tab type')
      checkTabType()
    }

    chrome.tabs.onUpdated.addListener(handleTabUpdate)
    chrome.tabs.onActivated.addListener(handleTabActivated)

    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdate)
      chrome.tabs.onActivated.removeListener(handleTabActivated)
    }
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
      // Listen for Electron screenshot results
      else if (message.type === 'ELECTRON_SELECTION_RESULT') {
        console.log('📷 Sidepanel received screenshot from Electron:', message.kind)
        const url = message.dataUrl || message.url
        if (url) {
          // Add screenshot to chat messages as a user message with image
          const imageMessage = {
            role: 'user' as const,
            text: `![Screenshot](${url})`,
            imageUrl: url
          }
          setChatMessages(prev => [...prev, imageMessage])
          // Scroll to bottom
          setTimeout(() => {
            if (chatRef.current) {
              chatRef.current.scrollTop = chatRef.current.scrollHeight
            }
          }, 100)
        }
      }
      // Listen for trigger prompt from Electron
      else if (message.type === 'SHOW_TRIGGER_PROMPT') {
        console.log('📝 Sidepanel received trigger prompt from Electron:', message)
        
        // Check if we're on a restricted page (display grid or MSN)
        const tabUrl = message.tabUrl || ''
        const isRestrictedPage = tabUrl.includes('/grid-display') || 
                                  tabUrl.includes('msn.com/') ||
                                  tabUrl.startsWith('edge://') ||
                                  tabUrl.includes('/grid-display')
        
        console.log('[SIDEPANEL] Is restricted page:', isRestrictedPage, 'URL:', tabUrl)
        
        // Only show inline form on restricted pages
        // On regular pages, the content script will show a modal instead
        if (!isRestrictedPage) {
          console.log('[SIDEPANEL] Skipping inline form on regular page - modal will be shown')
          return
        }
        
        setShowTriggerPrompt({
          mode: message.mode,
          rect: message.rect,
          bounds: message.bounds,
          imageUrl: message.imageUrl,
          videoUrl: message.videoUrl,
          createTrigger: message.createTrigger,
          addCommand: message.addCommand,
          name: '',
          command: ''
        })
      }
      // Listen for trigger updates from other contexts
      else if (message.type === 'TRIGGERS_UPDATED') {
        console.log('🔄 Sidepanel: Reloading triggers after update')
        chrome.storage?.local?.get(['optimando-tagged-triggers'], (data: any) => {
          const list = Array.isArray(data?.['optimando-tagged-triggers']) ? data['optimando-tagged-triggers'] : []
          setTriggers(list)
        })
      }
      // Listen for command append from modal
      else if (message.type === 'COMMAND_POPUP_APPEND') {
        console.log('📝 Sidepanel received command append:', message)
        if (message.command || message.text) {
          const commandText = message.command || message.text
          // Add command message to chat
          const commandMessage = {
            role: 'user' as const,
            text: typeof commandText === 'string' ? commandText : `📝 Command: ${commandText}`
          }
          setChatMessages(prev => [...prev, commandMessage])
          console.log('📝 Command appended to chat:', commandText)
        }
      }
      // Listen for reload request after deletion
      else if (message.type === 'RELOAD_SESSION_FROM_SQLITE') {
        console.log('🔄 Sidepanel: Reloading session from SQLite after deletion')
        loadSessionDataFromStorage()
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

  // Load session data immediately on mount and when sidebar becomes visible
  useEffect(() => {
    const loadSessionDataFromStorage = () => {
      // Load session data from SQLite (single source of truth)
      chrome.runtime.sendMessage({ type: 'GET_ALL_SESSIONS_FROM_SQLITE' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Error loading sessions from SQLite:', chrome.runtime.lastError.message)
          setSessionName('No Session')
          setSessionKey('')
          return
        }
        
        if (!response || !response.success || !response.sessions || response.sessions.length === 0) {
          console.log('⚠️ No sessions found in SQLite')
          setSessionName('No Session')
          setSessionKey('')
          return
        }
        
        // Get the most recent session (by timestamp)
        let mostRecentSession: any = null
        let mostRecentKey: string = ''
        let mostRecentTime = 0
        
        Object.entries(response.sessions).forEach(([key, session]: [string, any]) => {
          if (session && session.timestamp) {
            const sessionTime = new Date(session.timestamp).getTime()
            if (sessionTime > mostRecentTime) {
              mostRecentTime = sessionTime
              mostRecentSession = session
              mostRecentKey = key
            }
          }
        })
        
        // If we found a session, use it
        if (mostRecentSession && mostRecentKey) {
          console.log('✅ Loaded session from SQLite:', mostRecentKey, mostRecentSession.tabName)
          setSessionName(mostRecentSession.tabName || 'Unnamed Session')
          setSessionKey(mostRecentKey)
          setIsLocked(mostRecentSession.isLocked || false)
          setAgentBoxes(mostRecentSession.agentBoxes || [])
        } else {
          setSessionName('No Session')
          setSessionKey('')
        }
      })
    }

    const loadSessionDataFromContentScript = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_SESSION_DATA' }, (response) => {
            if (chrome.runtime.lastError) {
              console.log('⚠️ Content script not ready, loading from storage:', chrome.runtime.lastError.message)
              loadSessionDataFromStorage()
              return
            }
            if (response && response.sessionKey) {
              console.log('✅ Received session data from content script:', response)
              setSessionName(response.sessionName || 'New Session')
              setSessionKey(response.sessionKey || '')
              setIsLocked(response.isLocked || false)
              setAgentBoxes(response.agentBoxes || [])
            } else {
              // Fallback to storage
              loadSessionDataFromStorage()
            }
          })
        } else {
          // No active tab, load from storage
          loadSessionDataFromStorage()
        }
      })
    }
    
    // Load immediately from storage (fastest)
    loadSessionDataFromStorage()
    
    // Also try to get from content script (more accurate for current session)
    const contentScriptTimer = setTimeout(loadSessionDataFromContentScript, 100)
    
    // Retry content script a few times
    const retryTimer1 = setTimeout(loadSessionDataFromContentScript, 500)
    const retryTimer2 = setTimeout(loadSessionDataFromContentScript, 1500)
    
    return () => {
      clearTimeout(contentScriptTimer)
      clearTimeout(retryTimer1)
      clearTimeout(retryTimer2)
    }
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
    chrome.runtime.sendMessage({ type: 'OPEN_COMMAND_CENTER_POPUP', theme: theme })
  }

  const toggleViewMode = () => {
    if (isAdminDisabled) {
      showNotification('Open a website for viewing the admin panel', 'info')
      return
    }
    
    const newMode = viewMode === 'app' ? 'admin' : 'app'
    setViewMode(newMode)
    
    // Save to storage
    import('./storage/storageWrapper').then(({ storageSet }) => {
      storageSet({ viewMode: newMode }, () => {
        console.log('✅ View mode saved:', newMode)
      })
    })
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
    // Show confirmation dialog
    if (!confirm('Do you want to delete this agent box?')) {
      return
    }
    
    // Update local state for immediate UI feedback
    const updated = agentBoxes.filter(box => box.id !== id)
    setAgentBoxes(updated)
    
    // Notify content script to delete the box (which will handle SQLite deletion)
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
      const newHeight = Math.max(80, Math.min(800, startHeight + deltaY))
      setAgentBoxHeights(prev => ({ ...prev, [boxId]: newHeight }))
    }
    
    const handleMouseUp = () => {
      setResizingBoxId(null)
      // Save to storage
      const finalHeight = agentBoxHeights[boxId] || 120
      import('./storage/storageWrapper').then(({ storageSet }) => {
        storageSet({ agentBoxHeights: { ...agentBoxHeights, [boxId]: finalHeight } })
      })
      
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
    console.log('📷 Sidepanel: Starting Electron screen selection', { createTrigger: createTriggerChecked, addCommand: addCommandChecked })
    chrome.runtime?.sendMessage({ 
      type: 'ELECTRON_START_SELECTION', 
      source: 'sidepanel-docked-chat',
      createTrigger: createTriggerChecked,
      addCommand: addCommandChecked
    })
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
                
                // Show session name (editable), sessionKey shown below in small text
                setSessionName(sessionResponse.sessionName || 'New Session')
                setSessionKey(sessionResponse.sessionKey || '')
                setIsLocked(sessionResponse.isLocked || false)
                setAgentBoxes(sessionResponse.agentBoxes || [])
                
                // Show success notification
                showNotification(`🆕 New session "${sessionResponse.sessionName || sessionResponse.sessionKey}" started!`, 'success')
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

  // Get theme colors
  const getThemeColors = () => {
    switch (theme) {
      case 'dark':
        return {
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          text: '#f1f5f9'
        }
      case 'professional':
        return {
          background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
          text: '#0f172a'
        }
      default:
        return {
          background: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)',
          text: 'white'
        }
    }
  }

  // Get icon button style based on theme
  const getIconButtonStyle = (baseColor: string) => {
    if (theme === 'professional') {
      return {
        background: 'rgba(0,0,0,0.08)',
        border: '1px solid rgba(0,0,0,0.12)',
        color: '#1e293b'
      }
    } else if (theme === 'dark') {
      return {
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(255,255,255,0.2)',
        color: '#f1f5f9'
      }
    } else {
      return {
        background: baseColor,
        border: 'none',
        color: 'white'
      }
    }
  }

  const themeColors = getThemeColors()

  // Admin icon button style
  const adminIconStyle = {
    width: '32px',
    height: '32px',
    flexShrink: 0,
    ...(theme === 'professional' ? {
      background: 'rgba(15,23,42,0.08)',
      border: '1px solid rgba(15,23,42,0.2)',
      color: '#0f172a'
    } : theme === 'dark' ? {
      background: 'rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: '#f1f5f9'
    } : {
      background: 'rgba(118,75,162,0.45)',
      border: '1px solid rgba(255,255,255,0.5)',
      color: 'white'
    }),
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease'
  }

  // Action button style (for session controls)
  const actionButtonStyle = (baseColor: string) => ({
    width: '32px',
    height: '32px',
    flexShrink: 0,
    ...(theme === 'professional' ? {
      background: 'rgba(15,23,42,0.08)',
      border: '1px solid rgba(15,23,42,0.2)',
      color: '#0f172a'
    } : theme === 'dark' ? {
      background: 'rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: '#f1f5f9'
    } : {
      background: 'rgba(118,75,162,0.45)',
      border: '1px solid rgba(255,255,255,0.5)',
      color: 'white'
    }),
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease'
  })

  // Command chat control button style
  const chatControlButtonStyle = () => ({
    ...(theme === 'professional' ? {
      background: 'rgba(15,23,42,0.08)',
      border: '1px solid rgba(15,23,42,0.2)',
      color: '#0f172a'
    } : theme === 'dark' ? {
      background: 'rgba(255,255,255,0.1)',
      border: '1px solid rgba(255,255,255,0.2)',
      color: '#f1f5f9'
    } : {
      background: 'rgba(118,75,162,0.35)',
      border: '1px solid rgba(255,255,255,0.45)',
      color: 'white'
    })
  })

  // WR button style (for WR Login and Vault)
  const wrButtonStyle = () => ({
    width: '100%',
    padding: '12px 18px',
    ...(theme === 'professional' ? {
      background: 'rgba(15,23,42,0.08)',
      border: '1px solid rgba(15,23,42,0.2)',
      color: '#0f172a'
    } : theme === 'dark' ? {
      background: 'rgba(255,255,255,0.15)',
      border: '1px solid rgba(255,255,255,0.3)',
      color: '#f1f5f9'
    } : {
      background: 'rgba(118,75,162,0.35)',
      border: '1px solid rgba(255,255,255,0.45)',
      color: 'white'
    }),
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s ease'
  })

  const addMiniApp = () => {
    console.log('🎯 Opening Add Mini App dialog...')
    // TODO: Implement mini-app installation dialog
    showNotification('Mini-app installation coming soon!', 'info')
  }

  // Minimal UI for display grids and Edge startpage
  if (showMinimalUI) {
    return (
      <div style={{
        width: '100%',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        background: themeColors.background,
        color: themeColors.text,
        padding: '0',
        margin: '0',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden'
      }}>
        {/* Top Bar: 2 Small Icons + Toggle */}
        <div style={{ 
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          background: theme === 'default' ? 'rgba(118,75,162,0.6)' : 'rgba(0,0,0,0.15)'
        }}>
          <button
            onClick={openPopupChat}
            style={{
              width: '32px',
              height: '32px',
              ...actionButtonStyle('rgba(255,255,255,0.1)'),
              fontSize: '14px',
              padding: 0
            }}
            title="Open Popup Chat"
          >
            💬
          </button>
          <button
            onClick={toggleCommandChatPin}
            style={{
              width: '32px',
              height: '32px',
              ...actionButtonStyle(isCommandChatPinned ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.1)'),
              fontSize: '14px',
              padding: 0,
              ...(isCommandChatPinned && theme === 'default' ? {
                background: 'rgba(76,175,80,0.4)',
                border: '1px solid rgba(76,175,80,0.6)'
              } : {})
            }}
            title={isCommandChatPinned ? "Unpin Command Chat" : "Pin Command Chat"}
          >
            📌
          </button>
          <div
            onClick={toggleViewMode}
            style={{
              cursor: isAdminDisabled ? 'not-allowed' : 'pointer',
              opacity: isAdminDisabled ? 0.6 : 1,
              marginLeft: 'auto'
            }}
            title={isAdminDisabled ? 'Open a website for viewing the admin panel' : `Switch to ${viewMode === 'app' ? 'Admin' : 'App'} view`}
          >
            <div style={{
              position: 'relative',
              width: '50px',
              height: '20px',
              background: viewMode === 'app'
                ? (theme === 'default' ? 'rgba(76,175,80,0.9)' : theme === 'dark' ? 'rgba(76,175,80,0.9)' : 'rgba(34,197,94,0.9)')
                : (theme === 'default' ? 'rgba(255,255,255,0.2)' : theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)'),
              borderRadius: '10px',
              transition: 'background 0.2s',
              border: theme === 'default' ? '1px solid rgba(255,255,255,0.3)' : theme === 'dark' ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(15,23,42,0.3)',
              overflow: 'hidden'
            }}>
              <span style={{
                position: 'absolute',
                left: viewMode === 'app' ? '8px' : 'auto',
                right: viewMode === 'app' ? 'auto' : '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '9px',
                fontWeight: '700',
                color: viewMode === 'app'
                  ? 'rgba(255,255,255,0.95)'
                  : (theme === 'default' ? 'rgba(255,255,255,0.5)' : theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.5)'),
                transition: 'all 0.2s',
                userSelect: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                zIndex: 1,
                whiteSpace: 'nowrap',
                lineHeight: '1'
              }}>App</span>
              <div style={{
                position: 'absolute',
                top: '3px',
                left: viewMode === 'app' ? '32px' : '3px',
                width: '14px',
                height: '14px',
                background: theme === 'default' ? 'rgba(255,255,255,0.95)' : theme === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.95)',
                borderRadius: '50%',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                zIndex: 2
              }} />
            </div>
          </div>
        </div>
        
        {/* Docked Command Chat - Full Featured (Only when pinned) */}
        {isCommandChatPinned && (
          <>
            <div 
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.2)',
                background: theme === 'default' ? 'rgba(118,75,162,0.4)' : 'rgba(255,255,255,0.10)',
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
                background: themeColors.background,
                borderBottom: '1px solid rgba(255,255,255,0.20)',
                color: themeColors.text
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
                        ...chatControlButtonStyle(),
                        borderRadius: '6px',
                        padding: '0 10px',
                        fontSize: '14px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        if (theme === 'professional') {
                          e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'professional') {
                          e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      🪣
                    </button>
                    <button 
                      onClick={handleScreenSelect}
                      title="LmGTFY - Capture a screen area as screenshot or stream"
                      style={{
                        ...chatControlButtonStyle(),
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
                      onMouseEnter={(e) => {
                        if (theme === 'professional') {
                          e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'professional') {
                          e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      ✎
                    </button>
                    <div style={{ position: 'relative' }}>
                      <button 
                        onClick={() => setShowTagsMenu(!showTagsMenu)}
                        title="Tags - Quick access to saved triggers"
                        style={{
                          ...chatControlButtonStyle(),
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
                        onMouseEnter={(e) => {
                          if (theme === 'professional') {
                            e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                          } else if (theme === 'dark') {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                          } else {
                            e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (theme === 'professional') {
                            e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                          } else if (theme === 'dark') {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                          } else {
                            e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                          }
                        }}
                      >
                        Tags <span style={{ fontSize: '11px', opacity: 0.9 }}>▾</span>
                      </button>
                      
                      {/* Tags Dropdown Menu */}
                      {showTagsMenu && (
                        <div 
                          style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            minWidth: '180px',
                            width: '240px',
                            maxHeight: '300px',
                            overflowY: 'auto',
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
                      ...chatControlButtonStyle(),
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
                id="ccd-messages-sidepanel"
                ref={chatRef}
                style={{
                  height: `${chatHeight}px`,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  background: theme === 'default' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)',
                  borderBottom: '1px solid rgba(255,255,255,0.20)',
                  padding: '14px'
                }}
              >
                {chatMessages.length === 0 ? (
                  <div style={{ fontSize: '13px', opacity: 0.6, textAlign: 'center', padding: '32px 20px' }}>
                    Start a conversation...
                  </div>
                ) : (
                  chatMessages.map((msg: any, i) => (
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
                        {msg.imageUrl ? (
                          <img 
                            src={msg.imageUrl} 
                            alt="Screenshot" 
                            style={{ 
                              maxWidth: '260px', 
                              height: 'auto', 
                              borderRadius: '8px',
                              display: 'block'
                            }} 
                          />
                        ) : (
                          msg.text
                        )}
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
              <div 
                id="ccd-compose-sidepanel"
                style={{
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

            {/* Trigger Creation UI */}
            {showTriggerPrompt && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.08)',
                borderTop: '1px solid rgba(255,255,255,0.20)'
              }}>
                <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: '700', opacity: 0.85 }}>
                  {showTriggerPrompt.mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream'}
                </div>
                {showTriggerPrompt.createTrigger && (
                  <input
                    type="text"
                    placeholder="Trigger Name"
                    value={showTriggerPrompt.name || ''}
                    onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, name: e.target.value })}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '8px'
                    }}
                  />
                )}
                {showTriggerPrompt.addCommand && (
                  <textarea
                    placeholder="Optional Command"
                    value={showTriggerPrompt.command || ''}
                    onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, command: e.target.value })}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      minHeight: '60px',
                      marginBottom: '8px',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }}
                  />
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowTriggerPrompt(null)}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: 'white',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const name = showTriggerPrompt.name?.trim() || ''
                      const command = showTriggerPrompt.command?.trim() || ''
                      
                      // If createTrigger is checked, save the trigger
                      if (showTriggerPrompt.createTrigger) {
                        if (!name) {
                          alert('Please enter a trigger name')
                          return
                        }
                        
                        const triggerData = {
                          name,
                          command,
                          at: Date.now(),
                          rect: showTriggerPrompt.rect,
                          bounds: showTriggerPrompt.bounds,
                          mode: showTriggerPrompt.mode
                        }
                        
                        // Save to chrome.storage for dropdown
                        chrome.storage.local.get(['optimando-tagged-triggers'], (result) => {
                          const triggers = result['optimando-tagged-triggers'] || []
                          triggers.push(triggerData)
                          chrome.storage.local.set({ 'optimando-tagged-triggers': triggers }, () => {
                            console.log('✅ Trigger saved to storage:', triggerData)
                            setTriggers(triggers)
                            // Notify other contexts
                            try { chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) } catch {}
                          })
                        })
                        
                        // Send trigger to Electron
                        try {
                          chrome.runtime?.sendMessage({
                            type: 'ELECTRON_SAVE_TRIGGER',
                            name,
                            mode: showTriggerPrompt.mode,
                            rect: showTriggerPrompt.rect,
                            displayId: 0, // Main display for sidepanel
                            imageUrl: showTriggerPrompt.imageUrl,
                            videoUrl: showTriggerPrompt.videoUrl,
                            command: command || undefined
                          })
                        } catch (err) {
                          console.error('Error sending trigger to Electron:', err)
                        }
                      }
                      
                      // Post the screenshot to chat
                      if (showTriggerPrompt.imageUrl) {
                        const imageMessage = {
                          role: 'user' as const,
                          text: `![Screenshot](${showTriggerPrompt.imageUrl})`,
                          imageUrl: showTriggerPrompt.imageUrl
                        }
                        setChatMessages(prev => [...prev, imageMessage])
                        // Scroll to bottom
                        setTimeout(() => {
                          if (chatRef.current) {
                            chatRef.current.scrollTop = chatRef.current.scrollHeight
                          }
                        }, 100)
                      }
                      
                      // If addCommand is checked and command exists, add it to chat
                      if (showTriggerPrompt.addCommand && command) {
                        const commandMessage = {
                          role: 'user' as const,
                          text: `📝 Command: ${command}`
                        }
                        setChatMessages(prev => [...prev, commandMessage])
                      }
                      
                      // Clear the prompt
                      setShowTriggerPrompt(null)
                      // Reset checkboxes
                      setCreateTriggerChecked(false)
                      setAddCommandChecked(false)
                    }}
                    style={{
                      padding: '6px 12px',
                      background: '#22c55e',
                      border: '1px solid #16a34a',
                      color: '#0b1e12',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '700'
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
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
                background: 'linear-gradient(135deg,#c084fc 0%,#a855f7 50%,#9333ea 100%)',
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
        
        {/* Add Mini App Button */}
        <div style={{
          flex: 1,
          padding: '40px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <button
            onClick={addMiniApp}
            style={{
              width: '100%',
              maxWidth: '300px',
              padding: '20px 24px',
              ...(theme === 'professional' ? {
                background: 'rgba(15,23,42,0.08)',
                border: '2px dashed rgba(15,23,42,0.3)',
                color: '#0f172a'
              } : theme === 'dark' ? {
                background: 'rgba(255,255,255,0.1)',
                border: '2px dashed rgba(255,255,255,0.3)',
                color: '#f1f5f9'
              } : {
                background: 'rgba(118,75,162,0.3)',
                border: '2px dashed rgba(255,255,255,0.5)',
                color: 'white'
              }),
              borderRadius: '12px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.2s ease',
              boxShadow: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              if (theme === 'professional') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                e.currentTarget.style.borderColor = 'rgba(15,23,42,0.4)'
              } else if (theme === 'dark') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.55)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.7)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              if (theme === 'professional') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                e.currentTarget.style.borderColor = 'rgba(15,23,42,0.3)'
              } else if (theme === 'dark') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.3)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'
              }
            }}
          >
            ➕ Add Mini App
          </button>
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

  // Mini App View (simplified)
  if (viewMode === 'app') {
    return (
      <div style={{
        width: '100%',
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        background: themeColors.background,
        color: themeColors.text,
        padding: '0',
        margin: '0',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden'
      }}>
        {/* Top Bar: Icons + Toggle */}
        <div style={{ 
          padding: '8px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          background: theme === 'default' ? 'rgba(118,75,162,0.6)' : 'rgba(0,0,0,0.15)'
        }}>
          <button
            onClick={openPopupChat}
            style={{
              width: '32px',
              height: '32px',
              ...actionButtonStyle('rgba(255,255,255,0.1)'),
              fontSize: '14px',
              padding: 0
            }}
            title="Open Popup Chat"
          >
            💬
          </button>
          <button
            onClick={toggleCommandChatPin}
            style={{
              width: '32px',
              height: '32px',
              ...actionButtonStyle(isCommandChatPinned ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.1)'),
              fontSize: '14px',
              padding: 0,
              ...(isCommandChatPinned && theme === 'default' ? {
                background: 'rgba(76,175,80,0.4)',
                border: '1px solid rgba(76,175,80,0.6)'
              } : {})
            }}
            title={isCommandChatPinned ? "Unpin Command Chat" : "Pin Command Chat"}
          >
            📌
          </button>
          <div
            onClick={toggleViewMode}
            style={{
              cursor: 'pointer',
              marginLeft: 'auto'
            }}
            title={`Switch to Admin view`}
          >
            <div style={{
              position: 'relative',
              width: '50px',
              height: '20px',
              background: viewMode === 'app'
                ? (theme === 'default' ? 'rgba(76,175,80,0.9)' : theme === 'dark' ? 'rgba(76,175,80,0.9)' : 'rgba(34,197,94,0.9)')
                : (theme === 'default' ? 'rgba(255,255,255,0.2)' : theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)'),
              borderRadius: '10px',
              transition: 'background 0.2s',
              border: theme === 'default' ? '1px solid rgba(255,255,255,0.3)' : theme === 'dark' ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(15,23,42,0.3)',
              overflow: 'hidden'
            }}>
              <span style={{
                position: 'absolute',
                left: viewMode === 'app' ? '8px' : 'auto',
                right: viewMode === 'app' ? 'auto' : '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '9px',
                fontWeight: '700',
                color: viewMode === 'app'
                  ? 'rgba(255,255,255,0.95)'
                  : (theme === 'default' ? 'rgba(255,255,255,0.5)' : theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.5)'),
                transition: 'all 0.2s',
                userSelect: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                zIndex: 1,
                whiteSpace: 'nowrap',
                lineHeight: '1'
              }}>App</span>
              <div style={{
                position: 'absolute',
                top: '3px',
                left: viewMode === 'app' ? '32px' : '3px',
                width: '14px',
                height: '14px',
                background: theme === 'default' ? 'rgba(255,255,255,0.95)' : theme === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.95)',
                borderRadius: '50%',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                zIndex: 2
              }} />
            </div>
          </div>
        </div>
        
      {/* Docked Command Chat - Full Featured (Only when pinned) */}
      {isCommandChatPinned && (
        <>
          <div 
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.2)',
              background: theme === 'default' ? 'rgba(118,75,162,0.4)' : 'rgba(255,255,255,0.10)',
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
              background: themeColors.background,
              borderBottom: '1px solid rgba(255,255,255,0.20)',
              color: themeColors.text
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
                      ...chatControlButtonStyle(),
                      borderRadius: '6px',
                      padding: '0 10px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (theme === 'professional') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (theme === 'professional') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                      }
                    }}
                  >
                    🪣
                  </button>
                  <button 
                    onClick={handleScreenSelect}
                    title="LmGTFY - Capture a screen area as screenshot or stream"
                    style={{
                      ...chatControlButtonStyle(),
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
                    onMouseEnter={(e) => {
                      if (theme === 'professional') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (theme === 'professional') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                      }
                    }}
                  >
                    ✎
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button 
                      onClick={() => setShowTagsMenu(!showTagsMenu)}
                      title="Tags - Quick access to saved triggers"
                      style={{
                        ...chatControlButtonStyle(),
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
                      onMouseEnter={(e) => {
                        if (theme === 'professional') {
                          e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'professional') {
                          e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      Tags <span style={{ fontSize: '11px', opacity: 0.9 }}>▾</span>
                    </button>
                    
                    {/* Tags Dropdown Menu */}
                    {showTagsMenu && (
                      <div 
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          minWidth: '180px',
                          width: '240px',
                          maxHeight: '300px',
                          overflowY: 'auto',
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
                    ...chatControlButtonStyle(),
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
              id="ccd-messages-sidepanel"
              ref={chatRef}
              style={{
                height: `${chatHeight}px`,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                background: theme === 'default' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)',
                borderBottom: '1px solid rgba(255,255,255,0.20)',
                padding: '14px'
              }}
            >
              {chatMessages.length === 0 ? (
                <div style={{ fontSize: '13px', opacity: 0.6, textAlign: 'center', padding: '32px 20px' }}>
                  Start a conversation...
                </div>
              ) : (
                chatMessages.map((msg: any, i) => (
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
                      {msg.imageUrl ? (
                        <img 
                          src={msg.imageUrl} 
                          alt="Screenshot" 
                          style={{ 
                            maxWidth: '260px', 
                            height: 'auto', 
                            borderRadius: '8px',
                            display: 'block'
                          }} 
                        />
                      ) : (
                        msg.text
                      )}
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
            <div 
              id="ccd-compose-sidepanel"
              style={{
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
        </>
      )}
      
      {/* Add Mini App Button - Always visible */}
      <div style={{
        flex: 1,
        padding: '40px 20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <button
            onClick={addMiniApp}
            style={{
              width: '100%',
              maxWidth: '300px',
              padding: '20px 24px',
              ...(theme === 'professional' ? {
                background: 'rgba(15,23,42,0.08)',
                border: '2px dashed rgba(15,23,42,0.3)',
                color: '#0f172a'
              } : theme === 'dark' ? {
                background: 'rgba(255,255,255,0.1)',
                border: '2px dashed rgba(255,255,255,0.3)',
                color: '#f1f5f9'
              } : {
                background: 'rgba(118,75,162,0.3)',
                border: '2px dashed rgba(255,255,255,0.5)',
                color: 'white'
              }),
              borderRadius: '12px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '700',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.2s ease',
              boxShadow: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              if (theme === 'professional') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                e.currentTarget.style.borderColor = 'rgba(15,23,42,0.4)'
              } else if (theme === 'dark') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.55)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.7)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              if (theme === 'professional') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                e.currentTarget.style.borderColor = 'rgba(15,23,42,0.3)'
              } else if (theme === 'dark') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.3)'
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'
              }
            }}
          >
            ➕ Add Mini App
          </button>
        </div>
      </div>
    )
  }

  // Full Admin/Control Panel UI for master tabs
  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      background: themeColors.background,
      color: themeColors.text,
      padding: '0',
      margin: '0',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      overflowX: 'hidden'
    }}>
      {/* Session Controls at the very top - Two Rows */}
      <div style={{ 
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.2)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        background: theme === 'default' ? 'rgba(118,75,162,0.6)' : 'rgba(0,0,0,0.15)'
      }}>
        {/* Row 1: Session Name + 4 Action Icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={openReasoningLightbox}
          style={{
              ...actionButtonStyle('rgba(156, 39, 176, 0.8)'),
            fontSize: '14px',
            padding: 0
          }}
          title="Reasoning & Session Goals"
        >
          🧠
        </button>
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '3px'
        }}>
          <input
            type="text"
            value={sessionName}
            readOnly
            placeholder="Session Name"
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: themeColors.text,
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'default',
              outline: 'none'
            }}
          />
          {sessionKey && (
            <div style={{
              padding: '2px 12px',
              fontSize: '10px',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              color: 'rgba(255,255,255,0.5)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '0.3px'
            }}>
              <span style={{ 
                color: 'rgba(255,255,255,0.4)',
                marginRight: '4px'
              }}>ID:</span>
              <span style={{ 
                color: 'rgba(255,215,0,0.7)',
                fontWeight: '400'
              }}>{sessionKey}</span>
            </div>
          )}
        </div>
        <button
          onClick={createNewSession}
          style={{
              ...actionButtonStyle('#4CAF50'),
            fontSize: '18px',
              fontWeight: 'bold'
            }}
          title="New Session"
        >
          +
        </button>
        <button
          onClick={() => {
            console.log('📤 Export session...')
            sendToContentScript('EXPORT_SESSION')
          }}
          style={{
              ...actionButtonStyle('rgba(76, 175, 80, 0.8)'),
              fontSize: '14px'
            }}
          title="Export Session (JSON/YAML/MD)"
        >
          💾
        </button>
          <button
            onClick={openPopupChat}
            style={{
              ...actionButtonStyle('rgba(255,255,255,0.1)'),
              fontSize: '14px'
            }}
            title="Open Popup Chat"
          >
            💬
          </button>
          <button
            onClick={toggleCommandChatPin}
            style={{
              ...actionButtonStyle(isCommandChatPinned ? 'rgba(76,175,80,0.4)' : 'rgba(255,255,255,0.1)'),
              fontSize: '14px',
              ...(isCommandChatPinned && theme === 'default' ? {
                background: 'rgba(76,175,80,0.4)',
                border: '1px solid rgba(76,175,80,0.6)'
              } : {})
            }}
            title={isCommandChatPinned ? "Unpin Command Chat" : "Pin Command Chat"}
          >
            📌
        </button>
      </div>

        {/* Row 2: ADMIN/Master Tab Label + 4 Admin Icons (matching width) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{
            fontSize: masterTabId ? '9px' : '11px', 
            fontWeight: '700', 
            opacity: 0.85, 
            textTransform: 'uppercase', 
            letterSpacing: masterTabId ? '0.4px' : '0.5px',
            width: masterTabId ? '65px' : '32px',
            textAlign: 'center',
            lineHeight: masterTabId ? '1.1' : 'normal',
            whiteSpace: masterTabId ? 'normal' : 'nowrap'
          }}>
            {masterTabId && masterTabId !== "01" ? `Master Tab (${masterTabId})` : 'ADMIN'}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={openUnifiedAdmin} title="Admin Configuration (Agents, Context, Memory)" style={adminIconStyle}>⚙️</button>
          <button onClick={openAddView} title="Add View" style={adminIconStyle}>⊞</button>
          <button onClick={openSessions} title="Sessions" style={adminIconStyle}>📚</button>
          <button onClick={openSettings} title="Settings" style={adminIconStyle}>🔧</button>
        </div>
      </div>

      {/* WR Login / Backend Switcher Section */}
      <BackendSwitcherInline theme={theme} />

      {/* Docked Command Chat - Full Featured (Only when pinned) */}
      {isCommandChatPinned && (
        <>
          <div 
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.2)',
              background: theme === 'default' ? 'rgba(118,75,162,0.4)' : 'rgba(255,255,255,0.10)',
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
              background: themeColors.background,
              borderBottom: '1px solid rgba(255,255,255,0.20)',
              color: themeColors.text
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
                      ...chatControlButtonStyle(),
                      borderRadius: '6px',
                      padding: '0 10px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (theme === 'professional') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (theme === 'professional') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                      }
                    }}
                  >
                    🪣
                  </button>
                  <button 
                    onClick={handleScreenSelect}
                    title="LmGTFY - Capture a screen area as screenshot or stream"
                    style={{
                      ...chatControlButtonStyle(),
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
                    onMouseEnter={(e) => {
                      if (theme === 'professional') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (theme === 'professional') {
                        e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                      } else if (theme === 'dark') {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
                      } else {
                        e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                      }
                    }}
                  >
                    ✎
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button 
                      onClick={() => setShowTagsMenu(!showTagsMenu)}
                      title="Tags - Quick access to saved triggers"
                      style={{
                        ...chatControlButtonStyle(),
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
                      onMouseEnter={(e) => {
                        if (theme === 'professional') {
                          e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.6)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (theme === 'professional') {
                          e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
                        } else if (theme === 'dark') {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
                        } else {
                          e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
                        }
                      }}
                    >
                      Tags <span style={{ fontSize: '11px', opacity: 0.9 }}>▾</span>
                    </button>
                    
                    {/* Tags Dropdown Menu */}
                    {showTagsMenu && (
                      <div 
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          minWidth: '180px',
                          width: '240px',
                          maxHeight: '300px',
                          overflowY: 'auto',
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
                    ...chatControlButtonStyle(),
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
              id="ccd-messages-sidepanel"
              ref={chatRef}
              style={{
                height: `${chatHeight}px`,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                background: theme === 'default' ? 'rgba(118,75,162,0.25)' : 'rgba(255,255,255,0.06)',
                borderBottom: '1px solid rgba(255,255,255,0.20)',
                padding: '14px'
              }}
            >
              {chatMessages.length === 0 ? (
                <div style={{ fontSize: '13px', opacity: 0.6, textAlign: 'center', padding: '32px 20px' }}>
                  Start a conversation...
                </div>
              ) : (
                chatMessages.map((msg: any, i) => (
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
                      {msg.imageUrl ? (
                        <img 
                          src={msg.imageUrl} 
                          alt="Screenshot" 
                          style={{ 
                            maxWidth: '260px', 
                            height: 'auto', 
                            borderRadius: '8px',
                            display: 'block'
                          }} 
                        />
                      ) : (
                        msg.text
                      )}
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
            <div 
              id="ccd-compose-sidepanel"
              style={{
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

            {/* Trigger Creation UI */}
            {showTriggerPrompt && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(255,255,255,0.08)',
                borderTop: '1px solid rgba(255,255,255,0.20)'
              }}>
                <div style={{ marginBottom: '8px', fontSize: '12px', fontWeight: '700', opacity: 0.85 }}>
                  {showTriggerPrompt.mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream'}
                </div>
                {showTriggerPrompt.createTrigger && (
                  <input
                    type="text"
                    placeholder="Trigger Name"
                    value={showTriggerPrompt.name || ''}
                    onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, name: e.target.value })}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '8px'
                    }}
                  />
                )}
                {showTriggerPrompt.addCommand && (
                  <textarea
                    placeholder="Optional Command"
                    value={showTriggerPrompt.command || ''}
                    onChange={(e) => setShowTriggerPrompt({ ...showTriggerPrompt, command: e.target.value })}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.20)',
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      minHeight: '60px',
                      marginBottom: '8px',
                      resize: 'vertical',
                      fontFamily: 'inherit'
                    }}
                  />
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowTriggerPrompt(null)}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255,255,255,0.15)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      color: 'white',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const name = showTriggerPrompt.name?.trim() || ''
                      const command = showTriggerPrompt.command?.trim() || ''
                      
                      // If createTrigger is checked, save the trigger
                      if (showTriggerPrompt.createTrigger) {
                        if (!name) {
                          alert('Please enter a trigger name')
                          return
                        }
                        
                        const triggerData = {
                          name,
                          command,
                          at: Date.now(),
                          rect: showTriggerPrompt.rect,
                          bounds: showTriggerPrompt.bounds,
                          mode: showTriggerPrompt.mode
                        }
                        
                        // Save to chrome.storage for dropdown
                        chrome.storage.local.get(['optimando-tagged-triggers'], (result) => {
                          const triggers = result['optimando-tagged-triggers'] || []
                          triggers.push(triggerData)
                          chrome.storage.local.set({ 'optimando-tagged-triggers': triggers }, () => {
                            console.log('✅ Trigger saved to storage:', triggerData)
                            setTriggers(triggers)
                            // Notify other contexts
                            try { chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) } catch {}
                          })
                        })
                        
                        // Send trigger to Electron
                        try {
                          chrome.runtime?.sendMessage({
                            type: 'ELECTRON_SAVE_TRIGGER',
                            name,
                            mode: showTriggerPrompt.mode,
                            rect: showTriggerPrompt.rect,
                            displayId: 0, // Main display for sidepanel
                            imageUrl: showTriggerPrompt.imageUrl,
                            videoUrl: showTriggerPrompt.videoUrl,
                            command: command || undefined
                          })
                        } catch (err) {
                          console.error('Error sending trigger to Electron:', err)
                        }
                      }
                      
                      // Post the screenshot to chat
                      if (showTriggerPrompt.imageUrl) {
                        const imageMessage = {
                          role: 'user' as const,
                          text: `![Screenshot](${showTriggerPrompt.imageUrl})`,
                          imageUrl: showTriggerPrompt.imageUrl
                        }
                        setChatMessages(prev => [...prev, imageMessage])
                        // Scroll to bottom
                        setTimeout(() => {
                          if (chatRef.current) {
                            chatRef.current.scrollTop = chatRef.current.scrollHeight
                          }
                        }, 100)
                      }
                      
                      // If addCommand is checked and command exists, add it to chat
                      if (showTriggerPrompt.addCommand && command) {
                        const commandMessage = {
                          role: 'user' as const,
                          text: `📝 Command: ${command}`
                        }
                        setChatMessages(prev => [...prev, commandMessage])
                      }
                      
                      // Clear the prompt
                      setShowTriggerPrompt(null)
                      // Reset checkboxes
                      setCreateTriggerChecked(false)
                      setAddCommandChecked(false)
                    }}
                    style={{
                      padding: '6px 12px',
                      background: '#22c55e',
                      border: '1px solid #16a34a',
                      color: '#0b1e12',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '700'
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
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
                background: 'linear-gradient(135deg,#c084fc 0%,#a855f7 50%,#9333ea 100%)',
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
      
      {/* Master Tab Title */}
      {masterTabId && masterTabId !== "01" && (
        <div style={{
          background: 'rgba(118,75,162,0.25)',
          borderRadius: '10px',
          padding: '16px 20px',
          marginBottom: '20px',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '16px',
            fontWeight: '700',
            letterSpacing: '0.5px',
            opacity: 0.95
          }}>
            🖥️ Master Tab ({masterTabId})
          </div>
        </div>
      )}
      
      {/* Agent Boxes Display */}
      {agentBoxes.filter(box => {
        // Filter out display grid boxes (same logic as content script)
        const isDisplayGrid = box.source === 'display_grid' || box.gridSessionId
        if (isDisplayGrid) return false
        
        // Filter by master tab ID - only show boxes created on this tab
        const boxMasterTabId = box.masterTabId || "01"  // Default to "01" for legacy boxes
        const currentMasterTabId = masterTabId || "01"  // Current tab's ID
        return boxMasterTabId === currentMasterTabId
      }).length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          {agentBoxes.filter(box => {
            // Filter out display grid boxes (same logic as content script)
            const isDisplayGrid = box.source === 'display_grid' || box.gridSessionId
            if (isDisplayGrid) return false
            
            // Filter by master tab ID - only show boxes created on this tab
            const boxMasterTabId = box.masterTabId || "01"  // Default to "01" for legacy boxes
            const currentMasterTabId = masterTabId || "01"  // Current tab's ID
            return boxMasterTabId === currentMasterTabId
          }).map(box => {
            const currentHeight = agentBoxHeights[box.id] || 120
            const isEnabled = box.enabled !== false // Default to true
            return (
              <div key={box.id} style={{
                background: 'rgba(255,255,255,0.12)',
                borderRadius: '10px',
                overflow: 'hidden',
                marginBottom: '16px',
                border: '1px solid rgba(255,255,255,0.15)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                opacity: isEnabled ? 1 : 0.6
              }}>
      <div style={{ 
                  background: box.color || '#4CAF50',
                  padding: '4px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <span style={{ fontSize: '12px', fontWeight: '700', opacity: isEnabled ? 1 : 0.5 }}>{box.title || 'Agent Box'}</span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <label
                      style={{
                        position: 'relative',
                        display: 'inline-block',
                        width: '36px',
                        height: '20px',
                        cursor: 'pointer'
                      }}
                      title={isEnabled ? 'Click to disable this agent' : 'Click to enable this agent'}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        // Simply toggle the visual state
                        const updatedBoxes = agentBoxes.map(b => 
                          b.id === box.id ? { ...b, enabled: !isEnabled } : b
                        )
                        setAgentBoxes(updatedBoxes)
                      }}
                    >
                      <input type="checkbox" checked={isEnabled} readOnly style={{ opacity: 0, width: 0, height: 0 }} />
                      <span style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: isEnabled ? '#4CAF50' : '#ccc',
                        borderRadius: '20px',
                        transition: '0.3s'
                      }}></span>
                      <span style={{
                        position: 'absolute',
                        height: '14px',
                        width: '14px',
                        left: isEnabled ? '19px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        transition: '0.3s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                      }}></span>
                    </label>
                    <button
                      onClick={() => editAgentBox(box.id)}
                      style={{
                        background: 'rgba(255,255,255,0.2)',
                        border: 'none',
                        color: 'white',
                        minWidth: '20px',
                        height: '20px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '11px',
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
                        minWidth: '20px',
                        height: '20px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '12px',
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
                    background: theme === 'dark' ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.96)',
                    color: theme === 'dark' ? '#f1f5f9' : '#1e293b',
                    borderRadius: '0 0 10px 10px',
                    padding: '16px',
                    minHeight: `${currentHeight}px`,
                    height: `${currentHeight}px`,
                    border: theme === 'dark' ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                    position: 'relative',
                    overflow: 'auto',
                    opacity: isEnabled ? 1 : 0.5,
                    pointerEvents: isEnabled ? 'auto' : 'none'
                  }}
                >
                  <div style={{ fontSize: '13px', color: theme === 'dark' ? '#f1f5f9' : '#1e293b', lineHeight: '1.6' }}>
                    {isEnabled ? (
                      box.output || <span style={{ opacity: 0.5, color: theme === 'dark' ? '#94a3b8' : '#64748b' }}>Ready for {box.title?.replace(/[📝🔍🎯🧮]/g, '').trim()}...</span>
                    ) : (
                      <span style={{ opacity: 0.7, color: theme === 'dark' ? '#94a3b8' : '#64748b', fontStyle: 'italic' }}>Agent disabled - toggle On to activate</span>
                    )}
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
          ...(theme === 'professional' ? {
            background: 'rgba(15,23,42,0.08)',
            border: '2px dashed rgba(15,23,42,0.3)',
            color: '#0f172a'
          } : theme === 'dark' ? {
            background: 'rgba(255,255,255,0.1)',
            border: '2px dashed rgba(255,255,255,0.3)',
            color: '#f1f5f9'
          } : {
            background: 'rgba(118,75,162,0.3)',
            border: '2px dashed rgba(255,255,255,0.5)',
            color: 'white'
          }),
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
          boxShadow: 'none'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          if (theme === 'professional') {
            e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
            e.currentTarget.style.borderColor = 'rgba(15,23,42,0.4)'
          } else if (theme === 'dark') {
            e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)'
          } else {
            e.currentTarget.style.background = 'rgba(118,75,162,0.55)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.7)'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          if (theme === 'professional') {
            e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
            e.currentTarget.style.borderColor = 'rgba(15,23,42,0.3)'
          } else if (theme === 'dark') {
            e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'
          } else {
            e.currentTarget.style.background = 'rgba(118,75,162,0.3)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)'
          }
        }}
      >
        ➕ Add New Agent Box
      </button>

      {/* Quick Actions Section */}
      <div style={{
        background: theme === 'default' ? 'rgba(118,75,162,0.5)' : 'rgba(255,255,255,0.12)',
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
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px',
          alignItems: 'center'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            ⚡ Quick Actions
          </span>
          <div
            onClick={toggleViewMode}
            style={{
              cursor: isAdminDisabled ? 'not-allowed' : 'pointer',
              opacity: isAdminDisabled ? 0.6 : 1,
              display: 'flex',
              justifyContent: 'flex-end',
              paddingRight: '5px'
            }}
            title={isAdminDisabled ? 'Open a website for viewing the admin panel' : `Switch to ${viewMode === 'app' ? 'Admin' : 'App'} view`}
          >
            <div style={{
              position: 'relative',
              width: '50px',
              height: '20px',
              background: viewMode === 'app'
                ? (theme === 'default' ? 'rgba(76,175,80,0.9)' : theme === 'dark' ? 'rgba(76,175,80,0.9)' : 'rgba(34,197,94,0.9)')
                : (theme === 'default' ? 'rgba(255,255,255,0.2)' : theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)'),
              borderRadius: '10px',
              transition: 'background 0.2s',
              border: theme === 'default' ? '1px solid rgba(255,255,255,0.3)' : theme === 'dark' ? '1px solid rgba(255,255,255,0.3)' : '1px solid rgba(15,23,42,0.3)',
              overflow: 'hidden'
            }}>
              <span style={{
                position: 'absolute',
                left: viewMode === 'app' ? '8px' : 'auto',
                right: viewMode === 'app' ? 'auto' : '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: '9px',
                fontWeight: '700',
                color: viewMode === 'app'
                  ? 'rgba(255,255,255,0.95)'
                  : (theme === 'default' ? 'rgba(255,255,255,0.5)' : theme === 'dark' ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.5)'),
                transition: 'all 0.2s',
                userSelect: 'none',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                zIndex: 1,
                whiteSpace: 'nowrap',
                lineHeight: '1'
              }}>App</span>
              <div style={{
                position: 'absolute',
                top: '3px',
                left: viewMode === 'app' ? '32px' : '3px',
                width: '14px',
                height: '14px',
                background: theme === 'default' ? 'rgba(255,255,255,0.95)' : theme === 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.95)',
                borderRadius: '50%',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                zIndex: 2
              }} />
            </div>
          </div>
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
              ...(theme === 'professional' ? {
                background: 'rgba(15,23,42,0.08)',
                border: '1px solid rgba(15,23,42,0.2)',
                color: '#0f172a'
              } : theme === 'dark' ? {
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)',
                color: '#f1f5f9'
              } : {
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: 'white'
              }),
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
              if (theme === 'professional') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.12)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.2)'
              } else if (theme === 'dark') {
              e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(255,255,255,0.2)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.5)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(118,75,162,0.3)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              if (theme === 'professional') {
                e.currentTarget.style.background = 'rgba(15,23,42,0.08)'
              } else if (theme === 'dark') {
              e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
              } else {
                e.currentTarget.style.background = 'rgba(118,75,162,0.35)'
              }
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'
            }}
          >
            🔒 WRVault
          </button>
        </div>
      </div>

      {/* Backend Switcher Section */}
      <BackendSwitcher theme={theme} />

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
    </div>
  )
}

// Render the sidepanel
const container = document.getElementById('sidepanel-root')
if (container) {
  const root = createRoot(container)
  root.render(<SidepanelOrchestrator />)
}
