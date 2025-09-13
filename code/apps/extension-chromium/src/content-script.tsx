/// <reference types="chrome-types"/>

// Per-Tab Activation System
let isExtensionActive = false
const tabUrl = window.location.href
const extensionStateKey = `optimando-active-${btoa(tabUrl).substring(0, 20)}`

// Persist per-tab state across navigations using window.name
const OPTI_MARKER_START = '<<OPTIMANDO_STATE:'
const OPTI_MARKER_END = '>>'
type DedicatedRole = { type: 'master' } | { type: 'hybrid', hybridMasterId?: string }
type OptimandoTabState = { role?: DedicatedRole, sessionKey?: string }
function readOptimandoState(): OptimandoTabState {
  try {
    const name = window.name || ''
    const s = name.indexOf(OPTI_MARKER_START)
    const e = name.indexOf(OPTI_MARKER_END)
    if (s !== -1 && e !== -1 && e > s) {
      return JSON.parse(name.substring(s + OPTI_MARKER_START.length, e) || '{}')
    }
  } catch {}
  return {}
}
function writeOptimandoState(partial: OptimandoTabState) {
  try {
    const current = readOptimandoState()
    const next = { ...current, ...partial }
    const payload = OPTI_MARKER_START + JSON.stringify(next) + OPTI_MARKER_END
    const name = window.name || ''
    const s = name.indexOf(OPTI_MARKER_START)
    const e = name.indexOf(OPTI_MARKER_END)
    if (s !== -1 && e !== -1 && e > s) {
      window.name = name.substring(0, s) + payload + name.substring(e + OPTI_MARKER_END.length)
    } else {
      window.name = (name || '') + payload
    }
  } catch {}
}
const bootState = readOptimandoState()
let dedicatedRole: DedicatedRole | null = bootState.role || null
if (bootState.sessionKey) {
  try { sessionStorage.setItem('optimando-current-session-key', bootState.sessionKey) } catch {}
}

// Check if extension was previously activated for this URL OR if dedicated
const savedState = localStorage.getItem(extensionStateKey)
console.log('🔧 DEBUG: Extension activation check:', {
  url: window.location.href,
  savedState,
  dedicatedRole,
  extensionStateKey
})
if (savedState === 'true' || dedicatedRole) {
  isExtensionActive = true
  console.log('✅ Extension should be active:', { savedState: savedState === 'true', hasDedicatedRole: !!dedicatedRole })
} else {
  console.log('❌ Extension not active:', { savedState, dedicatedRole })
}

// Listen for toggle message from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_SIDEBARS') {
    if (message.visible && !isExtensionActive) {
      isExtensionActive = true
      localStorage.setItem(extensionStateKey, 'true')
      // Only dedicate as master if no existing dedicated role
      if (!dedicatedRole) {
        writeOptimandoState({ role: { type: 'master' } })
        dedicatedRole = { type: 'master' }
      }
      initializeExtension()
      console.log('🚀 Extension activated for tab')
    } else if (!message.visible && isExtensionActive) {
      // Never deactivate dedicated tabs
      if (!dedicatedRole) {
        isExtensionActive = false
        localStorage.setItem(extensionStateKey, 'false')
        deactivateExtension()
        console.log('🔴 Extension deactivated for tab')
      } else {
        console.log('⛔ Cannot deactivate dedicated tab')
      }
    }
    sendResponse({ success: true, active: isExtensionActive })
  }
})

function deactivateExtension() {
  const existingExtension = document.getElementById('optimando-sidebars')
  if (existingExtension) {
    existingExtension.remove()
  }
  
  // Reset body margins
  document.body.style.marginLeft = ''
  document.body.style.marginRight = ''
  document.body.style.marginTop = ''
  
  console.log('🔴 Optimando AI Extension deactivated')
}

function initializeExtension() {
  console.log('🔧 DEBUG: initializeExtension called for:', window.location.href)
  console.log('🔧 DEBUG: dedicatedRole:', dedicatedRole)
  
  // Check if extension should be disabled for this URL
  const urlParams = new URLSearchParams(window.location.search)
  const isDedicated = !!dedicatedRole
  console.log('🔧 DEBUG: isDedicated:', isDedicated, 'urlParams:', urlParams.toString())
  
  if (!isDedicated && urlParams.get('optimando_extension') === 'disabled') {
    console.log('🚫 Optimando AI Extension disabled for this tab (via URL parameter)')
    return
  }
  
  // Detect Hybrid Master mode via URL param, e.g. ?hybrid_master_id=3 or via dedicated role
  let isHybridMaster = urlParams.has('hybrid_master_id')
  let hybridMasterId = urlParams.get('hybrid_master_id') || ''
  if (dedicatedRole && dedicatedRole.type === 'hybrid') {
    isHybridMaster = true
    if (dedicatedRole.hybridMasterId) hybridMasterId = String(dedicatedRole.hybridMasterId)
  }
  // If arriving with hybrid param, persist that role for future navigations in this tab
  if (isHybridMaster) {
    writeOptimandoState({ role: { type: 'hybrid', hybridMasterId } })
    dedicatedRole = { type: 'hybrid', hybridMasterId }
  }
  
  // Check for session key in URL parameters (for hybrid views joining existing session)
  const sessionKeyFromUrl = urlParams.get('optimando_session_key')
  if (sessionKeyFromUrl && !sessionStorage.getItem('optimando-current-session-key')) {
    console.log('🔧 DEBUG: Setting session key from URL:', sessionKeyFromUrl)
    try { 
      sessionStorage.setItem('optimando-current-session-key', sessionKeyFromUrl) 
      sessionStorage.setItem('optimando-browser-session', 'active') // Mark as active session
      writeOptimandoState({ sessionKey: sessionKeyFromUrl })
    } catch {}
  }
  
  // Check for theme in URL parameters (for hybrid views using active theme)
  const themeFromUrl = urlParams.get('optimando_theme')
  if (themeFromUrl && (themeFromUrl === 'dark' || themeFromUrl === 'professional')) {
    console.log('🔧 DEBUG: Setting theme from URL:', themeFromUrl)
    localStorage.setItem('optimando-ui-theme', themeFromUrl)
  }
  
  // Check if this URL is marked as excluded
  const currentUrl = window.location.href
  const tabKey = 'optimando-excluded-' + btoa(currentUrl.split('?')[0]).substring(0, 20)
  const isExcluded = localStorage.getItem(tabKey) === 'true'
  console.log('🔧 DEBUG: URL exclusion check:', {
    currentUrl: currentUrl.split('?')[0],
    tabKey,
    isExcluded,
    isDedicated
  })
  
  if (!isDedicated && isExcluded) {
    console.log('🚫 Optimando AI Extension disabled for this URL (excluded)')
    return
  }
  
  // Prevent multiple injections
  if (document.getElementById('optimando-sidebars')) {
    console.log('🔄 Optimando AI Extension already loaded')
    return
  }
  
  console.log('🚀 Loading Optimando AI Extension...')
  
  // Tab-specific data structure
  const tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  
  let currentTabData = {
    tabId: tabId,
    tabName: `WR Session ${new Date().toLocaleString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false 
    }).replace(/[\/,]/g, '-').replace(/ /g, '_')}`,
    isLocked: false,
    goals: {
      shortTerm: '',
      midTerm: '',
      longTerm: ''
    },
    userIntentDetection: {
      detected: 'Web development',
      confidence: 75,
      lastUpdate: new Date().toLocaleTimeString()
    },
    uiConfig: {
      leftSidebarWidth: 350,
      rightSidebarWidth: 250,
      bottomSidebarHeight: 45
    },
    helperTabs: null as any,
    displayGrids: null as any,
    agentBoxHeights: {} as any,
    agentBoxes: [
      { id: 'brainstorm', number: 1, title: '#1 🧠 Brainstorm Support Ideas', color: '#4CAF50', outputId: 'brainstorm-output' },
      { id: 'knowledge', number: 2, title: '#2 🔍 Knowledge Gap Detection', color: '#2196F3', outputId: 'knowledge-output' },
      { id: 'risks', number: 3, title: '#3 ⚖️ Risks & Chances', color: '#FF9800', outputId: 'risks-output' },
      { id: 'explainer', number: 4, title: '#4 🎬 Explainer Video Suggestions', color: '#9C27B0', outputId: 'explainer-output' }
    ] as any
  }

  // Save/Load functions
  // Session key helpers to guarantee that all writes go to the active session only
  function getCurrentSessionKey(): string | null {
    try { return sessionStorage.getItem('optimando-current-session-key') } catch { return null }
  }
  function setCurrentSessionKey(key: string) {
    try { sessionStorage.setItem('optimando-current-session-key', key) } catch {}
    // Persist across navigations
    writeOptimandoState({ sessionKey: key })
  }
  function saveTabDataToStorage() {
    localStorage.setItem(`optimando-tab-${tabId}`, JSON.stringify(currentTabData))
    
    // Also save agent boxes configuration with URL-based key for persistence across page reloads
    const currentUrl = window.location.href.split('?')[0]
    const urlKey = `optimando-agentboxes-${btoa(currentUrl).substring(0, 20)}`
    localStorage.setItem(urlKey, JSON.stringify({
      agentBoxes: currentTabData.agentBoxes,
      agentBoxHeights: currentTabData.agentBoxHeights,
      timestamp: new Date().toISOString()
    }))
    console.log('🔧 DEBUG: Saved agent boxes to URL-based storage:', urlKey)
  }

  function loadTabDataFromStorage() {
    // Check if this is a fresh browser session (sessionStorage gets cleared on browser close)
    const browserSessionMarker = sessionStorage.getItem('optimando-browser-session')
    const existingSessionKey = sessionStorage.getItem('optimando-current-session-key')
    const isFreshBrowserSession = !browserSessionMarker && !existingSessionKey
    
    console.log('🔧 DEBUG: Session check:', {
      browserSessionMarker,
      existingSessionKey,
      isFreshBrowserSession
    })
    
    if (isFreshBrowserSession) {
      console.log('🆕 Fresh browser session detected - starting new session')
      
      // Set browser session marker for future checks
      sessionStorage.setItem('optimando-browser-session', 'active')
      
      // Before clearing data, preserve UI preferences from any existing tab data
      let preservedUIConfig = { ...currentTabData.uiConfig } // default values
      
      // Try to load UI preferences from the most recent tab data
      const existingTabKeys = Object.keys(localStorage).filter(key => key.startsWith('optimando-tab-'))
      if (existingTabKeys.length > 0) {
        try {
          // Get the most recent tab data to preserve UI settings
          const recentTabData = localStorage.getItem(existingTabKeys[existingTabKeys.length - 1])
          if (recentTabData) {
            const parsed = JSON.parse(recentTabData)
            if (parsed.uiConfig) {
              preservedUIConfig = parsed.uiConfig
              console.log('🔧 DEBUG: Preserved UI config from previous session')
            }
          }
        } catch (e) {
          console.log('🔧 DEBUG: Could not preserve UI config:', e)
        }
      }
      
      // Clear all old tab-specific data to ensure fresh start
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('optimando-tab-')) {
          localStorage.removeItem(key)
        }
      })
      
      // Generate new session name for fresh start
      currentTabData.tabName = `WR Session ${new Date().toLocaleString('en-GB', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: false 
      }).replace(/[\/,]/g, '-').replace(/ /g, '_')}`
      
      // Apply preserved UI configuration
      currentTabData.uiConfig = preservedUIConfig
      
      // Create a brand-new session entry in Sessions History
      try {
        const sessionKey = `session_${Date.now()}`
        const sessionData = {
          ...currentTabData,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          helperTabs: null,
          displayGrids: null
        }
        chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
          console.log('🆕 Fresh browser session added to history:', sessionKey)
          setCurrentSessionKey(sessionKey)
        })
      } catch (e) {
        console.error('❌ Failed to create fresh session entry:', e)
      }
      
      console.log('🔧 DEBUG: Starting fresh session:', currentTabData.tabName)
      return // Skip loading old data for fresh session
    }
    
    // Not a fresh browser session, try to load existing data
    console.log('🔧 DEBUG: Continuing existing browser session')
    sessionStorage.setItem('optimando-browser-session', 'active') // Refresh marker
    
    const saved = localStorage.getItem(`optimando-tab-${tabId}`)
    if (saved) {
      const savedData = JSON.parse(saved)
      currentTabData = { ...currentTabData, ...savedData }
      console.log('🔧 DEBUG: Loaded tab data from storage, agentBoxes:', currentTabData.agentBoxes?.length || 0)
    } else {
      console.log('🔧 DEBUG: No saved tab data found')
    }
    
    // Also try to load agent boxes from URL-based storage (for persistence across page reloads)
    const currentUrl = window.location.href.split('?')[0]
    const urlKey = `optimando-agentboxes-${btoa(currentUrl).substring(0, 20)}`
    const urlSaved = localStorage.getItem(urlKey)
    if (urlSaved) {
      try {
        const urlData = JSON.parse(urlSaved)
        if (urlData.agentBoxes && urlData.agentBoxes.length > 0) {
          currentTabData.agentBoxes = urlData.agentBoxes
          currentTabData.agentBoxHeights = urlData.agentBoxHeights || {}
          console.log('🔧 DEBUG: Restored agent boxes from URL-based storage:', urlData.agentBoxes.length, 'boxes')
        }
      } catch (e) {
        console.log('🔧 DEBUG: Error parsing URL-based agent box data:', e)
      }
    }
  }

  loadTabDataFromStorage()

  // Dynamic Agent Box Functions
  function renderAgentBoxes() {
    console.log('🔧 DEBUG: renderAgentBoxes called with currentTabData.agentBoxes:', currentTabData.agentBoxes)
    
    const container = document.getElementById('agent-boxes-container')
    if (!container) {
      console.log('🔧 DEBUG: agent-boxes-container not found!')
      return
    }

    container.innerHTML = ''
    
    if (!currentTabData.agentBoxes || currentTabData.agentBoxes.length === 0) {
      console.log('🔧 DEBUG: No agent boxes found, using default configuration')
      // Initialize with default boxes if none exist
      currentTabData.agentBoxes = [
        { id: 'brainstorm', number: 1, title: '#1 🧠 Brainstorm Support Ideas', color: '#4CAF50', outputId: 'brainstorm-output' },
        { id: 'knowledge', number: 2, title: '#2 🔍 Knowledge Gap Detection', color: '#2196F3', outputId: 'knowledge-output' },
        { id: 'risks', number: 3, title: '#3 ⚖️ Risks & Chances', color: '#FF9800', outputId: 'risks-output' },
        { id: 'explainer', number: 4, title: '#4 🎬 Explainer Video Suggestions', color: '#9C27B0', outputId: 'explainer-output' }
      ]
      saveTabDataToStorage()
    }
    
    console.log('🔧 DEBUG: Rendering', currentTabData.agentBoxes.length, 'agent boxes')
    
    currentTabData.agentBoxes.forEach((box: any) => {
      const agentDiv = document.createElement('div')
      agentDiv.className = 'agent-box-wrapper'
      agentDiv.setAttribute('data-agent-id', box.id)
      agentDiv.style.marginBottom = '20px'
      
      const savedHeight = currentTabData.agentBoxHeights?.[box.id] || 120
      
      agentDiv.innerHTML = `
        <div style="background: ${box.color}; color: white; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); padding: 8px 12px; border-radius: 6px 6px 0 0; font-size: 13px; font-weight: bold; margin-bottom: 0; position: relative; display: flex; justify-content: space-between; align-items: center;">
          <span>${box.title}</span>
          <div style="display: flex; gap: 5px;">
            <button class="edit-agent-box" data-agent-id="${box.id}" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; opacity: 0.7;" title="Edit this agent box">
              ✏️
            </button>
            <button class="delete-agent-box" data-agent-id="${box.id}" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 12px; font-weight: bold; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; opacity: 0.7;" title="Delete this agent box">
              ✕
            </button>
          </div>
        </div>
        <div class="resizable-agent-box" data-agent="${box.id}" style="background: rgba(255,255,255,0.95); color: black; border-radius: 0 0 8px 8px; padding: 12px; min-height: ${savedHeight}px; height: ${savedHeight}px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative; resize: vertical; overflow: auto;">
          <div style="font-size: 12px; color: #333; line-height: 1.4;">
            <div id="${box.outputId}">Ready for ${box.title.replace(/[📝🔍🎯🧮]/g, '').trim()}...</div>
          </div>
          <div class="resize-handle-horizontal" style="position: absolute; bottom: 0; left: 0; right: 0; height: 8px; cursor: ns-resize; background: rgba(0,0,0,0.1); border-radius: 0 0 8px 8px; opacity: 0; transition: opacity 0.2s;"></div>
        </div>
      `
      
      container.appendChild(agentDiv)
    })
    
    // Re-attach resize event listeners
    attachAgentBoxResizeListeners()
    attachDeleteButtonListeners()
    attachEditButtonListeners()
  }

  function deleteAgentBox(agentId: string) {
    currentTabData.agentBoxes = currentTabData.agentBoxes.filter((box: any) => box.id !== agentId)
    
    // Also remove saved height
    if (currentTabData.agentBoxHeights?.[agentId]) {
      delete currentTabData.agentBoxHeights[agentId]
    }
    
    saveTabDataToStorage()
    renderAgentBoxes()
  }

  function openAddAgentBoxDialog() {
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#E91E63', '#9E9E9E', '#795548', '#607D8B', '#FF5722']
    const existingNumbers = currentTabData.agentBoxes.map((box: any) => box.number)
    const nextNumber = Math.max(...existingNumbers, 0) + 1
    
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
    `
    
    overlay.innerHTML = `
      <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); max-width: 500px; width: 90%;">
        <h3 style="margin: 0 0 20px 0; color: #333; font-size: 18px; text-align: center;">Add New Agent Box</h3>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Agent Number:</label>
          <input id="agent-number" type="number" value="${nextNumber}" min="1" max="99" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Agent Title:</label>
          <input id="agent-title" type="text" placeholder="e.g., 🤖 Custom Agent" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 25px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Color:</label>
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
            ${colors.map((color, index) => `
              <button class="color-select" data-color="${color}" style="width: 40px; height: 40px; background: ${color}; border: 3px solid ${index === 0 ? '#333' : 'transparent'}; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;"></button>
            `).join('')}
          </div>
        </div>
        
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="cancel-add-agent" style="padding: 10px 20px; background: #ccc; border: none; color: #333; border-radius: 6px; cursor: pointer; font-size: 14px;">Cancel</button>
          <button id="confirm-add-agent" style="padding: 10px 20px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">Add Agent Box</button>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    let selectedColor = colors[0]
    
    // Color selection
    overlay.querySelectorAll('.color-select').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.color-select').forEach(b => b.style.border = '3px solid transparent')
        btn.style.border = '3px solid #333'
        selectedColor = btn.getAttribute('data-color') || colors[0]
      })
    })
    
    // Cancel button
    overlay.querySelector('#cancel-add-agent')?.addEventListener('click', () => {
      overlay.remove()
    })
    // Confirm button
    overlay.querySelector('#confirm-add-agent')?.addEventListener('click', () => {
      const numberInput = overlay.querySelector('#agent-number') as HTMLInputElement
      const titleInput = overlay.querySelector('#agent-title') as HTMLInputElement
      
      const number = parseInt(numberInput.value) || nextNumber
      const title = titleInput.value.trim() || `Agent ${number}`
      
      // Create unique ID
      const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const outputId = `${id}-output`
      
      const newBox = {
        id: id,
        number: number,
        title: title,
        color: selectedColor,
        outputId: outputId
      }
      
      currentTabData.agentBoxes.push(newBox)
      saveTabDataToStorage()
      renderAgentBoxes()
      
      overlay.remove()
      
      // Show success notification
      const notification = document.createElement('div')
      notification.style.cssText = `
        position: fixed;
        top: 60px;
        right: 20px;
        background: rgba(76, 175, 80, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 12px;
        z-index: 2147483648;
        animation: slideIn 0.3s ease;
      `
      notification.innerHTML = `➕ Agent box "${title}" added!`
      document.body.appendChild(notification)
      
      setTimeout(() => {
        notification.remove()
      }, 3000)
    })
    
    // Close on background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove()
      }
    })
  }

  function openEditAgentBoxDialog(agentId: string) {
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#E91E63', '#9E9E9E', '#795548', '#607D8B', '#FF5722']
    
    // Find the agent box to edit
    const agentBox = currentTabData.agentBoxes.find((box: any) => box.id === agentId)
    if (!agentBox) {
      console.error('Agent box not found:', agentId)
      return
    }
    
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
    `
    
    overlay.innerHTML = `
      <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); max-width: 500px; width: 90%;">
        <h3 style="margin: 0 0 20px 0; color: #333; font-size: 18px; text-align: center;">Edit Agent Box</h3>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Agent Number:</label>
          <input id="edit-agent-number" type="number" value="${agentBox.number}" min="1" max="99" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Agent Title:</label>
          <input id="edit-agent-title" type="text" value="${agentBox.title}" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 25px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Color:</label>
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
            ${colors.map((color, index) => `
              <button class="color-select" data-color="${color}" style="width: 40px; height: 40px; background: ${color}; border: 3px solid ${color === agentBox.color ? '#333' : 'transparent'}; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;"></button>
            `).join('')}
          </div>
        </div>
        
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="cancel-edit-agent" style="padding: 10px 20px; background: #ccc; border: none; color: #333; border-radius: 6px; cursor: pointer; font-size: 14px;">Cancel</button>
          <button id="confirm-edit-agent" style="padding: 10px 20px; background: #2196F3; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">Save Changes</button>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    // Handle color selection
    let selectedColor = agentBox.color
    overlay.querySelectorAll('.color-select').forEach(btn => {
      btn.addEventListener('click', () => {
        // Remove selection from all buttons
        overlay.querySelectorAll('.color-select').forEach(b => {
          (b as HTMLElement).style.border = '3px solid transparent'
        })
        
        // Add selection to clicked button
        ;(btn as HTMLElement).style.border = '3px solid #333'
        selectedColor = btn.getAttribute('data-color') || agentBox.color
      })
    })
    
    // Handle cancel
    overlay.querySelector('#cancel-edit-agent')?.addEventListener('click', () => {
      overlay.remove()
    })
    
    // Handle confirm
    overlay.querySelector('#confirm-edit-agent')?.addEventListener('click', () => {
      const numberInput = overlay.querySelector('#edit-agent-number') as HTMLInputElement
      const titleInput = overlay.querySelector('#edit-agent-title') as HTMLInputElement
      
      const number = parseInt(numberInput.value) || agentBox.number
      const title = titleInput.value.trim() || agentBox.title
      
      updateAgentBox(agentId, {
        number: number,
        title: title,
        color: selectedColor
      })
      
      overlay.remove()
    })
    
    // Close on background click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove()
      }
    })
  }

  function updateAgentBox(agentId: string, updates: { number?: number, title?: string, color?: string }) {
    const agentBoxIndex = currentTabData.agentBoxes.findIndex((box: any) => box.id === agentId)
    if (agentBoxIndex === -1) {
      console.error('Agent box not found for update:', agentId)
      return
    }
    
    // Update the agent box data
    const agentBox = currentTabData.agentBoxes[agentBoxIndex]
    if (updates.number !== undefined) agentBox.number = updates.number
    if (updates.title !== undefined) agentBox.title = updates.title
    if (updates.color !== undefined) agentBox.color = updates.color
    
    // Save to storage and re-render
    saveTabDataToStorage()
    renderAgentBoxes()
    
    // Show success notification
    const notification = document.createElement('div')
    notification.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      background: rgba(33, 150, 243, 0.9);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-size: 12px;
      z-index: 2147483648;
      animation: slideIn 0.3s ease;
    `
    notification.innerHTML = `✏️ Agent box "${agentBox.title}" updated!`
    document.body.appendChild(notification)
    
    setTimeout(() => {
      notification.remove()
    }, 3000)
  }

  // Helper functions for event listeners
  function attachAgentBoxResizeListeners() {
    document.querySelectorAll('.resizable-agent-box').forEach(box => {
      const resizeHandle = box.querySelector('.resize-handle-horizontal') as HTMLElement
      
      // Show/hide resize handle on hover
      box.addEventListener('mouseenter', () => {
        if (resizeHandle) resizeHandle.style.opacity = '0.6'
      })
      
      box.addEventListener('mouseleave', () => {
        if (!box.getAttribute('data-resizing') && resizeHandle) {
          resizeHandle.style.opacity = '0'
        }
      })
      
      // Resize functionality
      let isResizing = false
      let startY = 0
      let startHeight = 0
      
      if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
          isResizing = true
          box.setAttribute('data-resizing', 'true')
          startY = e.clientY
          startHeight = parseInt(window.getComputedStyle(box as Element).height, 10)
          resizeHandle.style.opacity = '1'
          
          const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return
            
            const deltaY = e.clientY - startY
            const newHeight = Math.max(80, startHeight + deltaY)
            ;(box as HTMLElement).style.height = newHeight + 'px'
            ;(box as HTMLElement).style.minHeight = newHeight + 'px'
          }
          
          const handleMouseUp = () => {
            isResizing = false
            box.removeAttribute('data-resizing')
            resizeHandle.style.opacity = '0'
            
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            
            // Save the new height to storage
            const agentId = box.getAttribute('data-agent')
            if (agentId) {
              if (!currentTabData.agentBoxHeights) {
                currentTabData.agentBoxHeights = {}
              }
              currentTabData.agentBoxHeights[agentId] = parseInt((box as HTMLElement).style.height, 10)
              saveTabDataToStorage()
            }
          }
          
          document.addEventListener('mousemove', handleMouseMove)
          document.addEventListener('mouseup', handleMouseUp)
          
          e.preventDefault()
        })
      }
    })
  }

  function attachDeleteButtonListeners() {
    document.querySelectorAll('.delete-agent-box').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const agentId = btn.getAttribute('data-agent-id')
        if (agentId) {
          // Show confirmation dialog
          const confirmDelete = confirm(`Are you sure you want to delete this agent box?`)
          if (confirmDelete) {
            deleteAgentBox(agentId)
          }
        }
      })
      
      // Hover effects for delete button
      btn.addEventListener('mouseenter', () => {
        (btn as HTMLElement).style.opacity = '1'
        ;(btn as HTMLElement).style.background = 'rgba(244, 67, 54, 0.8)'
      })
      
      btn.addEventListener('mouseleave', () => {
        (btn as HTMLElement).style.opacity = '0.7'
        ;(btn as HTMLElement).style.background = 'rgba(255,255,255,0.2)'
      })
    })
  }

  function attachEditButtonListeners() {
    document.querySelectorAll('.edit-agent-box').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const agentId = btn.getAttribute('data-agent-id')
        if (agentId) {
          openEditAgentBoxDialog(agentId)
        }
      })
      
      // Hover effects for edit button
      btn.addEventListener('mouseenter', () => {
        (btn as HTMLElement).style.opacity = '1'
        ;(btn as HTMLElement).style.background = 'rgba(33, 150, 243, 0.8)'
      })
      
      btn.addEventListener('mouseleave', () => {
        (btn as HTMLElement).style.opacity = '0.7'
        ;(btn as HTMLElement).style.background = 'rgba(255,255,255,0.2)'
      })
    })
  }

  // Add CSS animations
  if (!document.querySelector('#optimando-styles')) {
    const style = document.createElement('style')
    style.id = 'optimando-styles'
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes fadeOut {
        from {
          opacity: 1;
        }
        to {
          opacity: 0;
        }
      }
      
      .lightbox-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.8);
        z-index: 2147483649;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(5px);
      }
      
      .lightbox-content {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 12px;
        width: 90vw;
        height: 85vh;
        max-width: 1200px;
        color: white;
        overflow: hidden;
        box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        display: flex;
        flex-direction: column;
      }
      
      .lightbox-header {
        padding: 20px;
        border-bottom: 1px solid rgba(255,255,255,0.2);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .lightbox-body {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
      }
    `
    document.head.appendChild(style)
  }

  // Create main container
  const sidebarsDiv = document.createElement('div')
  sidebarsDiv.id = 'optimando-sidebars'
  sidebarsDiv.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 2147483647;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  `

  // LEFT SIDEBAR - AI Agent Outputs (weiße Display Ports)
  const leftSidebar = document.createElement('div')
  leftSidebar.id = 'left-sidebar'
  leftSidebar.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: ${currentTabData.uiConfig.leftSidebarWidth}px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
    color: white;
    padding: 20px;
    box-shadow: 2px 0 10px rgba(0,0,0,0.3);
    pointer-events: auto;
    overflow-y: auto;
    backdrop-filter: blur(10px);
    margin: 0;
    border: none;
  `

  // Add resize handle to left sidebar
  const leftResizeHandle = document.createElement('div')
  leftResizeHandle.style.cssText = `
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 5px;
    background: rgba(255,255,255,0.2);
    cursor: ew-resize;
    transition: background 0.2s ease;
  `
  leftResizeHandle.onmouseover = () => {
    leftResizeHandle.style.background = 'rgba(255,255,255,0.4)'
  }
  leftResizeHandle.onmouseout = () => {
    leftResizeHandle.style.background = 'rgba(255,255,255,0.2)'
  }

  leftSidebar.innerHTML = `
    <style>
      /* Theme-specific CSS classes to prevent caching conflicts */
      .theme-default .title-text { color: white !important; }
      .theme-default .section-title { color: white !important; }
      .theme-default .dropdown-title { color: white !important; }
      .theme-default .menu-link { color: white !important; }
      
      .theme-professional .title-text { color: #0f172a !important; }
      .theme-professional .section-title { color: #0f172a !important; }
      .theme-professional .dropdown-title { color: #0f172a !important; }
      .theme-professional .menu-link { color: #0f172a !important; font-weight: 700 !important; }
      
      .theme-dark .title-text { color: white !important; }
      .theme-dark .section-title { color: white !important; }
      .theme-dark .dropdown-title { color: white !important; }
      .theme-dark .menu-link { color: white !important; }
      
      /* WR Scan Text and Session ID Text */
      .theme-default .wr-scan-text { color: rgba(255,255,255,0.8) !important; }
      .theme-default .session-id-text { color: white !important; }
      
      .theme-professional .wr-scan-text { color: #64748b !important; }
      .theme-professional .session-id-text { color: #1e293b !important; }
      
      .theme-dark .wr-scan-text { color: rgba(255,255,255,0.8) !important; }
      .theme-dark .session-id-text { color: white !important; }
    </style>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 10px;">
      <h2 style="margin: 0; font-size: 18px; display: flex; align-items: center; gap: 10px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
          <!-- Giraffe Body -->
          <ellipse cx="12" cy="17" rx="3" ry="2.5" fill="currentColor" opacity="0.9"/>
          <!-- Giraffe Neck -->
          <rect x="11" y="7" width="2" height="10" rx="1" fill="currentColor"/>
          <!-- Giraffe Head -->
          <ellipse cx="12" cy="5.5" rx="2.2" ry="1.8" fill="currentColor"/>
          <!-- Giraffe Muzzle -->
          <ellipse cx="12" cy="6.8" rx="1" ry="0.6" fill="currentColor" opacity="0.8"/>
          <!-- Giraffe Eyes -->
          <circle cx="11.2" cy="5" r="0.25" fill="currentColor" opacity="0.6"/>
          <circle cx="12.8" cy="5" r="0.25" fill="currentColor" opacity="0.6"/>
          <!-- Giraffe Horns -->
          <circle cx="11.2" cy="3.8" r="0.3" fill="currentColor" opacity="0.8"/>
          <circle cx="12.8" cy="3.8" r="0.3" fill="currentColor" opacity="0.8"/>
          <line x1="11.2" y1="4.1" x2="11.2" y2="3.5" stroke="currentColor" stroke-width="0.4" opacity="0.8"/>
          <line x1="12.8" y1="4.1" x2="12.8" y2="3.5" stroke="currentColor" stroke-width="0.4" opacity="0.8"/>
          <!-- Giraffe Spots -->
          <circle cx="10.5" cy="5.5" r="0.3" fill="currentColor" opacity="0.4"/>
          <circle cx="13.5" cy="5.2" r="0.25" fill="currentColor" opacity="0.4"/>
          <circle cx="11.2" cy="9" r="0.4" fill="currentColor" opacity="0.4"/>
          <circle cx="12.8" cy="11" r="0.35" fill="currentColor" opacity="0.4"/>
          <circle cx="11.5" cy="13.5" r="0.3" fill="currentColor" opacity="0.4"/>
          <circle cx="12.2" cy="15.5" r="0.4" fill="currentColor" opacity="0.4"/>
          <circle cx="10.8" cy="16.5" r="0.3" fill="currentColor" opacity="0.4"/>
          <circle cx="13.2" cy="17.2" r="0.35" fill="currentColor" opacity="0.4"/>
          <!-- Giraffe Legs -->
          <rect x="10.2" y="19" width="0.8" height="2.5" rx="0.4" fill="currentColor" opacity="0.8"/>
          <rect x="11.6" y="19" width="0.8" height="2.5" rx="0.4" fill="currentColor" opacity="0.8"/>
          <rect x="12.6" y="19" width="0.8" height="2.5" rx="0.4" fill="currentColor" opacity="0.8"/>
          <rect x="13.4" y="19" width="0.8" height="2.5" rx="0.4" fill="currentColor" opacity="0.8"/>
        </svg>
        <span class="title-text">OpenGiraffe</span>
      </h2>
      <button id="quick-expand-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s ease;" title="Quick expand to maximum width">
        ⇄
      </button>
    </div>
    
    <!-- Agent Output Section -->
    <div id="agent-boxes-container" style="margin-bottom: 20px;">
      <!-- Dynamic agent boxes will be inserted here -->
    </div>
    <!-- Add New Agent Box Button -->
    <div style="margin-bottom: 20px;">
      <button id="add-agent-box-btn" style="width: 100%; padding: 12px 16px; background: rgba(76, 175, 80, 0.8); border: 2px dashed rgba(76, 175, 80, 1); color: white; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; min-height: 44px; transition: all 0.3s ease; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">
        ➕ Add New Agent Box
      </button>
    </div>


  `

  // Add resize handle after content
  leftSidebar.appendChild(leftResizeHandle)

  // Resize functionality for left sidebar
  let isResizingLeft = false
  let startX = 0
  let startWidth = 0

  leftResizeHandle.addEventListener('mousedown', (e) => {
    isResizingLeft = true
    startX = e.clientX
    startWidth = currentTabData.uiConfig.leftSidebarWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
  })

  document.addEventListener('mousemove', (e) => {
    if (!isResizingLeft) return
    
    const newWidth = Math.max(150, Math.min(1000, startWidth + (e.clientX - startX)))
    currentTabData.uiConfig.leftSidebarWidth = newWidth
    
    // Update left sidebar width
    leftSidebar.style.width = newWidth + 'px'
    
    // Update body margin and prevent horizontal scroll
    document.body.style.marginLeft = newWidth + 'px'
    document.body.style.overflowX = 'hidden'
    
    // Update bottom panel position
    bottomSidebar.style.left = newWidth + 'px'
  })

  document.addEventListener('mouseup', () => {
    if (isResizingLeft) {
      isResizingLeft = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      saveTabDataToStorage()
    }
  })

  // RIGHT SIDEBAR - AI Control Center
  const rightSidebar = document.createElement('div')
  rightSidebar.id = 'right-sidebar'
  rightSidebar.style.cssText = `
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: ${currentTabData.uiConfig.rightSidebarWidth}px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
    color: white;
    padding: 20px;
    box-shadow: -2px 0 10px rgba(0,0,0,0.3);
    pointer-events: auto;
    overflow-y: auto;
    backdrop-filter: blur(10px);
    margin: 0;
    border: none;
  `

  rightSidebar.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px;" class="section-title">⚙️ AI Orchestrator</h2>
    </div>

    <!-- WR Code Connection -->
    <div id="wr-card" style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;" class="section-title">📱 WR Code</h3>
      
      <!-- QR Code -->
      <div style="width: 120px; height: 120px; background: white; border-radius: 8px; margin: 0 auto 15px auto; display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDI1IDI1IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMjUiIGhlaWdodD0iMjUiIGZpbGw9IndoaXRlIi8+CjwhLS0gUVIgQ29kZSBQYXR0ZXJuIC0tPgo8IS0tIFRvcCBMZWZ0IEZpbmRlciAtLT4KPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjciIGhlaWdodD0iNyIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMiIgeT0iMiIgd2lkdGg9IjUiIGhlaWdodD0iNSIgZmlsbD0id2hpdGUiLz4KPHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjMiIGhlaWdodD0iMyIgZmlsbD0iYmxhY2siLz4KCjwhLS0gVG9wIFJpZ2h0IEZpbmRlciAtLT4KPHJlY3QgeD0iMTciIHk9IjEiIHdpZHRoPSI3IiBoZWlnaHQ9IjciIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE4IiB5PSIyIiB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSJ3aGl0ZSIvPgo8cmVjdCB4PSIxOSIgeT0iMyIgd2lkdGg9IjMiIGhlaWdodD0iMyIgZmlsbD0iYmxhY2siLz4KCjwhLS0gQm90dG9tIExlZnQgRmluZGVyIC0tPgo8cmVjdCB4PSIxIiB5PSIxNyIgd2lkdGg9IjciIGhlaWdodD0iNyIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMiIgeT0iMTgiIHdpZHRoPSI1IiBoZWlnaHQ9IjUiIGZpbGw9IndoaXRlIi8+CjxyZWN0IHg9IjMiIHk9IjE5IiB3aWR0aD0iMyIgaGVpZ2h0PSIzIiBmaWxsPSJibGFjayIvPgoKPCEtLSBUaW1pbmcgUGF0dGVybnMgLS0+CjxyZWN0IHg9IjkiIHk9IjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSIxIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPCEtLSBEYXRhIFBhdHRlcm4gLS0+CjxyZWN0IHg9IjkiIHk9IjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSIzIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSI1IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSI3IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSI1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSI3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8IS0tIE1vcmUgZGF0YSBwYXR0ZXJucyAtLT4KPHJlY3QgeD0iOSIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEwIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTIiIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNCIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE2IiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSIxMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIxNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTMiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSI5IiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMTciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE1IiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMSIgeT0iMTkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSIxOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIyMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTMiIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSI5IiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE1IiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjE3IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjEiIHk9IjkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIzIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIyMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8L3N2Zz4=" style="width: 110px; height: 110px;" alt="QR Code" />
      </div>
      
      <div class="wr-scan-text" style="font-size: 11px; color: rgba(255,255,255,0.8); margin-bottom: 15px;">
        Scan to connect your WR account
      </div>
      
      <button id="wr-connect-btn" style="width: 100%; padding: 12px 16px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600; min-height: 44px; margin-bottom: 10px;">
        🔗 WR Login
      </button>
      

      </div>

    <!-- Add Helpergrid Button -->
    <div id="helpergrid-card" style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <button id="add-helpergrid-btn" style="width: 100%; padding: 12px 16px; background: #FF6B6B; border: none; color: white; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; min-height: 44px; transition: all 0.3s ease;">
        🚀 Add View
      </button>
    </div>

    <!-- Session History -->
    <div id="sessions-card" style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 14px;" class="section-title">📚 Sessions History</h3>
      </div>
      
      <button id="sessions-history-btn" style="width: 100%; padding: 12px 16px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600; min-height: 44px;">
        📋 View All Sessions
      </button>
    </div>

    <!-- Quick Actions -->
    <div id="quick-actions-card" style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;" class="section-title">⚡ Quick Actions</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button id="save-session-btn" style="padding: 8px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">💾 Save</button>
        <button id="sync-btn" style="padding: 8px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">🔄 Sync</button>
        <button id="export-btn" style="padding: 8px; background: #FF9800; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">📤 Export</button>
        <button id="import-btn" style="padding: 8px; background: #9C27B0; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">📥 Import</button>
      </div>
    </div>


  `

  // If this tab is a Hybrid Master, render a right-side agent panel clone
  if (isHybridMaster) {
    // Align right panel width with left panel and persist
    currentTabData.uiConfig.rightSidebarWidth = currentTabData.uiConfig.leftSidebarWidth
    rightSidebar.style.width = currentTabData.uiConfig.rightSidebarWidth + 'px'
    rightSidebar.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px;" class="section-title">🧩 Master (${parseInt(hybridMasterId) + 1})</h2>
        <button id="quick-expand-right-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s ease;" title="Quick expand to maximum width">⇄</button>
      </div>

      <!-- Right-side Agent Output Section -->
      <div id="agent-boxes-container-right" style="margin-bottom: 20px;"></div>
      <div style="margin-bottom: 20px;">
        <button id="add-agent-box-btn-right" style="width: 100%; padding: 12px 16px; background: rgba(76, 175, 80, 0.8); border: 2px dashed rgba(76, 175, 80, 1); color: white; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; min-height: 44px; transition: all 0.3s ease; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">
          ➕ Add New Agent Box
        </button>
      </div>
    `
  }

  // BOTTOM PANEL - Minimal with Expand
  const bottomSidebar = document.createElement('div')
  bottomSidebar.id = 'bottom-sidebar'
  bottomSidebar.style.cssText = `
    position: fixed;
    left: ${currentTabData.uiConfig.leftSidebarWidth}px;
    right: ${currentTabData.uiConfig.rightSidebarWidth}px;
    top: 0;
    height: 45px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
    color: white;
    padding: 8px 15px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    pointer-events: auto;
    backdrop-filter: blur(10px);
    cursor: pointer;
    transition: height 0.3s ease;
    z-index: 10000;
    margin: 0;
    border: none;
  `

  // Theme application limited to Optimando elements (topbar + sidebars only)
  const ORIGINAL_BG = 'linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%)'

  function applyTheme(theme) {
    const gradients = {
      professional: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
      dark: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
    }
    const textColors = {
      professional: '#1e293b',
      dark: '#f1f5f9'
    }
    const titleColors = {
      professional: '#0f172a',
      dark: '#f1f5f9'
    }
    const bg = gradients[theme]
    if (!bg) return
    const fg = textColors[theme]
    const titleFg = titleColors[theme]
    
    // Add theme class to main containers for CSS-based styling
    if (leftSidebar) {
      leftSidebar.className = `theme-${theme}`
    }
    if (rightSidebar) {
      rightSidebar.className = `theme-${theme}`
    }
    if (bottomSidebar) {
      bottomSidebar.className = `theme-${theme}`
    }
    
    // CSS classes handle the styling now, no need for complex dynamic styling
    if (leftSidebar) { 
      leftSidebar.style.background = bg; 
      leftSidebar.style.color = fg;
      
      // Professional theme typography improvements
      if (theme === 'professional') {
        leftSidebar.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
        leftSidebar.style.fontSize = '14px'
        leftSidebar.style.lineHeight = '1.5'
      }
      // Button color rules
      const addAgentBtn = leftSidebar.querySelector('#add-agent-box-btn')
      if (addAgentBtn) {
        if (theme === 'professional') {
          addAgentBtn.style.background = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
          addAgentBtn.style.border = '1px solid #cbd5e1'
          addAgentBtn.style.color = '#1e293b'
          addAgentBtn.style.fontWeight = '600'
          addAgentBtn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)'
          addAgentBtn.style.fontSize = '14px'
          addAgentBtn.style.letterSpacing = '0.025em'
        } else if (theme === 'dark') {
          addAgentBtn.style.background = 'linear-gradient(135deg, #334155 0%, #1e293b 100%)'
          addAgentBtn.style.border = '2px dashed #475569'
          addAgentBtn.style.color = '#f1f5f9'
          addAgentBtn.style.fontWeight = '600'
        }
      }
    }
    if (rightSidebar) { 
      rightSidebar.style.background = bg; 
      rightSidebar.style.color = fg;
      
      // Professional theme typography improvements
      if (theme === 'professional') {
        rightSidebar.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
        rightSidebar.style.fontSize = '14px'
        rightSidebar.style.lineHeight = '1.5'
      }
      // Fix QR code instruction text
      const qrText = rightSidebar.querySelector('div[style*="font-size: 11px"]')
      if (qrText) {
        qrText.style.color = theme === 'professional' ? '#475569' : '#cbd5e1'
      }
      // Right sidebar buttons
      const wrBtn = rightSidebar.querySelector('#wr-connect-btn')
      const helperBtn = rightSidebar.querySelector('#add-helpergrid-btn')
      const sessionsBtn = rightSidebar.querySelector('#sessions-history-btn')
      const addAgentBtnRight = rightSidebar.querySelector('#add-agent-box-btn-right') as HTMLElement | null
      const cards = rightSidebar.querySelectorAll('#wr-card, #helpergrid-card, #sessions-card, #quick-actions-card')
      
      // Style right sidebar cards
      cards.forEach(card => {
        if (theme === 'professional') {
          card.style.background = 'rgba(255, 255, 255, 0.95)'
          card.style.border = '1px solid rgba(148, 163, 184, 0.2)'
          card.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.1)'
          card.style.borderRadius = '12px'
          card.style.backdropFilter = 'blur(10px)'
        } else if (theme === 'dark') {
          card.style.background = 'rgba(241, 245, 249, 0.08)'
          card.style.border = '1px solid rgba(241, 245, 249, 0.15)'
        }
      })
      const setBtn = (btn) => {
        if (!btn) return
        if (theme === 'professional') {
          btn.style.background = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
          btn.style.color = '#1e293b'
          btn.style.border = '1px solid #cbd5e1'
          btn.style.fontWeight = '600'
          btn.style.padding = '14px 18px'
          btn.style.fontSize = '14px'
          btn.style.minHeight = '48px'
          btn.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)'
          btn.style.letterSpacing = '0.025em'
          btn.style.borderRadius = '8px'
          btn.style.transition = 'all 0.2s ease'
        } else if (theme === 'dark') {
          btn.style.background = 'linear-gradient(135deg, #334155 0%, #1e293b 100%)'
          btn.style.color = '#f1f5f9'
          btn.style.border = 'none'
          btn.style.fontWeight = '600'
          btn.style.padding = '12px 16px'
          btn.style.fontSize = '14px'
          btn.style.minHeight = '44px'
        }
      }
      setBtn(wrBtn)
      setBtn(helperBtn)
      setBtn(sessionsBtn)
      // Theme the Hybrid right-panel Add Agent button to match left
      if (addAgentBtnRight) {
        if (theme === 'professional') {
          addAgentBtnRight.style.background = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
          addAgentBtnRight.style.border = '1px solid #cbd5e1'
          addAgentBtnRight.style.color = '#1e293b'
          addAgentBtnRight.style.fontWeight = '600'
          addAgentBtnRight.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)'
          addAgentBtnRight.style.fontSize = '14px'
          addAgentBtnRight.style.letterSpacing = '0.025em'
        } else if (theme === 'dark') {
          addAgentBtnRight.style.background = 'linear-gradient(135deg, #334155 0%, #1e293b 100%)'
          addAgentBtnRight.style.border = '2px dashed #475569'
          addAgentBtnRight.style.color = '#f1f5f9'
          addAgentBtnRight.style.fontWeight = '600'
        } else {
          addAgentBtnRight.style.background = 'rgba(76, 175, 80, 0.8)'
          addAgentBtnRight.style.border = '2px dashed rgba(76, 175, 80, 1)'
          addAgentBtnRight.style.color = 'white'
        }
      }
      
      // Fix dropdown area titles for better readability
      const dropdownTitles = rightSidebar.querySelectorAll('.bottom-panel h4')
      dropdownTitles.forEach(title => {
        // Force reset to prevent caching - clear all possible color styles
        title.style.color = ''
        title.style.setProperty('color', '', 'important')
        
        if (theme === 'professional') {
          title.style.setProperty('color', '#0f172a', 'important')  // Dark navy for light background
        } else if (theme === 'dark') {
          title.style.setProperty('color', 'white', 'important')    // White for dark background
        }
        // Default theme will be handled by resetToDefaultTheme function
      })
      
      // Fix all h4 titles in the right sidebar (including Intent Detection, Goals, Reasoning)
      const allH4Titles = rightSidebar.querySelectorAll('h4')
      allH4Titles.forEach(title => {
        // Force reset to prevent caching - clear all possible color styles
        title.style.color = ''
        title.style.setProperty('color', '', 'important')
        
        if (theme === 'professional') {
          title.style.setProperty('color', '#0f172a', 'important')  // Dark navy for light background
        } else if (theme === 'dark') {
          title.style.setProperty('color', 'white', 'important')    // White for dark background
        }
        // Default theme will be handled by resetToDefaultTheme function
      })
      
      // Fix dropdown titles specifically (Intent Detection, Goals)
      const dropdownTitlesInRightSidebar = rightSidebar.querySelectorAll('.dropdown-title')
      dropdownTitlesInRightSidebar.forEach(title => {
        // Force reset to prevent caching - clear all possible color styles
        title.style.color = ''
        title.style.setProperty('color', '', 'important')
        
        if (theme === 'professional') {
          title.style.setProperty('color', '#0f172a', 'important')  // Dark navy for light background
        } else if (theme === 'dark') {
          title.style.setProperty('color', 'white', 'important')    // White for dark background
        }
        // Default theme will be handled by resetToDefaultTheme function
      })
    }
    if (bottomSidebar) { 
      // Apply theme-specific backgrounds
      if (theme === 'dark') {
        bottomSidebar.style.background = bg; 
        bottomSidebar.style.color = fg;
      } else if (theme === 'professional') {
        // Professional theme top bar - Fortune 500 enterprise design
        bottomSidebar.style.background = 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)';
        bottomSidebar.style.color = '#1e293b';
        bottomSidebar.style.borderBottom = '1px solid #e2e8f0';
        bottomSidebar.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
        bottomSidebar.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
        bottomSidebar.style.fontSize = '14px';
        bottomSidebar.style.fontWeight = '500';
      }
      
      // Session input styling is now handled by CSS classes
      // Fix header titles readability for professional and dark themes only
      if (theme === 'professional' || theme === 'dark') {
        const headerTitles = bottomSidebar.querySelectorAll('h1, h2, h3, .header-title, .session-id')
        headerTitles.forEach(title => {
          title.style.color = theme === 'professional' ? '#1e293b' : titleFg
          title.style.fontWeight = '600'
        })
        const sessionId = bottomSidebar.querySelector('#session-id')
        if (sessionId) {
          sessionId.style.color = theme === 'professional' ? '#1e293b' : titleFg
          sessionId.style.fontWeight = '600'
        }
        
        // Fix top menu links for all themes
        const allElements = bottomSidebar.querySelectorAll('*')
        allElements.forEach(element => {
          if (element.textContent) {
            const text = element.textContent.trim()
            if (text === 'Reasoning' || text === 'Agents' || text === 'Whitelist' || text === 'Settings' || 
                text.includes('Reasoning') || text.includes('Agents') || text.includes('Whitelist') || text.includes('Settings')) {
              // Force reset to prevent caching
              element.style.color = ''
              element.style.setProperty('color', '', 'important')
              
              if (theme === 'professional') {
                element.style.setProperty('color', '#0f172a', 'important')  // Dark navy for light background
                element.style.fontWeight = '700'
              } else if (theme === 'dark') {
                element.style.setProperty('color', 'white', 'important')    // White for dark background
              }
            }
          }
        })
      }
    }
  }

  function resetToDefaultTheme() {
    // Set theme class to default
    if (leftSidebar) {
      leftSidebar.className = 'theme-default'
      leftSidebar.style.background = ORIGINAL_BG
      leftSidebar.style.color = 'white'
      const addAgentBtn = leftSidebar.querySelector('#add-agent-box-btn')
      if (addAgentBtn) {
        addAgentBtn.style.background = 'rgba(76, 175, 80, 0.8)'
        addAgentBtn.style.border = '2px dashed rgba(76, 175, 80, 1)'
        addAgentBtn.style.color = 'white'
      }
    }
    if (rightSidebar) {
      rightSidebar.className = 'theme-default'
      rightSidebar.style.background = ORIGINAL_BG
      rightSidebar.style.color = 'white'
      const wrBtn = rightSidebar.querySelector('#wr-connect-btn')
      const helperBtn = rightSidebar.querySelector('#add-helpergrid-btn')
      const sessionsBtn = rightSidebar.querySelector('#sessions-history-btn')
      const addAgentBtnRight = rightSidebar.querySelector('#add-agent-box-btn-right') as HTMLElement | null
      const cards = rightSidebar.querySelectorAll('#wr-card, #helpergrid-card, #sessions-card, #quick-actions-card')
      
      cards.forEach(card => {
        card.style.background = 'rgba(255,255,255,0.1)'
        card.style.border = 'none'
        card.style.boxShadow = ''
      })
      ;[wrBtn, helperBtn, sessionsBtn].forEach(btn => {
        if (!btn) return
        btn.style.border = 'none'
        btn.style.color = 'white'
      })
      if (wrBtn) wrBtn.style.background = '#4CAF50'
      if (sessionsBtn) sessionsBtn.style.background = '#2196F3'
      if (helperBtn) helperBtn.style.background = '#FF6B6B'
      if (addAgentBtnRight) {
        addAgentBtnRight.style.background = 'rgba(76, 175, 80, 0.8)'
        addAgentBtnRight.style.border = '2px dashed rgba(76, 175, 80, 1)'
        addAgentBtnRight.style.color = 'white'
      }
    }
    if (bottomSidebar) { 
      bottomSidebar.className = 'theme-default'
      bottomSidebar.style.background = ORIGINAL_BG; 
      bottomSidebar.style.color = 'white';
      // Reset header titles to original styling
      const headerTitles = bottomSidebar.querySelectorAll('h1, h2, h3, .header-title, .session-id')
      headerTitles.forEach(title => {
        title.style.color = 'white'
        title.style.fontWeight = ''
      })
      const sessionId = bottomSidebar.querySelector('#session-id')
      if (sessionId) {
        sessionId.style.color = 'white'
        sessionId.style.fontWeight = ''
      }
      
      // Fix dropdown area titles for default theme
      const dropdownTitles = rightSidebar.querySelectorAll('.bottom-panel h4')
      dropdownTitles.forEach(title => {
        title.style.color = 'white'
      })
      
      // Fix all h4 titles in the right sidebar for default theme
      const allH4Titles = rightSidebar.querySelectorAll('h4')
      allH4Titles.forEach(title => {
        // Force reset to prevent caching
        title.style.color = ''
        title.style.setProperty('color', '', 'important')
        title.style.setProperty('color', 'white', 'important')  // White for purple background
      })
      
      // Fix dropdown titles specifically for default theme
      const dropdownTitlesForDefault = rightSidebar.querySelectorAll('.dropdown-title')
      dropdownTitlesForDefault.forEach(title => {
        // Force reset to prevent caching
        title.style.color = ''
        title.style.setProperty('color', '', 'important')
        title.style.setProperty('color', 'white', 'important')  // White for purple background
      })
      
      // Fix top menu links for default theme
      const menuLinks = bottomSidebar.querySelectorAll('a, button, span, div')
      menuLinks.forEach(link => {
        if (link.textContent && (link.textContent.includes('Reasoning') || link.textContent.includes('Agents') || link.textContent.includes('Whitelist') || link.textContent.includes('Settings'))) {
          link.style.color = 'white'
        }
      })
    }
  }

  // Apply saved theme on init ONLY if present; otherwise keep original defaults
  try {
    const savedTheme = localStorage.getItem('optimando-ui-theme')
    if (savedTheme === 'dark' || savedTheme === 'professional') {
      applyTheme(savedTheme)
    }
  } catch {}

  // Bottom Panel Content
  let isExpanded = false
  const expandedHeight = 300

  function createBottomContent() {
    return `
      <!-- Compact Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; height: 29px;">
        <!-- Reasoning Title with Dropdown Arrow -->
        <div style="display: flex; align-items: center; gap: 15px;">
          <div id="reasoning-header" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <span style="font-size: 12px; font-weight: bold;" class="menu-link">🧠 Reasoning</span>
            <button id="expand-btn" style="background: transparent; border: none; color: white; font-size: 12px; transition: transform 0.3s ease;">⌄</button>
          </div>
          <button id="agents-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 3px; cursor: pointer; font-size: 10px;" class="menu-link">🤖 Agents</button>
          <button id="context-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 3px; cursor: pointer; font-size: 10px;" class="menu-link">📄 Context</button>
          <button id="whitelist-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 3px; cursor: pointer; font-size: 10px;" class="menu-link">🛡️ Whitelist</button>
          <button id="settings-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 3px; cursor: pointer; font-size: 10px;" class="menu-link">⚙️ Settings</button>
        </div>
        
        <!-- Session Name + Controls -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <input id="session-name-input" class="session-id-text" type="text" value="${currentTabData.tabName}" 
                 style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; 
                        padding: 4px 8px; border-radius: 3px; font-size: 11px; width: 140px; 
                        ${currentTabData.isLocked ? 'opacity: 0.6; pointer-events: none;' : ''}"
                 ${currentTabData.isLocked ? 'disabled' : ''}
                 placeholder="Session Name">
          <button id="new-session-btn" style="background: rgba(76, 175, 80, 0.8); border: none; color: white; width: 24px; height: 24px; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold; transition: all 0.2s ease; ${isHybridMaster ? 'display: none;' : ''}" title="Start a new session">+</button>
          <button id="lock-btn" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 24px; height: 24px; border-radius: 3px; cursor: pointer; font-size: 10px; ${currentTabData.isLocked ? 'background: rgba(255,215,0,0.3);' : ''}">${currentTabData.isLocked ? '🔒' : '🔓'}</button>
        </div>
      </div>

      <!-- Expandable Content - 3 Column Reasoning Display -->
      <div id="expandable-content" style="display: none; margin-top: 15px; height: ${expandedHeight - 60}px; overflow-y: auto;">
        
        <!-- 3-Column Layout -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; height: 100%;">
            
          <!-- Intent Detection Column -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 class="dropdown-title" style="margin: 0 0 10px 0; font-size: 12px;">🎯 Intent Detection</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;"><strong>Current:</strong> ${currentTabData.userIntentDetection.detected}</div>
                <div style="margin-bottom: 8px;"><strong>Confidence:</strong> ${currentTabData.userIntentDetection.confidence}%</div>
                <div><strong>Updated:</strong> ${currentTabData.userIntentDetection.lastUpdate}</div>
              </div>
            </div>

          <!-- Goals Column -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 class="dropdown-title" style="margin: 0 0 10px 0; font-size: 12px;">📋 Goals</h4>
              <div style="font-size: 10px; color: white;">
                <div style="margin-bottom: 6px;">
                  <strong style="color: white;">Short:</strong><br>
                  <textarea id="short-goal" style="width: 100%; height: 30px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.35); color: white; padding: 3px; border-radius: 2px; font-size: 9px; resize: none;">${currentTabData.goals.shortTerm}</textarea>
                </div>
                <div style="margin-bottom: 6px;">
                  <strong style="color: white;">Mid:</strong><br>
                  <textarea id="mid-goal" style="width: 100%; height: 30px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.35); color: white; padding: 3px; border-radius: 2px; font-size: 9px; resize: none;">${currentTabData.goals.midTerm}</textarea>
                </div>
                <div>
                  <strong style="color: white;">Long:</strong><br>
                  <textarea id="long-goal" style="width: 100%; height: 30px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.35); color: white; padding: 3px; border-radius: 2px; font-size: 9px; resize: none;">${currentTabData.goals.longTerm}</textarea>
                </div>
              </div>
            </div>

          <!-- Reasoning Column -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 class="dropdown-title" style="margin: 0 0 10px 0; font-size: 12px;">🤖 Reasoning</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;"><strong>Active Agents:</strong> 0/5</div>
                <div style="margin-bottom: 8px;"><strong>Status:</strong> Standby</div>
                <div style="background: rgba(0,0,0,0.3); padding: 5px; border-radius: 3px; font-size: 8px; height: 80px; overflow-y: auto; font-family: monospace;">
                  [System] Ready for AI orchestration<br>
                  [System] Waiting for agent activation<br>
                </div>
                <button style="width: 100%; margin-top: 5px; padding: 4px; background: #4CAF50; border: none; color: white; border-radius: 2px; cursor: pointer; font-size: 8px;">🚀 Start</button>
              </div>
            </div>
          </div>
        </div>
    `
  }


  bottomSidebar.innerHTML = createBottomContent()

  // Expand/Collapse functionality

  function toggleBottomPanel() {
    isExpanded = !isExpanded
    const expandBtn = document.getElementById('expand-btn')
    const expandableContent = document.getElementById('expandable-content')
    
    if (isExpanded) {
      bottomSidebar.style.height = expandedHeight + 'px'
      bottomSidebar.style.cursor = 'default'
      expandBtn.style.transform = 'rotate(180deg)'
      expandableContent.style.display = 'block'
      // Update body margin for expanded top panel (seamless)
      document.body.style.marginTop = expandedHeight + 'px'
    } else {
      bottomSidebar.style.height = '45px'
      bottomSidebar.style.cursor = 'pointer'
      expandBtn.style.transform = 'rotate(0deg)'
      expandableContent.style.display = 'none'
      // Reset body margin for collapsed top panel (seamless)
      document.body.style.marginTop = '45px'
    }
  }


  // Lightbox functions
  function openAgentsLightbox() {
    // Create agents lightbox
    const overlay = document.createElement('div')
    overlay.id = 'agents-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; height: 85vh; max-width: 1200px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">🤖 AI Agents Configuration</h2>
          <button id="close-agents-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px;">
            
            <!-- Agent 1: Summarize -->
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;">
              <div style="font-size: 32px; margin-bottom: 8px;">📝</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #4CAF50; font-weight: bold;">Summarize</h4>
              <button class="agent-toggle" data-agent="summarize" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 8px;">OFF</button>
              
              <!-- Compact Controls -->
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="summarize" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="summarize" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Context">📄</button>
                <button class="lightbox-btn" data-agent="summarize" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
              
              <!-- Output Selection -->
              <select style="width: 100%; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 3px; font-size: 8px;">
                <option value="1" selected>#1 Display Port</option>
                <option value="2">#2 Display Port</option>
                <option value="3">#3 Display Port</option>
                <option value="4">#4 Display Port</option>
                <option value="5">#5 Display Port</option>
                <option value="6">#6 Display Port</option>
                <option value="7">#7 Display Port</option>
                <option value="8">#8 Display Port</option>
                <option value="9">#9 Display Port</option>
                <option value="10">#10 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>

            <!-- Agent 2: Research -->
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;">
              <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #2196F3; font-weight: bold;">Research</h4>
              <button class="agent-toggle" data-agent="research" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 8px;">OFF</button>
              
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="research" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="research" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Context">📄</button>
                <button class="lightbox-btn" data-agent="research" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
              
              <select style="width: 100%; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 3px; font-size: 8px;">
                <option value="1">#1 Display Port</option>
                <option value="2" selected>#2 Display Port</option>
                <option value="3">#3 Display Port</option>
                <option value="4">#4 Display Port</option>
                <option value="5">#5 Display Port</option>
                <option value="6">#6 Display Port</option>
                <option value="7">#7 Display Port</option>
                <option value="8">#8 Display Port</option>
                <option value="9">#9 Display Port</option>
                <option value="10">#10 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>
            <!-- Agent 3: Analyze -->
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;">
              <div style="font-size: 32px; margin-bottom: 8px;">📊</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #FF9800; font-weight: bold;">Analyze</h4>
              <button class="agent-toggle" data-agent="analyze" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 8px;">OFF</button>
              
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="analyze" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="analyze" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Context">📄</button>
                <button class="lightbox-btn" data-agent="analyze" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
              
              <select style="width: 100%; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 3px; font-size: 8px;">
                <option value="1">#1 Display Port</option>
                <option value="2">#2 Display Port</option>
                <option value="3" selected>#3 Display Port</option>
                <option value="4">#4 Display Port</option>
                <option value="5">#5 Display Port</option>
                <option value="6">#6 Display Port</option>
                <option value="7">#7 Display Port</option>
                <option value="8">#8 Display Port</option>
                <option value="9">#9 Display Port</option>
                <option value="10">#10 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>

            <!-- Agent 4: Generate -->
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;">
              <div style="font-size: 32px; margin-bottom: 8px;">✨</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #9C27B0; font-weight: bold;">Generate</h4>
              <button class="agent-toggle" data-agent="generate" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 8px;">OFF</button>
              
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="generate" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="generate" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Context">📄</button>
                <button class="lightbox-btn" data-agent="generate" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
              
              <select style="width: 100%; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 3px; font-size: 8px;">
                <option value="1">#1 Display Port</option>
                <option value="2">#2 Display Port</option>
                <option value="3">#3 Display Port</option>
                <option value="4" selected>#4 Display Port</option>
                <option value="5">#5 Display Port</option>
                <option value="6">#6 Display Port</option>
                <option value="7">#7 Display Port</option>
                <option value="8">#8 Display Port</option>
                <option value="9">#9 Display Port</option>
                <option value="10">#10 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>

            <!-- Agent 5: Coordinate -->
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;">
              <div style="font-size: 32px; margin-bottom: 8px;">🎯</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #607D8B; font-weight: bold;">Coordinate</h4>
              <button class="agent-toggle" data-agent="coordinate" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 8px;">OFF</button>
              
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="coordinate" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="coordinate" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Context">📄</button>
                <button class="lightbox-btn" data-agent="coordinate" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
              
              <select style="width: 100%; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 3px; font-size: 8px;">
                <option value="1">#1 Display Port</option>
                <option value="2">#2 Display Port</option>
                <option value="3">#3 Display Port</option>
                <option value="4">#4 Display Port</option>
                <option value="5" selected>#5 Display Port</option>
                <option value="6">#6 Display Port</option>
                <option value="7">#7 Display Port</option>
                <option value="8">#8 Display Port</option>
                <option value="9">#9 Display Port</option>
                <option value="10">#10 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>
          </div>

          <!-- Add New Agent Button -->
          <div style="text-align: center; margin-top: 15px;">
            <button id="add-new-agent" style="padding: 12px 20px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">
              ➕ Add New Agent
            </button>
          </div>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    document.getElementById('close-agents-lightbox').onclick = () => overlay.remove()
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    
    // Add event handlers for agent controls
    overlay.querySelectorAll('.agent-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const agentName = e.target.dataset.agent
        const isOn = e.target.textContent === 'ON'
        e.target.textContent = isOn ? 'OFF' : 'ON'
        e.target.style.background = isOn ? '#f44336' : '#4CAF50'
        console.log(`Agent ${agentName} ${isOn ? 'deactivated' : 'activated'}`)
      })
    })
    
    // Add event handlers for lightbox buttons (instructions, context, settings)
    overlay.querySelectorAll('.lightbox-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const agentName = e.target.dataset.agent
        const type = e.target.dataset.type
        openAgentConfigDialog(agentName, type, overlay)
      })
    })
    
    // Add event handler for "Add New Agent" button
    document.getElementById('add-new-agent').addEventListener('click', () => {
      openAddNewAgentDialog(overlay)
    })
  }

  function openAgentConfigDialog(agentName, type, parentOverlay) {
    // Create agent config dialog
    const configOverlay = document.createElement('div')
    configOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.9); z-index: 2147483650;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    const typeLabels = {
      'instructions': '📋 AI Instructions',
      'context': '📄 Context & Memory',
      'settings': '⚙️ Agent Settings'
    }
    
    const agentColors = {
      'summarize': '#4CAF50',
      'research': '#2196F3',
      'analyze': '#FF9800',
      'generate': '#9C27B0',
      'coordinate': '#607D8B'
    }
    
    // Get existing data or create default
    const storageKey = `agent_${agentName}_${type}`
    const existingData = localStorage.getItem(storageKey) || ''
    
    let content = ''
    if (type === 'instructions') {
      content = `
        <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">📝 System Instructions:</label>
            <textarea id="agent-instructions" style="width: 100%; height: 200px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px; resize: vertical; font-family: 'Consolas', monospace;" placeholder="Enter detailed AI instructions for this agent...">${existingData}</textarea>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">🎭 Role Description:</label>
              <input type="text" id="agent-role" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;" placeholder="Define the agent's primary role..." value="${localStorage.getItem(storageKey + '_role') || ''}">
            </div>
          </div>
      `
    } else if (type === 'context') {
      content = `
        <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">📄 Context Data:</label>
            <textarea id="agent-context" style="width: 100%; height: 180px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px; resize: vertical; font-family: 'Consolas', monospace;" placeholder="Enter context information that will be available to this agent...">${existingData}</textarea>
            </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">🧠 Memory Allocation:</label>
              <select id="agent-memory" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;">
                <option value="low">Low (2MB)</option>
                <option value="medium" selected>Medium (8MB)</option>
                <option value="high">High (32MB)</option>
                <option value="ultra">Ultra (128MB)</option>
              </select>
                </div>
            
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">📥 Context Source:</label>
              <select id="agent-context-source" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;">
                <option value="manual">Manual Input</option>
                <option value="template">Template Upload</option>
                <option value="dom">DOM Extraction</option>
                <option value="api">API Source</option>
              </select>
                </div>
              </div>
          
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <label style="display: block; margin-bottom: 15px; font-size: 14px; color: #FFD700; font-weight: bold;">💾 Memory Settings:</label>
            <label style="display: flex; align-items: center; font-size: 12px; cursor: pointer;">
              <input type="checkbox" id="agent-persist-memory" style="margin-right: 10px; transform: scale(1.2);" checked>
              <span>Persist memory across sessions</span>
            </label>
            </div>
          </div>
      `
    } else if (type === 'settings') {
      content = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">🖥️ Display Port:</label>
            <select id="agent-display-port" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;">
              <option value="1" ${(localStorage.getItem(storageKey + '_display') || '1') === '1' ? 'selected' : ''}>Display Port #1</option>
              <option value="2" ${localStorage.getItem(storageKey + '_display') === '2' ? 'selected' : ''}>Display Port #2</option>
              <option value="3" ${localStorage.getItem(storageKey + '_display') === '3' ? 'selected' : ''}>Display Port #3</option>
              <option value="4" ${localStorage.getItem(storageKey + '_display') === '4' ? 'selected' : ''}>Display Port #4</option>
              <option value="5" ${localStorage.getItem(storageKey + '_display') === '5' ? 'selected' : ''}>Display Port #5</option>
              <option value="6" ${localStorage.getItem(storageKey + '_display') === '6' ? 'selected' : ''}>Display Port #6</option>
              <option value="7" ${localStorage.getItem(storageKey + '_display') === '7' ? 'selected' : ''}>Display Port #7</option>
              <option value="8" ${localStorage.getItem(storageKey + '_display') === '8' ? 'selected' : ''}>Display Port #8</option>
              <option value="9" ${localStorage.getItem(storageKey + '_display') === '9' ? 'selected' : ''}>Display Port #9</option>
              <option value="10" ${localStorage.getItem(storageKey + '_display') === '10' ? 'selected' : ''}>Display Port #10</option>
              <option value="monitor" ${localStorage.getItem(storageKey + '_display') === 'monitor' ? 'selected' : ''}>Monitor Output</option>
              <option value="sidebar" ${localStorage.getItem(storageKey + '_display') === 'sidebar' ? 'selected' : ''}>Right Sidebar</option>
              <option value="overlay" ${localStorage.getItem(storageKey + '_display') === 'overlay' ? 'selected' : ''}>Overlay Window</option>
            </select>
          </div>
          
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">⚡ Priority Level:</label>
            <select id="agent-priority" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;">
              <option value="low">Low</option>
              <option value="normal" selected>Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <label style="display: block; margin-bottom: 15px; font-size: 14px; color: #FFD700; font-weight: bold;">🚀 Auto-Activation:</label>
            <label style="display: flex; align-items: center; font-size: 12px; margin-bottom: 12px; cursor: pointer;">
              <input type="checkbox" id="agent-auto-start" style="margin-right: 10px; transform: scale(1.2);">
              <span>Auto-start on session load</span>
            </label>
            <label style="display: flex; align-items: center; font-size: 12px; cursor: pointer;">
              <input type="checkbox" id="agent-auto-respond" style="margin-right: 10px; transform: scale(1.2);">
              <span>Auto-respond to triggers</span>
            </label>
          </div>
          
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">⏱️ Response Delay:</label>
            <input type="number" id="agent-delay" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;" value="500" min="0" max="5000" step="100" placeholder="Milliseconds">
            <div style="margin-top: 8px; font-size: 10px; opacity: 0.7;">0-5000 milliseconds</div>
        </div>
      </div>
    `
  }

    configOverlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 85vw; max-width: 1000px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, ${agentColors[agentName] || '#667eea'} 0%, rgba(118, 75, 162, 0.8) 100%);">
          <h2 style="margin: 0; font-size: 20px; text-transform: capitalize;">${typeLabels[type]} - ${agentName}</h2>
          <button id="close-agent-config" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex: 1; padding: 30px; overflow-y: auto;">
          ${content}
        </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: flex-end; gap: 15px; background: rgba(255,255,255,0.05);">
          <button id="agent-config-cancel" style="padding: 12px 24px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px;">Cancel</button>
          <button id="agent-config-save" style="padding: 12px 24px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px;">💾 Save</button>
        </div>
      </div>
    `
    
    document.body.appendChild(configOverlay)
    
    // Close handlers
    document.getElementById('close-agent-config').onclick = () => configOverlay.remove()
    document.getElementById('agent-config-cancel').onclick = () => configOverlay.remove()
    
    // Save handler
    document.getElementById('agent-config-save').onclick = () => {
      let dataToSave = ''
      
      if (type === 'instructions') {
        dataToSave = document.getElementById('agent-instructions').value
        localStorage.setItem(storageKey + '_role', document.getElementById('agent-role').value)
      } else if (type === 'context') {
        dataToSave = document.getElementById('agent-context').value
        localStorage.setItem(storageKey + '_memory', document.getElementById('agent-memory').value)
        localStorage.setItem(storageKey + '_source', document.getElementById('agent-context-source').value)
        localStorage.setItem(storageKey + '_persist', document.getElementById('agent-persist-memory').checked)
      } else if (type === 'settings') {
        localStorage.setItem(storageKey + '_display', document.getElementById('agent-display-port').value)
        localStorage.setItem(storageKey + '_priority', document.getElementById('agent-priority').value)
        localStorage.setItem(storageKey + '_autostart', document.getElementById('agent-auto-start').checked)
        localStorage.setItem(storageKey + '_autorespond', document.getElementById('agent-auto-respond').checked)
        localStorage.setItem(storageKey + '_delay', document.getElementById('agent-delay').value)
      }
      
      localStorage.setItem(storageKey, dataToSave)
      
      // Show notification
      const notification = document.createElement('div')
      notification.style.cssText = `
        position: fixed;
        top: 60px;
        right: 20px;
        background: rgba(76, 175, 80, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 12px;
        z-index: 2147483651;
      `
      notification.innerHTML = `💾 ${agentName} ${type} saved!`
      document.body.appendChild(notification)
      
      setTimeout(() => {
        notification.remove()
      }, 2000)
      
      configOverlay.remove()
      console.log(`Saved ${type} for agent ${agentName}:`, dataToSave)
    }
    
    configOverlay.onclick = (e) => { if (e.target === configOverlay) configOverlay.remove() }
  }
  function openAddNewAgentDialog(parentOverlay) {
    // Create add new agent dialog
    const configOverlay = document.createElement('div')
    configOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.9); z-index: 2147483650;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    configOverlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 500px; max-height: 80vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">➕ Add New Agent</h2>
          <button id="close-add-agent" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex: 1; padding: 30px; overflow-y: auto;">
          <div style="display: grid; gap: 20px;">
            
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">🤖 Agent Name:</label>
              <input type="text" id="new-agent-name" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;" placeholder="Enter agent name (e.g., Editor, Translator)">
            </div>
            
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">🎨 Agent Icon:</label>
              <div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px;">
                <button class="icon-btn" data-icon="🔧" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🔧</button>
                <button class="icon-btn" data-icon="💡" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">💡</button>
                <button class="icon-btn" data-icon="🎨" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🎨</button>
                <button class="icon-btn" data-icon="🔬" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🔬</button>
                <button class="icon-btn" data-icon="📊" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">📊</button>
                <button class="icon-btn" data-icon="🎯" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🎯</button>
                <button class="icon-btn" data-icon="⚡" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">⚡</button>
                <button class="icon-btn" data-icon="🚀" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🚀</button>
                <button class="icon-btn" data-icon="🎪" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🎪</button>
                <button class="icon-btn" data-icon="🔮" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🔮</button>
                <button class="icon-btn" data-icon="🎵" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🎵</button>
                <button class="icon-btn" data-icon="🌟" style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 4px; cursor: pointer; font-size: 20px;">🌟</button>
              </div>
              <input type="hidden" id="selected-icon" value="🔧">
            </div>
            
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">🖥️ Default Display Port:</label>
              <select id="new-agent-display-port" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;">
                <option value="1">#1 Display Port</option>
                <option value="2">#2 Display Port</option>
                <option value="3">#3 Display Port</option>
                <option value="4">#4 Display Port</option>
                <option value="5">#5 Display Port</option>
                <option value="6" selected>#6 Display Port</option>
                <option value="7">#7 Display Port</option>
                <option value="8">#8 Display Port</option>
                <option value="9">#9 Display Port</option>
                <option value="10">#10 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>
            
          </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: flex-end; gap: 15px; background: rgba(255,255,255,0.05);">
          <button id="add-agent-cancel" style="padding: 12px 24px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px;">Cancel</button>
          <button id="add-agent-create" style="padding: 12px 24px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px;">➕ Create Agent</button>
        </div>
      </div>
    `
    
    document.body.appendChild(configOverlay)
    
    // Close handlers
    document.getElementById('close-add-agent').onclick = () => configOverlay.remove()
    document.getElementById('add-agent-cancel').onclick = () => configOverlay.remove()
    
    // Icon selection
    configOverlay.querySelectorAll('.icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Remove selection from all buttons
        configOverlay.querySelectorAll('.icon-btn').forEach(b => b.style.background = 'rgba(255,255,255,0.1)')
        // Highlight selected button
        btn.style.background = 'rgba(76, 175, 80, 0.3)'
        // Store selected icon
        document.getElementById('selected-icon').value = btn.dataset.icon
      })
    })
    
    // Create agent handler
    document.getElementById('add-agent-create').onclick = () => {
      const agentName = document.getElementById('new-agent-name').value.trim()
      const agentIcon = document.getElementById('selected-icon').value
      const displayPort = document.getElementById('new-agent-display-port').value
      
      if (!agentName) {
        alert('Please enter an agent name')
        return
      }
      
      // Show notification
      const notification = document.createElement('div')
      notification.style.cssText = `
        position: fixed;
        top: 60px;
        right: 20px;
        background: rgba(76, 175, 80, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 12px;
        z-index: 2147483651;
      `
      notification.innerHTML = `➕ Agent "${agentName}" created!`
      document.body.appendChild(notification)
      
      setTimeout(() => {
        notification.remove()
      }, 3000)
      
      configOverlay.remove()
      
      // Save new agent configuration
      const agentKey = agentName.toLowerCase().replace(/[^a-z0-9]/g, '')
      localStorage.setItem(`custom_agent_${agentKey}`, JSON.stringify({
        name: agentName,
        icon: agentIcon,
        displayPort: displayPort,
        created: new Date().toISOString()
      }))
      
      console.log(`Created new agent: ${agentName} (${agentIcon}) -> Display Port ${displayPort}`)
      
      // Close parent overlay and reopen to show new agent
      parentOverlay.remove()
      setTimeout(() => {
        openAgentsLightbox()
      }, 100)
    }
    
    configOverlay.onclick = (e) => { if (e.target === configOverlay) configOverlay.remove() }
  }

  function openWhitelistLightbox() {
    // Create whitelist lightbox
    const overlay = document.createElement('div')
    overlay.id = 'whitelist-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    // Get existing whitelist from localStorage
    const existingWhitelist = JSON.parse(localStorage.getItem('url_whitelist') || '["https://example.com"]')
    
    // Generate URL fields HTML
    const generateUrlFieldsHTML = () => {
      return existingWhitelist.map((url, index) => `
        <div class="url-field-row" data-index="${index}" style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <input type="url" class="whitelist-url" value="${url}" style="flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white !important; -webkit-text-fill-color: white !important; padding: 10px; border-radius: 6px; font-size: 12px;" placeholder="https://example.com">
          <button class="add-url-btn" style="background: #4CAF50; border: none; color: white; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;" title="Add new URL field">+</button>
          <button class="remove-url-btn" style="background: #f44336; border: none; color: white; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; ${existingWhitelist.length <= 1 ? 'opacity: 0.5; pointer-events: none;' : ''}" title="Remove this URL field">×</button>
        </div>
      `).join('')
    }
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 85vw; max-width: 800px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">🛡️ URL Whitelist Configuration</h2>
          <button id="close-whitelist-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex: 1; padding: 30px; overflow-y: auto;">
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #FFD700;">Trusted URLs</h3>
            <p style="margin: 0 0 20px 0; font-size: 12px; opacity: 0.8;">Add URLs that you trust and want to enable OpenGiraffe features on. Use HTTPS URLs for security.</p>
            
            <div id="url-fields-container">
              ${generateUrlFieldsHTML()}
            </div>
            
            <div style="margin-top: 20px; display: flex; gap: 10px;">
              <button id="clear-all-urls" style="padding: 8px 16px; background: #ff5722; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 11px;">🗑️ Clear All</button>
              <button id="load-defaults" style="padding: 8px 16px; background: #2196F3; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 11px;">🔄 Load Defaults</button>
            </div>
          </div>
          
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #FFD700;">Security Information</h3>
            <div style="font-size: 12px; opacity: 0.8; line-height: 1.6;">
              <p style="margin: 0 0 10px 0;">• Only URLs in this whitelist will have OpenGiraffe features enabled</p>
              <p style="margin: 0 0 10px 0;">• Wildcard patterns are supported (e.g., https://*.example.com)</p>
              <p style="margin: 0 0 10px 0;">• Changes take effect immediately across all tabs</p>
              <p style="margin: 0;">• HTTPS is recommended for security</p>
            </div>
          </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: center; background: rgba(255,255,255,0.05);">
          <button id="whitelist-save" style="padding: 12px 30px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">
            💾 Save Whitelist
          </button>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    // Close handlers
    document.getElementById('close-whitelist-lightbox').onclick = () => overlay.remove()
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    
    // Add URL field functionality
    const container = document.getElementById('url-fields-container')
    
    const updateUrlFields = () => {
      const urls = Array.from(container.querySelectorAll('.whitelist-url')).map(input => input.value.trim()).filter(url => url)
      container.innerHTML = generateUrlFieldsHTML()
      attachUrlFieldHandlers()
    }
    
    const attachUrlFieldHandlers = () => {
      // Add button handlers
      container.querySelectorAll('.add-url-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const currentUrls = Array.from(container.querySelectorAll('.whitelist-url')).map(input => input.value.trim()).filter(url => url)
          if (currentUrls.length < 20) { // Limit to 20 URLs
            currentUrls.push('')
            existingWhitelist.length = 0
            existingWhitelist.push(...currentUrls)
            updateUrlFields()
          }
        })
      })
      
      // Remove button handlers
      container.querySelectorAll('.remove-url-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.closest('.url-field-row').dataset.index)
          existingWhitelist.splice(index, 1)
          if (existingWhitelist.length === 0) existingWhitelist.push('') // Keep at least one field
          updateUrlFields()
        })
      })
    }
    
    attachUrlFieldHandlers()
    
    // Clear all button
    document.getElementById('clear-all-urls').onclick = () => {
      existingWhitelist.length = 0
      existingWhitelist.push('')
      updateUrlFields()
    }
    
    // Load defaults button
    document.getElementById('load-defaults').onclick = () => {
      existingWhitelist.length = 0
      existingWhitelist.push('https://chatgpt.com', 'https://claude.ai', 'https://bard.google.com', 'https://localhost:*')
      updateUrlFields()
    }
    
    // Save handler
    document.getElementById('whitelist-save').onclick = () => {
      const urls = Array.from(container.querySelectorAll('.whitelist-url'))
        .map(input => input.value.trim())
        .filter(url => url && url.length > 0)
      
      localStorage.setItem('url_whitelist', JSON.stringify(urls.length > 0 ? urls : ['https://example.com']))
      
      // Show notification
      const notification = document.createElement('div')
      notification.style.cssText = `
        position: fixed;
        top: 60px;
        right: 20px;
        background: rgba(76, 175, 80, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 12px;
        z-index: 2147483651;
      `
      notification.innerHTML = `🛡️ URL Whitelist saved! (${urls.length} URLs)`
      document.body.appendChild(notification)
      
      setTimeout(() => {
        notification.remove()
      }, 3000)
      
      overlay.remove()
      console.log('URL Whitelist saved:', urls)
    }
  }

  function openContextLightbox() {
    // Create context lightbox
    const overlay = document.createElement('div')
    overlay.id = 'context-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    overlay.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
        border-radius: 16px; width: 90vw; height: 85vh; max-width: 1200px; 
        color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); 
        display: flex; flex-direction: column;
      ">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">📄 Context Management</h2>
          <button id="close-context-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
          <!-- Tab Navigation -->
          <div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.3);">
            <button id="user-context-tab" style="
              padding: 10px 20px; background: rgba(255,255,255,0.2); border: none; 
              color: white; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;
              transition: all 0.3s ease;
            ">👤 User Context</button>
            <button id="publisher-context-tab" style="
              padding: 10px 20px; background: rgba(255,255,255,0.1); border: none; 
              color: white; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;
              transition: all 0.3s ease;
            ">🌐 Publisher Context</button>
          </div>
          
          <!-- User Context Tab Content -->
          <div id="user-context-content" style="display: block;">
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #66FF66;">Auto-scrape Website Context</h3>
              <button id="scrape-context-btn" style="
                background: linear-gradient(135deg, #4CAF50, #45a049);
                border: none; color: white; padding: 12px 24px; border-radius: 8px;
                cursor: pointer; font-size: 14px; font-weight: bold;
                transition: all 0.3s ease; box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                margin-bottom: 15px;
              ">🔍 Scrape Current Page</button>
              
              <textarea id="user-context-text" style="
                width: 100%; height: 200px; background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.3); color: white; padding: 15px;
                border-radius: 8px; font-size: 14px; resize: vertical;
                font-family: 'Consolas', monospace; line-height: 1.5;
              " placeholder="Enter your context information here or use the scrape button above..."></textarea>
            </div>
            
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #66FF66;">📎 Upload PDF Files</h3>
              <input type="file" id="context-pdf-upload" multiple accept=".pdf" style="
                width: 100%; padding: 10px; background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.3); color: white;
                border-radius: 6px; font-size: 12px; margin-bottom: 10px;
              ">
              <div id="pdf-files-list" style="font-size: 12px; color: #CCCCCC;"></div>
            </div>
          </div>
          
          <!-- Publisher Context Tab Content -->
          <div id="publisher-context-content" style="display: none;">
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #66FF66;">Publisher Context from wrcode.org</h3>
              <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                <button id="load-wrcode-context" style="
                  background: linear-gradient(135deg, #2196F3, #1976D2);
                  border: none; color: white; padding: 10px 20px; border-radius: 6px;
                  cursor: pointer; font-size: 12px; font-weight: bold;
                ">Load from wrcode.org</button>
              </div>
              
              <textarea id="publisher-context-text" style="
                width: 100%; height: 200px; background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.3); color: white; padding: 15px;
                border-radius: 8px; font-size: 14px; resize: vertical;
                font-family: 'Consolas', monospace; line-height: 1.5;
              " placeholder="Publisher context will be loaded from wrcode.org or injected via template..."></textarea>
            </div>
          </div>
          
          <!-- Action Buttons -->
          <div style="display: flex; justify-content: center; gap: 15px; margin-top: 20px;">
            <button id="inject-context-btn" style="
              background: linear-gradient(135deg, #4CAF50, #45a049);
              border: none; color: white; padding: 15px 30px; border-radius: 10px;
              cursor: pointer; font-size: 16px; font-weight: bold;
              transition: all 0.3s ease; box-shadow: 0 6px 12px rgba(0,0,0,0.3);
            ">💉 Inject Context to LLMs</button>
            <button id="save-context-btn" style="
              background: linear-gradient(135deg, #2196F3, #1976D2);
              border: none; color: white; padding: 15px 30px; border-radius: 10px;
              cursor: pointer; font-size: 16px; font-weight: bold;
              transition: all 0.3s ease; box-shadow: 0 6px 12px rgba(0,0,0,0.3);
            ">💾 Save Context</button>
            <button id="clear-context-btn" style="
              background: linear-gradient(135deg, #f44336, #d32f2f);
              border: none; color: white; padding: 15px 30px; border-radius: 10px;
              cursor: pointer; font-size: 16px; font-weight: bold;
              transition: all 0.3s ease; box-shadow: 0 6px 12px rgba(0,0,0,0.3);
            ">🗑️ Clear All</button>
          </div>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    // Load existing context data
    const userText = document.getElementById('user-context-text') as HTMLTextAreaElement
    const publisherText = document.getElementById('publisher-context-text') as HTMLTextAreaElement
    
    if (currentTabData.context?.userContext?.text) {
      userText.value = currentTabData.context.userContext.text
    }
    if (currentTabData.context?.publisherContext?.text) {
      publisherText.value = currentTabData.context.publisherContext.text
    }
    
    // Update PDF files list
    updatePdfFilesList()
    
    // Auto-save on text changes
    const autoSaveContext = () => {
      if (!currentTabData.context) {
        currentTabData.context = { userContext: { text: '', pdfFiles: [] }, publisherContext: { text: '' } }
      }
      currentTabData.context.userContext.text = userText.value
      currentTabData.context.publisherContext.text = publisherText.value
      saveTabDataToStorage()
      
      if (currentTabData.isLocked) {
        sendContextToElectron()
      }
    }
    
    // Add auto-save listeners
    userText.addEventListener('input', autoSaveContext)
    publisherText.addEventListener('input', autoSaveContext)
    
    // Tab switching functionality
    const userTab = document.getElementById('user-context-tab')
    const publisherTab = document.getElementById('publisher-context-tab')
    const userContent = document.getElementById('user-context-content')
    const publisherContent = document.getElementById('publisher-context-content')
    
    userTab?.addEventListener('click', () => {
      userTab.style.background = 'rgba(255,255,255,0.2)'
      publisherTab.style.background = 'rgba(255,255,255,0.1)'
      userContent.style.display = 'block'
      publisherContent.style.display = 'none'
    })
    
    publisherTab?.addEventListener('click', () => {
      publisherTab.style.background = 'rgba(255,255,255,0.2)'
      userTab.style.background = 'rgba(255,255,255,0.1)'
      publisherContent.style.display = 'block'
      userContent.style.display = 'none'
    })
    
    // Close button
    document.getElementById('close-context-lightbox')?.addEventListener('click', () => {
      overlay.remove()
    })
    
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    
    // Scrape context functionality
    document.getElementById('scrape-context-btn')?.addEventListener('click', () => {
      const pageTitle = document.title
      const pageUrl = window.location.href
      const pageText = document.body.innerText.substring(0, 3000)
      
      const scrapedContext = `Page Title: ${pageTitle}
URL: ${pageUrl}

Content:
${pageText}

[Scraped on ${new Date().toLocaleString()}]`
      
      const textarea = document.getElementById('user-context-text') as HTMLTextAreaElement
      textarea.value = scrapedContext
    })
    
    // PDF upload functionality
    document.getElementById('context-pdf-upload')?.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files
      if (files && files.length > 0) {
        // Initialize context data structure if not exists
        if (!currentTabData.context) {
          currentTabData.context = { userContext: { text: '', pdfFiles: [] }, publisherContext: { text: '' } }
        }
        if (!currentTabData.context.userContext) {
          currentTabData.context.userContext = { text: '', pdfFiles: [] }
        }
        if (!currentTabData.context.userContext.pdfFiles) {
          currentTabData.context.userContext.pdfFiles = []
        }
        
        // Add new files to existing list
        Array.from(files).forEach(file => {
          if (file.type === 'application/pdf') {
            currentTabData.context.userContext.pdfFiles.push({
              name: file.name,
              size: file.size,
              lastModified: file.lastModified,
              id: Date.now() + Math.random() // Unique ID for removal
            })
          }
        })
        
        updatePdfFilesList()
        saveTabDataToStorage()
        
        // Auto-save context to session if locked
        if (currentTabData.isLocked) {
          sendContextToElectron()
        }
      }
    })
    
    // Helper function to update PDF files list
    function updatePdfFilesList() {
      const pdfList = document.getElementById('pdf-files-list')
      if (pdfList) {
        const pdfFiles = currentTabData.context?.userContext?.pdfFiles || []
        if (pdfFiles.length > 0) {
          pdfList.innerHTML = `
            <div style="color: #66FF66; font-weight: bold; margin-bottom: 5px;">📎 Uploaded Files (${pdfFiles.length}):</div>
            ${pdfFiles.map((file, index) => `
              <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.1); padding: 5px 10px; border-radius: 4px; margin: 2px 0; font-size: 11px;">
                <span>📄 ${file.name} (${Math.round(file.size / 1024)}KB)</span>
                <button onclick="removePdfFile(${index})" style="background: #f44336; border: none; color: white; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 10px;">✕</button>
              </div>
            `).join('')}
          `
        } else {
          pdfList.innerHTML = '<div style="color: #888; font-size: 11px;">No PDF files uploaded</div>'
        }
      }
    }
    
    // Global function for removing PDF files
    (window as any).removePdfFile = (index: number) => {
      if (currentTabData.context?.userContext?.pdfFiles) {
        currentTabData.context.userContext.pdfFiles.splice(index, 1)
        updatePdfFilesList()
        saveTabDataToStorage()
      }
    }
    
    // Load wrcode context
    document.getElementById('load-wrcode-context')?.addEventListener('click', () => {
      const textarea = document.getElementById('publisher-context-text') as HTMLTextAreaElement
      textarea.value = 'Loading context from wrcode.org...\n[This would connect to wrcode.org API]'
    })
    
    // Inject context to LLMs
    document.getElementById('inject-context-btn')?.addEventListener('click', () => {
      alert('Context injection to LLMs functionality would be implemented here')
    })
    
    // Export context
    document.getElementById('export-context-btn')?.addEventListener('click', () => {
      const userText = document.getElementById('user-context-text') as HTMLTextAreaElement
      const publisherText = document.getElementById('publisher-context-text') as HTMLTextAreaElement
      const pdfFiles = currentTabData.context?.userContext?.pdfFiles || []
      
      const exportData = {
        userContext: {
          text: userText.value,
          pdfFiles: pdfFiles.map(file => ({
            name: file.name,
            size: file.size,
            lastModified: file.lastModified
          }))
        },
        publisherContext: {
          text: publisherText.value
        },
        exportedAt: new Date().toISOString(),
        sessionId: currentTabData.tabId
      }
      
      // Create and download JSON file
      const dataStr = JSON.stringify(exportData, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(dataBlob)
      
      const link = document.createElement('a')
      link.href = url
      link.download = `context-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      
      // Show success notification
      const notification = document.createElement('div')
      notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2147483650;
        background: linear-gradient(135deg, #FF9800, #F57C00); color: white;
        padding: 15px 20px; border-radius: 8px; font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-weight: bold;
      `
      notification.innerHTML = '📤 Context exported successfully!'
      document.body.appendChild(notification)
      
      setTimeout(() => {
        notification.remove()
      }, 3000)
    })
    // Save context
    document.getElementById('save-context-btn')?.addEventListener('click', () => {
      // Initialize context data structure if not exists
      if (!currentTabData.context) {
        currentTabData.context = { userContext: { text: '', pdfFiles: [] }, publisherContext: { text: '' } }
      }
      
      // Update context data
      const userText = document.getElementById('user-context-text') as HTMLTextAreaElement
      const publisherText = document.getElementById('publisher-context-text') as HTMLTextAreaElement
      
      currentTabData.context.userContext.text = userText.value
      currentTabData.context.publisherContext.text = publisherText.value
      
      // Save to local storage
      saveTabDataToStorage()
      
      // Send to Electron app
      sendContextToElectron()
      
      // Also save to chrome.storage.local for session persistence
      if (currentTabData.isLocked) {
        const sessionKey = `session_${currentTabData.tabId}`
        chrome.storage.local.get([sessionKey], (result) => {
          if (result[sessionKey]) {
            const updatedSession = {
              ...result[sessionKey],
              context: currentTabData.context
            }
            chrome.storage.local.set({ [sessionKey]: updatedSession }, () => {
              console.log('✅ Context saved to session storage:', sessionKey)
            })
          }
        })
      }
      
      // Show success notification
      const notification = document.createElement('div')
      notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2147483650;
        background: linear-gradient(135deg, #4CAF50, #45a049); color: white;
        padding: 15px 20px; border-radius: 8px; font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); font-weight: bold;
      `
      notification.innerHTML = '✅ Context saved to active session!'
      document.body.appendChild(notification)
      
      setTimeout(() => {
        notification.remove()
      }, 3000)
      
      overlay.remove()
    })
    
    // Clear context
    document.getElementById('clear-context-btn')?.addEventListener('click', () => {
      if (confirm('Clear all context data?')) {
        const userText = document.getElementById('user-context-text') as HTMLTextAreaElement
        const publisherText = document.getElementById('publisher-context-text') as HTMLTextAreaElement
        userText.value = ''
        publisherText.value = ''
        document.getElementById('pdf-files-list').innerHTML = ''
      }
    })
  }

  function sendContextToElectron() {
    console.log('💾 Saving context to Electron app...')
    console.log('💾 currentTabData.context:', currentTabData.context)
    
    // Send context data to Electron app via WebSocket
    if (window.gridWebSocket && window.gridWebSocket.readyState === WebSocket.OPEN) {
      const contextData = {
        type: 'SAVE_CONTEXT',
        context: currentTabData.context,
        sessionId: currentTabData.tabId,
        timestamp: new Date().toISOString()
      }
      window.gridWebSocket.send(JSON.stringify(contextData))
      console.log('📄 Context sent to Electron app:', contextData)
    } else {
      console.log('❌ WebSocket not connected, cannot save context to Electron app')
    }
  }

  // Load session data from Electron app
  function loadSessionFromElectron(sessionId) {
    console.log('📂 Loading session from Electron app:', sessionId)
    
    if (window.gridWebSocket && window.gridWebSocket.readyState === WebSocket.OPEN) {
      window.gridWebSocket.send(JSON.stringify({
        type: 'LOAD_SESSION',
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      }))
      console.log('✅ Load session request sent to Electron app')
    } else {
      console.log('❌ WebSocket not connected, trying to connect...')
      const ws = new WebSocket('ws://localhost:51247')
      
      ws.onopen = () => {
        console.log('🔗 Connected to Electron app WebSocket')
        ws.send(JSON.stringify({
          type: 'LOAD_SESSION',
          sessionId: sessionId,
          timestamp: new Date().toISOString()
        }))
        console.log('✅ Load session request sent to Electron app')
        window.gridWebSocket = ws
      }
      
      ws.onerror = (error) => {
        console.log('❌ WebSocket connection failed:', error)
      }
    }
  }

  // Save full session data to Electron app
  function saveSessionToElectron(sessionId, sessionData) {
    console.log('💾 Saving full session to Electron app:', sessionId)
    
    if (window.gridWebSocket && window.gridWebSocket.readyState === WebSocket.OPEN) {
      window.gridWebSocket.send(JSON.stringify({
        type: 'SAVE_SESSION_DATA',
        sessionId: sessionId,
        sessionData: sessionData,
        timestamp: new Date().toISOString()
      }))
      console.log('✅ Session data sent to Electron app')
    } else {
      console.log('❌ WebSocket not connected, trying to connect...')
      const ws = new WebSocket('ws://localhost:51247')
      
      ws.onopen = () => {
        console.log('🔗 Connected to Electron app WebSocket')
        ws.send(JSON.stringify({
          type: 'SAVE_SESSION_DATA',
          sessionId: sessionId,
          sessionData: sessionData,
          timestamp: new Date().toISOString()
        }))
        console.log('✅ Session data sent to Electron app')
        window.gridWebSocket = ws
      }
      
      ws.onerror = (error) => {
        console.log('❌ WebSocket connection failed:', error)
      }
    }
  }

  // Initialize WebSocket connection to Electron app
  function initializeWebSocket() {
    if (window.gridWebSocket && window.gridWebSocket.readyState === WebSocket.OPEN) {
      return // Already connected
    }

    console.log('🔗 Initializing WebSocket connection to Electron app...')
    const ws = new WebSocket('ws://localhost:51247')
    
    ws.onopen = () => {
      console.log('✅ Connected to Electron app WebSocket')
      window.gridWebSocket = ws
    }
    
    ws.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data)
        console.log('📨 Received from Electron app:', response)
        
        switch (response.type) {
          case 'SESSION_LOADED':
            console.log('📂 Session loaded from Electron app:', response.sessionId)
            if (response.data) {
              // Update currentTabData with loaded session data
              if (response.data.context) {
                currentTabData.context = response.data.context
              }
              if (response.data.grid_config) {
                // Update display grids
                if (!currentTabData.displayGrids) {
                  currentTabData.displayGrids = []
                }
                const existingIndex = currentTabData.displayGrids.findIndex(g => 
                  g.sessionId === response.sessionId && g.layout === response.data.grid_config.layout
                )
                if (existingIndex >= 0) {
                  currentTabData.displayGrids[existingIndex].config = response.data.grid_config
                } else {
                  currentTabData.displayGrids.push({
                    sessionId: response.sessionId,
                    layout: response.data.grid_config.layout,
                    config: response.data.grid_config
                  })
                }
              }
              if (response.data.agents) {
                currentTabData.agents = response.data.agents
              }
              if (response.data.whitelist) {
                currentTabData.whitelist = response.data.whitelist
              }
              
              // Save to local storage
              saveTabDataToStorage()
              console.log('✅ Session data restored from Electron app')
            }
            break
            
          case 'CONTEXT_SAVED':
            console.log('✅ Context saved to Electron app')
            break
            
          case 'GRID_CONFIG_SAVED':
            console.log('✅ Grid config saved to Electron app')
            break
            
          case 'SESSION_DATA_SAVED':
            console.log('✅ Session data saved to Electron app')
            break
            
          case 'SESSIONS_LISTED':
            console.log('📋 Sessions listed from Electron app:', response.sessions)
            break
            
          default:
            console.log('ℹ️ Unknown message type from Electron app:', response.type)
        }
      } catch (error) {
        console.log('❌ Error parsing WebSocket message:', error)
      }
    }
    
    ws.onclose = (event) => {
      console.log('🔌 WebSocket connection closed:', event.code, event.reason)
      window.gridWebSocket = null
      
      // Retry connection after 5 seconds
      setTimeout(() => {
        if (!window.gridWebSocket || window.gridWebSocket.readyState !== WebSocket.OPEN) {
          initializeWebSocket()
        }
      }, 5000)
    }
    
    ws.onerror = (error) => {
      console.log('❌ WebSocket connection error:', error)
      window.gridWebSocket = null
    }
  }

  // Initialize WebSocket connection on page load
  initializeWebSocket()

  function openSettingsLightbox() {
    // Create settings lightbox
    const overlay = document.createElement('div')
    overlay.id = 'settings-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; height: 85vh; max-width: 1200px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">⚙️ Extension Settings</h2>
          <button id="close-settings-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex: 1; padding: 30px; overflow-y: auto;">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
            
            <!-- Display Ports -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🖥️ Display Ports</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Monitor Output:</label>
                  <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option selected>Electron App</option>
                    <option>Browser Window</option>
                    <option>Popup Window</option>
                  </select>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">API Endpoint:</label>
                  <input type="text" id="api-endpoint" value="localhost:51247" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Display Port Configuration:</label>
                  <button id="configure-display-ports" style="width: 100%; padding: 6px; background: #2196F3; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px;">🖥️ Configure Display Ports</button>
                </div>
              </div>
            </div>

            <!-- System Settings -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">⚙️ System</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Max Agents:</label>
                  <input type="number" value="10" min="5" max="20" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Memory (hours):</label>
                  <input type="number" value="24" min="1" max="168" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                </div>
                <button style="width: 100%; padding: 6px; background: #4CAF50; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px;">💾 Save Settings</button>
              </div>
            </div>

            <!-- Performance Settings -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">⚡ Performance</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Reasoning Speed:</label>
                  <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option>Conservative</option>
                    <option selected>Balanced</option>
                    <option>Aggressive</option>
                  </select>
          </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Auto-save Interval:</label>
                  <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option>30 seconds</option>
                    <option selected>60 seconds</option>
                    <option>2 minutes</option>
                    <option>5 minutes</option>
                  </select>
        </div>
      </div>
            </div>
            
            <!-- Privacy & Security -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🔒 Privacy & Security</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: flex; align-items: center;">
                    <input type="checkbox" checked style="margin-right: 6px;">
                    <span>Store sessions locally</span>
                  </label>
              </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: flex; align-items: center;">
                    <input type="checkbox" style="margin-right: 6px;">
                    <span>Share anonymous usage data</span>
                  </label>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: flex; align-items: center;">
                    <input type="checkbox" checked style="margin-right: 6px;">
                    <span>Enable encryption</span>
                  </label>
                </div>
              </div>
            </div>
            
            <!-- Appearance -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🎨 Appearance</h4>
              <div style="font-size: 10px; display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center;">
                <label style="display:block;">Theme:</label>
                <select id="optimando-theme-select" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                  <option value="default" selected>Default (Original)</option>
                  <option value="dark">Dark</option>
                  <option value="professional">Professional</option>
                </select>
                <div style="grid-column: 1 / span 2; font-size: 9px; opacity: 0.85;">Only sidebars and the top header bar are themed. Main page stays unchanged.</div>
              </div>
            </div>

            <!-- Advanced Options -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🔬 Advanced</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Debug Level:</label>
                  <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option selected>None</option>
                    <option>Basic</option>
                    <option>Verbose</option>
                    <option>Full</option>
                  </select>
              </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: flex; align-items: center;">
                    <input type="checkbox" style="margin-right: 6px;">
                    <span>Developer mode</span>
                  </label>
                </div>
              </div>
            </div>
            
            <!-- Export/Import -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">📦 Backup</h4>
              <div style="font-size: 10px;">
                <button style="width: 100%; margin-bottom: 6px; padding: 6px; background: #2196F3; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px;">📤 Export Settings</button>
                <button style="width: 100%; margin-bottom: 6px; padding: 6px; background: #FF9800; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px;">📥 Import Settings</button>
                <button style="width: 100%; padding: 6px; background: #F44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px;">🗑️ Reset All</button>
              </div>
            </div>
            
          </div>
          
          </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: center; background: rgba(255,255,255,0.05);">
          <button style="padding: 12px 30px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">
            💾 Save All Settings
          </button>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    document.getElementById('close-settings-lightbox').onclick = () => overlay.remove()
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    
    // Add event handler for display port configuration
    document.getElementById('configure-display-ports').onclick = () => {
      openDisplayPortsConfig(overlay)
    }

    // Theme select wiring
    const themeSelect = document.getElementById('optimando-theme-select') as HTMLSelectElement | null
    if (themeSelect) {
      // initialize from saved (keep default if none)
      try {
        const savedTheme = localStorage.getItem('optimando-ui-theme')
        if (savedTheme === 'dark' || savedTheme === 'professional') {
          themeSelect.value = savedTheme
        } else {
          themeSelect.value = 'default'
        }
      } catch {}

      themeSelect.addEventListener('change', () => {
        const theme = themeSelect.value
        try { localStorage.setItem('optimando-ui-theme', theme) } catch {}
        // apply only to extension UIs
        if (theme === 'default') {
          try { resetToDefaultTheme() } catch {}
        } else {
          try { applyTheme(theme) } catch {}
        }
      })
    }
  }

  function openDisplayPortsConfig(parentOverlay) {
    // Create display ports configuration dialog
    const configOverlay = document.createElement('div')
    configOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.9); z-index: 2147483650;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    configOverlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; max-width: 1200px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">🖥️ Display Ports Configuration</h2>
          <button id="close-display-config" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex: 1; padding: 30px; overflow-y: auto;">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
            
            <!-- Port 1 -->
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <h4 style="margin: 0 0 15px 0; font-size: 14px; color: #FFD700; font-weight: bold;">🖥️ Display Port #1</h4>
              <div style="font-size: 12px;">
                                <div style="margin-bottom: 12px;">
                  <label style="display: block; margin-bottom: 6px; font-size: 11px; font-weight: bold;">Output Type:</label>
                  <select id="port1-type" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px; border-radius: 4px; font-size: 11px;">
                    <option value="electron">Electron App</option>
                    <option value="browser">Browser Window</option>
                    <option value="popup">Popup Window</option>
                    <option value="overlay">Overlay</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                <div style="margin-bottom: 12px;">
                  <label style="display: block; margin-bottom: 6px; font-size: 11px; font-weight: bold;">Resolution:</label>
                  <select id="port1-resolution" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px; border-radius: 4px; font-size: 11px;">
                    <option value="auto">Auto</option>
                    <option value="1920x1080">1920x1080</option>
                    <option value="1366x768">1366x768</option>
                    <option value="800x600">800x600</option>
                  </select>
                </div>
                <div style="margin-bottom: 12px;">
                  <label style="display: block; margin-bottom: 6px; font-size: 11px; font-weight: bold;">Position:</label>
                  <select id="port1-position" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px; border-radius: 4px; font-size: 11px;">
                    <option value="center">Center</option>
                    <option value="top-left">Top Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Port 2 -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🖥️ Display Port #2</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Output Type:</label>
                  <select id="port2-type" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="electron">Electron App</option>
                    <option value="browser" selected>Browser Window</option>
                    <option value="popup">Popup Window</option>
                    <option value="overlay">Overlay</option>
                    <option value="disabled">Disabled</option>
                  </select>
        </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Resolution:</label>
                  <select id="port2-resolution" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="auto" selected>Auto</option>
                    <option value="1920x1080">1920x1080</option>
                    <option value="1366x768">1366x768</option>
                    <option value="800x600">800x600</option>
                  </select>
        </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Position:</label>
                  <select id="port2-position" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="center" selected>Center</option>
                    <option value="top-left">Top Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
            </select>
          </div>
              </div>
            </div>

            <!-- Port 3 -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🖥️ Display Port #3</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Output Type:</label>
                  <select id="port3-type" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="electron">Electron App</option>
                    <option value="browser">Browser Window</option>
                    <option value="popup" selected>Popup Window</option>
                    <option value="overlay">Overlay</option>
                    <option value="disabled">Disabled</option>
            </select>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Resolution:</label>
                  <select id="port3-resolution" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="auto">Auto</option>
                    <option value="1920x1080">1920x1080</option>
                    <option value="1366x768" selected>1366x768</option>
                    <option value="800x600">800x600</option>
                  </select>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Position:</label>
                  <select id="port3-position" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="center">Center</option>
                    <option value="top-left">Top Left</option>
                    <option value="top-right" selected>Top Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Port 4 -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🖥️ Display Port #4</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Output Type:</label>
                  <select id="port4-type" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="electron">Electron App</option>
                    <option value="browser">Browser Window</option>
                    <option value="popup">Popup Window</option>
                    <option value="overlay" selected>Overlay</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Resolution:</label>
                  <select id="port4-resolution" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="auto">Auto</option>
                    <option value="1920x1080">1920x1080</option>
                    <option value="1366x768">1366x768</option>
                    <option value="800x600" selected>800x600</option>
                  </select>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Position:</label>
                  <select id="port4-position" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="center">Center</option>
                    <option value="top-left">Top Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="bottom-left" selected>Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Port 5 -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🖥️ Display Port #5</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Output Type:</label>
                  <select id="port5-type" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="electron">Electron App</option>
                    <option value="browser">Browser Window</option>
                    <option value="popup">Popup Window</option>
                    <option value="overlay">Overlay</option>
                    <option value="disabled" selected>Disabled</option>
                  </select>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Resolution:</label>
                  <select id="port5-resolution" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="auto" selected>Auto</option>
                    <option value="1920x1080">1920x1080</option>
                    <option value="1366x768">1366x768</option>
                    <option value="800x600">800x600</option>
                  </select>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Position:</label>
                  <select id="port5-position" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="center" selected>Center</option>
                    <option value="top-left">Top Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Monitor Output -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">📺 Monitor Output</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">Output Type:</label>
                  <select id="monitor-type" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                    <option value="electron" selected>Electron App</option>
                    <option value="browser">Browser Window</option>
                    <option value="external">External Monitor</option>
                  </select>
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: block; margin-bottom: 3px;">API Port:</label>
                  <input type="number" id="monitor-port" value="51247" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
                </div>
                <div style="margin-bottom: 8px;">
                  <label style="display: flex; align-items: center; font-size: 9px;">
                    <input type="checkbox" id="monitor-autostart" style="margin-right: 6px;" checked>
                    <span>Auto-start monitor output</span>
            </label>
          </div>
        </div>
        </div>

          </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: flex-end; gap: 15px; background: rgba(255,255,255,0.05);">
          <button id="display-config-cancel" style="padding: 12px 24px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px;">Cancel</button>
          <button id="display-config-save" style="padding: 12px 24px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px;">💾 Save Display Ports</button>
        </div>
      </div>
    `
    
    document.body.appendChild(configOverlay)
    
    // Close handlers
    document.getElementById('close-display-config').onclick = () => configOverlay.remove()
    document.getElementById('display-config-cancel').onclick = () => configOverlay.remove()
    
    // Save handler
    document.getElementById('display-config-save').onclick = () => {
      // Save all display port configurations
      for (let i = 1; i <= 5; i++) {
        const type = document.getElementById(`port${i}-type`).value
        const resolution = document.getElementById(`port${i}-resolution`).value
        const position = document.getElementById(`port${i}-position`).value
        
        localStorage.setItem(`display_port_${i}`, JSON.stringify({
          type, resolution, position
        }))
      }
      
      // Save monitor configuration
      const monitorConfig = {
        type: document.getElementById('monitor-type').value,
        port: document.getElementById('monitor-port').value,
        autostart: document.getElementById('monitor-autostart').checked
      }
      localStorage.setItem('monitor_output', JSON.stringify(monitorConfig))
      
      // Show notification
      const notification = document.createElement('div')
      notification.style.cssText = `
        position: fixed;
        top: 60px;
        right: 20px;
        background: rgba(76, 175, 80, 0.9);
        color: white;
        padding: 10px 15px;
        border-radius: 5px;
        font-size: 12px;
        z-index: 2147483651;
      `
      notification.innerHTML = `💾 Display ports configuration saved!`
      document.body.appendChild(notification)
      
  setTimeout(() => {
        notification.remove()
      }, 2000)
      
      configOverlay.remove()
      console.log('Display ports configuration saved')
    }
    
    configOverlay.onclick = (e) => { if (e.target === configOverlay) configOverlay.remove() }
  }

  function openHelperGridLightbox() {
    // Create helper grid lightbox
    const overlay = document.createElement('div')
    overlay.id = 'helpergrid-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; max-width: 1000px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">🚀 Helper Grid Configuration</h2>
          <button id="close-helpergrid-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex: 1; padding: 30px; overflow-y: auto;">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
            
            <!-- Web Sources (renamed from Helper Tabs) -->
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; text-align: center;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #FFD700;">Web Sources</h3>
              <div id="helper-tabs-config" style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 15px; cursor: pointer; transition: all 0.3s ease; border: 2px solid transparent;" onmouseover="this.style.borderColor='rgba(255,255,255,0.3)'" onmouseout="this.style.borderColor='transparent'">
                <div style="font-size: 48px; margin-bottom: 10px;">🌐</div>
                <h4 style="margin: 0 0 8px 0; font-size: 14px;">Web Sources</h4>
                <p style="margin: 0; font-size: 11px; opacity: 0.7;">Configure multiple website tabs</p>
              </div>
          </div>
          
            <!-- Add Master View (renamed from Display Grid Screen) -->
            <div id="add-hybrid-grid-config" style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; text-align: center;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #FFD700;">Add Master View</h3>
              <div style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 15px; cursor: pointer; transition: all 0.3s ease; border: 2px solid transparent;" onmouseover="this.style.borderColor='rgba(255,255,255,0.3)'" onmouseout="this.style.borderColor='transparent'">
                <div style="font-size: 48px; margin-bottom: 10px;">🖥️</div>
                <h4 style="margin: 0 0 8px 0; font-size: 14px;">Add Hybrid Grid</h4>
                <p style="margin: 0; font-size: 11px; opacity: 0.7;">Layout display configurations</p>
              </div>
            </div>
            
            <!-- Display Grid Browser -->
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px; text-align: center;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #FFD700;">Display Grid Browser</h3>
              <div id="display-grid-browser-config" style="background: rgba(0,0,0,0.2); border-radius: 8px; padding: 15px; cursor: pointer; transition: all 0.3s ease; border: 2px solid transparent;" onmouseover="this.style.borderColor='rgba(255,255,255,0.3)'" onmouseout="this.style.borderColor='transparent'">
                <div style="font-size: 48px; margin-bottom: 10px;">🗂️</div>
                <h4 style="margin: 0 0 8px 0; font-size: 14px;">AI Output Grids</h4>
                <p style="margin: 0; font-size: 11px; opacity: 0.7;">AI agent display layouts</p>
              </div>
            </div>
            
              </div>
              </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: center; background: rgba(255,255,255,0.05);">
          <button id="helpergrid-close" style="padding: 12px 30px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">
            ✅ Close Configuration
          </button>
            </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    // Close handlers
    document.getElementById('close-helpergrid-lightbox').onclick = () => overlay.remove()
    document.getElementById('helpergrid-close').onclick = () => overlay.remove()
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    
    // Helper tabs configuration
    document.getElementById('helper-tabs-config').onclick = () => {
      overlay.remove()
      openHelperTabsConfig()
    }
    // Add Hybrid Grid configuration -> open select modal
    document.getElementById('add-hybrid-grid-config').onclick = () => {
      overlay.remove()
      openHybridMasterSelectModal()
    }
    
    // Display Grid Browser configuration
    document.getElementById('display-grid-browser-config').onclick = () => {
      overlay.remove()
      openDisplayGridBrowserConfig()
    }
  }

  function openHelperTabsConfig() {
    // Get existing URLs from localStorage
    const existingUrls = JSON.parse(localStorage.getItem('helper_tabs_urls') || '["https://chatgpt.com"]')
    
    // Generate URL fields HTML
    const generateUrlFieldsHTML = () => {
      return existingUrls.map((url, index) => `
        <div class="url-field-row" data-index="${index}" style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <input type="url" class="helper-url" value="${url}" style="flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white !important; -webkit-text-fill-color: white !important; padding: 10px; border-radius: 6px; font-size: 12px;" placeholder="https://example.com">
          <button class="add-url-btn" style="background: #4CAF50; border: none; color: white; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;" title="Add new URL field">+</button>
          <button class="remove-url-btn" style="background: #f44336; border: none; color: white; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; ${existingUrls.length <= 1 ? 'opacity: 0.5; pointer-events: none;' : ''}" title="Remove this URL field">×</button>
              </div>
      `).join('')
    }
    
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 85vw; max-width: 800px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">🌐 Web Sources Configuration</h2>
          <button id="close-helper-tabs" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
          </div>
        <div style="flex: 1; padding: 30px; overflow-y: auto;">
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #FFD700;">URLs Configuration</h3>
            <p style="margin: 0 0 20px 0; font-size: 12px; opacity: 0.8;">Add up to 10 URLs that will open in separate tabs when activated.</p>
            
            <div id="helper-url-fields-container">
              ${generateUrlFieldsHTML()}
            </div>
          </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: center; background: rgba(255,255,255,0.05);">
          <button id="save-helper-tabs" style="padding: 12px 30px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">
            🚀 Save & Open Web Sources
          </button>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    // Close handlers
    document.getElementById('close-helper-tabs').onclick = () => overlay.remove()
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    
    // URL field management
    const container = document.getElementById('helper-url-fields-container')
    
    const updateUrlFields = () => {
      container.innerHTML = generateUrlFieldsHTML()
      attachUrlFieldHandlers()
    }
    
    const attachUrlFieldHandlers = () => {
      container.querySelectorAll('.add-url-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (existingUrls.length < 10) {
            existingUrls.push('')
            updateUrlFields()
          }
        })
      })
      
      container.querySelectorAll('.remove-url-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.closest('.url-field-row').dataset.index)
          existingUrls.splice(index, 1)
          if (existingUrls.length === 0) existingUrls.push('')
          updateUrlFields()
        })
      })
    }
    
    attachUrlFieldHandlers()
    
    
    // Save configuration
    document.getElementById('save-helper-tabs').onclick = () => {
      const urls = Array.from(container.querySelectorAll('.helper-url'))
        .map(input => input.value.trim())
        .filter(url => url && url.length > 0)
      
      if (urls.length > 0) {
        // Save configuration to localStorage
        localStorage.setItem('helper_tabs_urls', JSON.stringify(urls))
        
        // IMMEDIATELY open the helper tabs
        urls.forEach((url, index) => {
          const agentId = index + 1
          const sessionId = Date.now()
          const urlWithParams = url + (url.includes('?') ? '&' : '?') + 
            `optimando_extension=disabled&session_id=${sessionId}&agent_id=${agentId}`
          
          setTimeout(() => {
            // Open in background without changing focus
            window.open(urlWithParams, `helper-tab-${index}`)
          }, index * 500)
        })
        
        // Store helper tabs data in current session
        currentTabData.helperTabs = {
          urls: urls,
          masterUrl: window.location.href,
          timestamp: new Date().toISOString()
        }
        
        // Save to localStorage
        saveTabDataToStorage()
        
        // AUTOMATICALLY save the session to chrome.storage.local (Sessions History)
        // Check if there's already a session for this tab to update instead of creating new
        chrome.storage.local.get(null, (allData) => {
          const existingSessions = Object.entries(allData)
            .filter(([key]) => key.startsWith('session_'))
            .map(([key, data]) => ({ id: key, ...data }))
            .filter(session => session.url === window.location.href)
            .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
          
          let sessionKey
          let sessionData
          
          if (existingSessions.length > 0) {
            // Update existing session, preserving display grids
            sessionKey = existingSessions[0].id
            sessionData = {
              ...existingSessions[0],
              helperTabs: currentTabData.helperTabs,
              timestamp: new Date().toISOString()
            }
            console.log('🌐 Updating existing session with helper tabs:', urls.length, 'tabs')
      } else {
            // Create new session
            sessionKey = `session_${Date.now()}`
            
            // If session name is still default, update it with current date-time
            if (!currentTabData.tabName || currentTabData.tabName.startsWith('WR Session')) {
              currentTabData.tabName = `WR Session ${new Date().toLocaleString('en-GB', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric', 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit',
                hour12: false 
              }).replace(/[\/,]/g, '-').replace(/ /g, '_')}`
            }
            
            sessionData = {
              ...currentTabData,
              timestamp: new Date().toISOString(),
              url: window.location.href
            }
            console.log('🌐 Creating new session with helper tabs:', urls.length, 'tabs')
          }
          
          chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
            console.log('✅ Helper tabs session saved:', sessionData.tabName, 'Session ID:', sessionKey)
            // Persist active session for this tab
            try { sessionStorage.setItem('optimando-current-session-key', sessionKey) } catch {}
            writeOptimandoState({ sessionKey })
            console.log('🌐 Session contains:', {
              helperTabs: sessionData.helperTabs ? sessionData.helperTabs.urls?.length || 0 : 0,
              displayGrids: sessionData.displayGrids ? sessionData.displayGrids.length : 0,
              agentBoxes: sessionData.agentBoxes ? sessionData.agentBoxes.length : 0
            })
          })
        })
        
        // Show notification
        const notification = document.createElement('div')
        notification.style.cssText = `
          position: fixed;
          top: 60px;
          right: 20px;
          background: rgba(76, 175, 80, 0.9);
          color: white;
          padding: 10px 15px;
          border-radius: 5px;
          font-size: 12px;
          z-index: 2147483651;
        `
        notification.innerHTML = `🚀 ${urls.length} Helper tabs opened! Session auto-saved to history.`
        document.body.appendChild(notification)
        
        setTimeout(() => {
          notification.remove()
        }, 3000)
        
        overlay.remove()
        console.log('🚀 Helper tabs opened and saved to session:', urls)
      } else {
        // Just save empty configuration
        localStorage.setItem('helper_tabs_urls', JSON.stringify(['https://chatgpt.com']))
        overlay.remove()
      }
    }
  }
  
  // Modal to select number of Hybrid Masters to open
  function openHybridMasterSelectModal() {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `

    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; max-width: 520px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column; max-height: 80vh;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 18px;">🧩 Add Master Views</h2>
          <button id="close-hybrid-select" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="padding: 24px; overflow-y: auto; flex: 1;">
          <label for="hybrid-count" style="display:block; margin-bottom:8px; font-size: 13px;">Number of hybrid master tabs</label>
          <select id="hybrid-count" style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.3); background: rgba(0,0,0,0.2); color: white; margin-bottom: 20px;">
            ${Array.from({ length: 5 }, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('')}
          </select>
          
          <div id="hybrid-url-fields" style="display: none;">
            <label style="display:block; margin-bottom:12px; font-size: 13px; color: #B3E5FC;">URLs for Hybrid Views</label>
            <div id="url-inputs-container"></div>
          </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: center; background: rgba(255,255,255,0.05);">
          <button id="hybrid-save-open" style="padding: 12px 30px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">🚀 Save & Open</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    const close = () => overlay.remove()
    document.getElementById('close-hybrid-select')!.onclick = close
    overlay.onclick = (e) => { if (e.target === overlay) close() }

    // Function to update URL fields based on selected count
    const updateUrlFields = () => {
      const countEl = document.getElementById('hybrid-count') as HTMLSelectElement
      const count = parseInt(countEl.value || '1', 10)
      const urlFieldsDiv = document.getElementById('hybrid-url-fields')!
      const urlContainer = document.getElementById('url-inputs-container')!
      
      if (count > 0) {
        urlFieldsDiv.style.display = 'block'
        
        // Clear existing inputs
        urlContainer.innerHTML = ''
        
        // Create URL inputs for each hybrid view
        for (let i = 1; i <= count; i++) {
          const inputWrapper = document.createElement('div')
          inputWrapper.style.cssText = 'margin-bottom: 12px;'
          
          inputWrapper.innerHTML = `
            <label style="display:block; margin-bottom:4px; font-size: 12px; color: #E1F5FE;">Hybrid View ${i} URL:</label>
            <input 
              type="url" 
              id="hybrid-url-${i}" 
              placeholder="https://example.com" 
              style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.3); background: rgba(0,0,0,0.2); color: white; font-size: 12px;"
            />
          `
          urlContainer.appendChild(inputWrapper)
        }
      } else {
        urlFieldsDiv.style.display = 'none'
      }
    }

    // Initialize URL fields and add change listener
    updateUrlFields()
    document.getElementById('hybrid-count')!.addEventListener('change', updateUrlFields)

    document.getElementById('hybrid-save-open')!.onclick = () => {
      const countEl = document.getElementById('hybrid-count') as HTMLSelectElement
      const count = Math.max(1, Math.min(5, parseInt(countEl.value || '1', 10)))

      // Collect URLs from input fields
      const hybridUrls: string[] = []
      for (let i = 1; i <= count; i++) {
        const urlInput = document.getElementById(`hybrid-url-${i}`) as HTMLInputElement
        const url = urlInput?.value?.trim() || ''
        hybridUrls.push(url)
      }

      // Get current session key and theme to share with hybrid views
      const currentSessionKey = getCurrentSessionKey()
      const currentTheme = localStorage.getItem('optimando-ui-theme') || 'default'
      console.log('🔧 DEBUG: Current session key for hybrid views:', currentSessionKey)
      console.log('🔧 DEBUG: Current theme for hybrid views:', currentTheme)

      // Open hybrid views with their respective URLs
      for (let i = 1; i <= count; i++) {
        let targetUrl = hybridUrls[i - 1]
        
        // If no URL provided, use current page as fallback
        if (!targetUrl) {
          const base = new URL(window.location.href)
          base.searchParams.delete('optimando_extension')
          targetUrl = base.toString()
        }
        
        // Add hybrid_master_id, session key, and theme parameters to the URL
        try {
          const url = new URL(targetUrl)
          url.searchParams.set('hybrid_master_id', String(i))
          if (currentSessionKey) {
            url.searchParams.set('optimando_session_key', currentSessionKey)
          }
          if (currentTheme && currentTheme !== 'default') {
            url.searchParams.set('optimando_theme', currentTheme)
          }
          window.open(url.toString(), `hybrid-master-${i}`)
          console.log(`🧩 Opened hybrid view ${i} with URL:`, url.toString())
        } catch (error) {
          console.error(`❌ Invalid URL for hybrid view ${i}:`, targetUrl, error)
          // Fallback to current page if URL is invalid
          const base = new URL(window.location.href)
          base.searchParams.delete('optimando_extension')
          base.searchParams.set('hybrid_master_id', String(i))
          if (currentSessionKey) {
            base.searchParams.set('optimando_session_key', currentSessionKey)
          }
          if (currentTheme && currentTheme !== 'default') {
            base.searchParams.set('optimando_theme', currentTheme)
          }
          window.open(base.toString(), `hybrid-master-${i}`)
        }
      }

      // Mirror hybrid placeholders into session history with URLs
      try {
        chrome.storage.local.get(null, (allData) => {
          // Use active session key instead of URL matching
          const activeKey = getCurrentSessionKey()
          if (!activeKey) return
          const sessionData = allData[activeKey]
          if (!sessionData) return
          sessionData.hybridAgentBoxes = Array.from({ length: count }, (_, idx) => ({ 
            id: String(idx + 1), 
            count: 4,
            url: hybridUrls[idx] || '' // Store the URL for session restoration
          }))
          sessionData.timestamp = new Date().toISOString()
          chrome.storage.local.set({ [activeKey]: sessionData }, () => {})
        })
      } catch {}

      const note = document.createElement('div')
      note.textContent = `✅ Opened ${count} hybrid master tab${count > 1 ? 's' : ''} with custom URLs`
      note.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#4CAF50;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
      document.body.appendChild(note)
      setTimeout(() => note.remove(), 2500)
      close()
    }
  }
  function openDisplayGridBrowserConfig() {
    console.log('🚀 LOADING GRIDS FOR CURRENT SESSION')
    console.log('🚀 Current tabId:', currentTabData.tabId)
    console.log('🚀 Session locked:', currentTabData.isLocked)
    
    let activeGridLayouts = new Set()
    
    // Method 1: Load from currentTabData.displayGrids (most accurate)
    if (currentTabData.displayGrids && Array.isArray(currentTabData.displayGrids)) {
      console.log('💾 Loading from currentTabData.displayGrids:', currentTabData.displayGrids.length)
      currentTabData.displayGrids.forEach(grid => {
        if (grid.layout) {
          activeGridLayouts.add(grid.layout)
        }
      })
    }
    
    console.log('💾 Active grids from currentTabData:', Array.from(activeGridLayouts))
    
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
    `
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 98vw; height: 95vh; color: white; overflow: hidden; display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 22px;">🗂️ Display Grid Browser Layouts</h2>
          <button id="close-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
                  <div style="flex: 1; padding: 20px;">
          <p style="margin: 0 0 20px 0; text-align: center; opacity: 0.8; font-size: 14px;">Select grid layouts to save and open. Multiple selections allowed.</p>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; height: calc(100% - 120px); overflow-y: auto;">
            
            <!-- ROW 1: 2-slot, 3-slot, 4-slot -->
            <div id="btn-2-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-2-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">2-Slot Layout</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#7</div>
                </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">Main + Secondary</p>
          </div>
          
            <div id="btn-3-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-3-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">3-Slot Layout</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#7</div>
                  <div style="background: rgba(255,152,0,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#8</div>
                </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">Primary + Dual</p>
            </div>

            <div id="btn-4-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-4-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">4-Slot Grid</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#7</div>
                  <div style="background: rgba(255,152,0,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#8</div>
                  <div style="background: rgba(156,39,176,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">#9</div>
              </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">2x2 Grid</p>
            </div>
            
            <!-- ROW 2: 5-slot, 6-slot, 7-slot -->
            <div id="btn-5-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-5-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">5-Slot Layout</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold; grid-row: span 2;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#7</div>
                  <div style="background: rgba(255,152,0,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#8</div>
                  <div style="background: rgba(156,39,176,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#9</div>
                  <div style="background: rgba(244,67,54,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#10</div>
              </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">Main + Side</p>
            </div>
            
            <div id="btn-6-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-6-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">6-Slot Grid</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#7</div>
                  <div style="background: rgba(255,152,0,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#8</div>
                  <div style="background: rgba(156,39,176,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#9</div>
                  <div style="background: rgba(244,67,54,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#10</div>
                  <div style="background: rgba(0,150,136,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#11</div>
              </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">3x2 Grid</p>
            </div>
            
            <div id="btn-7-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-7-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">7-Slot Grid</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold; grid-row: span 2;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#7</div>
                  <div style="background: rgba(255,152,0,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#8</div>
                  <div style="background: rgba(156,39,176,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#9</div>
                  <div style="background: rgba(244,67,54,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: bold;">#10</div>
                  <div style="background: rgba(0,150,136,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#11</div>
                  <div style="background: rgba(121,85,72,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#12</div>
              </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">Main + Grid</p>
            </div>
            
                        <!-- ROW 3: 8-slot, 9-slot, 10-slot -->
            <div id="btn-8-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-8-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">8-Slot Grid</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: 1fr 1fr; gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#7</div>
                  <div style="background: rgba(255,152,0,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#8</div>
                  <div style="background: rgba(156,39,176,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#9</div>
                  <div style="background: rgba(244,67,54,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#10</div>
                  <div style="background: rgba(0,150,136,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#11</div>
                  <div style="background: rgba(121,85,72,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#12</div>
                  <div style="background: rgba(158,158,158,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#13</div>
                </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">4x2 Grid</p>
          </div>
          
            <div id="btn-9-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-9-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">9-Slot Grid</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#7</div>
                  <div style="background: rgba(255,152,0,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#8</div>
                  <div style="background: rgba(156,39,176,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#9</div>
                  <div style="background: rgba(244,67,54,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#10</div>
                  <div style="background: rgba(0,150,136,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#11</div>
                  <div style="background: rgba(121,85,72,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#12</div>
                  <div style="background: rgba(158,158,158,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#13</div>
                  <div style="background: rgba(103,58,183,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold;">#14</div>
                </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">3x3 Grid</p>
            </div>

            <div id="btn-10-slot" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 15px; cursor: pointer; text-align: center; border: 2px solid transparent; position: relative;">
              <label style="position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; background: #FFD700; border: 3px solid #000; border-radius: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 1000;">
                <input type="checkbox" id="check-10-slot" style="width: 16px; height: 16px; cursor: pointer; margin: 0;">
              </label>
              <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #FFD700;">10-Slot Grid</h3>
              <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px; margin-bottom: 10px; height: 80px;">
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: 1fr 1fr; gap: 3px; height: 100%;">
                  <div style="background: rgba(76,175,80,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#6</div>
                  <div style="background: rgba(33,150,243,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#7</div>
                  <div style="background: rgba(255,152,0,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#8</div>
                  <div style="background: rgba(156,39,176,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#9</div>
                  <div style="background: rgba(244,67,54,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#10</div>
                  <div style="background: rgba(0,150,136,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#11</div>
                  <div style="background: rgba(121,85,72,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#12</div>
                  <div style="background: rgba(158,158,158,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#13</div>
                  <div style="background: rgba(103,58,183,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#14</div>
                  <div style="background: rgba(255,193,7,0.8); border-radius: 3px; display: flex; align-items: center; justify-content: center; font-size: 7px; font-weight: bold;">#15</div>
                </div>
              </div>
              <p style="margin: 0; font-size: 12px; opacity: 0.7;">5x2 Grid</p>
            </div>
            

          
            
          </div>
          <div style="padding: 20px; text-align: center;">
            <button id="save-open-grids" style="padding: 15px 30px; background: #666; border: none; color: white; border-radius: 8px; cursor: not-allowed; font-size: 14px; font-weight: bold; transition: all 0.3s ease;" disabled>
              🚀 Save & Open Grids
            </button>
          </div>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    // Close button handler
    document.getElementById('close-btn').onclick = () => overlay.remove()
    
    // Set initial checked state based on active grids
    const layoutMapping = {
      'check-2-slot': '2-slot',
      'check-3-slot': '3-slot', 
      'check-4-slot': '4-slot',
      'check-5-slot': '5-slot',
      'check-6-slot': '6-slot',
      'check-7-slot': '7-slot',
      'check-8-slot': '8-slot',
      'check-9-slot': '9-slot',
      'check-10-slot': '10-slot'
    }
    
    // SIMPLE: Apply selections immediately after DOM creation
    setTimeout(() => {
      console.log('🔧 APPLYING SELECTIONS:', Array.from(activeGridLayouts))
      
      Object.keys(layoutMapping).forEach(checkboxId => {
        const checkbox = document.getElementById(checkboxId) as HTMLInputElement
        const card = document.getElementById(checkboxId.replace('check-', 'btn-'))
        const layout = layoutMapping[checkboxId as keyof typeof layoutMapping]
        
        if (checkbox && activeGridLayouts.has(layout)) {
          console.log(`✅ CHECKING ${checkboxId} for ${layout}`)
          checkbox.checked = true
          if (card) {
            card.style.borderColor = '#4CAF50'
            card.style.background = 'rgba(76,175,80,0.2)'
          }
        }
      })
      
      updateSaveButton()
    }, 100)
    
    // Checkbox change handlers
    const checkboxes = ['check-2-slot', 'check-3-slot', 'check-4-slot', 'check-5-slot', 'check-6-slot', 'check-7-slot', 'check-8-slot', 'check-9-slot', 'check-10-slot']
    checkboxes.forEach(id => {
      const checkbox = document.getElementById(id)
      const card = document.getElementById(id.replace('check-', 'btn-'))
      
      checkbox.onchange = () => {
        if (checkbox.checked) {
          card.style.borderColor = '#4CAF50'
          card.style.background = 'rgba(76,175,80,0.2)'
        } else {
          card.style.borderColor = 'transparent'
          card.style.background = 'rgba(255,255,255,0.1)'
        }
        updateSaveButton()
        
        // IMMEDIATE SAVE: Save current selection to localStorage on every change
        const currentlySelected = checkboxes
          .filter(id => document.getElementById(id)?.checked)
          .map(id => layoutMapping[id as keyof typeof layoutMapping])
        
        const currentUrl = window.location.href.split('?')[0]
        const activeGridsKey = `active-grids-${btoa(currentUrl).substring(0, 20)}`
        localStorage.setItem(activeGridsKey, JSON.stringify(currentlySelected))
        console.log('💾 IMMEDIATE SAVE:', currentlySelected)
      }
      
      // Click on card toggles checkbox
      card.onclick = (e) => {
        if (e.target !== checkbox) {
          checkbox.checked = !checkbox.checked
          checkbox.onchange()
        }
      }
    })
    
    // Save & Open button handler
    document.getElementById('save-open-grids').onclick = () => {
      const selectedLayouts = checkboxes
        .filter(id => document.getElementById(id).checked)
        .map(id => layoutMapping[id as keyof typeof layoutMapping])
      
      if (selectedLayouts.length === 0) {
        alert('Please select at least one grid layout.')
        return
      }
      
      console.log('🗂️ Saving and opening selected grids:', selectedLayouts)
      
      // Initialize displayGrids if not exists
      if (!currentTabData.displayGrids) {
        currentTabData.displayGrids = []
      }
      
      // Track which grids are actually new and need to be opened
      const newGridsToOpen = []
      
      // Only add new grids for selected layouts that don't already exist
      selectedLayouts.forEach(layout => {
        // Check if this layout already exists
        const existingGrid = currentTabData.displayGrids.find(grid => grid.layout === layout)
        
        if (!existingGrid) {
          const gridSessionId = `grid_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
          const newGrid = {
            layout: layout,
            sessionId: gridSessionId,
            url: 'about:blank',
            timestamp: new Date().toISOString()
          }
          currentTabData.displayGrids.push(newGrid)
          newGridsToOpen.push(newGrid)
          console.log('✅ Added new grid:', layout, 'with sessionId:', gridSessionId)
        } else {
          console.log('⚠️ Grid already exists for layout:', layout, '- skipping')
        }
      })
      
      // Save to localStorage for immediate persistence
      saveTabDataToStorage()
      // FORCE UPDATE SESSION HISTORY - ALWAYS WORKS
      console.log('🔄 FORCE UPDATING SESSION HISTORY...')
      chrome.storage.local.get(null, (allData) => {
        console.log('📋 All stored data keys:', Object.keys(allData))
        
        // Get all sessions
        const allSessions = Object.entries(allData).filter(([key, value]) => 
          key.startsWith('session_')
        )
        console.log('📋 Found sessions:', allSessions.length)
        
        allSessions.forEach(([key, session]) => {
          console.log(`📋 Session ${key}:`, {
            tabName: session.tabName,
            tabId: session.tabId,
            url: session.url?.substring(0, 50),
            timestamp: session.timestamp
          })
        })
        
        // Try multiple methods to find the correct session
        let targetSessionKey = null
        let targetSessionData = null
        
        // Method 1: By tabId
        const sessionByTabId = allSessions.find(([key, value]) => 
          value.tabId === currentTabData.tabId
        )
        if (sessionByTabId) {
          [targetSessionKey, targetSessionData] = sessionByTabId
          console.log('✅ FOUND SESSION BY TABID:', targetSessionKey)
        }
        
        // Method 2: By URL (if tabId failed)
        if (!targetSessionKey) {
          const currentUrl = window.location.href.split('?')[0]
          const sessionByUrl = allSessions.find(([key, value]) => 
            value.url && value.url.split('?')[0] === currentUrl
          )
          if (sessionByUrl) {
            [targetSessionKey, targetSessionData] = sessionByUrl
            console.log('✅ FOUND SESSION BY URL:', targetSessionKey)
          }
        }
        
        // Method 3: Most recent session (last resort)
        if (!targetSessionKey && allSessions.length > 0) {
          const mostRecent = allSessions.sort((a, b) => 
            new Date(b[1].timestamp || 0).getTime() - new Date(a[1].timestamp || 0).getTime()
          )[0]
          [targetSessionKey, targetSessionData] = mostRecent
          console.log('✅ USING MOST RECENT SESSION:', targetSessionKey)
        }
        
        // Update the found session
        if (targetSessionKey && targetSessionData) {
          const updatedSessionData = {
            ...targetSessionData,
            displayGrids: currentTabData.displayGrids,
            timestamp: new Date().toISOString()
          }
          
          chrome.storage.local.set({ [targetSessionKey]: updatedSessionData }, () => {
            console.log('🎯 SUCCESS: Updated session in history!')
            console.log('🎯 Session key:', targetSessionKey)
            console.log('🎯 Grid count:', updatedSessionData.displayGrids.length)
            console.log('🎯 Grid layouts:', selectedLayouts)
            
            // Show success notification
            const notification = document.createElement('div')
            notification.innerHTML = `✅ Session updated with ${selectedLayouts.length} grids!`
            notification.style.cssText = `
              position: fixed; top: 20px; right: 20px; z-index: 2147483650;
              background: #4CAF50; color: white; padding: 12px 20px;
              border-radius: 8px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            `
            document.body.appendChild(notification)
            setTimeout(() => notification.remove(), 3000)
          })
        } else {
          console.log('❌ NO SESSION FOUND TO UPDATE!')
          
          // Show error notification
          const notification = document.createElement('div')
          notification.innerHTML = `❌ No session found to update. Please lock the session first!`
          notification.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 2147483650;
            background: #f44336; color: white; padding: 12px 20px;
            border-radius: 8px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          `
          document.body.appendChild(notification)
          setTimeout(() => notification.remove(), 5000)
        }
      })
      
      // BACKUP: Also save active grids to localStorage for reliable retrieval
      const currentUrl = window.location.href.split('?')[0]
      const activeGridsKey = `active-grids-${btoa(currentUrl).substring(0, 20)}`
      localStorage.setItem(activeGridsKey, JSON.stringify(selectedLayouts))
      console.log('💾 BACKUP: Saved active grids to localStorage:', selectedLayouts)
      
      // Open only the new grids that were actually added
      newGridsToOpen.forEach((grid, index) => {
        setTimeout(() => {
          openGridFromSession(grid.layout, grid.sessionId)
        }, index * 300)
      })
      
      // Show notification
      const notification = document.createElement('div')
      notification.innerHTML = '🗂️ ' + newGridsToOpen.length + ' new display grids opened! (' + currentTabData.displayGrids.length + ' total grids in session)'
      notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2147483650;
        background: #4CAF50; color: white; padding: 12px 20px;
        border-radius: 8px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `
      document.body.appendChild(notification)
      setTimeout(() => notification.remove(), 4000)
      
        overlay.remove()
      }
      
    function updateSaveButton() {
      const selectedCount = checkboxes.filter(id => document.getElementById(id).checked).length
      const saveBtn = document.getElementById('save-open-grids')
      
      if (selectedCount > 0) {
        saveBtn.innerHTML = `🚀 Save & Open ${selectedCount} Grid${selectedCount > 1 ? 's' : ''}`
        saveBtn.style.background = '#4CAF50'
        saveBtn.style.cursor = 'pointer'
        saveBtn.disabled = false
      } else {
        saveBtn.innerHTML = '🚀 Save & Open Grids'
        saveBtn.style.background = '#666'
        saveBtn.style.cursor = 'not-allowed'
        saveBtn.disabled = true
      }
    }
    
    // Initialize save button state
    updateSaveButton()
    
    // Close on background click
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
  }

  function saveGridToSession(layout) {
    console.log('🗂️ Saving grid to session:', layout)
    
    // Generate unique session identifier for this grid
    const gridSessionId = `grid_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
    
    // Store grid configuration in current session
    if (!currentTabData.displayGrids) {
      currentTabData.displayGrids = []
    }
    
    currentTabData.displayGrids.push({
      layout: layout,
      sessionId: gridSessionId,
      url: 'about:blank',
      timestamp: new Date().toISOString()
    })
    
    // Save to localStorage for persistence
    saveTabDataToStorage()
    
    // If session is locked, also update chrome.storage.local
    if (currentTabData.isLocked) {
      // Find and update existing session in chrome.storage.local
      chrome.storage.local.get(null, (allSessions) => {
        const sessionEntries = Object.entries(allSessions).filter(([key, value]) => 
          key.startsWith('session_') && value.tabId === currentTabData.tabId
        )
        
        if (sessionEntries.length > 0) {
          const [sessionKey, sessionData] = sessionEntries[0]
          const updatedSessionData = {
            ...sessionData,
            displayGrids: currentTabData.displayGrids,
            timestamp: new Date().toISOString()
          }
          
          chrome.storage.local.set({ [sessionKey]: updatedSessionData }, () => {
            console.log('🔒 Updated session with new grid:', layout)
          })
        }
      })
    }
    
    return gridSessionId
  }

  function createGridTab(layout) {
    console.log('🗂️ Selecting grid layout:', layout)
    
    // Generate unique session identifier for this grid
    const gridSessionId = `grid_${Date.now()}`
    
    // Store grid configuration in current session (but don't open yet)
    if (!currentTabData.displayGrids) {
      currentTabData.displayGrids = []
    }
    
    currentTabData.displayGrids.push({
      layout: layout,
      sessionId: gridSessionId,
      url: 'about:blank',
      timestamp: new Date().toISOString()
    })
    
    // Save to localStorage for persistence
    saveTabDataToStorage()
    
    // AUTOMATICALLY save the session to chrome.storage.local (Sessions History)
    // Check if there's already a session for this tab to update instead of creating new
    chrome.storage.local.get(null, (allData) => {
      const existingSessions = Object.entries(allData)
        .filter(([key]) => key.startsWith('session_'))
        .map(([key, data]) => ({ id: key, ...data }))
        .filter(session => session.url === window.location.href)
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
      
      let sessionKey
      let sessionData
      
      if (existingSessions.length > 0) {
        // Update existing session
        sessionKey = existingSessions[0].id
        sessionData = {
          ...existingSessions[0],
          displayGrids: currentTabData.displayGrids,
          timestamp: new Date().toISOString()
        }
        console.log('🗂️ Updating existing session with display grid:', layout)
      } else {
        // Create new session
        sessionKey = 'session_' + Date.now()
        
        // If session name is still default, update it with current date-time
        if (!currentTabData.tabName || currentTabData.tabName.startsWith('WR Session')) {
          currentTabData.tabName = 'WR Session ' + new Date().toLocaleString('en-GB', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: false 
          }).replace(/[\/,]/g, '-').replace(/ /g, '_')
        }
        
        sessionData = {
          ...currentTabData,
          timestamp: new Date().toISOString(),
          url: window.location.href
        }
        console.log('🗂️ Creating new session with display grid:', layout)
      }
      
      chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
        console.log('🗂️ Display grid session saved:', layout, 'Session ID:', sessionKey)
        console.log('🗂️ Session contains:', {
          helperTabs: sessionData.helperTabs ? sessionData.helperTabs.urls?.length || 0 : 0,
          displayGrids: sessionData.displayGrids ? sessionData.displayGrids.length : 0,
          agentBoxes: sessionData.agentBoxes ? sessionData.agentBoxes.length : 0
        })
      })
    })
    
    console.log('✅ Grid layout selected and saved:', layout, 'Session:', gridSessionId)
    
    // Show notification that grid was saved (not opened)
    const notification = document.createElement('div')
    notification.innerHTML = '🗂️ ' + layout.replace('-', ' ').toUpperCase() + ' display grid saved to session! Use "View All Sessions" to open it.'
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 2147483650;
      background: #4CAF50; color: white; padding: 12px 20px;
      border-radius: 8px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `
    document.body.appendChild(notification)
    setTimeout(() => notification.remove(), 4000)
  }
  
  function openGridFromSession(layout, sessionId) {
    console.log('🔍 DEBUG: Opening grid from session:', layout, sessionId)
    
    // Get current theme
    const currentTheme = localStorage.getItem('optimando-ui-theme') || 'default'
    
    // Create the complete HTML content for the new tab
    const gridHTML = createGridHTML(layout, sessionId, currentTheme)
    
    console.log('🔍 DEBUG: Generated HTML length:', gridHTML.length)
    console.log('🔍 DEBUG: HTML contains save button:', gridHTML.includes('save-grid-btn'))
    console.log('🔍 DEBUG: HTML contains slot-title:', gridHTML.includes('slot-title'))
    console.log('🔍 DEBUG: HTML contains Agent options:', gridHTML.includes('Agent 1'))
    
    // Create a new tab with the grid content
    const newTab = window.open('about:blank', 'grid-' + layout + '-' + sessionId)
    
    if (!newTab) {
      console.error('❌ Failed to open grid tab - popup blocked?')
      alert('Grid tab was blocked. Please allow popups for this site.')
      return
    }
    
    console.log('🔍 DEBUG: Writing HTML to new tab...')
    
    // Write the HTML content to the new tab
    newTab.document.write(gridHTML)
    newTab.document.close()
    
    // Set global variables in the new tab
    newTab.window.gridLayout = layout
    newTab.window.gridSessionId = sessionId
    
    console.log('✅ Grid tab opened from session:', layout)
    console.log('🔧 Set global variables:', { layout, sessionId })

    // Attach save handler from the opener (avoids CSP issues with inline scripts)
    attachGridSaveHandler(newTab, layout, sessionId)
  }
  function attachGridSaveHandler(gridWindow: Window, layout: string, sessionId: string) {
    const tryAttach = () => {
      try {
        const doc = gridWindow.document
        const btn = doc && doc.getElementById('save-grid-btn')
        if (!btn) {
          setTimeout(tryAttach, 150)
          return
        }

        console.log('🔧 Attaching save handler to grid tab:', layout, sessionId)
        btn.addEventListener('click', () => {
          try {
            const slotDivs = Array.from(doc.querySelectorAll('[data-slot-id]')) as HTMLElement[]
            const slots: any = {}
            slotDivs.forEach(div => {
              const id = div.getAttribute('data-slot-id') || ''
              const title = (div.querySelector('.slot-title') as HTMLInputElement)?.value || ''
              const agent = (div.querySelector('.slot-agent') as HTMLSelectElement)?.value || ''
              slots[id] = { title, agent }
            })

            const config = { layout, sessionId, slots }
            console.log('💾 Saving grid config from opener:', config)

            // Persist into in-memory session and localStorage
            persistGridConfig(config)

            // Show success in the child tab
            const note = doc.getElementById('success-notification')
            if (note) {
              note.style.display = 'block'
              note.style.opacity = '1'
              setTimeout(() => {
                note.style.opacity = '0'
                setTimeout(() => { note.style.display = 'none' }, 300)
              }, 1500)
            }
          } catch (err) {
            console.error('❌ Failed to save grid config from opener:', err)
          }
        })
      } catch (e) {
        setTimeout(tryAttach, 150)
      }
    }
    tryAttach()
  }

  function persistGridConfig(config: { layout: string, sessionId: string, slots: any }) {
    console.log('💾 persistGridConfig called with:', config)
    console.log('💾 currentTabData.tabId:', currentTabData.tabId)
    console.log('💾 currentTabData.isLocked:', currentTabData.isLocked)
    
    if (!currentTabData.displayGrids) currentTabData.displayGrids = []
    let entry: any = currentTabData.displayGrids.find(g => g.sessionId === config.sessionId && g.layout === config.layout)
    if (!entry) {
      entry = { layout: config.layout, sessionId: config.sessionId, url: '', timestamp: new Date().toISOString() }
      currentTabData.displayGrids.push(entry)
    }
    entry.config = { layout: config.layout, sessionId: config.sessionId, slots: config.slots }

    console.log('📊 Updated currentTabData.displayGrids:', currentTabData.displayGrids)

    // Persist local tab data
    saveTabDataToStorage()

    // If session is locked, find and update the correct session
    if (currentTabData.isLocked) {
    chrome.storage.local.get(null, (allData) => {
        console.log('🔍 All stored data keys:', Object.keys(allData))
      const allSessions = Object.entries(allData).filter(([key, value]: any) => key.startsWith('session_')) as any[]
        console.log('🔍 Found sessions:', allSessions.map(([key, value]: any) => ({ 
          key, 
          tabId: value.tabId, 
          url: value.url, 
          tabName: value.tabName,
          isLocked: value.isLocked 
        })))
        
        // Strategy 1: Find by exact tabId match
      let target: any = allSessions.find(([key, value]: any) => value.tabId === currentTabData.tabId)
        console.log('🔍 Target by exact tabId:', target)
        
        // Strategy 2: Find by URL match (most recent)
      if (!target) {
        const currentUrl = window.location.href.split('?')[0]
          const urlMatches = allSessions.filter(([key, value]: any) => 
            value.url && value.url.split('?')[0] === currentUrl
          )
          if (urlMatches.length > 0) {
            // Sort by timestamp and take the most recent
            urlMatches.sort((a, b) => new Date(b[1].timestamp).getTime() - new Date(a[1].timestamp).getTime())
            target = urlMatches[0]
            console.log('🔍 Target by URL (most recent):', target)
          }
        }
        
        // Strategy 3: Find by locked session with same tabName
        if (!target && currentTabData.tabName) {
          const nameMatches = allSessions.filter(([key, value]: any) => 
            value.tabName === currentTabData.tabName && value.isLocked
          )
          if (nameMatches.length > 0) {
            // Sort by timestamp and take the most recent
            nameMatches.sort((a, b) => new Date(b[1].timestamp).getTime() - new Date(a[1].timestamp).getTime())
            target = nameMatches[0]
            console.log('🔍 Target by tabName (most recent locked):', target)
          }
        }
        
      if (target) {
        const [sessionKey, sessionData] = target
          console.log('✅ Found target session:', sessionKey)
          
        const existing = Array.isArray(sessionData.displayGrids) ? sessionData.displayGrids : []
        let found = existing.find((g: any) => g.sessionId === config.sessionId && g.layout === config.layout)
        if (!found) {
          found = { layout: config.layout, sessionId: config.sessionId, url: '', timestamp: new Date().toISOString() }
          existing.push(found)
        }
        found.config = { layout: config.layout, sessionId: config.sessionId, slots: config.slots }
        const updatedSession = { ...sessionData, displayGrids: existing, timestamp: new Date().toISOString() }
          
          console.log('💾 Updating session with displayGrids:', updatedSession.displayGrids)
          
        chrome.storage.local.set({ [sessionKey]: updatedSession }, () => {
          console.log('✅ Mirrored grid config into session history:', sessionKey)
        })
        } else {
          console.log('❌ No target session found. Creating new session...')
          
          // Create a new session for this grid
          const sessionKey = `session_${Date.now()}`
          const sessionData = {
            ...currentTabData,
            displayGrids: currentTabData.displayGrids,
            timestamp: new Date().toISOString(),
            url: window.location.href
          }
          
          chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
            console.log('✅ Created new session for grid config:', sessionKey)
          })
        }
      })
    } else {
      console.log('ℹ️ Session not locked, grid config only saved locally')
    }
  }

  // Listen for save messages from grid tabs (about:blank child windows)
  window.addEventListener('message', (event) => {
    const data = (event && event.data) || null
    if (!data || data.type !== 'OPTIMANDO_SAVE_GRID' || !data.payload) return

    try {
      const payload = data.payload
      const sessionId = payload.sessionId
      const layout = payload.layout
      const slots = payload.slots || {}

      if (!currentTabData.displayGrids) currentTabData.displayGrids = []
      let entry = currentTabData.displayGrids.find(g => g.sessionId === sessionId && g.layout === layout)
      if (!entry) {
        entry = { layout, sessionId, url: '', timestamp: new Date().toISOString() } as any
        currentTabData.displayGrids.push(entry)
      }
      ;(entry as any).config = { layout, sessionId, slots }

      // Persist locally
      saveTabDataToStorage()

      // If locked, mirror to chrome.storage.local (update session for this tabId)
      if (currentTabData.isLocked) {
        chrome.storage.local.get(null, (allSessions) => {
          const sessionEntries = Object.entries(allSessions).filter(([key, value]: any) => 
            key.startsWith('session_') && value.tabId === currentTabData.tabId
          )
          if (sessionEntries.length > 0) {
            const [sessionKey, sessionData]: any = sessionEntries[0]
            const updatedSessionData = {
              ...sessionData,
              displayGrids: currentTabData.displayGrids,
              timestamp: new Date().toISOString()
            }
            chrome.storage.local.set({ [sessionKey]: updatedSessionData }, () => {
              // no-op
            })
          }
        })
      }

      // Visual feedback
      const note = document.createElement('div')
      note.textContent = '✅ Saved grid to session'
      note.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#4CAF50;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
      document.body.appendChild(note)
      setTimeout(() => note.remove(), 2500)
    } catch (err) {
      const note = document.createElement('div')
      note.textContent = '❌ Failed saving grid to session'
      note.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#f44336;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
      document.body.appendChild(note)
      setTimeout(() => note.remove(), 3000)
    }
  })
  
  function createGridHTML(layout, sessionId, theme = 'default') {
    // Configure grid layout
    const layouts = {
      '2-slot': { slots: 2, columns: '2fr 1fr', rows: 'auto' },
      '3-slot': { slots: 3, columns: '2fr 1fr 1fr', rows: 'auto' },
      '4-slot': { slots: 4, columns: '1fr 1fr', rows: '1fr 1fr' },
      '5-slot': { slots: 5, columns: '2fr 1fr 1fr', rows: '1fr 1fr' },
      '6-slot': { slots: 6, columns: '1fr 1fr 1fr', rows: '1fr 1fr' },
      '7-slot': { slots: 7, columns: '2fr 1fr 1fr', rows: '1fr 1fr' },
      '8-slot': { slots: 8, columns: 'repeat(4, 1fr)', rows: '1fr 1fr' },
      '9-slot': { slots: 9, columns: 'repeat(3, 1fr)', rows: 'repeat(3, 1fr)' },
      '10-slot': { slots: 10, columns: 'repeat(5, 1fr)', rows: '1fr 1fr' }
    }
    
    const config = layouts[layout] || layouts['4-slot']

    // Prefill from currentTabData if a config exists
    console.log('🔍 DEBUG: createGridHTML - currentTabData.displayGrids:', currentTabData.displayGrids)
    console.log('🔍 DEBUG: createGridHTML - looking for sessionId:', sessionId, 'layout:', layout)
    
    const entry = (currentTabData && currentTabData.displayGrids)
      ? currentTabData.displayGrids.find(g => g.sessionId === sessionId && g.layout === layout)
      : null
    console.log('🔍 DEBUG: createGridHTML - found entry:', entry)
    
    const savedSlots: any = (entry && (entry as any).config && (entry as any).config.slots) ? (entry as any).config.slots : {}
    console.log('🔍 DEBUG: createGridHTML - savedSlots:', savedSlots)
    
    // Create slots HTML
    let slotsHTML = ''
    for (let i = 1; i <= config.slots; i++) {
      const slotNum = i + 5 // Start from #6
      
      let gridRowStyle = ''
      if (layout === '5-slot' && i === 1) gridRowStyle = 'grid-row: span 2;'
      if (layout === '7-slot' && i === 1) gridRowStyle = 'grid-row: span 2;'
      
      const savedTitle = (savedSlots[String(slotNum)] && savedSlots[String(slotNum)].title) ? savedSlots[String(slotNum)].title : `Display Port ${slotNum}`
      const savedAgent = (savedSlots[String(slotNum)] && savedSlots[String(slotNum)].agent) ? savedSlots[String(slotNum)].agent : ''
      const sel = (val: string) => (savedAgent === val ? ' selected' : '')

      // Use theme-specific colors for title bars
      let headerColor = '#e5e4e2' // default calm color
      let textColor = '#333' // default text color
      let inputBg = 'rgba(255,255,255,0.8)' // default input background
      let inputBorder = 'rgba(0,0,0,0.2)' // default input border
      let slotBg = 'white' // default slot background
      
      if (theme === 'default') {
        headerColor = '#667eea' // solid purple color matching the screenshot
        textColor = 'white'
        inputBg = 'rgba(255,255,255,0.2)'
        inputBorder = 'rgba(255,255,255,0.3)'
        slotBg = 'white'
      } else if (theme === 'dark') {
        headerColor = 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)' // dark gradient
        textColor = 'white'
        inputBg = 'rgba(255,255,255,0.2)'
        inputBorder = 'rgba(255,255,255,0.3)'
        slotBg = 'black'
      } else if (theme === 'professional') {
        headerColor = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)' // professional light gradient
        textColor = '#1e293b'
        inputBg = 'rgba(255,255,255,0.8)'
        inputBorder = 'rgba(0,0,0,0.2)'
        slotBg = 'white'
      }
      
      slotsHTML += `
        <div data-slot-id="${slotNum}" style="background: ${slotBg} !important; border: 2px solid #666; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); ${gridRowStyle}">
          <div style="background: ${headerColor}; padding: 6px 8px; font-size: 11px; display: flex; justify-content: space-between; align-items: center; border-radius: 8px 8px 0 0; min-height: 32px; flex-shrink: 0;">
            <div style="display: flex; align-items: center; color: ${textColor}; font-weight: bold; min-width: 0; flex: 1;">
              <span style="margin-right: 4px; white-space: nowrap;">#${slotNum}</span>
              <span style="margin-right: 4px;">🖥️</span>
              <input type="text" class="slot-title" value="${savedTitle.replace(/"/g, '&quot;')}" placeholder="Title..." style="background: ${inputBg}; border: 1px solid ${inputBorder}; color: ${textColor}; padding: 2px 6px; border-radius: 4px; font-size: 10px; width: 120px; font-weight: bold; margin-right: 6px; min-width: 60px; max-width: 150px;">
            </div>
            <div style="display: flex; align-items: center; flex-shrink: 0;">
              <select class="slot-agent" style="background: ${inputBg}; color: ${textColor}; border: 1px solid ${inputBorder}; padding: 2px 4px; border-radius: 4px; font-size: 9px; margin-right: 4px; min-width: 80px; max-width: 100px;">
                <option value="">Agent</option>
                <option value="agent1"${sel('agent1')}>Agent 1</option>
                <option value="agent2"${sel('agent2')}>Agent 2</option>
                <option value="agent3"${sel('agent3')}>Agent 3</option>
                <option value="agent4"${sel('agent4')}>Agent 4</option>
                <option value="agent5"${sel('agent5')}>Agent 5</option>
                <option value="agent6"${sel('agent6')}>Agent 6</option>
                <option value="agent7"${sel('agent7')}>Agent 7</option>
                <option value="agent8"${sel('agent8')}>Agent 8</option>
                <option value="agent9"${sel('agent9')}>Agent 9</option>
                <option value="agent10"${sel('agent10')}>Agent 10</option>
              </select>
              <button class="close-slot" style="background: ${theme === 'professional' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'}; border: none; color: ${textColor}; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">×</button>
            </div>
          </div>
          <div style="flex: 1; display: flex; align-items: center; justify-content: center; font-size: 14px; color: ${theme === 'dark' ? 'white' : '#333'}; text-align: center; padding: 16px; background: ${slotBg} !important; min-height: 0;">
          </div>
        </div>
      `
    }
    
    // Theme background/text for page
    let bodyBg = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    let bodyText = '#ffffff'
    if (theme === 'dark') {
      bodyBg = 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)'
      bodyText = '#ffffff'
    } else if (theme === 'professional') {
      bodyBg = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
      bodyText = '#333333'
    } else if (theme === 'default') {
      bodyBg = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      bodyText = '#ffffff'
    }
    // Return complete HTML document
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>AI Grid - ${layout.toUpperCase()}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: ${bodyBg};
            color: ${bodyText}; height: 100vh; overflow: hidden;
          }
          .grid { 
            width: 100vw; height: 100vh; display: grid; gap: 0px; padding: 0px;
            grid-template-columns: ${config.columns};
            ${config.rows !== 'auto' ? 'grid-template-rows: ' + config.rows + ';' : ''}
          }
        </style>
      </head>
      <body>
        <div class="grid">
          ${slotsHTML}
        </div>
        
        <!-- Navigation Arrows for Slide Mode -->
        <div id="nav-arrows" style="
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          display: none;
          justify-content: space-between;
          pointer-events: none;
          z-index: 1000;
        ">
          <button id="prev-slide" style="
            background: rgba(0,0,0,0.7);
            border: none;
            color: white;
            font-size: 24px;
            padding: 10px 15px;
            cursor: pointer;
            pointer-events: auto;
            border-radius: 0 5px 5px 0;
          ">‹</button>
          <button id="next-slide" style="
            background: rgba(0,0,0,0.7);
            border: none;
            color: white;
            font-size: 24px;
            padding: 10px 15px;
            cursor: pointer;
            pointer-events: auto;
            border-radius: 5px 0 0 5px;
          ">›</button>
        </div>
        
        <!-- Control Buttons Container -->
        <div style="
          position: fixed;
          bottom: 20px;
          right: 20px;
          display: flex;
          gap: 10px;
          z-index: 1000;
        ">
          <!-- Save Grid Button -->
          <button id="save-grid-btn" style="
          padding: 12px 20px;
          background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
          border: none;
          color: white;
          border-radius: 12px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
          transition: all 0.3s ease;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        " onmouseover="this.style.background='linear-gradient(135deg, #45a049 0%, #3d8b40 100%)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(76, 175, 80, 0.4)'" onmouseout="this.style.background='linear-gradient(135deg, #4CAF50 0%, #45a049 100%)'; this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(76, 175, 80, 0.3)'">
          💾 Save Grid
        </button>
          
          <!-- Fullscreen Button -->
          <button id="fullscreen-btn" style="
            width: 48px;
            height: 48px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border: none;
            color: white;
            border-radius: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
            transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          " title="Fullscreen" onmouseover="this.style.background='linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 16px rgba(102, 126, 234, 0.4)'" onmouseout="this.style.background='linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.3)'">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
        </div>
        
        <!-- Success Notification -->
        <div id="success-notification" style="
          position: fixed;
          top: 20px;
          right: 20px;
          padding: 12px 20px;
          background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
          color: white;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
          z-index: 1001;
          display: none;
          opacity: 0;
          transition: all 0.3s ease;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        ">
          ✅ Grid saved to session!
        </div>
        
        <script src="${chrome.runtime.getURL('grid-script.js')}"></script>
        <script>
          console.log('✅ Grid loaded successfully:', '${layout}', 'Session:', '${sessionId}');
          document.title = 'AI Grid - ${layout.toUpperCase()}';
          
          const sessionId = '${sessionId}';
          const layout = '${layout}';
          
          // SIMPLE SAVE FUNCTION
          function saveGridConfig() {
            console.log('💾 SAVING GRID CONFIG...');
            
            const config = {
              layout: layout,
              sessionId: sessionId,
              timestamp: new Date().toISOString(),
              slots: {}
            };
            
            // Collect slot data
            document.querySelectorAll('[data-slot-id]').forEach(slot => {
              const slotId = slot.getAttribute('data-slot-id');
              const titleInput = slot.querySelector('.slot-title');
              const agentSelect = slot.querySelector('.slot-agent');
              
              config.slots[slotId] = {
                title: titleInput ? titleInput.value : '',
                agent: agentSelect ? agentSelect.value : ''
              };
            });
            
            // Save to localStorage with simple key
            const saveKey = 'grid_' + sessionId + '_' + layout;
            localStorage.setItem(saveKey, JSON.stringify(config));
            
            console.log('✅ SAVED TO LOCALSTORAGE:', saveKey, config);
            
            // Show success notification
            const notification = document.getElementById('success-notification');
            if (notification) {
              notification.style.display = 'block';
              notification.style.opacity = '1';
              setTimeout(() => {
                notification.style.opacity = '0';
                setTimeout(() => notification.style.display = 'none', 300);
              }, 2000);
            }
          }
          
          // SIMPLE LOAD FUNCTION
          function loadGridConfig() {
            console.log('📂 LOADING GRID CONFIG...');
            
            const saveKey = 'grid_' + sessionId + '_' + layout;
            const saved = localStorage.getItem(saveKey);
            
            if (saved) {
              try {
                const config = JSON.parse(saved);
                console.log('📂 LOADED CONFIG:', config);
                
                // Apply config to slots
                Object.keys(config.slots || {}).forEach(slotId => {
                  const slot = document.querySelector('[data-slot-id="' + slotId + '"]');
                  if (slot) {
                    const titleInput = slot.querySelector('.slot-title');
                    const agentSelect = slot.querySelector('.slot-agent');
                    
                    if (titleInput && config.slots[slotId].title) {
                      titleInput.value = config.slots[slotId].title;
                    }
                    if (agentSelect && config.slots[slotId].agent) {
                      agentSelect.value = config.slots[slotId].agent;
                    }
                  }
                });
              } catch (e) {
                console.error('❌ Error loading config:', e);
              }
            } else {
              console.log('📂 No saved config found for:', saveKey);
            }
          }
          
          // Attach save button
          document.addEventListener('DOMContentLoaded', () => {
            const saveBtn = document.getElementById('save-grid-btn');
            if (saveBtn) {
              saveBtn.addEventListener('click', saveGridConfig);
              console.log('✅ Save button listener attached');
            }
            
            // Load existing config
            loadGridConfig();
          });
          
          // Also attach immediately if DOM already loaded
          if (document.readyState !== 'loading') {
            const saveBtn = document.getElementById('save-grid-btn');
            if (saveBtn) {
              saveBtn.addEventListener('click', saveGridConfig);
              console.log('✅ Save button listener attached (immediate)');
            }
            loadGridConfig();
          }
        </script>
        <script src="chrome-extension://${chrome.runtime.id}/grid-script.js"></script>
      </body>
      </html>
    `
  }
  


  function openSessionsLightbox() {
    // Create sessions lightbox
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    // Get saved sessions from chrome.storage.local
    chrome.storage.local.get(null, (allData) => {
      const sessions = Object.entries(allData)
        .filter(([key]) => key.startsWith('session_'))
        .map(([key, data]) => ({ id: key, ...data }))
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
      
      const generateSessionsHTML = () => {
        if (sessions.length === 0) {
          return '<div style="text-align: center; padding: 40px; opacity: 0.7;"><p>No saved sessions found</p></div>'
        }
        
                return sessions.map(session => `
          <div style="margin-bottom: 16px;">
            <!-- Session title outside the box -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 4px;">
              <h4 style="margin: 0; font-size: 16px; font-weight: bold; color: #FFEF94; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${session.tabName || 'Unnamed Session'}</h4>
              <div style="display: flex; gap: 6px;">
                <button class="rename-session-btn" data-session-id="${session.id}" style="background: linear-gradient(135deg, #2196F3, #1976D2); border: none; color: white; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; transition: all 0.2s ease;" title="Rename session" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">✏️</button>
                <button class="delete-session-btn" data-session-id="${session.id}" style="background: linear-gradient(135deg, #f44336, #d32f2f); border: none; color: white; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; transition: all 0.2s ease;" title="Delete session" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">🗑️</button>
        </div>
            </div>
            <!-- Session box with content -->
            <div class="session-item" data-session-id="${session.id}" style="background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%); border-radius: 12px; padding: 14px; cursor: pointer; transition: all 0.3s ease; border: 2px solid transparent; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" onmouseover="this.style.borderColor='rgba(255,255,255,0.4)'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(0,0,0,0.2)'" onmouseout="this.style.borderColor='transparent'; this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.1)'">
              <div class="session-content" style="cursor: pointer;">
                <p style="margin: 0 0 8px 0; font-size: 12px; color: #F0F0F0; opacity: 0.9;">${session.url || 'No URL'}</p>
                
                ${session.agentBoxes && session.agentBoxes.length > 0 ? `
                  <div style=\"background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; padding: 10px; margin: 8px 0;\">
                    <span style=\"font-size: 11px; font-weight: bold; color: #FFB366;\">📦 Master Agent Boxes (${session.agentBoxes.length})</span>
                  </div>
                ` : ''}

                ${session.hybridAgentBoxes && session.hybridAgentBoxes.length > 0 ? `
                  <div style=\"background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; padding: 10px; margin: 8px 0;\">
                    <span style=\"font-size: 11px; font-weight: bold; color: #B3E5FC;\">🧩 Hybrid Views (${session.hybridAgentBoxes.length})</span>
                    <div style=\"display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;\">
                      ${session.hybridAgentBoxes
                        .sort((a,b) => parseInt(a.id) - parseInt(b.id))
                        .map(h => `<span style=\\\"background: rgba(33,150,243,0.9); color: white; padding: 3px 8px; border-radius: 10px; font-size: 10px;\\\">HM-${h.id} (${h.count})</span>`)
                        .join('')}
                    </div>
                  </div>
                ` : ''}
                
                ${session.helperTabs && session.helperTabs.urls && session.helperTabs.urls.length > 0 ? `
                  <div style="background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; padding: 12px; margin: 10px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <span style="font-size: 12px; font-weight: bold; color: #66FF66;">🌐 Web Sources (${session.helperTabs.urls.length})</span>
                      <button class="edit-helper-tabs-btn" data-session-id="${session.id}" style="background: #FF6B35; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;" title="Edit helper tabs">✏️ Edit</button>
          </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                      ${session.helperTabs.urls.map((url, index) => `
                        <span style="background: rgba(102,255,102,0.25); color: white; border: 1px solid rgba(102,255,102,0.5); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${url}">${url.replace('https://', '').replace('http://', '').split('/')[0]}</span>
                      `).join('')}
          </div>
        </div>
                ` : ''}
                
                ${session.displayGrids && session.displayGrids.length > 0 ? `
                  <div style="background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; padding: 12px; margin: 10px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <span style="font-size: 12px; font-weight: bold; color: #FFB366;">🗂️ Display Grids (${session.displayGrids.length})</span>
                      <button class="edit-display-grids-btn" data-session-id="${session.id}" style="background: #FF8C00; border: none; color: white; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: bold;" title="Edit display grids">✏️ Edit</button>
        </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                      ${session.displayGrids.map((grid, index) => `
                        <span style="background: rgba(255,179,102,0.25); color: white; border: 1px solid rgba(255,179,102,0.5); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;" title="${grid.layout} - ${grid.sessionId}">${grid.layout}</span>
                      `).join('')}
        </div>
        </div>
                ` : ''}
                
                ${session.context && (session.context.userContext?.text || session.context.publisherContext?.text || (session.context.userContext?.pdfFiles && session.context.userContext.pdfFiles.length > 0)) ? `
                  <div style="background: rgba(255,255,255,0.25); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; padding: 12px; margin: 10px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                      <span style="font-size: 12px; font-weight: bold; color: #E6E6FA;">📄 Attached Context</span>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                      ${session.context.userContext?.text ? `
                        <span style="background: rgba(230,230,250,0.25); color: white; border: 1px solid rgba(230,230,250,0.5); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;" title="User Context: ${session.context.userContext.text.substring(0, 100)}${session.context.userContext.text.length > 100 ? '...' : ''}">👤 User Context (${session.context.userContext.text.length} chars)</span>
                      ` : ''}
                      ${session.context.publisherContext?.text ? `
                        <span style="background: rgba(230,230,250,0.25); color: white; border: 1px solid rgba(230,230,250,0.5); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;" title="Publisher Context: ${session.context.publisherContext.text.substring(0, 100)}${session.context.publisherContext.text.length > 100 ? '...' : ''}">🌐 Publisher Context (${session.context.publisherContext.text.length} chars)</span>
                      ` : ''}
                      ${session.context.userContext?.pdfFiles && session.context.userContext.pdfFiles.length > 0 ? `
                        <span style="background: rgba(230,230,250,0.25); color: white; border: 1px solid rgba(230,230,250,0.5); padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500;" title="PDF Files: ${session.context.userContext.pdfFiles.map(f => f.name).join(', ')}">📎 PDF Files (${session.context.userContext.pdfFiles.length})</span>
                      ` : ''}
        </div>
        </div>
                ` : ''}
              </div>
            </div>
            <!-- Date outside the box at the bottom -->
            <div style="padding: 4px 4px 0 4px;">
              <span style="font-size: 10px; color: #D0D0D0; opacity: 0.7;">📅 ${session.timestamp ? new Date(session.timestamp).toLocaleString() : 'No date'}</span>
            </div>
          </div>
        `).join('')
      }
      
      overlay.innerHTML = `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; max-width: 900px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
          <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
            <h2 style="margin: 0; font-size: 20px;">📚 Sessions History</h2>
            <button id="close-sessions-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
          </div>
          <div style="flex: 1; padding: 30px; overflow-y: auto;">
            <div id="sessions-list">
              ${generateSessionsHTML()}
            </div>
          </div>
          <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: center; background: rgba(255,255,255,0.05);">
            <button id="clear-all-sessions" style="padding: 12px 30px; background: #f44336; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">
              🗑️ Clear All Sessions
            </button>
        </div>
      </div>
    `
    
      document.body.appendChild(overlay)
      
      // Close handlers
      document.getElementById('close-sessions-lightbox').onclick = () => overlay.remove()
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
      
      // Session click handlers - make entire session clickable
      overlay.querySelectorAll('.session-item').forEach(sessionEl => {
        sessionEl.addEventListener('click', (e) => {
          // Don't trigger if clicking on action buttons
          if (e.target.classList.contains('rename-session-btn') || 
              e.target.classList.contains('delete-session-btn')) {
            return
          }
          
          const sessionId = sessionEl.dataset.sessionId
          const sessionData = sessions.find(s => s.id === sessionId)
          
          if (sessionData) {
            console.log('🔧 DEBUG: Session data:', sessionData)
            console.log('🔧 DEBUG: Helper tabs data:', sessionData.helperTabs)
            
            // Close overlay immediately to preserve user gesture for window.open
            try { overlay.remove() } catch {}
            
            // Persist active session key in this tab
            try { sessionStorage.setItem('optimando-current-session-key', sessionId) } catch {}
            writeOptimandoState({ sessionKey: sessionId })

            // Don't navigate immediately - this breaks the helper tabs opening
            // Instead, store the target URL and navigate after opening helper tabs
            const targetUrl = sessionData.url
            
            // Restore helper tabs FIRST if they exist
            if (sessionData.helperTabs && sessionData.helperTabs.urls && sessionData.helperTabs.urls.length > 0) {
              console.log('🔧 DEBUG: Opening', sessionData.helperTabs.urls.length, 'helper tabs:', sessionData.helperTabs.urls)
              
              // Open helper tabs immediately (no setTimeout to avoid popup blockers)
              sessionData.helperTabs.urls.forEach((url, index) => {
                const agentId = index + 1
                const sessionId = Date.now()
                const urlWithParams = url + (url.includes('?') ? '&' : '?') + 
                  `optimando_extension=disabled&session_id=${sessionId}&agent_id=${agentId}`
                
                console.log(`🔧 DEBUG: Opening helper tab ${index + 1}:`, urlWithParams)
                
                // Open immediately to preserve user gesture for popup blocker
                const newTab = window.open(urlWithParams, `helper-tab-${index}`)
                if (!newTab) {
                  console.error(`❌ Failed to open helper tab ${index + 1} - popup blocked:`, url)
                } else {
                  console.log(`✅ Successfully opened helper tab ${index + 1}:`, url)
                }
              })
              
              // Restore current session data with helper tabs
              currentTabData = {
                ...currentTabData,
                ...sessionData,
                tabId: currentTabData.tabId  // Keep current tab ID
              }
              
              // Save restored data to localStorage to persist it
              saveTabDataToStorage()
              
              console.log('🔧 DEBUG: Session restored - currentTabData.agentBoxes:', currentTabData.agentBoxes)
              console.log('🔧 DEBUG: Session restored - currentTabData.context:', currentTabData.context)
              
              // Re-render agent boxes with restored configuration
              setTimeout(() => {
                console.log('🔧 DEBUG: About to re-render agent boxes with:', currentTabData.agentBoxes?.length || 0, 'boxes')
                renderAgentBoxes()
              }, 200)
              
              // Restore hybrid views if they exist
              if (sessionData.hybridAgentBoxes && sessionData.hybridAgentBoxes.length > 0) {
                console.log('🔧 DEBUG: Restoring', sessionData.hybridAgentBoxes.length, 'hybrid views')
                
                setTimeout(() => {
                  sessionData.hybridAgentBoxes.forEach((hybridBox, index) => {
                    const hybridId = hybridBox.id || String(index + 1)
                    
                    // Use stored URL if available, otherwise fall back to target URL
                    let hybridUrl = hybridBox.url || targetUrl
                    
                    try {
                      const url = new URL(hybridUrl)
                      url.searchParams.delete('optimando_extension')
                      url.searchParams.set('hybrid_master_id', hybridId)
                      url.searchParams.set('optimando_session_key', sessionId)
                      
                      // Add theme if available
                      const currentTheme = localStorage.getItem('optimando-ui-theme')
                      if (currentTheme && currentTheme !== 'default') {
                        url.searchParams.set('optimando_theme', currentTheme)
                      }
                      
                      console.log(`🔧 DEBUG: Opening hybrid view ${hybridId} with URL:`, url.toString())
                      const hybridTab = window.open(url.toString(), `hybrid-master-${hybridId}`)
                      
                      if (!hybridTab) {
                        console.error(`❌ Failed to open hybrid view ${hybridId} - popup blocked`)
                      } else {
                        console.log(`✅ Successfully opened hybrid view ${hybridId}`)
                      }
                    } catch (error) {
                      console.error(`❌ Invalid URL for hybrid view ${hybridId}:`, hybridUrl, error)
                      // Fallback to target URL if stored URL is invalid
                      const base = new URL(targetUrl)
                      base.searchParams.delete('optimando_extension')
                      base.searchParams.set('hybrid_master_id', hybridId)
                      base.searchParams.set('optimando_session_key', sessionId)
                      
                      const currentTheme = localStorage.getItem('optimando-ui-theme')
                      if (currentTheme && currentTheme !== 'default') {
                        base.searchParams.set('optimando_theme', currentTheme)
                      }
                      
                      window.open(base.toString(), `hybrid-master-${hybridId}`)
                    }
                  })
                }, 300) // Small delay after helper tabs
              }
              
              // Also restore display grids if they exist
              if (sessionData.displayGrids && sessionData.displayGrids.length > 0) {
                console.log('🔧 DEBUG: Opening', sessionData.displayGrids.length, 'display grids:', sessionData.displayGrids)
                console.log('🔧 DEBUG: Updated currentTabData.displayGrids:', currentTabData.displayGrids)
                
                sessionData.displayGrids.forEach((grid, index) => {
                  console.log('🔧 DEBUG: Opening display grid ' + (index + 1) + ':', grid.layout)
                  
                  // Open immediately to preserve user gesture for popup blocker
                  try {
                    openGridFromSession(grid.layout, grid.sessionId)
                    console.log(`✅ Successfully opened display grid ${index + 1}:`, grid.layout)
                  } catch (error) {
                    console.error(`❌ Failed to open display grid ${index + 1}:`, error)
                  }
                })
              }
              
              // Navigate to master URL after a short delay to let tabs load
              if (shouldNavigate) {
                setTimeout(() => {
                  console.log('🔧 DEBUG: Navigating to master URL:', targetUrl)
                  window.location.href = targetUrl
                }, 1000) // Reduced delay since tabs open immediately
              } else {
                console.log('🔧 DEBUG: Already on target URL, skipping navigation')
              }
            } else {
              // Restore current session data even without helper tabs
              currentTabData = {
                ...currentTabData,
                ...sessionData,
                tabId: currentTabData.tabId  // Keep current tab ID
              }
              
              // Save restored data to localStorage to persist it
              saveTabDataToStorage()
              
              console.log('🔧 DEBUG: Session restored (no helper tabs) - currentTabData.agentBoxes:', currentTabData.agentBoxes)
              console.log('🔧 DEBUG: Session restored (no helper tabs) - currentTabData.context:', currentTabData.context)
              
                            // Re-render agent boxes with restored configuration
              setTimeout(() => {
                console.log('🔧 DEBUG: About to re-render agent boxes with:', currentTabData.agentBoxes?.length || 0, 'boxes')
                renderAgentBoxes()
              }, 200)
              
              // Restore hybrid views if they exist (no helper tabs case)
              if (sessionData.hybridAgentBoxes && sessionData.hybridAgentBoxes.length > 0) {
                console.log('🔧 DEBUG: Restoring', sessionData.hybridAgentBoxes.length, 'hybrid views (no helper tabs)')
                
                setTimeout(() => {
                  sessionData.hybridAgentBoxes.forEach((hybridBox, index) => {
                    const hybridId = hybridBox.id || String(index + 1)
                    
                    // Use stored URL if available, otherwise fall back to target URL
                    let hybridUrl = hybridBox.url || targetUrl
                    
                    try {
                      const url = new URL(hybridUrl)
                      url.searchParams.delete('optimando_extension')
                      url.searchParams.set('hybrid_master_id', hybridId)
                      url.searchParams.set('optimando_session_key', sessionId)
                      
                      // Add theme if available
                      const currentTheme = localStorage.getItem('optimando-ui-theme')
                      if (currentTheme && currentTheme !== 'default') {
                        url.searchParams.set('optimando_theme', currentTheme)
                      }
                      
                      console.log(`🔧 DEBUG: Opening hybrid view ${hybridId} with URL:`, url.toString())
                      const hybridTab = window.open(url.toString(), `hybrid-master-${hybridId}`)
                      
                      if (!hybridTab) {
                        console.error(`❌ Failed to open hybrid view ${hybridId} - popup blocked`)
                      } else {
                        console.log(`✅ Successfully opened hybrid view ${hybridId}`)
                      }
                    } catch (error) {
                      console.error(`❌ Invalid URL for hybrid view ${hybridId}:`, hybridUrl, error)
                      // Fallback to target URL if stored URL is invalid
                      const base = new URL(targetUrl)
                      base.searchParams.delete('optimando_extension')
                      base.searchParams.set('hybrid_master_id', hybridId)
                      base.searchParams.set('optimando_session_key', sessionId)
                      
                      const currentTheme = localStorage.getItem('optimando-ui-theme')
                      if (currentTheme && currentTheme !== 'default') {
                        base.searchParams.set('optimando_theme', currentTheme)
                      }
                      
                      window.open(base.toString(), `hybrid-master-${hybridId}`)
                    }
                  })
                }, 300) // Small delay after agent boxes
              }
              
              // No helper tabs, but check for display grids
              if (sessionData.displayGrids && sessionData.displayGrids.length > 0) {
                console.log('🔧 DEBUG: Opening', sessionData.displayGrids.length, 'display grids only:', sessionData.displayGrids)
                console.log('🔧 DEBUG: Updated currentTabData.displayGrids:', currentTabData.displayGrids)
                console.log('🔧 DEBUG: Session data displayGrids:', sessionData.displayGrids)
                console.log('🔧 DEBUG: Each grid config:', sessionData.displayGrids.map(g => ({ layout: g.layout, sessionId: g.sessionId, hasConfig: !!g.config })))
                
                sessionData.displayGrids.forEach((grid, index) => {
                  console.log(`🔧 DEBUG: Opening display grid ${index + 1}:`, grid.layout)
                  
                  // Open immediately to preserve user gesture for popup blocker
                  try {
                    openGridFromSession(grid.layout, grid.sessionId)
                    console.log(`✅ Successfully opened display grid ${index + 1}:`, grid.layout)
                  } catch (error) {
                    console.error(`❌ Failed to open display grid ${index + 1}:`, error)
                  }
                })
                
                // Navigate to master URL after a short delay
                if (shouldNavigate) {
                  setTimeout(() => {
                    console.log('🔧 DEBUG: Navigating to master URL:', targetUrl)
                    window.location.href = targetUrl
                  }, 1000) // Reduced delay since grids open immediately
                } else {
                  console.log('🔧 DEBUG: Already on target URL, skipping navigation')
                }
              } else {
                console.log('🔧 DEBUG: No helper tabs or grids found, navigating directly')
                // No helper tabs or grids, navigate directly
                window.location.href = targetUrl
              }
            }
            
            console.log('🔄 Session restore initiated with', sessionData.helperTabs?.urls?.length || 0, 'helper tabs:', sessionData.tabName)
            
            // Show context restoration notification if context exists
            if (sessionData.context && (sessionData.context.userContext?.text || sessionData.context.publisherContext?.text || (sessionData.context.userContext?.pdfFiles && sessionData.context.userContext.pdfFiles.length > 0))) {
              const contextNotification = document.createElement('div')
              contextNotification.style.cssText = `
                position: fixed;
                top: 120px;
                right: 20px;
                background: rgba(230, 230, 250, 0.9);
                color: #333;
                padding: 10px 15px;
                border-radius: 5px;
                font-size: 12px;
                z-index: 2147483648;
                animation: slideIn 0.3s ease;
                border-left: 4px solid #9370DB;
              `
              
              const contextItems = []
              if (sessionData.context.userContext?.text) contextItems.push('User Context')
              if (sessionData.context.publisherContext?.text) contextItems.push('Publisher Context')
              if (sessionData.context.userContext?.pdfFiles && sessionData.context.userContext.pdfFiles.length > 0) contextItems.push(`${sessionData.context.userContext.pdfFiles.length} PDF Files`)
              
              contextNotification.innerHTML = `📄 Context restored: ${contextItems.join(', ')}`
              document.body.appendChild(contextNotification)
              
              setTimeout(() => {
                contextNotification.remove()
              }, 4000)
            }
          }
        })
      })
      
            overlay.querySelectorAll('.rename-session-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          const sessionId = btn.dataset.sessionId
          const sessionData = sessions.find(s => s.id === sessionId)
          
          if (sessionData) {
            let newName = prompt('Enter new session name:', sessionData.tabName || 'Unnamed Session')
            if (newName && newName.trim()) {
              sessionData.tabName = newName.trim()
              chrome.storage.local.set({ [sessionId]: sessionData }, () => {
                // Refresh the sessions list
                overlay.remove()
                openSessionsLightbox()
              })
            }
          }
        })
      })
      
      overlay.querySelectorAll('.edit-helper-tabs-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
        e.stopPropagation()
          const sessionId = btn.dataset.sessionId
          const sessionData = sessions.find(s => s.id === sessionId)
          
          if (sessionData && sessionData.helperTabs && sessionData.helperTabs.urls) {
            openEditHelperTabsDialog(sessionData, sessionId, overlay)
          }
        })
      })
      
      overlay.querySelectorAll('.delete-session-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
        e.stopPropagation()
          const sessionId = btn.dataset.sessionId
          
          if (confirm('Are you sure you want to delete this session?')) {
            chrome.storage.local.remove(sessionId, () => {
              // Refresh the sessions list
              overlay.remove()
              openSessionsLightbox()
            })
          }
        })
      })
      
      // Clear all sessions
      document.getElementById('clear-all-sessions').onclick = () => {
        if (confirm('Are you sure you want to delete ALL sessions? This cannot be undone.')) {
          const sessionKeys = sessions.map(s => s.id)
          chrome.storage.local.remove(sessionKeys, () => {
            overlay.remove()
            openSessionsLightbox()
          })
        }
      }
    })
  }

  function openEditHelperTabsDialog(sessionData, sessionId, parentOverlay) {
    // Create helper tabs edit dialog
    const editOverlay = document.createElement('div')
    editOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.9); z-index: 2147483650;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(8px);
    `
    
    const currentUrls = [...sessionData.helperTabs.urls]
    
    const generateEditUrlFieldsHTML = () => {
      return currentUrls.map((url, index) => `
        <div class="edit-url-field-row" data-index="${index}" style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <input type="url" class="edit-helper-url" value="${url}" style="flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white !important; -webkit-text-fill-color: white !important; padding: 10px; border-radius: 6px; font-size: 12px;" placeholder="https://example.com">
          <button class="add-edit-url-btn" style="background: #4CAF50; border: none; color: white; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;" title="Add new URL field">+</button>
          <button class="remove-edit-url-btn" style="background: #f44336; border: none; color: white; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; ${currentUrls.length <= 1 ? 'opacity: 0.5; pointer-events: none;' : ''}" title="Remove this URL field">×</button>
        </div>
      `).join('')
    }
    
    editOverlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 85vw; max-width: 800px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">✏️ Edit Web Sources - ${sessionData.tabName}</h2>
          <button id="close-edit-helper-tabs" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex: 1; padding: 30px; overflow-y: auto;">
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #FFD700;">Web Sources URLs</h3>
            <p style="margin: 0 0 20px 0; font-size: 12px; opacity: 0.8;">Edit the URLs that will open when this session is restored.</p>
            
            <div id="edit-helper-url-fields-container">
              ${generateEditUrlFieldsHTML()}
            </div>
          </div>
        </div>
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; background: rgba(255,255,255,0.05);">
          <button id="cancel-edit-helper-tabs" style="padding: 12px 30px; background: #6c757d; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">Cancel</button>
          <button id="save-edit-helper-tabs" style="padding: 12px 30px; background: #4CAF50; border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">💾 Save Changes</button>
        </div>
      </div>
    `
    
    document.body.appendChild(editOverlay)
    
    // Close handlers
    document.getElementById('close-edit-helper-tabs').onclick = () => editOverlay.remove()
    document.getElementById('cancel-edit-helper-tabs').onclick = () => editOverlay.remove()
    editOverlay.onclick = (e) => { if (e.target === editOverlay) editOverlay.remove() }
    
    // URL field management
    const container = document.getElementById('edit-helper-url-fields-container')
    
    const updateEditUrlFields = () => {
      container.innerHTML = generateEditUrlFieldsHTML()
      attachEditUrlFieldHandlers()
    }
    
    const attachEditUrlFieldHandlers = () => {
      container.querySelectorAll('.add-edit-url-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (currentUrls.length < 10) {
            currentUrls.push('')
            updateEditUrlFields()
          }
        })
      })
      
      container.querySelectorAll('.remove-edit-url-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.closest('.edit-url-field-row').dataset.index)
          currentUrls.splice(index, 1)
          if (currentUrls.length === 0) currentUrls.push('')
          updateEditUrlFields()
        })
      })
    }
    
    attachEditUrlFieldHandlers()
    
    // Save handler
    document.getElementById('save-edit-helper-tabs').onclick = () => {
      const updatedUrls = Array.from(container.querySelectorAll('.edit-helper-url'))
        .map(input => input.value.trim())
        .filter(url => url && url.length > 0)
      
      // Update session data
      sessionData.helperTabs.urls = updatedUrls
      sessionData.timestamp = new Date().toISOString()
      
      chrome.storage.local.set({ [sessionId]: sessionData }, () => {
        console.log('✅ Helper tabs updated for session:', sessionData.tabName)
        
        // Show notification
        const notification = document.createElement('div')
        notification.style.cssText = `
          position: fixed;
          top: 60px;
          right: 20px;
          background: rgba(76, 175, 80, 0.9);
          color: white;
          padding: 10px 15px;
          border-radius: 5px;
          font-size: 12px;
          z-index: 2147483651;
        `
        notification.innerHTML = `✅ Helper tabs updated! (${updatedUrls.length} URLs)`
        document.body.appendChild(notification)
        
        setTimeout(() => {
          notification.remove()
        }, 3000)
        
        editOverlay.remove()
        parentOverlay.remove()
        openSessionsLightbox()
      })
    }
  }

  // Helper function to update current session in storage
  function updateCurrentSessionInStorage() {
    // Only update if session is locked and has helper tabs
    if (!currentTabData.isLocked || !currentTabData.helperTabs) {
      return
    }
    
    // Use the helper tabs session ID to find the correct session
    const sessionKey = `session_${currentTabData.helperTabs.sessionId}`
    
    chrome.storage.local.get([sessionKey], (result) => {
      if (result[sessionKey]) {
        // Update the existing session with current data
        const updatedSessionData = {
          ...result[sessionKey],
          ...currentTabData,
          timestamp: new Date().toISOString(),
          url: window.location.href
        }
        
        chrome.storage.local.set({ [sessionKey]: updatedSessionData }, () => {
          console.log('📝 Updated existing session with current data:', currentTabData.tabName)
        })
      }
    })
  }
  // Quick action functions
  function saveCurrentSession() {
        if (currentTabData.isLocked) {
      console.log('💾 Session already saved (locked):', currentTabData.tabName)
      return
    }
    
    // Save current session to chrome.storage.local
    const sessionKey = `session_${Date.now()}`
    const sessionData = {
      ...currentTabData,
      timestamp: new Date().toISOString(),
      url: window.location.href
    }
    
    chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
          // Show notification
          const notification = document.createElement('div')
          notification.style.cssText = `
            position: fixed;
        top: 60px;
            right: 20px;
            background: rgba(76, 175, 80, 0.9);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 2147483648;
          `
      notification.innerHTML = `💾 Session "${currentTabData.tabName}" saved!`
          document.body.appendChild(notification)
          
          setTimeout(() => {
            notification.remove()
          }, 3000)
          
      console.log('💾 Session saved manually:', sessionData.tabName, 'with', sessionData.agentBoxes?.length || 0, 'agent boxes')
    })
  }

  function syncSession() {
    console.log('🔄 Sync functionality - placeholder')
    // Placeholder for sync functionality
  }

  function startNewSession() {
    // Generate new session name with timestamp
    const newSessionName = `WR Session ${new Date().toLocaleString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: false 
    }).replace(/[\/,]/g, '-').replace(/ /g, '_')}`

    // Reset current tab data to default state
    const newTabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Preserve UI configuration but reset everything else
    const preservedUIConfig = { ...currentTabData.uiConfig }
    
    currentTabData = {
      tabId: newTabId,
      tabName: newSessionName,
      isLocked: false,
      goals: {
        shortTerm: '',
        midTerm: '',
        longTerm: ''
      },
      userIntentDetection: {
        detected: 'Web development',
        confidence: 75,
        lastUpdate: new Date().toLocaleTimeString()
      },
      uiConfig: preservedUIConfig,
      helperTabs: null as any,
      displayGrids: null as any,
      agentBoxHeights: {} as any,
      agentBoxes: [
        { id: 'brainstorm', number: 1, title: '#1 🧠 Brainstorm Support Ideas', color: '#4CAF50', outputId: 'brainstorm-output' },
        { id: 'knowledge', number: 2, title: '#2 🔍 Knowledge Gap Detection', color: '#2196F3', outputId: 'knowledge-output' },
        { id: 'risks', number: 3, title: '#3 ⚖️ Risks & Chances', color: '#FF9800', outputId: 'risks-output' },
        { id: 'explainer', number: 4, title: '#4 🎬 Explainer Video Suggestions', color: '#9C27B0', outputId: 'explainer-output' }
      ] as any
    }

    // Save the new session data
    saveTabDataToStorage()

    // Also create a new session in Sessions History
    try {
      const sessionKey = `session_${Date.now()}`
      const sessionData = {
        ...currentTabData,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        helperTabs: null,
        displayGrids: null
      }
      chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
        console.log('🆕 New session added to history:', sessionKey)
        setCurrentSessionKey(sessionKey)
      })
    } catch (e) {
      console.error('❌ Failed to add session to history:', e)
    }

    // Clear agent box outputs
    const summarizeOutput = document.getElementById('summarize-output')
    if (summarizeOutput) summarizeOutput.innerText = 'Ready for new summaries...'
    
    const researchOutput = document.getElementById('research-output')
    if (researchOutput) researchOutput.innerText = 'Ready for new analysis...'
    
    const goalsOutput = document.getElementById('goals-output')
    if (goalsOutput) goalsOutput.innerText = 'Ready for new goal tracking...'
    
    const analysisOutput = document.getElementById('analysis-output')
    if (analysisOutput) analysisOutput.innerText = 'Ready for new data analysis...'

    // Update the session name input in the UI
    const sessionNameInput = document.getElementById('session-name-input') as HTMLInputElement
    if (sessionNameInput) {
      sessionNameInput.value = newSessionName
    }

    // Update lock button to unlocked state
    const lockBtn = document.getElementById('lock-btn')
    if (lockBtn) {
      lockBtn.innerHTML = '🔓'
      lockBtn.style.background = 'rgba(255,255,255,0.1)'
    }

    // Re-render agent boxes with default configuration
    renderAgentBoxes()

    // Show success notification
    const notification = document.createElement('div')
    notification.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      background: rgba(76, 175, 80, 0.9);
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      font-size: 12px;
      z-index: 2147483648;
      animation: slideIn 0.3s ease;
    `
    notification.innerHTML = `🆕 New session "${newSessionName}" started!`
    document.body.appendChild(notification)
    
    setTimeout(() => {
      notification.remove()
    }, 3000)

    console.log('🆕 New session started:', newSessionName)
  }

  function exportSession() {
    const sessionData = {
      ...currentTabData,
      timestamp: new Date().toISOString(),
      url: window.location.href
    }
    
    const dataStr = JSON.stringify(sessionData, null, 2)
    const dataBlob = new Blob([dataStr], {type: 'application/json'})
    const url = URL.createObjectURL(dataBlob)
    
    const link = document.createElement('a')
    link.href = url
    link.download = `session_${currentTabData.tabName || 'unnamed'}_${Date.now()}.json`
    link.click()
    
    URL.revokeObjectURL(url)
    console.log('📤 Session exported:', currentTabData.tabName)
  }

  function importSession() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (e) => {
          try {
            const sessionData = JSON.parse(e.target.result)
            
            // Save imported session
            const sessionKey = `session_${Date.now()}`
            chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
              console.log('📥 Session imported:', sessionData.tabName)
              
              // Show notification
              const notification = document.createElement('div')
              notification.style.cssText = `
                position: fixed;
                top: 60px;
                right: 20px;
                background: rgba(76, 175, 80, 0.9);
                color: white;
                padding: 10px 15px;
                border-radius: 5px;
                font-size: 12px;
                z-index: 2147483648;
              `
              notification.innerHTML = `📥 Session "${sessionData.tabName || 'unnamed'}" imported!`
              document.body.appendChild(notification)
              
              setTimeout(() => {
                notification.remove()
              }, 3000)
            })
          } catch (error) {
            console.error('❌ Failed to import session:', error)
            alert('Failed to import session. Please check the file format.')
          }
        }
        reader.readAsText(file)
      }
    }
    
    input.click()
  }

  // Add all sidebars to page
  sidebarsDiv.appendChild(leftSidebar)
  sidebarsDiv.appendChild(rightSidebar)
  sidebarsDiv.appendChild(bottomSidebar)
  document.body.appendChild(sidebarsDiv)
  
  // Hybrid right panel behaviors after mount
  if (isHybridMaster) {
    // Render agent boxes into the right container
    const renderInto = (containerId) => {
      const container = document.getElementById(containerId)
      if (!container) return
      const original = document.getElementById('agent-boxes-container')
      if (original) original.id = 'agent-boxes-container-original'
      container.id = 'agent-boxes-container'
      try { renderAgentBoxes() } catch (e) {}
      container.id = containerId
      const movedBack = document.getElementById('agent-boxes-container-original')
      if (movedBack) movedBack.id = 'agent-boxes-container'
    }
    setTimeout(() => renderInto('agent-boxes-container-right'), 0)
    document.getElementById('add-agent-box-btn-right')?.addEventListener('click', () => {
      try { openAddAgentBoxDialog() } catch (e) {}
      setTimeout(() => renderInto('agent-boxes-container-right'), 100)
    })

    // Right-side resize (mirror left) and quick expand
    const rightResizeHandle = document.createElement('div')
    rightResizeHandle.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:5px;background:rgba(255,255,255,0.2);cursor:ew-resize;transition:background 0.2s ease;`
    rightResizeHandle.onmouseover = () => { rightResizeHandle.style.background = 'rgba(255,255,255,0.4)' }
    rightResizeHandle.onmouseout = () => { rightResizeHandle.style.background = 'rgba(255,255,255,0.2)' }
    rightSidebar.appendChild(rightResizeHandle)

    let isResizingRight = false
    let startXRight = 0
    let startWidthRight = 0
    rightResizeHandle.addEventListener('mousedown', (e) => {
      isResizingRight = true
      startXRight = e.clientX
      startWidthRight = currentTabData.uiConfig.rightSidebarWidth
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ew-resize'
    })
    document.addEventListener('mousemove', (e) => {
      if (!isResizingRight) return
      const delta = startXRight - e.clientX
      const newWidth = Math.max(150, Math.min(1000, startWidthRight + delta))
      currentTabData.uiConfig.rightSidebarWidth = newWidth
      rightSidebar.style.width = newWidth + 'px'
      bottomSidebar.style.right = newWidth + 'px'
    })
    document.addEventListener('mouseup', () => {
      if (isResizingRight) {
        isResizingRight = false
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        saveTabDataToStorage()
      }
    })
    document.getElementById('quick-expand-right-btn')?.addEventListener('click', () => {
      const currentWidth = currentTabData.uiConfig.rightSidebarWidth
      const newWidth = currentWidth === 350 ? 600 : currentWidth === 600 ? 800 : 350
      currentTabData.uiConfig.rightSidebarWidth = newWidth
      rightSidebar.style.width = newWidth + 'px'
      bottomSidebar.style.right = newWidth + 'px'
      saveTabDataToStorage()
    })
  }
  
  // Render dynamic agent boxes after DOM is ready
  setTimeout(() => {
    renderAgentBoxes()
    
    // Show new session notification if this was a fresh browser session
    const browserSessionMarker = sessionStorage.getItem('optimando-browser-session')
    const sessionStartTime = sessionStorage.getItem('optimando-session-start-time')
    
    if (browserSessionMarker && !sessionStartTime) {
      // Mark that we've shown the notification for this browser session
      sessionStorage.setItem('optimando-session-start-time', Date.now().toString())
      
      // Show fresh session notification
      setTimeout(() => {
        const notification = document.createElement('div')
        notification.style.cssText = `
          position: fixed;
          top: 60px;
          right: 20px;
          background: rgba(33, 150, 243, 0.9);
          color: white;
          padding: 10px 15px;
          border-radius: 5px;
          font-size: 12px;
          z-index: 2147483648;
          animation: slideIn 0.3s ease;
        `
        notification.innerHTML = `🆕 Fresh browser session - New session started: "${currentTabData.tabName}"`
        document.body.appendChild(notification)
        
        setTimeout(() => {
          notification.remove()
        }, 4000)
        
        console.log('🆕 Fresh browser session notification shown')
      }, 1000) // Delay to ensure UI is ready
    }
  }, 100)
  
  // Set initial body margins and safe scrollbar prevention
  document.body.style.marginLeft = currentTabData.uiConfig.leftSidebarWidth + 'px'
  document.body.style.marginRight = currentTabData.uiConfig.rightSidebarWidth + 'px'
  document.body.style.marginTop = '45px'  // Exact sidebar height, no spacing
  document.body.style.overflowX = 'hidden'

  // Event handlers - AFTER DOM elements are created and added
  setTimeout(() => {
    // Reasoning header click (entire header area)
    document.getElementById('reasoning-header')?.addEventListener('click', toggleBottomPanel)
    
    // Agents and Settings lightbox buttons
    document.getElementById('agents-lightbox-btn')?.addEventListener('click', openAgentsLightbox)
    document.getElementById('context-lightbox-btn')?.addEventListener('click', openContextLightbox)
    document.getElementById('whitelist-lightbox-btn')?.addEventListener('click', openWhitelistLightbox)
    document.getElementById('settings-lightbox-btn')?.addEventListener('click', openSettingsLightbox)
    
    // Right sidebar buttons
    document.getElementById('add-helpergrid-btn')?.addEventListener('click', openHelperGridLightbox)
    document.getElementById('sessions-history-btn')?.addEventListener('click', openSessionsLightbox)
    document.getElementById('save-session-btn')?.addEventListener('click', saveCurrentSession)
    document.getElementById('sync-btn')?.addEventListener('click', syncSession)
    document.getElementById('export-btn')?.addEventListener('click', exportSession)
    document.getElementById('import-btn')?.addEventListener('click', importSession)
    
    // Left sidebar quick expand button
    document.getElementById('quick-expand-btn')?.addEventListener('click', () => {
      const currentWidth = currentTabData.uiConfig.leftSidebarWidth
      let newWidth
      
      // 3-step expansion: 350px -> 600px -> 800px -> back to 350px
      if (currentWidth === 350) {
        newWidth = 600 // Medium expansion
      } else if (currentWidth === 600) {
        newWidth = 800 // Large expansion  
      } else {
        newWidth = 350 // Back to default
      }
      
      currentTabData.uiConfig.leftSidebarWidth = newWidth
      leftSidebar.style.width = newWidth + 'px'
      document.body.style.marginLeft = newWidth + 'px'
        bottomSidebar.style.left = newWidth + 'px'
      
      saveTabDataToStorage()
      console.log('🔄 Left sidebar expanded to width:', newWidth)
    })
    
    // Add New Agent Box button
    document.getElementById('add-agent-box-btn')?.addEventListener('click', () => {
      openAddAgentBoxDialog()
    })
    
    // Session name input and lock button
    const sessionNameInput = document.getElementById('session-name-input')
    const lockBtn = document.getElementById('lock-btn')
    
    if (sessionNameInput) {
      sessionNameInput.addEventListener('input', () => {
        if (!currentTabData.isLocked) {
          currentTabData.tabName = sessionNameInput.value
          saveTabDataToStorage()
          console.log('📝 Session name updated:', currentTabData.tabName)
        }
      })
      
      sessionNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          sessionNameInput.blur()
        }
      })
    }
    if (lockBtn) {
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        currentTabData.isLocked = !currentTabData.isLocked
        
        // Update lock button appearance
        lockBtn.innerHTML = currentTabData.isLocked ? '🔒' : '🔓'
        lockBtn.style.background = currentTabData.isLocked ? 'rgba(255,215,0,0.3)' : 'rgba(255,255,255,0.1)'
        
        // Update session name input
        if (sessionNameInput) {
          sessionNameInput.disabled = currentTabData.isLocked
          sessionNameInput.style.opacity = currentTabData.isLocked ? '0.6' : '1'
          sessionNameInput.style.pointerEvents = currentTabData.isLocked ? 'none' : 'auto'
        }
        
        // Save session when locking
      saveTabDataToStorage()
        
        if (currentTabData.isLocked) {
          // Save to chrome.storage.local for sessions history
          const sessionKey = `session_${Date.now()}`
          
          // If session name is still default, update it with current date-time
          if (!currentTabData.tabName || currentTabData.tabName.startsWith('WR Session')) {
            currentTabData.tabName = `WR Session ${new Date().toLocaleString('en-GB', { 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric', 
              hour: '2-digit', 
              minute: '2-digit', 
              second: '2-digit',
              hour12: false 
            }).replace(/[\/,]/g, '-').replace(/ /g, '_')}`
          }
          
          const sessionData = {
            ...currentTabData,
            timestamp: new Date().toISOString(),
            url: window.location.href
          }
          
          chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
            console.log('🔒 Session saved:', sessionData.tabName, 'with', sessionData.helperTabs?.urls?.length || 0, 'helper tabs,', sessionData.agentBoxes?.length || 0, 'agent boxes')
          })
          // Show notification
          const notification = document.createElement('div')
          notification.style.cssText = `
            position: fixed;
            top: 60px;
            right: 20px;
            background: rgba(76, 175, 80, 0.9);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 2147483648;
            animation: slideIn 0.3s ease;
          `
          notification.innerHTML = `🔒 Session "${currentTabData.tabName}" saved!`
          document.body.appendChild(notification)
          
          setTimeout(() => {
            notification.remove()
          }, 3000)
          
          console.log('🔒 Session locked and saved:', currentTabData.tabName)
        } else {
          console.log('🔓 Session unlocked:', currentTabData.tabName)
        }
      })
    }

    // New session button
    const newSessionBtn = document.getElementById('new-session-btn')
    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        startNewSession()
      })
      
      // Hover effects for new session button
      newSessionBtn.addEventListener('mouseenter', () => {
        newSessionBtn.style.background = 'rgba(76, 175, 80, 1)'
        newSessionBtn.style.transform = 'scale(1.1)'
      })
      
      newSessionBtn.addEventListener('mouseleave', () => {
        newSessionBtn.style.background = 'rgba(76, 175, 80, 0.8)'
        newSessionBtn.style.transform = 'scale(1)'
      })
    }

    
    console.log('✅ Event handlers attached for reasoning section')
  }, 100)

}

// Check for grid config from Electron app via file system bridge
function checkForElectronGridConfig() {
  try {
    // Check if we have access to file system (this won't work in browser context)
    // Instead, we'll use a different approach - check for a special localStorage key
    // that gets set by a background script that monitors the file system
    
    const electronConfig = localStorage.getItem('optimando-electron-grid-config')
    if (electronConfig) {
      const config = JSON.parse(electronConfig)
      console.log('📨 Received grid config from Electron app:', config)
      
      // Update currentTabData
      if (!currentTabData.displayGrids) currentTabData.displayGrids = [];
      let entry = currentTabData.displayGrids.find((g: any) => g.sessionId === config.sessionId && g.layout === config.layout);
      if (!entry) {
        entry = { layout: config.layout, sessionId: config.sessionId, url: '', timestamp: new Date().toISOString() };
        currentTabData.displayGrids.push(entry);
      }
      entry.config = { layout: config.layout, sessionId: config.sessionId, slots: config.slots };
      
      // Save to localStorage
      saveTabDataToStorage();
      
      // Save to chrome.storage.local
      chrome.storage.local.get(null, (allData) => {
        const allSessions = Object.entries(allData).filter(([key, value]: any) => key.startsWith('session_')) as any[];
        let target: any = allSessions.find(([key, value]: any) => value.tabId === currentTabData.tabId);
        if (!target) {
          const currentUrl = window.location.href.split('?')[0];
          target = allSessions.find(([key, value]: any) => (value.url && value.url.split('?')[0] === currentUrl));
        }
        if (target) {
          const [sessionKey, sessionData] = target;
          const existing = Array.isArray(sessionData.displayGrids) ? sessionData.displayGrids : [];
          let found = existing.find((g: any) => g.sessionId === config.sessionId && g.layout === config.layout);
          if (!found) {
            found = { layout: config.layout, sessionId: config.sessionId, url: '', timestamp: new Date().toISOString() };
            existing.push(found);
          }
          found.config = { layout: config.layout, sessionId: config.sessionId, slots: config.slots };
          sessionData.displayGrids = existing;
          sessionData.timestamp = new Date().toISOString();
          chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
            console.log('✅ Grid config saved to session via Electron app:', sessionKey);
          });
        }
      });
      
      // Clear the Electron app data
      localStorage.removeItem('optimando-electron-grid-config');
      
      // Visual feedback
      const note = document.createElement('div')
      note.textContent = '✅ Saved grid to session via Electron app'
      note.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#4CAF50;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
      document.body.appendChild(note)
      setTimeout(() => note.remove(), 2500)
    }
  } catch (error) {
    console.log('ℹ️ Could not check for Electron app config:', error.message);
  }
}

// Alternative approach: Use a simpler method by directly calling the save function
// when we receive a message from the grid window
function handleElectronGridSave(config: any) {
  console.log('📨 Handling Electron grid save:', config)
  
  // Update currentTabData
  if (!currentTabData.displayGrids) currentTabData.displayGrids = [];
  let entry = currentTabData.displayGrids.find((g: any) => g.sessionId === config.sessionId && g.layout === config.layout);
  if (!entry) {
    entry = { layout: config.layout, sessionId: config.sessionId, url: '', timestamp: new Date().toISOString() };
    currentTabData.displayGrids.push(entry);
  }
  entry.config = { layout: config.layout, sessionId: config.sessionId, slots: config.slots };
  
  // Save to localStorage
  saveTabDataToStorage();
  
  // Save to chrome.storage.local
  chrome.storage.local.get(null, (allData) => {
    const allSessions = Object.entries(allData).filter(([key, value]: any) => key.startsWith('session_')) as any[];
    let target: any = allSessions.find(([key, value]: any) => value.tabId === currentTabData.tabId);
    if (!target) {
      const currentUrl = window.location.href.split('?')[0];
      target = allSessions.find(([key, value]: any) => (value.url && value.url.split('?')[0] === currentUrl));
    }
    if (target) {
      const [sessionKey, sessionData] = target;
      const existing = Array.isArray(sessionData.displayGrids) ? sessionData.displayGrids : [];
      let found = existing.find((g: any) => g.sessionId === config.sessionId && g.layout === config.layout);
      if (!found) {
        found = { layout: config.layout, sessionId: config.sessionId, url: '', timestamp: new Date().toISOString() };
        existing.push(found);
      }
      found.config = { layout: config.layout, sessionId: config.sessionId, slots: config.slots };
      sessionData.displayGrids = existing;
      sessionData.timestamp = new Date().toISOString();
      chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
        console.log('✅ Grid config saved to session via Electron app:', sessionKey);
      });
    }
  });
  
  // Visual feedback
  const note = document.createElement('div')
  note.textContent = '✅ Saved grid to session via Electron app'
  note.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#4CAF50;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
  document.body.appendChild(note)
  setTimeout(() => note.remove(), 2500)
}

// Check for Electron app data every 2 seconds
setInterval(checkForElectronGridConfig, 2000)

// Initialize extension if active
console.log('🔧 DEBUG: Final initialization check:', {
  isExtensionActive,
  dedicatedRole,
  url: window.location.href
})

if (isExtensionActive) {
  console.log('🚀 Initializing extension automatically...')
  initializeExtension()
} else {
  console.log('❌ Extension not active, skipping initialization')
}