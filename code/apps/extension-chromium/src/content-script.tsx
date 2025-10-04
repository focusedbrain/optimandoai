/// <reference types="chrome-types"/>
import './agent-manager-v2'

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

// Function to show trigger name prompt in docked or floating chat
function showTriggerPromptInChat(mode: string, rect: any, displayId: number, imageUrl: string, videoUrl: string){
  try{
    console.log('[CONTENT] showTriggerPromptInChat called:', { mode, rect, displayId })
    
    // Remove existing prompt if any
    const existing = document.getElementById('og-trigger-modal')
    if (existing) existing.remove()
    
    // Create simple modal overlay - completely independent of chat UI
    const modal = document.createElement('div')
    modal.id = 'og-trigger-modal'
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s;
    `
    
    const card = document.createElement('div')
    card.style.cssText = `
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 8px;
      padding: 20px;
      width: 90%;
      max-width: 400px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);
    `
    
    const title = document.createElement('div')
    title.style.cssText = 'font-size: 16px; font-weight: 600; color: #f9fafb; margin-bottom: 16px;'
    title.textContent = (mode === 'screenshot' ? '📸 ' : '🎥 ') + 'Save Trigger'
    
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = 'Enter trigger name...'
    input.style.cssText = `
      width: 100%;
      padding: 10px 12px;
      background: #111827;
      border: 1px solid #374151;
      border-radius: 6px;
      color: #f9fafb;
      font-size: 14px;
      margin-bottom: 16px;
      box-sizing: border-box;
      outline: none;
    `
    input.addEventListener('focus', () => { input.style.borderColor = '#3b82f6' })
    input.addEventListener('blur', () => { input.style.borderColor = '#374151' })
    
    const buttons = document.createElement('div')
    buttons.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;'
    
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      background: #374151;
      color: #f9fafb;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
    `
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = '#4b5563' })
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = '#374151' })
    
    const saveBtn = document.createElement('button')
    saveBtn.textContent = 'Save Trigger'
    saveBtn.style.cssText = `
      padding: 8px 16px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
    `
    saveBtn.addEventListener('mouseenter', () => { saveBtn.style.background = '#2563eb' })
    saveBtn.addEventListener('mouseleave', () => { saveBtn.style.background = '#3b82f6' })
    
    buttons.append(cancelBtn, saveBtn)
    card.append(title, input, buttons)
    modal.appendChild(card)
    
    // Close on clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove()
    })
    
    cancelBtn.onclick = () => modal.remove()
    
    const saveTrigger = () => {
      const name = input.value.trim() || ('Trigger ' + new Date().toLocaleString())
      // Save to chrome.storage
      try{
        const key='optimando-tagged-triggers'
        chrome.storage?.local?.get([key], (data:any)=>{
          const prev = Array.isArray(data?.[key]) ? data[key] : []
          prev.push({ name, at: Date.now(), rect, mode, displayId })
          chrome.storage?.local?.set({ [key]: prev }, ()=>{
            try{ window.dispatchEvent(new CustomEvent('optimando-triggers-updated')) }catch{}
            try{ chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) }catch{}
          })
        })
      }catch{}
      // Send to Electron
      try{
        chrome.runtime?.sendMessage({
          type: 'ELECTRON_SAVE_TRIGGER',
          name,
          mode,
          rect,
          displayId,
          imageUrl,
          videoUrl
        })
      }catch{}
      modal.remove()
    }
    
    saveBtn.onclick = saveTrigger
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveTrigger()
      else if (e.key === 'Escape') modal.remove()
    })
    
    document.body.appendChild(modal)
    setTimeout(() => input.focus(), 100)
    console.log('[CONTENT] Modal created and shown')
  }catch(err){
    console.error('[CONTENT] Error showing trigger prompt:', err)
  }
}

// Global handler: append captures coming back from Electron to whichever chat is visible
try {
  chrome.runtime.onMessage.addListener((msg:any)=>{
    try{
      if (!msg || !msg.type) return
      if (msg.type === 'SHOW_TRIGGER_PROMPT'){
        // Show trigger name input in docked chat or floating popup
        console.log('[CONTENT] Showing trigger prompt:', msg)
        showTriggerPromptInChat(msg.mode, msg.rect, msg.displayId, msg.imageUrl, msg.videoUrl)
      } else if (msg.type === 'ELECTRON_SELECTION_RESULT'){
        const target = (document.getElementById('ccf-messages') as HTMLElement | null) || (document.getElementById('ccd-messages') as HTMLElement | null)
        if (!target) return
        const kind = msg.kind || 'image'
        const url = msg.dataUrl || msg.url
        if (!url) return
        const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='flex-end'
        const bub = document.createElement('div'); bub.style.maxWidth='78%'; bub.style.padding='6px'; bub.style.borderRadius='10px'; bub.style.fontSize='12px'; bub.style.background='var(--bubble-user-bg, rgba(34,197,94,0.12))'; bub.style.border='1px solid var(--bubble-user-border, rgba(34,197,94,0.45))'
        if (kind==='video'){ const v=document.createElement('video'); v.src=url; v.controls=true; v.style.maxWidth='260px'; v.style.borderRadius='8px'; bub.appendChild(v) }
        else { const img=document.createElement('img'); img.src=url; img.style.maxWidth='260px'; img.style.borderRadius='8px'; img.alt='screenshot'; bub.appendChild(img) }
        row.appendChild(bub); target.appendChild(row); target.scrollTop = 1e9
      }
    }catch{}
  })
} catch {}

// Ensure popup-triggered selection works even if main overlay wasn't toggled yet
chrome.runtime.onMessage.addListener((msg:any)=>{
  try {
    if (!msg || !msg.type) return
    if (msg.type === 'OG_BEGIN_SELECTION_FOR_POPUP'){
      try {
        const popupMsgs = document.getElementById('ccf-messages') as HTMLElement | null
        beginScreenSelect(popupMsgs || document.body)
      } catch {}
    } else if (msg.type === 'OG_CAPTURE_SAVED_TAG') {
      try{
        const key='optimando-tagged-triggers'; const list = JSON.parse(localStorage.getItem(key)||'[]'); const t = list?.[msg.index]
        if (!t) return
        ;(async ()=>{
          const raw = await new Promise<string|null>((resolve)=>{ try{ chrome.runtime.sendMessage({ type:'CAPTURE_VISIBLE_TAB' }, (res:any)=> resolve(res?.dataUrl||null)) }catch{ resolve(null) } })
          if(!raw) return
          const rect = t.rect || { x: 0, y: 0, w: 0, h: 0 }
          const out = await cropCapturedImageToRect(raw, rect)
          const msgs = (document.getElementById('ccf-messages') || document.getElementById('ccd-messages')) as HTMLElement | null
          if (msgs) {
            const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='flex-end'
            const bub = document.createElement('div'); bub.style.maxWidth='78%'; bub.style.padding='6px'; bub.style.borderRadius='10px'; bub.style.fontSize='12px'; bub.style.background='var(--bubble-user-bg, rgba(34,197,94,0.12))'; bub.style.border='1px solid var(--bubble-user-border, rgba(34,197,94,0.45))'
            const image = document.createElement('img'); image.src=out; image.style.maxWidth='260px'; image.style.borderRadius='8px'; image.alt='screenshot'
            bub.appendChild(image); row.appendChild(bub); msgs.appendChild(row); msgs.scrollTop = 1e9
          }
        })()
      }catch{}
    }
  } catch {}
})

function deactivateExtension() {
  const existingExtension = document.getElementById('optimando-sidebars')
  if (existingExtension) {
    existingExtension.remove()
  }
  
  // Reset body styles to original
  document.body.style.margin = ''
  document.body.style.padding = ''
  document.body.style.overflowX = ''
  
  console.log('🔴 Optimando AI Extension deactivated')
}

function initializeExtension() {
  try {
    chrome.runtime.onMessage.addListener((msg:any)=>{
      if (!msg || !msg.type) return
      if (msg.type === 'OG_BEGIN_SELECTION_FOR_POPUP'){
        try {
          const popupMsgs = document.getElementById('ccf-messages') as HTMLElement | null
          beginScreenSelect(popupMsgs || document.body)
        } catch {}
      } else if (msg.type === 'OG_CAPTURE_SAVED_TAG') {
        try{
          const key='optimando-tagged-triggers'; const list = JSON.parse(localStorage.getItem(key)||'[]'); const t = list?.[msg.index]
          if (!t) return
          ;(async ()=>{
            const raw = await new Promise<string|null>((resolve)=>{ try{ chrome.runtime.sendMessage({ type:'CAPTURE_VISIBLE_TAB' }, (res:any)=> resolve(res?.dataUrl||null)) }catch{ resolve(null) } })
            if(!raw) return
            const rect = t.rect || { x: 0, y: 0, w: 0, h: 0 }
            const out = await cropCapturedImageToRect(raw, rect)
            const msgs = (document.getElementById('ccf-messages') || document.getElementById('ccd-messages')) as HTMLElement | null
            if (msgs) {
              const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='flex-end'
              const bub = document.createElement('div'); bub.style.maxWidth='78%'; bub.style.padding='6px'; bub.style.borderRadius='10px'; bub.style.fontSize='12px'; bub.style.background='var(--bubble-user-bg, rgba(34,197,94,0.12))'; bub.style.border='1px solid var(--bubble-user-border, rgba(34,197,94,0.45))'
              const image = document.createElement('img'); image.src=out; image.style.maxWidth='260px'; image.style.borderRadius='8px'; image.alt='screenshot'
              bub.appendChild(image); row.appendChild(bub); msgs.appendChild(row); msgs.scrollTop = 1e9
            }
          })()
        }catch{}
      }
    })
  } catch {}
  console.log('🔧 DEBUG: initializeExtension called for:', window.location.href)
  // agent-manager-v2 is now statically imported at top to guarantee execution
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
      { id: 'brainstorm', agentId: 'agent1', number: 1, title: '#1 🧠 Brainstorm Support Ideas', color: '#4CAF50', outputId: 'brainstorm-output' },
      { id: 'knowledge', agentId: 'agent2', number: 2, title: '#2 🔍 Knowledge Gap Detection', color: '#2196F3', outputId: 'knowledge-output' },
      { id: 'risks', agentId: 'agent3', number: 3, title: '#3 ⚖️ Risks & Chances', color: '#FF9800', outputId: 'risks-output' },
      { id: 'explainer', agentId: 'agent4', number: 4, title: '#4 🎬 Explainer Video Suggestions', color: '#9C27B0', outputId: 'explainer-output' }
    ] as any
  }

  // Save/Load functions
  // Session key helpers to guarantee that all writes go to the active session only
  function getCurrentSessionKey(): string | null {
    // First check sessionStorage for this tab's session
    try { 
      const tabSession = sessionStorage.getItem('optimando-current-session-key')
      if (tabSession) {
        // Verify the session exists in chrome storage (async check, but return key immediately)
        chrome.storage.local.get([tabSession], (result) => {
          if (!result[tabSession]) {
            console.warn('⚠️ Session key exists but session data missing, clearing invalid key:', tabSession)
            // Clear invalid session key
            try { 
              sessionStorage.removeItem('optimando-current-session-key')
              localStorage.removeItem('optimando-global-active-session')
            } catch {}
          }
        })
        return tabSession
      }
    } catch {}
    
    // Fall back to global active session from localStorage
    try {
      const globalSession = localStorage.getItem('optimando-global-active-session')
      if (globalSession) {
        // Sync to this tab's sessionStorage
        try { sessionStorage.setItem('optimando-current-session-key', globalSession) } catch {}
        return globalSession
      }
    } catch {}
    
    return null
  }
  
  function setCurrentSessionKey(key: string) {
    // Set in both sessionStorage (for this tab) and localStorage (global)
    try { 
      sessionStorage.setItem('optimando-current-session-key', key) 
      localStorage.setItem('optimando-global-active-session', key)
      localStorage.setItem('optimando-global-active-session-time', Date.now().toString())
    } catch {}
    // Persist across navigations
    writeOptimandoState({ sessionKey: key })
  }
  // Ensure there is an active session; if none, create one and persist immediately
  function ensureActiveSession(cb: any) {
    try {
      const existingKey = getCurrentSessionKey()
      if (existingKey) {
        chrome.storage.local.get([existingKey], (all:any) => {
          const session = (all && all[existingKey]) || {}
          // Ensure session has all required fields
          if (!session.tabName) session.tabName = document.title || 'Unnamed Session'
          if (!session.url) session.url = window.location.href
          if (!session.displayGrids) session.displayGrids = []
          if (!session.agentBoxes) session.agentBoxes = []
          if (!session.customAgents) session.customAgents = []
          if (!session.hiddenBuiltins) session.hiddenBuiltins = []
          if (!session.timestamp) session.timestamp = new Date().toISOString()
          cb(existingKey, session)
        })
        return
      }
    } catch {}
    const newKey = `session_${Date.now()}_${Math.floor(Math.random()*1000000)}`
    try { setCurrentSessionKey(newKey) } catch {}
    const newSession:any = {
      tabName: document.title || 'Unnamed Session',
      url: (window.location && window.location.href) || '',
      timestamp: new Date().toISOString(),
      isLocked: false,
      displayGrids: [],
      agentBoxes: [],
      customAgents: [],
      hiddenBuiltins: []
    }
    chrome.storage.local.set({ [newKey]: newSession }, () => {
      console.log('🆕 New session created and added to history:', newKey)
      cb(newKey, newSession)
    })
  }

  // Helper function to ensure session is properly saved to session history
  function ensureSessionInHistory(sessionKey: string, sessionData: any, callback?: () => void) {
    // Ensure the session has all required fields for session history
    const completeSessionData = {
      ...sessionData,
      tabName: sessionData.tabName || document.title || 'Unnamed Session',
      url: sessionData.url || window.location.href,
      timestamp: new Date().toISOString(),
      displayGrids: sessionData.displayGrids || [],
      agentBoxes: sessionData.agentBoxes || [],
      customAgents: sessionData.customAgents || [],
      hiddenBuiltins: sessionData.hiddenBuiltins || []
    }
    
    chrome.storage.local.set({ [sessionKey]: completeSessionData }, () => {
      if (chrome.runtime.lastError) {
        console.error('❌ Failed to save session to history:', chrome.runtime.lastError)
      } else {
        console.log('✅ Session saved to history:', sessionKey, completeSessionData.tabName)
      }
      if (callback) callback()
    })
  }

  // Helper: append an agent event into the session for history/audit
  function appendAgentEvent(session:any, event:{ type:'add'|'delete'|'update', key:string, name?:string, icon?:string }){
    try {
      if (!Array.isArray(session.agentEvents)) session.agentEvents = []
      session.agentEvents.push({ ...event, timestamp: new Date().toISOString() })
    } catch {}
  }

  // New: Session Agents Manager (single source of truth)
  const BUILTIN_AGENTS = [
    { key: 'summarize', name: 'Summarize', icon: '📝' },
    { key: 'research', name: 'Research', icon: '🔍' },
    { key: 'analyze', name: 'Analyze', icon: '📊' },
    { key: 'generate', name: 'Generate', icon: '✨' },
    { key: 'coordinate', name: 'Coordinate', icon: '🎯' }
  ]
  function pad2(n:number){ return n < 10 ? `0${n}` : String(n) }
  function normalizeSessionAgents(activeKey:string, session:any, cb:(session:any)=>void){
    let changed = false
    if (!Array.isArray(session.agents)) {
      // Seed with builtins 1..5
      session.agents = BUILTIN_AGENTS.map((b, i) => ({ 
        ...b, 
        number: i+1, 
        kind: 'builtin',
        scope: 'system',
        config: {}
      }))
      session.numberMap = session.agents.reduce((acc:any,a:any)=>{ acc[a.key]=a.number; return acc }, {})
      session.nextNumber = 6
      changed = true
    } else {
      // Ensure numberMap and nextNumber consistent
      const numbers = session.agents.map((a:any)=>Number(a.number)||0)
      const maxNum = numbers.length ? Math.max(...numbers) : 0
      if (!session.numberMap) {
        session.numberMap = session.agents.reduce((acc:any,a:any)=>{ acc[a.key]=a.number; return acc }, {})
        changed = true
      }
      if (!session.nextNumber || session.nextNumber <= maxNum) {
        session.nextNumber = maxNum + 1
        changed = true
      }
      // Ensure builtins exist at least once
      BUILTIN_AGENTS.forEach((b, idx) => {
        if (!session.agents.find((a:any)=>a.key===b.key)) {
          const num = idx+1
          session.agents.push({ 
            ...b, 
            number: num, 
            kind: 'builtin',
            scope: 'system',
            config: {}
          })
          session.numberMap[b.key] = num
          changed = true
        }
      })
      // Ensure all agents have scope and config properties (backward compatibility)
      session.agents.forEach((a: any) => {
        if (!a.scope) {
          a.scope = a.kind === 'builtin' ? 'system' : 'session'
          changed = true
        }
        if (!a.config) {
          a.config = {}
          changed = true
        }
      })
    }
    if (changed) {
      session.timestamp = new Date().toISOString()
      try { localStorage.setItem('optimando-agent-number-map', JSON.stringify(session.numberMap||{})) } catch {}
      ensureSessionInHistory(activeKey, session, () => cb(session))
    } else {
      try { localStorage.setItem('optimando-agent-number-map', JSON.stringify(session.numberMap||{})) } catch {}
      cb(session)
    }
  }
  function addAgentToSession(name:string, icon:string, done:()=>void){
    const key = (name||'').toLowerCase().replace(/[^a-z0-9]/g,'')
    ensureActiveSession((activeKey:string, session:any) => {
      normalizeSessionAgents(activeKey, session, (s:any)=>{
        const existing = s.agents.find((a:any)=>a.key===key)
        if (existing) {
          existing.name = name
          existing.icon = icon || existing.icon
        } else {
          const num = Number(s.nextNumber)||1
          s.agents.push({ 
            key, 
            name, 
            icon: icon||'🤖', 
            number: num, 
            kind: 'custom',
            scope: 'session',
            config: {}
          })
          s.numberMap[key] = num
          s.nextNumber = num + 1
        }
        s.timestamp = new Date().toISOString()
        
        // Ensure session has all required fields for session history
        if (!s.tabName) s.tabName = document.title || 'Unnamed Session'
        if (!s.url) s.url = window.location.href
        if (!s.displayGrids) s.displayGrids = []
        if (!s.agentBoxes) s.agentBoxes = []
        if (!s.customAgents) s.customAgents = []
        if (!s.hiddenBuiltins) s.hiddenBuiltins = []
        
        // Append audit event
        appendAgentEvent(s, { type:'add', key, name, icon })

        try { localStorage.setItem('optimando-agent-number-map', JSON.stringify(s.numberMap||{})) } catch {}
        
        // Save to chrome storage and ensure it's in session history
        ensureSessionInHistory(activeKey, s, () => {
          console.log('✅ Agent added and session updated in history:', activeKey, name)
          done()
        })
      })
    })
  }
  function deleteAgentFromSession(key:string, done:()=>void){
    ensureActiveSession((activeKey:string, session:any) => {
      normalizeSessionAgents(activeKey, session, (s:any)=>{
        const agentToDelete = s.agents.find((a:any)=>a.key===key)
        const isBuiltin = Array.isArray(BUILTIN_AGENTS) && BUILTIN_AGENTS.some((b:any)=>b.key===key)
        if (isBuiltin) {
          if (!Array.isArray(s.hiddenBuiltins)) s.hiddenBuiltins = []
          if (!s.hiddenBuiltins.includes(key)) s.hiddenBuiltins.push(key)
        }
        s.agents = (s.agents||[]).filter((a:any)=>a.key!==key)
        // Do not renumber to preserve uniqueness; keep numberMap for existing
        s.timestamp = new Date().toISOString()
        
        // Ensure session has all required fields for session history
        if (!s.tabName) s.tabName = document.title || 'Unnamed Session'
        if (!s.url) s.url = window.location.href
        if (!s.displayGrids) s.displayGrids = []
        if (!s.agentBoxes) s.agentBoxes = []
        if (!s.customAgents) s.customAgents = []
        if (!s.hiddenBuiltins) s.hiddenBuiltins = []
        
        // Append audit event
        appendAgentEvent(s, { type:'delete', key, name: agentToDelete?.name, icon: agentToDelete?.icon })

        // Save to chrome storage and ensure it's in session history
        ensureSessionInHistory(activeKey, s, () => {
          console.log('✅ Agent deleted and session updated in history:', activeKey, agentToDelete?.name || key)
          done()
        })
      })
    })
  }
  
  // NEW: Helper functions for scope-aware agent storage
  function getAccountAgents(callback: (agents: any[]) => void) {
    chrome.storage.local.get(['accountAgents'], (result) => {
      callback(result.accountAgents || [])
    })
  }
  
  function saveAccountAgents(agents: any[], callback: () => void) {
    chrome.storage.local.set({ accountAgents: agents }, callback)
  }
  
  function getAllAgentsForSession(session: any, callback: (agents: any[]) => void) {
    getAccountAgents((accountAgents) => {
      const sessionAgents = (session.agents || []).filter((a: any) => a.scope !== 'system')
      const systemAgents = (session.agents || []).filter((a: any) => a.scope === 'system')
      const allAgents = [...systemAgents, ...accountAgents, ...sessionAgents]
      callback(allAgents)
    })
  }
  
  function toggleAgentScope(agentKey: string, fromScope: string, toScope: string, callback: () => void) {
    if (fromScope === toScope) return callback()
    
    ensureActiveSession((activeKey: string, session: any) => {
      if (fromScope === 'session' && toScope === 'account') {
        // Move from session to account
        const agent = (session.agents || []).find((a: any) => a.key === agentKey)
        if (!agent) return callback()
        
        session.agents = session.agents.filter((a: any) => a.key !== agentKey)
        session.timestamp = new Date().toISOString()
        
        agent.scope = 'account'
        getAccountAgents((accountAgents) => {
          accountAgents.push(agent)
          saveAccountAgents(accountAgents, () => {
            chrome.storage.local.set({ [activeKey]: session }, () => {
              console.log('✅ Agent moved to Account scope:', agentKey)
              callback()
            })
          })
        })
      } else if (fromScope === 'account' && toScope === 'session') {
        // Move from account to session
        getAccountAgents((accountAgents) => {
          const agent = accountAgents.find((a: any) => a.key === agentKey)
          if (!agent) return callback()
          
          const updatedAccountAgents = accountAgents.filter((a: any) => a.key !== agentKey)
          agent.scope = 'session'
          
          if (!Array.isArray(session.agents)) session.agents = []
          session.agents.push(agent)
          session.timestamp = new Date().toISOString()
          
          saveAccountAgents(updatedAccountAgents, () => {
            chrome.storage.local.set({ [activeKey]: session }, () => {
              console.log('✅ Agent moved to Session scope:', agentKey)
              callback()
            })
          })
        })
      } else {
        callback()
      }
    })
  }
  function renderAgentsGrid(overlay:HTMLElement, filter: string = 'all'){
    const grid = overlay.querySelector('#agents-grid') as HTMLElement | null
    if (!grid) return
    grid.innerHTML = ''
    
    ensureActiveSession((activeKey:string, session:any) => {
      normalizeSessionAgents(activeKey, session, (s:any)=>{
        getAllAgentsForSession(s, (allAgents) => {
          const hidden = Array.isArray(s.hiddenBuiltins) ? s.hiddenBuiltins : []
          
          // Apply filter
          let agents = allAgents.filter((a:any)=> !(a?.kind==='builtin' && hidden.includes(a.key)))
          
          if (filter === 'account') {
            agents = agents.filter((a:any) => a.scope === 'account')
          } else if (filter === 'system') {
            agents = agents.filter((a:any) => a.scope === 'system')
          }
          // 'all' shows everything
          
          agents.sort((a:any,b:any)=> (a.number||0)-(b.number||0))
          
          agents.forEach((a:any) => {
            const num = pad2(Number(a.number)||1)
            const isSystem = a.scope === 'system'
            const card = document.createElement('div')
            card.style.cssText = 'background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;'
            card.innerHTML = `
              <div style="font-size: 32px; margin-bottom: 8px;">${a.icon || '🤖'}</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #FFFFFF; font-weight: bold;">Agent ${num} — ${a.name || 'Agent'}</h4>
              <button class="agent-toggle" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 4px;">OFF</button>
              
              ${!isSystem ? `
                <div class="scope-toggle-container" style="margin: 8px 0; display: flex; border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.3);">
                  <button class="scope-toggle-btn ${a.scope === 'session' ? 'active' : ''}" data-scope="session" data-agent="${a.key}" style="flex: 1; padding: 4px 8px; background: ${a.scope === 'session' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}; border: none; color: white; cursor: pointer; font-size: 9px;">
                    📍 Session
                  </button>
                  <button class="scope-toggle-btn ${a.scope === 'account' ? 'active' : ''}" data-scope="account" data-agent="${a.key}" style="flex: 1; padding: 4px 8px; background: ${a.scope === 'account' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}; border: none; color: white; cursor: pointer; font-size: 9px;">
                    🌐 Account
                  </button>
                </div>
              ` : '<div style="height: 32px; margin: 8px 0; display: flex; align-items: center; justify-content: center; font-size: 9px; color: rgba(255,255,255,0.5);">🔒 System</div>'}
              
              ${!isSystem ? `<button class="delete-agent" data-key="${a.key}" title="Delete" style="position:absolute;top:6px;right:6px;background:rgba(244,67,54,0.85);border:none;color:#fff;width:20px;height:20px;border-radius:50%;cursor:pointer">×</button>` : ''}
              
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="${a.key}" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="${a.key}" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Memory">📄</button>
                <button class="lightbox-btn" data-agent="${a.key}" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
            `
            grid.appendChild(card)
            
            // ON/OFF toggle
            const toggle = card.querySelector('.agent-toggle') as HTMLElement | null
            toggle?.addEventListener('click', () => {
              const isOn = toggle.textContent === 'ON'
              toggle.textContent = isOn ? 'OFF' : 'ON'
              toggle.style.background = isOn ? '#f44336' : '#4CAF50'
            })
            
            // Scope toggle handlers
            card.querySelectorAll('.scope-toggle-btn').forEach((btn: any) => {
              btn.addEventListener('click', (e: any) => {
                e.stopPropagation()
                const newScope = btn.getAttribute('data-scope')
                const agentKey = btn.getAttribute('data-agent')
                const currentScope = a.scope
                
                if (newScope !== currentScope) {
                  toggleAgentScope(agentKey, currentScope, newScope, () => {
                    renderAgentsGrid(overlay, filter)
                  })
                }
              })
            })
            
            // Config dialog buttons
            card.querySelectorAll('.lightbox-btn').forEach((btn:any) => {
              btn.addEventListener('click', (e:any) => {
                const agentKey = e.currentTarget.getAttribute('data-agent') || a.key
                const t = e.currentTarget.getAttribute('data-type') || 'instructions'
                openAgentConfigDialog(agentKey, t, overlay, a.scope || 'session')
              })
            })
            
            // Delete button
            const del = card.querySelector('.delete-agent') as HTMLElement | null
            del?.addEventListener('click', () => {
              if (!confirm('Delete this agent?')) return
              deleteAgentFromSession(a.key, () => renderAgentsGrid(overlay, filter))
            })
          })
        })
      })
    })
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
    
    // For hybrid master tabs, clear any loaded agent boxes
    const urlParams = new URLSearchParams(window.location.search)
    const bootState = readOptimandoState()
    const isHybridMaster = urlParams.has('hybrid_master_id') || 
                          (dedicatedRole && dedicatedRole.type === 'hybrid') ||
                          (bootState.role && bootState.role.type === 'hybrid')
    
    if (isHybridMaster && currentTabData.agentBoxes && currentTabData.agentBoxes.length > 0) {
      console.log('🔧 DEBUG: Clearing agent boxes for hybrid master tab')
      currentTabData.agentBoxes = []
      currentTabData.agentBoxHeights = {}
      // Save the cleared state
      saveTabDataToStorage()
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
    
    // Check if this is a hybrid master tab
    const urlParams = new URLSearchParams(window.location.search)
    const bootState = readOptimandoState()
    const isHybridMaster = urlParams.has('hybrid_master_id') || 
                          (dedicatedRole && dedicatedRole.type === 'hybrid') ||
                          (bootState.role && bootState.role.type === 'hybrid')
    
    console.log('🔧 DEBUG: Checking hybrid status:', { 
      urlHasHybrid: urlParams.has('hybrid_master_id'),
      dedicatedRole,
      bootStateRole: bootState.role,
      isHybridMaster 
    })
    
    if (!currentTabData.agentBoxes || currentTabData.agentBoxes.length === 0) {
      // Only create default boxes for the main master tab, not hybrid masters
      if (!isHybridMaster) {
        console.log('🔧 DEBUG: No agent boxes found, using default configuration for main master')
        // Initialize with default boxes if none exist
        currentTabData.agentBoxes = [
          { id: 'brainstorm', number: 1, title: '#1 🧠 Brainstorm Support Ideas', color: '#4CAF50', outputId: 'brainstorm-output', agentId: 'agent1' },
          { id: 'knowledge', number: 2, title: '#2 🔍 Knowledge Gap Detection', color: '#2196F3', outputId: 'knowledge-output', agentId: 'agent2' },
          { id: 'risks', number: 3, title: '#3 ⚖️ Risks & Chances', color: '#FF9800', outputId: 'risks-output', agentId: 'agent3' },
          { id: 'explainer', number: 4, title: '#4 🎬 Explainer Video Suggestions', color: '#9C27B0', outputId: 'explainer-output', agentId: 'agent4' }
        ]
        saveTabDataToStorage()
      } else {
        console.log('🔧 DEBUG: Hybrid master tab - no default boxes created')
        currentTabData.agentBoxes = []
        saveTabDataToStorage()
      }
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
    
    // Get next sequential number across entire session
    let nextNumber = Math.max(...currentTabData.agentBoxes.map((box: any) => box.number), 0) + 1
    
    // Also check session storage for highest number across all tabs/grids
    const sessionKey = getCurrentSessionKey()
    if (sessionKey && chrome?.storage?.local) {
      chrome.storage.local.get([sessionKey], (result) => {
        if (result[sessionKey]) {
          const session = result[sessionKey]
          let maxNumber = nextNumber - 1
          
          // Check all agent boxes in session
          if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
            session.agentBoxes.forEach((box: any) => {
              if (box && box.number && box.number > maxNumber) {
                maxNumber = box.number
              }
            })
          }
          
          // Check display grid slots
          if (session.displayGrids && Array.isArray(session.displayGrids)) {
            session.displayGrids.forEach((grid: any) => {
              if (grid.config && grid.config.slots) {
                Object.entries(grid.config.slots).forEach(([slotId, slotData]: [string, any]) => {
                  const slotNum = parseInt(slotId)
                  if (!isNaN(slotNum) && slotNum > maxNumber) {
                    maxNumber = slotNum
                  }
                })
              }
            })
          }
          
          nextNumber = maxNumber + 1
          console.log('📦 Next agent box number calculated:', nextNumber, 'from max:', maxNumber)
          
          // Update the input field if dialog is still open
          const numberInput = document.querySelector('#agent-number') as HTMLInputElement
          if (numberInput) {
            numberInput.value = String(nextNumber)
          }
        }
      })
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
        <h3 style="margin: 0 0 20px 0; color: #333; font-size: 18px; text-align: center;">Add New Agent Box</h3>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Agent Number:</label>
          <input id="agent-number" type="number" value="${nextNumber}" min="1" max="99" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Agent Title:</label>
          <input id="agent-title" type="text" placeholder="e.g., 🤖 Custom Agent" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
          <div>
            <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Provider:</label>
            <select id="agent-provider" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; background: white;">
              <option value="" selected disabled>Select LLM</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Claude">Claude</option>
              <option value="Gemini">Gemini</option>
              <option value="Grok">Grok</option>
            </select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Model:</label>
            <select id="agent-model" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; background: white;" disabled>
              <option value="" selected disabled>Select provider first</option>
            </select>
          </div>
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
    const getPlaceholderModels = (provider: string) => {
      switch ((provider || '').toLowerCase()) {
        case 'openai': return ['auto', 'gpt-4o-mini', 'gpt-4o']
        case 'claude': return ['auto', 'claude-3-5-sonnet', 'claude-3-opus']
        case 'gemini': return ['auto', 'gemini-1.5-flash', 'gemini-1.5-pro']
        case 'grok': return ['auto', 'grok-2-mini', 'grok-2']
        default: return ['auto']
      }
    }
    const providerSelect = overlay.querySelector('#agent-provider') as HTMLSelectElement | null
    const modelSelect = overlay.querySelector('#agent-model') as HTMLSelectElement | null
    const refreshModels = () => {
      if (!modelSelect) return
      const provider = providerSelect?.value || ''
      if (!provider) {
        modelSelect.innerHTML = '<option value="" selected disabled>Select provider first</option>'
        modelSelect.disabled = true
        return
      }
      const models = getPlaceholderModels(provider)
      modelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('')
      modelSelect.disabled = false
      modelSelect.value = models[0]
    }
    providerSelect?.addEventListener('change', refreshModels)
    
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
      const providerInput = overlay.querySelector('#agent-provider') as HTMLSelectElement | null
      const modelInput = overlay.querySelector('#agent-model') as HTMLSelectElement | null
      
      const number = parseInt(numberInput.value) || nextNumber
      const title = titleInput.value.trim() || `Agent ${number}`
      const provider = providerInput?.value || ''
      const model = modelInput?.value || 'auto'
      
      // Create unique ID
      const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const outputId = `${id}-output`
      
      // Allocate agent by the chosen Agent Number
      let agentId = `agent${number}`
      
      const newBox = {
        id: id,
        agentId: agentId,
        number: number,
        title: title,
        color: selectedColor,
        outputId: outputId,
        provider: provider,
        model: model
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
          <input id="edit-agent-number" type="number" value="${
            agentBox.agentId && agentBox.agentId.match(/agent(\d+)/) 
              ? agentBox.agentId.match(/agent(\d+)/)[1] 
              : agentBox.model && agentBox.model.match(/agent(\d+)/)
                ? agentBox.model.match(/agent(\d+)/)[1]
                : agentBox.number
          }" min="1" max="99" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 20px;">
          <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Agent Title:</label>
          <input id="edit-agent-title" type="text" value="${agentBox.title}" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px;">
        </div>

        <div style="margin: 10px 0;display:flex;align-items:center;gap:6px;">
          <button id="agent-tools-open" data-agent-id="${agentId}" style="background:transparent;border:none;color:#3b82f6;text-decoration:underline;cursor:pointer;font-size:12px;padding:0">+ Tool</button>
          <span style="font-size:12px;color:#64748b">(optional)</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
          <div>
            <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Provider:</label>
            <select id="edit-agent-provider" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; background: white;">
              <option value="" ${!agentBox.provider ? 'selected' : ''} disabled>Select LLM</option>
              <option value="OpenAI" ${agentBox.provider === 'OpenAI' ? 'selected' : ''}>OpenAI</option>
              <option value="Claude" ${agentBox.provider === 'Claude' ? 'selected' : ''}>Claude</option>
              <option value="Gemini" ${agentBox.provider === 'Gemini' ? 'selected' : ''}>Gemini</option>
              <option value="Grok" ${agentBox.provider === 'Grok' ? 'selected' : ''}>Grok</option>
            </select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 8px; color: #555; font-weight: bold;">Model:</label>
            <select id="edit-agent-model" style="width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; background: white;" ${!agentBox.provider ? 'disabled' : ''}>
              ${!agentBox.provider ? '<option value="" selected disabled>Select provider first</option>' : ''}
            </select>
            <div>
              <button id="finetune-link" style="margin-top:6px;background:transparent;border:none;color:#3b82f6;text-decoration:underline;cursor:pointer;font-size:12px;padding:0">Finetune Model</button>
              <div id="finetune-feedback" style="display:none;margin-top:6px;background:#fee2e2;color:#b91c1c;padding:6px 8px;border-radius:6px;font-size:12px">Finetuning is not available for this Model</div>
            </div>
          </div>
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
    // Provider/Model with agent options
    const getPlaceholderModels = (provider: string) => {
      switch ((provider || '').toLowerCase()) {
        case 'openai': return ['auto', 'gpt-4o-mini', 'gpt-4o']
        case 'claude': return ['auto', 'claude-3-5-sonnet', 'claude-3-opus']
        case 'gemini': return ['auto', 'gemini-1.5-flash', 'gemini-1.5-pro']
        case 'grok': return ['auto', 'grok-2-mini', 'grok-2']
        default: return ['auto']
      }
    }
    const providerSelect = overlay.querySelector('#edit-agent-provider') as HTMLSelectElement | null
    const modelSelect = overlay.querySelector('#edit-agent-model') as HTMLSelectElement | null
    const refreshModels = () => {
      if (!modelSelect) return
      const provider = providerSelect?.value || agentBox.provider || ''
      if (!provider) {
        modelSelect.innerHTML = '<option value="" selected disabled>Select provider first</option>'
        modelSelect.disabled = true
        return
      }
      const models = getPlaceholderModels(provider)
      modelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('')
      modelSelect.disabled = false
      const preferred = (agentBox.model && models.includes(agentBox.model)) ? agentBox.model : models[0]
      modelSelect.value = preferred
    }
    refreshModels()
    providerSelect?.addEventListener('change', refreshModels)
    
    // Minimal tools catalog (inline) for agent editor
    const openAgentToolsCatalog = (id: string) => {
      const tl = document.createElement('div')
      tl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:2147483647;display:flex;align-items:center;justify-content:center'
      tl.onclick = (e:any)=>{ if (e.target === tl) tl.remove() }
      const panel = document.createElement('div')
      panel.style.cssText = 'width:620px;max-width:92vw;max-height:70vh;overflow:auto;background:#0b1220;color:#e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4)'
      panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)">
          <div style="font-weight:700">Tool Catalog</div>
          <button id="at-close" style="padding:6px 10px;background:#475569;border:none;color:#e2e8f0;border-radius:6px;cursor:pointer">Close</button>
        </div>
        <div style="padding:12px 14px;display:flex;gap:10px;align-items:center">
          <input id="at-search" placeholder="Search tools..." style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#0f172a;color:#e2e8f0" />
          <button id="at-add" disabled style="padding:8px 12px;background:#22c55e;border:none;color:#07210f;border-radius:8px;cursor:pointer;font-weight:700">Add</button>
        </div>
        <div style="padding:0 14px 14px 14px;opacity:.7;font-size:12px">No tools yet. Type a name and click Add to attach a tool to this agent box.</div>
      `
      tl.appendChild(panel)
      document.body.appendChild(tl)
      const s = panel.querySelector('#at-search') as HTMLInputElement
      const addBtn = panel.querySelector('#at-add') as HTMLButtonElement
      s.oninput = ()=>{ addBtn.disabled = !s.value.trim() }
      ;(panel.querySelector('#at-close') as HTMLButtonElement).onclick = ()=> tl.remove()
      addBtn.onclick = ()=>{
        const name = (s.value || '').trim()
        if (!name) return
        try {
          const key = `agent-tools:${id}`
          const current = JSON.parse(localStorage.getItem(key) || '[]')
          if (!current.includes(name)) current.push(name)
          localStorage.setItem(key, JSON.stringify(current))
        } catch {}
        addBtn.textContent = 'Added'
        addBtn.disabled = true
        setTimeout(()=> tl.remove(), 400)
      }
    }

    // Handle cancel
    overlay.querySelector('#cancel-edit-agent')?.addEventListener('click', () => {
      overlay.remove()
    })
    // Tools lightbox
    ;(overlay.querySelector('#agent-tools-open') as HTMLButtonElement | null)?.addEventListener('click', ()=>{
      try { openAgentToolsCatalog(agentId) } catch (e){ console.error('tools lib open failed', e) }
    })
    // Finetune feedback
    ;(overlay.querySelector('#finetune-link') as HTMLButtonElement | null)?.addEventListener('click', ()=>{
      const fb = overlay.querySelector('#finetune-feedback') as HTMLElement
      if (fb) {
        fb.style.display = 'block'
        fb.style.opacity = '1'
        setTimeout(()=>{
          fb.style.opacity = '0'
          setTimeout(()=>{ fb.style.display = 'none' }, 300)
        }, 2000)
      }
    })
    
    // Handle confirm
    overlay.querySelector('#confirm-edit-agent')?.addEventListener('click', () => {
      const numberInput = overlay.querySelector('#edit-agent-number') as HTMLInputElement
      const titleInput = overlay.querySelector('#edit-agent-title') as HTMLInputElement
      const providerInput = overlay.querySelector('#edit-agent-provider') as HTMLSelectElement | null
      const modelInput = overlay.querySelector('#edit-agent-model') as HTMLSelectElement | null
      
      const number = parseInt(numberInput.value) || agentBox.number
      const title = titleInput.value.trim() || agentBox.title
      const provider = providerInput?.value || agentBox.provider || 'OpenAI'
      const model = modelInput?.value || agentBox.model || 'auto'
      
      // The "Agent Number" field actually represents the allocated agent, not the box number
      // So we need to set the agentId based on this number
      const allocatedAgentNumber = parseInt(numberInput.value)
      let agentIdToSet = agentBox.agentId
      if (allocatedAgentNumber && allocatedAgentNumber > 0) {
        agentIdToSet = `agent${allocatedAgentNumber}`
      }
      
      console.log('📝 Edit dialog save:', {
        boxNumber: agentBox.number,
        inputValue: numberInput.value,
        allocatedAgentNumber,
        oldAgentId: agentBox.agentId,
        newAgentId: agentIdToSet
      })
      
      updateAgentBox(agentId, {
        number: agentBox.number, // Keep original box number unchanged
        title: title,
        color: selectedColor,
        provider: provider,
        model: model,
        agentId: agentIdToSet // Set the allocated agent
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

  function updateAgentBox(agentId: string, updates: { number?: number, title?: string, color?: string, provider?: string, model?: string, agentId?: string }) {
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
    if (updates.provider !== undefined) agentBox.provider = updates.provider
    if (updates.model !== undefined) agentBox.model = updates.model
    
    // Update agent allocation if explicitly provided
    if (updates.agentId !== undefined) {
      agentBox.agentId = updates.agentId
      console.log(`🔄 Agent allocation updated: Box ${agentBox.number} → ${updates.agentId}`)
    }
    // Also check model for agent info (fallback)
    else if (updates.model && updates.model.includes('agent')) {
      const match = updates.model.match(/agent[- ]?(\d+)/i)
      if (match) {
        agentBox.agentId = `agent${match[1]}`
        console.log(`🔄 Agent allocation updated from model: Box ${agentBox.number} → Agent ${match[1]}`)
      }
    }
    
    // Save to storage and re-render
    saveTabDataToStorage()
    // Also persist to current chrome.storage.local session so overview reflects changes immediately
    try {
      const sessionKey = getCurrentSessionKey()
      if (sessionKey && chrome?.storage?.local) {
        chrome.storage.local.get([sessionKey], (result) => {
          const session = result[sessionKey] || {}
          session.agentBoxes = currentTabData.agentBoxes
          session.timestamp = new Date().toISOString()
          chrome.storage.local.set({ [sessionKey]: session }, () => {
            console.log('✅ Persisted updated agentBoxes to session:', sessionKey)
          })
        })
      }
    } catch {}
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
      <div style="display:flex; gap:6px; align-items:center;">
        <button id="command-center-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s ease;" title="Command Chat">
          💬
        </button>
      <button id="quick-expand-btn" style="background: rgba(255,255,255,0.2); border: none; color: inherit; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s ease;" title="Quick expand to maximum width">
        ⇄
      </button>
      </div>
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
    
    // Update original margins only (wrapper removed)
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
        <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDI1IDI1IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMjUiIGhlaWdodD0iMjUiIGZpbGw9IndoaXRlIi8+CjwhLS0gUVIgQ29kZSBQYXR0ZXJuIC0tPgo8IS0tIFRvcCBMZWZ0IEZpbmRlciAtLT4KPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjciIGhlaWdodD0iNyIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMiIgeT0iMiIgd2lkdGg9IjUiIGhlaWdodD0iNSIgZmlsbD0id2hpdGUiLz4KPHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjMiIGhlaWdodD0iMyIgZmlsbD0iYmxhY2siLz4KCjwhLS0gVG9wIFJpZ2h0IEZpbmRlciAtLT4KPHJlY3QgeD0iMTciIHk9IjEiIHdpZHRoPSI3IiBoZWlnaHQ9IjciIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE4IiB5PSIyIiB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSJ3aGl0ZSIvPgo8cmVjdCB4PSIxOSIgeT0iMyIgd2lkdGg9IjMiIGhlaWdodD0iMyIgZmlsbD0iYmxhY2siLz4KCjwhLS0gQm90dG9tIExlZnQgRmluZGVyIC0tPgo8cmVjdCB4PSIxIiB5PSIxNyIgd2lkdGg9IjciIGhlaWdodD0iNyIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMiIgeT0iMTgiIHdpZHRoPSI1IiBoZWlnaHQ9IjUiIGZpbGw9IndoaXRlIi8+CjxyZWN0IHg9IjMiIHk9IjE5IiB3aWR0aD0iMyIgaGVpZ2h0PSIzIiBmaWxsPSJibGFjayIvPgoKPCEtLSBUaW1pbmcgUGF0dGVybnMgLS0+CjxyZWN0IHg9IjkiIHk9IjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSIxIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPCEtLSBEYXRhIFBhdHRlcm4gLS0+CjxyZWN0IHg9IjkiIHk9IjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSIzIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSI1IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSI3IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSI1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSI3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8IS0tIE1vcmEgZGF0YSBwYXR0ZXJucyAtLT4KPHJlY3QgeD0iOSIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEwIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTIiIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNCIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE2IiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSIxMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIxNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTMiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSI5IiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMTciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE1IiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMSIgeT0iMTkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSIxOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIyMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTMiIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSI5IiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE1IiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjE3IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjEiIHk9IjkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIzIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIyMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8L3N2Zz4=" style="width: 110px; height: 110px;" alt="QR Code" />
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
        <button id="wrvault-open-btn" style="padding: 10px; border-radius: 6px; cursor: pointer; font-size: 11px; display:flex; align-items:center; gap:8px; justify-content:center; font-weight:700; border:1px solid rgba(255,255,255,0.25); grid-column: 1 / span 2;">
          <span>🔒</span>
          <span>WRVault</span>
        </button>
      </div>
    </div>


  `
  // If this tab is a Hybrid Master, render a right-side agent panel with only Add button
  if (isHybridMaster) {
    // Align right panel width with left panel and persist
    currentTabData.uiConfig.rightSidebarWidth = currentTabData.uiConfig.leftSidebarWidth
    rightSidebar.style.width = currentTabData.uiConfig.rightSidebarWidth + 'px'
    rightSidebar.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px;" class="section-title">🧩 Master (${parseInt(hybridMasterId) + 1})</h2>
        <button id="quick-expand-right-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s ease;" title="Quick expand to maximum width">⇄</button>
      </div>

      <!-- Right-side Agent Box Add Button Only -->
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
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 8px 15px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    pointer-events: auto;
    backdrop-filter: none;
    overflow: visible;
    cursor: pointer;
    transition: height 0.3s ease;
    z-index: 2147483000;
    margin: 0;
    border: none;
  `

  // Theme application limited to Optimando elements (topbar + sidebars only)
  const ORIGINAL_BG = 'linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%)'

  // Ensure theme CSS for tabs and quick-action links exists (overrides inline styles)
  function injectThemeCSSOnce() {
    try {
      if (document.getElementById('optimando-theme-css')) return
      const style = document.createElement('style')
      style.id = 'optimando-theme-css'
      style.textContent = `
        /* Topbar tabs - ensure visibility across themes */
        .theme-default #topbar-tabs .topbar-tab { color: white !important; }
        .theme-dark #topbar-tabs .topbar-tab { background: rgba(255,255,255,0.1) !important; border: 1px solid rgba(255,255,255,0.2) !important; color: #ffffff !important; }
        .theme-professional #topbar-tabs .topbar-tab { background: rgba(2,6,23,0.03) !important; border: 1px solid #e2e8f0 !important; color: #0f172a !important; }

        /* Orchestration quick actions */
        .theme-default .quick-action { background: rgba(255,255,255,0.18) !important; border: 1px solid rgba(255,255,255,0.3) !important; color: #ffffff !important; }
        .theme-dark .quick-action { background: rgba(255,255,255,0.18) !important; border: 1px solid rgba(255,255,255,0.3) !important; color: #ffffff !important; }
        .theme-professional .quick-action { background: #f8fafc !important; border: 1px solid #cbd5e1 !important; color: #0f172a !important; box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important; }
      `
      ;(document.head || document.documentElement).appendChild(style)
    } catch {}
  }

  // Re-apply dynamic theming for elements created earlier (tabs)
  function refreshExpandableTheming() {
    try { injectThemeCSSOnce(); injectDockedSendCSSOnce() } catch {}
    try {
      const saved = (localStorage.getItem('optimando-topbar-active-tab') as 'reasoning' | 'session-goals' | 'workflows' | null) || 'reasoning'
      setActiveTopbarTab(saved)
    } catch {
      try { setActiveTopbarTab('reasoning') } catch {}
    }
  }

  // Minimal CSS for theme-aware Send button in docked chat
  function injectDockedSendCSSOnce() {
    try {
      if (document.getElementById('optimando-chat-send-css')) return
      const s = document.createElement('style')
      s.id = 'optimando-chat-send-css'
      s.textContent = `
        #command-chat-docked .send-btn { font-weight: 800; height: 36px; border-radius: 6px; cursor: pointer; padding: 0 12px; }
        .theme-default #command-chat-docked .send-btn { background: linear-gradient(135deg,#667eea,#764ba2); border: 1px solid rgba(255,255,255,0.30); color: #ffffff; }
        .theme-dark #command-chat-docked .send-btn { background: linear-gradient(135deg,#334155,#1e293b); border: 1px solid rgba(255,255,255,0.20); color: #e5e7eb; }
        .theme-professional #command-chat-docked .send-btn { background: linear-gradient(135deg,#ffffff,#f1f5f9); border: 1px solid #cbd5e1; color: #0f172a; }
      `
      ;(document.head || document.documentElement).appendChild(s)
    } catch {}
  }

  // Inject CSS for docked Command Chat once so theme switches apply immediately
  function injectDockedChatCSSOnce() {
    try {
      if (document.getElementById('chat-docked-css')) return
      const style = document.createElement('style')
      style.id = 'chat-docked-css'
      style.textContent = `
        /* Base layout */
        .chat-docked { border-radius: 8px; overflow: hidden; border-width: 1px; border-style: solid; }
        .chat-docked .chat-hdr { display:flex; align-items:center; justify-content:space-between; padding:6px 8px; border-bottom-width:1px; border-bottom-style:solid; font-size:12px; font-weight:700; }
        .chat-docked .chat-title { display:flex; align-items:center; gap:6px; }
        .chat-docked .chat-msgs { height:160px; overflow:auto; display:flex; flex-direction:column; gap:6px; padding:8px; }
        .chat-docked .chat-compose { display:grid; grid-template-columns:1fr 36px 36px 68px; gap:6px; align-items:center; padding:8px; }
        .chat-docked .chat-ta { box-sizing:border-box; height:36px; resize:vertical; border-radius:6px; padding:8px; font-size:12px; }
        .chat-docked .chat-btn { height:36px; border-radius:6px; display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:12px; }
        .chat-docked .chat-send { height:36px; border-radius:6px; font-weight:800; cursor:pointer; }

        /* Default (purple) */
        .theme-default .chat-docked { background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.20); color: white; }
        .theme-default .chat-docked .chat-hdr { background: linear-gradient(135deg,#667eea,#764ba2); border-bottom-color: rgba(255,255,255,0.20); color: white; }
        .theme-default .chat-docked .chat-msgs { background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.20); }
        .theme-default .chat-docked .chat-ta { background: rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.20); color: white; }
        .theme-default .chat-docked .chat-btn { background: rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.20); color: white; }
        .theme-default .chat-docked .chat-send { background:#22c55e; border:1px solid #16a34a; color:#0b1e12; }

        /* Dark */
        .theme-dark .chat-docked { background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.20); color: #e5e7eb; }
        .theme-dark .chat-docked .chat-hdr { background: linear-gradient(135deg,#0f172a,#1e293b); border-bottom-color: rgba(255,255,255,0.20); color: #e5e7eb; }
        .theme-dark .chat-docked .chat-msgs { background: rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.20); }
        .theme-dark .chat-docked .chat-ta { background: rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.20); color: #e5e7eb; }
        .theme-dark .chat-docked .chat-btn { background: rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.20); color: #e5e7eb; }
        .theme-dark .chat-docked .chat-send { background:#22c55e; border:1px solid #16a34a; color:#0b1e12; }

        /* Professional (light) */
        .theme-professional .chat-docked { background:#ffffff; border-color:#e2e8f0; color:#0f172a; }
        .theme-professional .chat-docked .chat-hdr { background: linear-gradient(135deg,#ffffff,#f1f5f9); border-bottom-color:#e2e8f0; color:#0f172a; }
        .theme-professional .chat-docked .chat-msgs { background:#f8fafc; border-bottom: 1px solid #e2e8f0; }
        .theme-professional .chat-docked .chat-ta { background:#ffffff; border:1px solid #e2e8f0; color:#0f172a; }
        .theme-professional .chat-docked .chat-btn { background:#e2e8f0; border:1px solid #cbd5e1; color:#0f172a; }
        .theme-professional .chat-docked .chat-send { background:#22c55e; border:1px solid #16a34a; color:#0b1e12; }
      `
      ;(document.head || document.documentElement).appendChild(style)
    } catch {}
  }
  function applyTheme(theme) {
    injectThemeCSSOnce()
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
        bottomSidebar.style.borderBottom = '1px solid #374151';  // Anthracite color for dark theme
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
    // Ensure tabs reflect new theme immediately
    refreshExpandableTheming()
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
      bottomSidebar.style.borderBottom = 'none';  // Remove any theme-specific borders
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
    // Ensure tabs reflect theme reset immediately
    refreshExpandableTheming()
  }

  // Apply saved theme on init ONLY if present; otherwise keep original defaults
  try {
    const savedTheme = localStorage.getItem('optimando-ui-theme')
    if (savedTheme === 'dark' || savedTheme === 'professional') {
        try { chrome.storage?.local?.set({ 'optimando-ui-theme': savedTheme }) } catch {}
      applyTheme(savedTheme)
      } else {
        try { chrome.storage?.local?.set({ 'optimando-ui-theme': 'default' }) } catch {}
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
            <button id="expand-btn" style="background: transparent; border: none; color: currentColor; font-size: 12px; transition: transform 0.3s ease;">⌄</button>
          </div>
          <button id="agents-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 3px; cursor: pointer; font-size: 10px; color: inherit;" class="menu-link">🤖 Agents</button>
          <button id="context-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 3px; cursor: pointer; font-size: 10px; color: inherit;" class="menu-link">📄 Context</button>
          <button id="memory-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 3px; cursor: pointer; font-size: 10px; color: inherit;" class="menu-link">💽 Memory</button>
          <button id="settings-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 3px; cursor: pointer; font-size: 10px; color: inherit;" class="menu-link">⚙️ Settings</button>
          <button id="dock-chat-btn" style="padding: 4px 8px; background: transparent; border: none; border-radius: 3px; cursor: pointer; font-size: 12px; color: inherit; font-weight:700;" class="menu-link" title="Dock to sidepanel">📌</button>
        </div>
        
        <!-- Session Name + Controls -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <input id="session-name-input" class="session-id-text" type="text" value="${currentTabData.tabName}" 
                 style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: inherit; 
                        padding: 4px 8px; border-radius: 3px; font-size: 11px; width: 140px; 
                        ${currentTabData.isLocked ? 'opacity: 0.6; pointer-events: none;' : ''}"
                 ${currentTabData.isLocked ? 'disabled' : ''}
                 placeholder="Session Name">
          <button id="new-session-btn" style="background: rgba(76, 175, 80, 0.8); border: none; color: white; width: 24px; height: 24px; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold; transition: all 0.2s ease; ${isHybridMaster ? 'display: none;' : ''}" title="Start a new session">+</button>
          <button id="lock-btn" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 24px; height: 24px; border-radius: 3px; cursor: pointer; font-size: 10px; ${currentTabData.isLocked ? 'background: rgba(255,215,0,0.3);' : ''}">${currentTabData.isLocked ? '🔒' : '🔓'}</button>
        </div>
      </div>

      <!-- Expandable Content - Tabbed Reasoning Area -->
      <div id="expandable-content" style="display: none; margin-top: 15px; height: ${expandedHeight - 60}px; overflow-y: auto;">
        <!-- Tabs -->
        <div id="topbar-tabs" style="display:flex; gap:8px; margin-bottom:10px;">
          <button data-tab="reasoning" class="topbar-tab" style="padding:6px 10px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.25); color: white; border-radius: 6px; font-size: 11px; cursor: pointer;">💡 Insights</button>
          <button data-tab="session-goals" class="topbar-tab" style="padding:6px 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 6px; font-size: 11px; cursor: pointer;">🎯 Session Goals</button>
          <button data-tab="workflows" class="topbar-tab" style="padding:6px 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 6px; font-size: 11px; cursor: pointer;">🛠️ Workflows</button>
        </div>

        <!-- Reasoning Panel -->
        <div id="tab-content-reasoning" style="display:block;">
          <div style="display:grid; grid-template-columns: 1fr 2fr; gap: 15px; height: 100%;">
            <!-- Left: User Intent Detection (1/3) -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; display:flex; flex-direction:column; gap:10px;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                <h4 class="dropdown-title" style="margin: 0; font-size: 12px;">🧭 User Intent Detection</h4>
                <div style="display:flex; align-items:center; gap:6px;">
                  <label for="optimization-mode-select" style="font-size: 10px; opacity: 0.9;">Optimization</label>
                  <select id="optimization-mode-select" style="background: rgba(17,24,39,0.92); border: 1px solid rgba(255,255,255,0.35); color: #ffffff; padding: 4px 6px; border-radius: 6px; font-size: 10px; max-width: 160px; appearance: auto; color-scheme: dark;">
                    <option value="off" style="background:#111827;color:#ffffff;">Off (default)</option>
                    <option value="on" style="background:#111827;color:#ffffff;">On</option>
                    <option value="optiscan" style="background:#111827;color:#ffffff;">Optiscan</option>
                    <option value="deepfix" style="background:#111827;color:#ffffff;">Deepfix</option>
                  </select>
                </div>
              </div>
              <div id="detected-intent-demo" style="font-size: 10px; opacity: 0.9; line-height:1.5; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.18); border-radius:6px; padding:8px;">
                <div><strong>Detected Intent:</strong> Compare product prices and find best value</div>
                <div style="opacity:0.8;">Confidence: 72% • Updated: just now</div>
              </div>
            </div>

            <!-- Right: Orchestration Logic (2/3) -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; display:flex; flex-direction:column; gap:10px;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <h4 class="dropdown-title" style="margin: 0; font-size: 12px;">🧠 Orchestration Logic</h4>
                <div style="display:flex; gap:6px;">
                  <button id="gen-followups-btn" class="quick-action" title="Re-generate follow-up questions" style="padding:6px 8px; border-radius:6px; font-size:11px; cursor:pointer;">🔄 Re-Generate</button>
                  <button id="show-paths-btn" class="quick-action" title="Show reasoning paths" style="padding:6px 8px; border-radius:6px; font-size:11px; cursor:pointer;">🧭 Paths</button>
                  <button id="feedback-loop-btn" class="quick-action" title="Trigger feedback loop" style="padding:6px 8px; border-radius:6px; font-size:11px; cursor:pointer;">♻️ Feedback</button>
                </div>
              </div>
              <div id="orchestration-log" style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; font-size: 10px; height: 120px; overflow-y: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
                [System] Orchestrator idle. Awaiting actions…
              </div>
            </div>
          </div>
        </div>
        <!-- Session Goals Panel -->
        <div id="tab-content-session-goals" style="display:none;">
          <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <h4 class="dropdown-title" style="margin: 0; font-size: 12px;">🎯 Session Goals</h4>
              <span title="Defining goals helps the system detect your intent more accurately and orchestrate better actions." style="font-size:12px; opacity:0.85; cursor:help;">ℹ️</span>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items:start; grid-auto-rows: min-content;">
              <div style="display:flex;flex-direction:column;gap:4px; position:relative; grid-row: 1 / span 2;">
                <label for="goal-text" style="display:flex; align-items:center; gap:6px; font-size:11px;">Goal</label>
                <textarea id="goal-text" placeholder="What's your goal right now?" style="width: 100%; height: 100px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.45); color: white; padding: 6px 36px 6px 10px; border-radius: 6px; font-size: 11px; resize: vertical;"></textarea>
                <button id="goal-mic" title="Speak your goal" style="position:absolute; right:8px; bottom:8px; background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.35);color:#fff;padding:2px 6px;border-radius:6px;cursor:pointer">🎤</button>
              </div>
              <div style="display:flex;flex-direction:column;gap:4px; position:relative;">
                <label for="role-text" style="display:flex; align-items:center; gap:6px; font-size:11px;">Role</label>
                <input id="role-text" placeholder="e.g. assistant, validator" style="width:100%; height: 44px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.45); color: white; padding: 6px 36px 6px 10px; border-radius: 6px; font-size: 11px;"/>
                <button id="role-mic" title="Speak your role" style="position:absolute; right:8px; bottom:8px; background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.35);color:#fff;padding:2px 6px;border-radius:6px;cursor:pointer">🎤</button>
              </div>
              <div style="display:flex; justify-content:flex-end; align-items:center;">
                <button id="save-as-agent" title="You can save your Goals and Role into an Agent. This allows recurring tasks and intent detection to be refined and tailored to you, so the system can automatically trigger workflows and complex reasoning processes more effectively." style="padding:6px 10px; background:#22c55e; border:none; color:#07210f; border-radius:6px; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:6px;">Save as Agent <span style="font-size:12px">ℹ️</span></button>
              </div>
            </div>
          </div>
        </div>

        <!-- Workflows Panel -->
        <div id="tab-content-workflows" style="display:none;">
          <div style="display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px;">
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; display:flex; flex-direction:column; gap:8px;">
              <div style="font-size:12px; font-weight:600;">📧 Send Email</div>
              <div style="font-size:10px; opacity:0.9;">Draft and send a concise email.</div>
              <button data-workflow="email" class="wf-action" style="padding:6px 8px; background:#22c55e; border:none; color:#07210f; border-radius:6px; font-size:11px; cursor:pointer;">Start</button>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; display:flex; flex-direction:column; gap:8px;">
              <div style="font-size:12px; font-weight:600;">📅 Manage Calendar</div>
              <div style="font-size:10px; opacity:0.9;">Create or reschedule meetings.</div>
              <button data-workflow="calendar" class="wf-action" style="padding:6px 8px; background:#3b82f6; border:none; color:white; border-radius:6px; font-size:11px; cursor:pointer;">Start</button>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; display:flex; flex-direction:column; gap:8px;">
              <div style="font-size:12px; font-weight:600;">🧹 Clean Up Draft</div>
              <div style="font-size:10px; opacity:0.9;">Refine text for clarity and tone.</div>
              <button data-workflow="cleanup" class="wf-action" style="padding:6px 8px; background:#f59e0b; border:none; color:#1f2937; border-radius:6px; font-size:11px; cursor:pointer;">Start</button>
            </div>
          </div>
        </div>
      </div>
    `
  }


  bottomSidebar.innerHTML = createBottomContent()
  // Start collapsed and ensure no empty content flashes
  try {
    const expandableContent = bottomSidebar.querySelector('#expandable-content') as HTMLElement | null
    if (expandableContent) expandableContent.style.display = 'none'
  } catch {}
  // Restore expansion state (after innerHTML set, ensure DOM refs are available)
  try {
    const saved = localStorage.getItem('optimando-topbar-expanded')
    const expandBtn = document.getElementById('expand-btn')
    const expandableContent = document.getElementById('expandable-content')
    if (saved === 'true') {
      isExpanded = true
      bottomSidebar.style.height = expandedHeight + 'px'
      bottomSidebar.style.cursor = 'default'
      if (expandBtn) (expandBtn as HTMLElement).style.transform = 'rotate(180deg)'
      if (expandableContent) (expandableContent as HTMLElement).style.display = 'block'
      setTimeout(() => { document.body.style.marginTop = expandedHeight + 'px' }, 10)
    } else {
      // Ensure compact defaults
      isExpanded = false
      bottomSidebar.style.height = '45px'
      bottomSidebar.style.cursor = 'pointer'
      if (expandBtn) (expandBtn as HTMLElement).style.transform = 'rotate(0deg)'
      if (expandableContent) (expandableContent as HTMLElement).style.display = 'none'
      setTimeout(() => { document.body.style.marginTop = '0px' }, 10)
    }
  } catch {}

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
      // Re-apply offsets after transition completes
      setTimeout(() => {
        document.body.style.marginTop = expandedHeight + 'px'
      }, 10)
    } else {
      bottomSidebar.style.height = '45px'
      bottomSidebar.style.cursor = 'pointer'
      expandBtn.style.transform = 'rotate(0deg)'
      expandableContent.style.display = 'none'
      setTimeout(() => {
        // Remove any extra offset when collapsed to avoid wasted space
        document.body.style.marginTop = '0px'
      }, 10)
    }

    // Persist expansion state per tab (best-effort)
    try {
      localStorage.setItem('optimando-topbar-expanded', isExpanded ? 'true' : 'false')
    } catch {}
  }
  // Tabs logic for expandable content
  function setActiveTopbarTab(tabId: 'reasoning' | 'session-goals' | 'workflows') {
    try { localStorage.setItem('optimando-topbar-active-tab', tabId) } catch {}
    const tabs = Array.from(document.querySelectorAll('#topbar-tabs .topbar-tab')) as HTMLElement[]
    const panels: Record<string, HTMLElement | null> = {
      reasoning: document.getElementById('tab-content-reasoning') as HTMLElement | null,
      'session-goals': document.getElementById('tab-content-session-goals') as HTMLElement | null,
      workflows: document.getElementById('tab-content-workflows') as HTMLElement | null,
    }
    const isProfessional = bottomSidebar.classList.contains('theme-professional')
    const activeBg = isProfessional ? 'rgba(2,6,23,0.08)' : 'rgba(255,255,255,0.2)'
    const inactiveBg = isProfessional ? 'rgba(2,6,23,0.03)' : 'rgba(255,255,255,0.1)'
    const activeBorder = isProfessional ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.25)'
    const inactiveBorder = isProfessional ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.2)'
    const textColor = isProfessional ? '#0f172a' : 'white'
    tabs.forEach(btn => {
      const id = btn.getAttribute('data-tab') || ''
      if (id === tabId) {
        btn.style.background = activeBg
        btn.style.border = activeBorder
        btn.style.color = textColor
      } else {
        btn.style.background = inactiveBg
        btn.style.border = inactiveBorder
        btn.style.color = textColor
      }
    })
    Object.entries(panels).forEach(([id, el]) => {
      if (!el) return
      el.style.display = id === tabId ? 'block' : 'none'
    })
  }

  // Attach tab handlers after DOM paint and guard against initial empty state
  setTimeout(() => {
    // If persisted expanded but content hidden (edge cases), force-show
    try {
      const saved = localStorage.getItem('optimando-topbar-expanded')
      const expandBtn = document.getElementById('expand-btn') as HTMLElement | null
      const expandableContent = document.getElementById('expandable-content') as HTMLElement | null
      if (saved === 'true' && expandableContent && expandableContent.style.display === 'none') {
        isExpanded = true
        bottomSidebar.style.height = expandedHeight + 'px'
        bottomSidebar.style.cursor = 'default'
        if (expandBtn) expandBtn.style.transform = 'rotate(180deg)'
        expandableContent.style.display = 'block'
        document.body.style.marginTop = expandedHeight + 'px'
      }
    } catch {}
    const tabButtons = Array.from(document.querySelectorAll('#topbar-tabs .topbar-tab')) as HTMLElement[]
    tabButtons.forEach(btn => btn.addEventListener('click', () => {
      const id = (btn.getAttribute('data-tab') || 'reasoning') as 'reasoning' | 'session-goals' | 'workflows'
      setActiveTopbarTab(id)
    }))
    // Adjust initial tab styles for professional theme
    try {
      const saved = (localStorage.getItem('optimando-topbar-active-tab') as 'reasoning' | 'session-goals' | 'workflows' | null) || 'reasoning'
      setActiveTopbarTab(saved)
    } catch { setActiveTopbarTab('reasoning') }
    // Wire up orchestration quick actions
    const log = document.getElementById('orchestration-log') as HTMLElement | null
    const append = (msg: string) => { if (!log) return; log.innerHTML += `\n${msg}`; log.scrollTop = log.scrollHeight }
    document.getElementById('gen-followups-btn')?.addEventListener('click', () => append('[Action] Generated follow-up questions.'))
    document.getElementById('show-paths-btn')?.addEventListener('click', () => append('[Action] Displayed current reasoning paths.'))
    document.getElementById('feedback-loop-btn')?.addEventListener('click', () => append('[Action] Triggered feedback loop.'))
    // Wire up demo workflow quick actions
    Array.from(document.querySelectorAll('.wf-action')).forEach(btn => {
      btn.addEventListener('click', () => {
        const wf = (btn as HTMLElement).getAttribute('data-workflow') || 'unknown'
        append(`[Workflow] Started: ${wf}`)
      })
    })
    // Persist optimization mode
    try {
      const select = document.getElementById('optimization-mode-select') as HTMLSelectElement | null
      if (select) {
        const savedMode = localStorage.getItem('optimando-optimization-mode')
        if (savedMode) select.value = savedMode
        select.addEventListener('change', () => {
          localStorage.setItem('optimando-optimization-mode', select.value)
          append(`[Mode] Optimization set to: ${select.value}`)
        })
      }
    } catch {}
    // Persist new Goal/Role fields
    const persistField = (id: string, key: string) => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null
      if (!el) return
      try { const saved = localStorage.getItem(key); if (saved !== null) (el as any).value = saved } catch {}
      el.addEventListener('input', () => { try { localStorage.setItem(key, (el as any).value) } catch {} })
    }
    persistField('goal-text', 'optimando-goal')
    persistField('role-text', 'optimando-role')

    // Wire up Save as Agent (robust: create via session API, then open editor and prefill)
    const saveAsAgentBtn = document.getElementById('save-as-agent') as HTMLButtonElement | null
    saveAsAgentBtn?.addEventListener('click', () => {
      const goal = (document.getElementById('goal-text') as HTMLTextAreaElement)?.value || ''
      const role = (document.getElementById('role-text') as HTMLInputElement)?.value || ''
      try {
        // Derive a stable key from the temporary name
        const tempName = 'Custom Agent'
        const agentKey = (tempName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        // Create the agent directly in the session, then open the lightbox and config dialog
        addAgentToSession(tempName, '🎯', () => {
          try {
            openAgentsLightbox()
          } catch {}
          // Give the lightbox a moment to mount
          setTimeout(() => {
            const overlay = document.getElementById('agents-lightbox') as HTMLElement | null
            try { openAgentConfigDialog(agentKey, 'instructions', overlay as any) } catch {}
            // After dialog renders, ensure Reasoning is enabled and prefill fields
            setTimeout(() => {
              const capR = document.getElementById('cap-reasoning') as HTMLInputElement | null
              if (capR && !capR.checked) { capR.click() }
              setTimeout(() => {
                const goalsEl = document.getElementById('R-goals') as HTMLTextAreaElement | null
                const roleEl = document.getElementById('R-role') as HTMLInputElement | null
                if (goalsEl) goalsEl.value = goal
                if (roleEl) roleEl.value = role
                const rBox = document.getElementById('box-reasoning') as HTMLElement | null
                if (rBox) rBox.style.maxHeight = '52px'
              }, 120)
            }, 180)
          }, 160)
        })
      } catch (e) { console.warn('Save as Agent failed', e) }
    })
    // Restore active tab
    try {
      const saved = (localStorage.getItem('optimando-topbar-active-tab') as 'reasoning' | 'session-goals' | 'workflows' | null) || 'reasoning'
      setActiveTopbarTab(saved)
    } catch {
      setActiveTopbarTab('reasoning')
    }
  }, 0)


  // Lightbox functions
  function openAgentsLightbox() {
    // Create agents lightbox
    const overlay = document.createElement('div')
    overlay.id = 'agents-lightbox'
    const safeGradient = (() => {
      try {
        return getCurrentGradient()
      } catch {
        return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }
    })()

    // Show default 01–05 for a fresh lightbox; session will override below
    const nSummarize = '01'
    const nResearch = '02'
    const nAnalyze = '03'
    const nGenerate = '04'
    const nCoordinate = '05'

    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: ${safeGradient}; z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
    `
    
    function getCurrentGradient() {
      try {
        const ls = document.getElementById('left-sidebar') as HTMLElement | null
        if (ls) {
          const inlineBg = ls.style.background
          if (inlineBg && inlineBg.includes('linear-gradient')) return inlineBg
          const cs = getComputedStyle(ls)
          const ci = (cs.backgroundImage || cs.background || '').toString()
          if (ci && ci.includes('gradient')) return ci
        }
      } catch {}
      const t = (localStorage.getItem('optimando-ui-theme') || 'default') as 'default'|'dark'|'professional'
      if (t === 'dark') return 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
      if (t === 'professional') return 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)'
      return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    }

    // Force default look for Settings wrapper as well
    const themeGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    overlay.innerHTML = `
      <div style="background: ${themeGradient}; border-radius: 16px; width: 90vw; height: 85vh; max-width: 1200px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">🤖 AI Agents Configuration</h2>
          <button id="close-agents-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        
        <!-- TABS: All Agents | Account | System -->
        <div style="padding: 10px 20px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; gap: 10px;">
          <button class="agent-filter-tab" data-filter="all" style="padding: 8px 16px; background: rgba(255,255,255,0.3); border: none; color: white; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">
            All Agents
          </button>
          <button class="agent-filter-tab" data-filter="account" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: none; color: rgba(255,255,255,0.7); border-radius: 6px; cursor: pointer; font-size: 12px;">
            Account
          </button>
          <button class="agent-filter-tab" data-filter="system" style="padding: 8px 16px; background: rgba(255,255,255,0.1); border: none; color: rgba(255,255,255,0.7); border-radius: 6px; cursor: pointer; font-size: 12px;">
            System
          </button>
        </div>
        
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
          <div id="agents-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px;"></div>

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
    
    // Tab switching functionality
    let currentFilter = 'all'
    overlay.querySelectorAll('.agent-filter-tab').forEach((tab: any) => {
      tab.addEventListener('click', () => {
        currentFilter = tab.getAttribute('data-filter')
        // Update tab styles
        overlay.querySelectorAll('.agent-filter-tab').forEach((t: any) => {
          if (t === tab) {
            t.style.background = 'rgba(255,255,255,0.3)'
            t.style.color = 'white'
            t.style.fontWeight = 'bold'
          } else {
            t.style.background = 'rgba(255,255,255,0.1)'
            t.style.color = 'rgba(255,255,255,0.7)'
            t.style.fontWeight = 'normal'
          }
        })
        // Re-render grid with filter
        renderAgentsGrid(overlay, currentFilter)
      })
    })
    
    // Render grid from session (single source of truth)
    renderAgentsGrid(overlay, currentFilter)
    // Delegated handlers for dynamically rendered buttons
    overlay.addEventListener('click', (ev:any) => {
      const t = ev?.target as HTMLElement | null
      if (!t) return
      if (t.classList?.contains('delete-agent')) {
        ev.preventDefault(); ev.stopPropagation()
        const key = t.getAttribute('data-key') || ''
        if (!key) return
        if (!confirm('Delete this agent?')) return
        deleteAgentFromSession(key, () => renderAgentsGrid(overlay, currentFilter))
        return
      }
      if (t.classList?.contains('lightbox-btn')) {
        ev.preventDefault(); ev.stopPropagation()
        const agentKey = t.getAttribute('data-agent') || ''
        const type = t.getAttribute('data-type') || 'instructions'
        openAgentConfigDialog(agentKey, type, overlay)
        return
      }
    }, true)
    
    // Keep all agents visible; grid shows exactly 5 per row using CSS above
    function enforceVisibleAgentLimit() {}

    // Legacy renderer no-op
    const renderCustomAgents = (customs?: any[], numberMapOverride?: any) => { return }

    // Helper to apply numbers to builtin headings from a provided map
    function applyBuiltinNumbers(map:any) {
      try {
        const pairs = [
          ['summarize', 'Summarize'],
          ['research', 'Research'],
          ['analyze', 'Analyze'],
          ['generate', 'Generate'],
          ['coordinate', 'Coordinate']
        ]
        pairs.forEach(([key, label]) => {
          const card = overlay.querySelector(`#agent-card-${key}`) as HTMLElement | null
          if (!card) return
          const h4 = card.querySelector('h4') as HTMLElement | null
          const num = map && map[key] ? String(map[key]).padStart(2, '0') : '01'
          if (h4) h4.textContent = `Agent ${num} — ${label}`
        })
      } catch {}
    }

    // Load custom agents and sync session number map, ensuring session exists
    (function(){
      try {
        ensureActiveSession((activeKey:string, session:any) => {
          // Normalize numbering: seed built-ins 1..5 and assign unique numbers to customs
          let map:any = (session && session.numberMap) ? session.numberMap : {}
          const seedIfMissing = (k:string, n:number) => { if (!map[k]) map[k] = n }
          seedIfMissing('summarize', 1)
          seedIfMissing('research', 2)
          seedIfMissing('analyze', 3)
          seedIfMissing('generate', 4)
          seedIfMissing('coordinate', 5)
          let maxNum = Object.values(map)
            .map((v:any)=>parseInt(String(v),10))
            .filter((v:number)=>!isNaN(v))
            .reduce((m:number,v:number)=> Math.max(m,v), 0)
          const customs = Array.isArray(session?.customAgents) ? session.customAgents : []
          customs.forEach((a:any) => {
            const k = a.key || (a.name||'').toLowerCase().replace(/[^a-z0-9]/g,'')
            if (!map[k]) { maxNum += 1; map[k] = maxNum }
          })
          session.numberMap = map
          session.timestamp = new Date().toISOString()
          chrome.storage.local.set({ [activeKey]: session }, ()=>{})
          try { localStorage.setItem('optimando-agent-number-map', JSON.stringify(map)) } catch {}
          applyBuiltinNumbers(map)

          // Hide builtin cards that were removed previously
          const hidden = Array.isArray(session?.hiddenBuiltins) ? session.hiddenBuiltins : []
          if (hidden.length) {
            hidden.forEach((k:string) => {
              const el = overlay.querySelector(`#agent-card-${k}`) as HTMLElement | null
              if (el) el.remove()
            })
          }
          if (session && Array.isArray(session.customAgents) && session.customAgents.length > 0) {
            // ensure they exist in localStorage for future fast load
            session.customAgents.forEach((a:any) => {
              const k = (a.key || (a.name||'').toLowerCase().replace(/[^a-z0-9]/g,''))
              localStorage.setItem(`custom_agent_${k}`, JSON.stringify(a))
            })
            renderCustomAgents(session.customAgents, map)
          } else {
            renderCustomAgents(undefined, map)
          }
          // Previously limited to 5; now unlimited, grid is responsive
          enforceVisibleAgentLimit()
        })
      } catch { renderCustomAgents() }
    })()
    // Add event handler for "Add New Agent" button
    document.getElementById('add-new-agent')?.addEventListener('click', () => {
      try { openAddNewAgentDialog(overlay) } catch (e) {
        console.error('Failed to open Add New Agent dialog', e)
        alert('Unable to open the Add Agent dialog. Please reload the page and try again.')
      }
    })
  }
  function openAgentConfigDialog(agentName, type, parentOverlay, agentScope = 'session') {
    function pad2(n) { try { const num = parseInt(n, 10) || 0; return num < 10 ? `0${num}` : String(num) } catch { return '01' } }
    function capitalizeName(n) { try { return (n || '').toString().charAt(0).toUpperCase() + (n || '').toString().slice(1) } catch { return n } }
    function getOrAssignAgentNumber(key) {
      try {
        const raw = localStorage.getItem('optimando-agent-number-map')
        const map = raw ? JSON.parse(raw) : {}
        if (map && map[key]) return pad2(map[key])
        const used = Object.values(map || {}).map(v => parseInt(v, 10)).filter(v => !isNaN(v))
        const next = used.length > 0 ? Math.max(...used) + 1 : 1
        map[key] = next
        localStorage.setItem('optimando-agent-number-map', JSON.stringify(map))
        return pad2(next)
      } catch { return '01' }
    }
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
      'context': '🧠 Memory',
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
      // Revised unified Agent Editor
      content = `
        <div style="display:grid;gap:14px;">
          <!-- Name/Identifier -->
          <div style="background:rgba(255,255,255,0.08);padding:12px;border-radius:8px;display:grid;gap:8px;grid-template-columns:1fr 140px;align-items:center;">
            <label>Name (Command Identifier)
              <input id="ag-name" value="${(agentName||'').toString()}" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px">
            </label>
            <label>Icon
              <input id="ag-icon" value="🤖" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px">
            </label>
          </div>

          <!-- Capability toggles -->
          <div style="background:rgba(255,255,255,0.08);padding:10px;border-radius:8px;display:flex;gap:14px;align-items:center;">
            <label style="display:flex;align-items:center;gap:6px"><input id="cap-listening" type="checkbox"> Listener</label>
            <label style="display:flex;align-items:center;gap:6px"><input id="cap-reasoning" type="checkbox"> Reasoning</label>
            <label style="display:flex;align-items:center;gap:6px"><input id="cap-execution" type="checkbox"> Execution</label>
          </div>

          <!-- Dynamic sections container -->
          <div id="agent-sections" style="display:grid;gap:12px"></div>
          </div>
      `
    } else if (type === 'context') {
      content = `
        <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
          <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
            <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">🧠 Memory:</label>
            <textarea id="agent-context" style="width: 100%; height: 180px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px; resize: vertical; font-family: 'Consolas', monospace;" placeholder="Enter persistent memory for this agent...">${existingData}</textarea>
            </div>

          <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display: block; margin-bottom: 10px; font-size: 14px; color: #FFD700; font-weight: bold;">🧠 Memory Allocation:</label>
              <select id="agent-memory" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 12px; border-radius: 6px; font-size: 12px;">
                <option value="low">Low (2MB)</option>
                <option value="medium" selected>Medium (8MB)</option>
                <option value="high">High (32MB)</option>
                <option value="ultra">Ultra (128MB)</option>
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

    const headerTitle = (() => {
      if (type === 'instructions') {
        const num = getOrAssignAgentNumber(agentName)
        return `AI Instructions - Agent ${num} - ${capitalizeName(agentName)}`
      }
      if (type === 'context') {
        const num = getOrAssignAgentNumber(agentName)
        return `Memory Agent ${num} - ${capitalizeName(agentName)}`
      }
      return `${typeLabels[type]} - ${agentName}`
    })()

    configOverlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 85vw; max-width: 1000px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, ${agentColors[agentName] || '#667eea'} 0%, rgba(118, 75, 162, 0.8) 100%);">
          <h2 style="margin: 0; font-size: 20px; text-transform: capitalize;">${headerTitle}</h2>
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
    
    // Dynamic section rendering
    try {
      const container = configOverlay.querySelector('#agent-sections') as HTMLElement | null
      const capL = configOverlay.querySelector('#cap-listening') as HTMLInputElement | null
      const capR = configOverlay.querySelector('#cap-reasoning') as HTMLInputElement | null
      const capE = configOverlay.querySelector('#cap-execution') as HTMLInputElement | null
      if (!container) throw new Error('agent-sections container missing')

      const makeSelect = (options: Array<{label:string,value:string}>, cls: string, defValue?: string) => {
        const sel = document.createElement('select')
        sel.className = cls
        sel.style.cssText = 'width:100%;background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:6px;border-radius:6px'
        options.forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; sel.appendChild(opt) })
        if (defValue) sel.value = defValue
        return sel
      }
      const addRow = (
        containerId: string,
        rowClass: string,
        kindClass: string,
        specificClass: string,
        defaults?: { kind?: string; specific?: string }
      ) => {
        const cont = configOverlay.querySelector(containerId) as HTMLElement | null
        if (!cont) return
        const row = document.createElement('div')
        row.className = `${rowClass}`
        row.style.cssText = 'display:grid;grid-template-columns:160px 1fr auto;gap:8px'
        const kindOptions = [
          { label: 'Agent', value: 'agent' },
          { label: 'Workflow', value: 'workflow' },
          { label: 'Tool', value: 'tool' },
          { label: 'UI', value: 'ui' },
          { label: 'Agent Box', value: 'agentBox' }
        ]
        const agents = [
          { label: `Agent ${getOrAssignAgentNumber('summarize')} — Summarizer`, value: 'summarize' },
          { label: `Agent ${getOrAssignAgentNumber('research')} — Researcher`, value: 'research' },
          { label: `Agent ${getOrAssignAgentNumber('execute')} — Executor`, value: 'execute' }
        ]
        const workflows = [
          { label: 'Email', value: 'email' },
          { label: 'Calendar', value: 'calendar' },
          { label: 'Cleanup', value: 'cleanup' }
        ]
        const tools = [
          { label: 'Browser', value: 'browser' },
          { label: 'Notion', value: 'notion' },
          { label: 'Jira', value: 'jira' }
        ]
        const kindSel = makeSelect(kindOptions, kindClass, defaults?.kind)
        const specSel = makeSelect([], specificClass, defaults?.specific)
        const refreshSpecific = () => {
          const k = kindSel.value
          specSel.innerHTML = ''
          let opts: Array<{label:string,value:string}> = []
          if (k === 'agent') opts = agents
          else if (k === 'workflow') opts = workflows
          else if (k === 'tool') opts = tools
          else if (k === 'ui') opts = [{ label: 'UI Overlay', value: 'overlay' }]
          else if (k === 'agentBox') opts = [{ label: 'Agent Box', value: 'agentBox' }]
          opts.forEach(o => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; specSel.appendChild(opt) })
          if (defaults?.specific) specSel.value = defaults.specific
        }
        kindSel.addEventListener('change', refreshSpecific)
        refreshSpecific()
        const del = document.createElement('button')
        del.textContent = '×'
        del.title = 'Remove'
        del.style.cssText = 'background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:0 10px;border-radius:6px;cursor:pointer'
        del.addEventListener('click', () => row.remove())
        row.appendChild(kindSel)
        row.appendChild(specSel)
        row.appendChild(del)
        cont.appendChild(row)
      }
      // Dedicated workflow-row adder (no kind selector)
      const addWorkflowRow = (containerId: string) => {
        const cont = configOverlay.querySelector(containerId) as HTMLElement | null
        if (!cont) return
        const row = document.createElement('div')
        row.className = 'wf-row'
        row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px'
        const workflows = [
          { label: 'Email', value: 'email' },
          { label: 'Calendar', value: 'calendar' },
          { label: 'Cleanup', value: 'cleanup' }
        ]
        const sel = makeSelect(workflows, 'wf-target')
        const del = document.createElement('button')
        del.textContent = '×'
        del.title = 'Remove'
        del.style.cssText = 'background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:0 10px;border-radius:6px;cursor:pointer'
        del.addEventListener('click', () => row.remove())
        row.appendChild(sel)
        row.appendChild(del)
        cont.appendChild(row)
      }
      const agentTargets = [
        { label: 'This Agent', value: 'this' },
        { label: 'Other Agent', value: 'agent:other' },
        { label: 'Workflow', value: 'workflow' },
        { label: 'Tool', value: 'tool' },
        { label: 'UI', value: 'ui' }
      ]
      const workflows = [
        { label: 'Email', value: 'email' },
        { label: 'Calendar', value: 'calendar' },
        { label: 'Cleanup', value: 'cleanup' }
      ]

      // Persist Reasoning inputs across re-renders
      let persistedGoals = ''
      let persistedRole = ''
      let persistedPassiveToggle = true
      let persistedActiveToggle = false
      let persistedActiveTriggers: Array<{ tag?: string, kind?: string, extra?: string }> = []
      // Persist Memory toggles
      let persistedMemSessionEnabled = true
      let persistedMemSessionRead = true
      let persistedMemSessionWrite = false
      let persistedMemAccountEnabled = true
      let persistedMemAccountRead = false
      let persistedMemAccountWrite = false
      let persistedMemAgentEnabled = true
      const syncPersistedFromDom = () => {
        try {
          const g = configOverlay.querySelector('#R-goals') as HTMLTextAreaElement | null
          const r = configOverlay.querySelector('#R-role') as HTMLInputElement | null
          if (g) persistedGoals = g.value
          if (r) persistedRole = r.value
          // Persist Listener toggles
          const p = configOverlay.querySelector('#L-toggle-passive') as HTMLInputElement | null
          const a = configOverlay.querySelector('#L-toggle-active') as HTMLInputElement | null
          if (p) persistedPassiveToggle = !!p.checked
          if (a) persistedActiveToggle = !!a.checked
          // Persist Memory UI
          const ms = configOverlay.querySelector('#MEM-session') as HTMLInputElement | null
          const msr = configOverlay.querySelector('#MEM-session-read') as HTMLInputElement | null
          const msw = configOverlay.querySelector('#MEM-session-write') as HTMLInputElement | null
          const ma = configOverlay.querySelector('#MEM-account') as HTMLInputElement | null
          const mar = configOverlay.querySelector('#MEM-account-read') as HTMLInputElement | null
          const maw = configOverlay.querySelector('#MEM-account-write') as HTMLInputElement | null
          const mAgent = configOverlay.querySelector('#MEM-agent') as HTMLInputElement | null
          if (ms) persistedMemSessionEnabled = !!ms.checked
          if (msr) persistedMemSessionRead = !!msr.checked
          if (msw) persistedMemSessionWrite = !!msw.checked
          if (ma) persistedMemAccountEnabled = !!ma.checked
          if (mar) persistedMemAccountRead = !!mar.checked
          if (maw) persistedMemAccountWrite = !!maw.checked
          if (mAgent) persistedMemAgentEnabled = !!mAgent.checked
          // Also persist Active Listener triggers (so tags do not get lost)
          const rows = Array.from(configOverlay.querySelectorAll('#L-active-list .act-row')) as HTMLElement[]
          persistedActiveTriggers = rows.map((row:any)=> ({
            tag: (row.querySelector('.act-tag') as HTMLInputElement)?.value || '',
            kind: (row.querySelector('.act-kind') as HTMLSelectElement)?.value || 'OTHER',
            extra: (():string=>{
              const ex = row.querySelector('.act-extra') as HTMLSelectElement | null
              return ex && ex.style.display !== 'none' ? (ex.value || '') : ''
            })()
          }))
        } catch {}
      }

      const render = () => {
        // Before clearing, capture current Reasoning values if present
        syncPersistedFromDom()
        container.innerHTML = ''
        // Context uploader
        const agentCtxWrap = document.createElement('div')
        agentCtxWrap.style.cssText = 'background:rgba(255,255,255,0.06);padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15)'
        agentCtxWrap.innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;justify-content:space-between">
            <div style="font-weight:700">Context</div>
            <div style="display:flex;align-items:center;gap:12px;font-size:12px">
              <label style="display:flex;align-items:center;gap:6px"><input id="AC-session" type="checkbox" checked> Session Context</label>
              <label style="display:flex;align-items:center;gap:6px"><input id="AC-account" type="checkbox" checked> Account Context</label>
              <label style="display:flex;align-items:center;gap:6px"><input id="AC-agent" type="checkbox"> Agent Context</label>
            </div>
          </div>
          <div id="AC-content" style="display:none;margin-top:8px">
            <label style="display:block;margin-bottom:6px">Upload JSON / PDF / DOCX / MD</label>
            <input id="AC-files" type="file" multiple accept="application/json,application/pdf,.doc,.docx,text/markdown,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px">
            <div id="AC-list" style="margin-top:6px;font-size:12px;opacity:.85">No files selected</div>
          </div>`
        container.appendChild(agentCtxWrap)
        const acEnable = agentCtxWrap.querySelector('#AC-agent') as HTMLInputElement
        const acContent = agentCtxWrap.querySelector('#AC-content') as HTMLElement
        const acFiles = agentCtxWrap.querySelector('#AC-files') as HTMLInputElement
        const acList = agentCtxWrap.querySelector('#AC-list') as HTMLElement
        const syncAc = () => { acContent.style.display = acEnable.checked ? 'block' : 'none' }
        acEnable.addEventListener('change', syncAc); syncAc()
        acFiles.addEventListener('change', () => {
          const n = (acFiles.files||[]).length
          acList.textContent = n ? `${n} file(s) selected` : 'No files selected'
        })

        // Memory settings block
        const memoryWrap = document.createElement('div')
        memoryWrap.style.cssText = 'background:rgba(255,255,255,0.06);padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);margin-top:10px'
        memoryWrap.innerHTML = `
          <div style="font-weight:700;margin-bottom:6px">Memory</div>
          <div style="display:flex;flex-direction:column;gap:10px;font-size:12px">
            <div style="display:flex;align-items:center;gap:12px;justify-content:space-between">
              <label style="display:flex;align-items:center;gap:6px"><input id="MEM-session" type="checkbox" ${persistedMemSessionEnabled ? 'checked' : ''}> Session Memory</label>
              <div style="display:flex;align-items:center;gap:10px">
                <label style="display:flex;align-items:center;gap:6px">
                  <input id="MEM-session-read" type="checkbox" ${persistedMemSessionRead ? 'checked' : ''}>
                  <span>Read <span id="MEM-session-read-state" style="padding:2px 6px;border-radius:6px;background:${persistedMemSessionRead ? '#22c55e' : 'rgba(255,255,255,.15)'};border:1px solid rgba(255,255,255,.3)">${persistedMemSessionRead ? 'ON' : 'OFF'}</span></span>
                </label>
                <label style="display:flex;align-items:center;gap:6px">
                  <input id="MEM-session-write" type="checkbox" ${persistedMemSessionWrite ? 'checked' : ''}>
                  <span>Write <span id="MEM-session-write-state" style="padding:2px 6px;border-radius:6px;background:${persistedMemSessionWrite ? '#22c55e' : 'rgba(255,255,255,.15)'};border:1px solid rgba(255,255,255,.3)">${persistedMemSessionWrite ? 'ON' : 'OFF'}</span></span>
                </label>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;justify-content:space-between">
              <label style="display:flex;align-items:center;gap:6px"><input id="MEM-account" type="checkbox" ${persistedMemAccountEnabled ? 'checked' : ''}> Account Memory</label>
              <div style="display:flex;align-items:center;gap:10px">
                <label style="display:flex;align-items:center;gap:6px">
                  <input id="MEM-account-read" type="checkbox" ${persistedMemAccountRead ? 'checked' : ''}>
                  <span>Read <span id="MEM-account-read-state" style="padding:2px 6px;border-radius:6px;background:${persistedMemAccountRead ? '#22c55e' : 'rgba(255,255,255,.15)'};border:1px solid rgba(255,255,255,.3)">${persistedMemAccountRead ? 'ON' : 'OFF'}</span></span>
                </label>
                <label style="display:flex;align-items:center;gap:6px">
                  <input id="MEM-account-write" type="checkbox" ${persistedMemAccountWrite ? 'checked' : ''}>
                  <span>Write <span id="MEM-account-write-state" style="padding:2px 6px;border-radius:6px;background:${persistedMemAccountWrite ? '#22c55e' : 'rgba(255,255,255,.15)'};border:1px solid rgba(255,255,255,.3)">${persistedMemAccountWrite ? 'ON' : 'OFF'}</span></span>
                </label>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;opacity:.6">
              <label style="display:flex;align-items:center;gap:6px"><input id="MEM-agent" type="checkbox" checked disabled> Agent Memory (always on)</label>
            </div>
          </div>
        `
        container.appendChild(memoryWrap)

        // Wire memory interactions
        const memSession = memoryWrap.querySelector('#MEM-session') as HTMLInputElement
        const memSessionRead = memoryWrap.querySelector('#MEM-session-read') as HTMLInputElement
        const memSessionWrite = memoryWrap.querySelector('#MEM-session-write') as HTMLInputElement
        const memAccount = memoryWrap.querySelector('#MEM-account') as HTMLInputElement
        const memAccountRead = memoryWrap.querySelector('#MEM-account-read') as HTMLInputElement
        const memAccountWrite = memoryWrap.querySelector('#MEM-account-write') as HTMLInputElement
        const stateEls: Record<string, HTMLElement | null> = {
          'MEM-session-read': memoryWrap.querySelector('#MEM-session-read-state') as HTMLElement,
          'MEM-session-write': memoryWrap.querySelector('#MEM-session-write-state') as HTMLElement,
          'MEM-account-read': memoryWrap.querySelector('#MEM-account-read-state') as HTMLElement,
          'MEM-account-write': memoryWrap.querySelector('#MEM-account-write-state') as HTMLElement
        }
        const syncToggleText = (id: string, checked: boolean) => {
          const el = stateEls[id]
          if (el) {
            el.textContent = checked ? 'ON' : 'OFF'
            el.style.background = checked ? '#22c55e' : 'rgba(255,255,255,.15)'
          }
        }
        const syncParentEnable = () => {
          const sesEnabled = !!memSession?.checked
          const accEnabled = !!memAccount?.checked
          ;[memSessionRead, memSessionWrite].forEach(el => { if (el) el.disabled = !sesEnabled })
          ;[memAccountRead, memAccountWrite].forEach(el => { if (el) el.disabled = !accEnabled })
          if (memSessionRead) syncToggleText('MEM-session-read', memSessionRead.checked)
          if (memSessionWrite) syncToggleText('MEM-session-write', memSessionWrite.checked)
          if (memAccountRead) syncToggleText('MEM-account-read', memAccountRead.checked)
          if (memAccountWrite) syncToggleText('MEM-account-write', memAccountWrite.checked)
        }
        memSession?.addEventListener('change', syncParentEnable)
        memAccount?.addEventListener('change', syncParentEnable)
        memSessionRead?.addEventListener('change', () => syncToggleText('MEM-session-read', memSessionRead.checked))
        memSessionWrite?.addEventListener('change', () => syncToggleText('MEM-session-write', memSessionWrite.checked))
        memAccountRead?.addEventListener('change', () => syncToggleText('MEM-account-read', memAccountRead.checked))
        memAccountWrite?.addEventListener('change', () => syncToggleText('MEM-account-write', memAccountWrite.checked))
        syncParentEnable()
        if (capL && capL.checked) {
          const wrap = document.createElement('div')
          wrap.id = 'box-listening'
          wrap.style.cssText = 'background:rgba(255,255,255,0.08);padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.25);color:#fff'
          wrap.innerHTML = `
            <div style="font-weight:700;margin-bottom:6px">Listener</div>
            <div style="margin:6px 0 8px 0;display:flex;align-items:center;gap:14px">
              <label style="display:flex;align-items:center;gap:6px"><input id="L-toggle-passive" type="checkbox" checked> Passive Listener</label>
              <label style="display:flex;align-items:center;gap:6px"><input id="L-toggle-active" type="checkbox"> Active Listener</label>
            </div>
            <div id="L-passive" style="border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:10px;background:rgba(255,255,255,0.04);margin-bottom:10px">
            <label style="display:flex;align-items:center;gap:6px">Expected Context
              <span title="Describe examples, keywords, or patterns the Listener Agent should detect. These instructions improve the intent detection of the optimization layer and can enhance or overwrite the trained LLM logic of finetuned models, depending on this agent's settings. It offers a more tailored experience for the users." style="font-size:12px;opacity:0.9;cursor:help;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);padding:0 6px;border-radius:50%">i</span>
            </label>
            <textarea id="L-context" placeholder="e.g. business email, product research, visiting specific site" style="width:100%;min-height:90px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.45);color:#fff;padding:8px;border-radius:6px"></textarea>
            <div style="margin:8px 0;display:flex;flex-wrap:wrap;gap:10px">
              <label><input class="L-tag" type="checkbox" value="patterns" checked> patterns</label>
              <label><input class="L-tag" type="checkbox" value="code"> code</label>
              <label><input class="L-tag" type="checkbox" value="debug-error"> debug error</label>
              <label><input class="L-tag" type="checkbox" value="math"> math</label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <label>Listen on (type)
                <select id="L-source" style="width:100%;background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:8px;border-radius:6px">
                  <option value="website">website</option>
                  <option value="api">api</option>
                  <option value="lmgtfy">LmGTFY</option>
                  <option value="agent">Agent</option>
                  <option value="workflow">Workflow</option>
                  <option value="table">Table</option>
                  <option value="diagram">Diagram</option>
                  <option value="picture">Picture</option>
                  <option value="video">Video</option>
                </select>
              </label>
              <label id="L-website-wrap" style="display:none">Website URL
                <input id="L-website" placeholder="https://example.com" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px">
              </label>
            </div>
            <div style="margin-top:8px">
              <label>Example Context (optional)
                <input id="L-examples" type="file" multiple style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;padding:6px;border-radius:6px">
              </label>
            </div>
            </div>
            <div id="L-active" style="display:none;border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:10px;background:rgba(255,255,255,0.04);margin-bottom:10px">
              <div style="font-weight:700;margin-bottom:6px">Tagged Event Triggers</div>
              <div id="L-active-list" style="display:flex;flex-direction:column;gap:8px"></div>
              <button id="L-add-active-trigger" style="margin-top:6px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Add Trigger</button>
              <div style="margin-top:8px;font-size:12px;opacity:0.9">Add #tags inside media or along uploads to the command chat in order to trigger the automation</div>
            </div>
            <div id="L-reports" style="margin-top:10px">
              <div style="font-weight:600;margin:6px 0">Report to (optional)</div>
              <div id="L-report-list" style="display:flex;flex-direction:column;gap:8px"></div>
              <button id="L-add-report" style="margin-top:6px;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Add</button>
            </div>`
          container.appendChild(wrap)
        }
        if (capR && capR.checked) {
          const wrap = document.createElement('div')
          wrap.id = 'box-reasoning'
          wrap.style.cssText = 'background:rgba(255,255,255,0.06);padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15)'
          wrap.innerHTML = `
            <div style="font-weight:700;margin-bottom:6px">Reasoning</div>
            <div style="display:flex;align-items:center;gap:10px;margin:6px 0">
              <label>Apply for:
                <select id="R-apply" style="margin-left:6px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:6px;border-radius:6px">
                  <option value="__any__">Any Tag</option>
                </select>
              </label>
              <button id="R-add-section" style="display:none;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer">+ Add Reasoning Section</button>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin:6px 0"><span>Listen from</span></div>
              <div id="R-accept-list" style="display:flex;flex-direction:column;gap:8px"></div>
              <button id="R-add-accept" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Add</button>
            </div>
            <label style="margin-top:8px">Goals (System instructions)
              <textarea id="R-goals" style="width:100%;min-height:90px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px"></textarea>
            </label>
            <label>Role (optional)
              <input id="R-role" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px">
            </label>
            <label>Rules
              <textarea id="R-rules" style="width:100%;min-height:70px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px"></textarea>
            </label>
            <div id="R-custom-list" style="display:flex;flex-direction:column;gap:8px;margin-top:8px"></div>
            <button id="R-add-custom" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Custom field</button>
            <div style="margin-top:8px">
              <div style="font-weight:600;margin:6px 0">Report to (optional)</div>
              <div id="R-report-list" style="display:flex;flex-direction:column;gap:8px"></div>
              <button id="R-add-report" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;margin-top:6px">+ Add</button>
            </div>
            <div id="R-sections-extra" style="display:flex;flex-direction:column;gap:10px;margin-top:10px"></div>`
          container.appendChild(wrap)

          // Re-apply persisted values and keep them updated
          try {
            const g = wrap.querySelector('#R-goals') as HTMLTextAreaElement | null
            const r = wrap.querySelector('#R-role') as HTMLInputElement | null
            if (g && persistedGoals) g.value = persistedGoals
            if (r && persistedRole) r.value = persistedRole
            g && g.addEventListener('input', () => { persistedGoals = g.value })
            r && r.addEventListener('input', () => { persistedRole = r.value })
          } catch {}
        }
        if (capE && capE.checked) {
          const wrap = document.createElement('div')
          wrap.id = 'box-execution'
          wrap.style.cssText = 'background:rgba(255,255,255,0.06);padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15)'
          wrap.innerHTML = `
            <div style="font-weight:700;margin-bottom:6px">Execution</div>
            <div style="display:flex;align-items:center;gap:10px;margin:6px 0">
              <label>Apply for:
                <select id="E-apply" style="margin-left:6px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:6px;border-radius:6px">
                  <option value="__any__">Any Tag</option>
                </select>
              </label>
              <button id="E-add-section" style="display:none;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer">+ Add Execution Section</button>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin:6px 0"><span>Listen from</span></div>
              <div id="E-accept-list" style="display:flex;flex-direction:column;gap:8px"></div>
              <button id="E-add-accept" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Add</button>
            </div>
            <div style="margin-top:8px">
              <div id="E-workflow-list" style="display:flex;flex-direction:column;gap:8px"></div>
              <button id="E-add-workflow" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Add Workflow</button>
            </div>
            <div style="margin-top:8px">
              <div style="font-weight:600;margin:6px 0">Report to</div>
              <div id="E-special-list" style="display:flex;flex-direction:column;gap:8px"></div>
              <button id="E-special-add" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;margin-top:6px">+ Add</button>
            </div>
            <div id="E-sections-extra" style="display:flex;flex-direction:column;gap:10px;margin-top:10px"></div>
            <div style="margin-top:8px"></div>`
          container.appendChild(wrap)
        }

        // After mount init
        const srcSel = configOverlay.querySelector('#L-source') as HTMLSelectElement | null
        const websiteWrap = configOverlay.querySelector('#L-website-wrap') as HTMLElement | null
        const updateWebsiteVisibility = () => { if (srcSel && websiteWrap) websiteWrap.style.display = srcSel.value === 'website' ? 'block' : 'none' }
        srcSel && srcSel.addEventListener('change', updateWebsiteVisibility)
        updateWebsiteVisibility()

        const passToggle = configOverlay.querySelector('#L-toggle-passive') as HTMLInputElement | null
        const actToggle = configOverlay.querySelector('#L-toggle-active') as HTMLInputElement | null
        const passWrap = configOverlay.querySelector('#L-passive') as HTMLElement | null
        const actWrap = configOverlay.querySelector('#L-active') as HTMLElement | null
        const syncListenerSubsections = () => {
          if (passWrap && passToggle) passWrap.style.display = passToggle.checked ? 'block' : 'none'
          if (actWrap && actToggle) actWrap.style.display = actToggle.checked ? 'block' : 'none'
        }
        passToggle && passToggle.addEventListener('change', syncListenerSubsections)
        actToggle && actToggle.addEventListener('change', syncListenerSubsections)
        // Restore previous open/closed state
        if (passToggle) passToggle.checked = !!persistedPassiveToggle
        if (actToggle) actToggle.checked = !!persistedActiveToggle
        syncListenerSubsections()

        // Active triggers list (multi-row)
        const activeList = configOverlay.querySelector('#L-active-list') as HTMLElement | null
        const activeAddBtn = configOverlay.querySelector('#L-add-active-trigger') as HTMLButtonElement | null
        const populateExtra = (selectEl: HTMLSelectElement, opts: { value: string, label: string }[]) => {
          selectEl.innerHTML = ''
          opts.forEach(o => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; selectEl.appendChild(op) })
        }
        const loadPinnedInto = (which: 'PIN-SCREENSHOT'|'PIN-STREAM', selectEl: HTMLSelectElement) => {
          try {
            const key = getCurrentSessionKey()
            if (!key || !chrome?.storage?.local) { populateExtra(selectEl, [{ value:'', label:'No pinned items' }]); return }
            chrome.storage.local.get([key], (all:any) => {
              const sess = all[key] || {}
              const arr = which === 'PIN-SCREENSHOT' ? (sess.pinnedScreenshots || []) : (sess.pinnedStreams || [])
              const items = Array.isArray(arr) ? arr : []
              const opts = items.map((it:any, idx:number)=>({ value:String(it.id||it.key||idx), label:String(it.name||it.title||it.url||(`Item ${idx+1}`)) }))
              populateExtra(selectEl, opts.length?opts:[{ value:'', label:'No pinned items' }])
            })
          } catch { populateExtra(selectEl, [{ value:'', label:'No pinned items' }]) }
        }
        const makeTriggerRow = (init?: { tag?: string, kind?: string, extra?: string }) => {
          const row = document.createElement('div')
          row.className = 'act-row'
          row.style.cssText = 'display:grid;grid-template-columns:auto 1fr 1fr auto;gap:8px;align-items:center'
          const hash = document.createElement('div'); hash.textContent = '#'; hash.style.cssText = 'background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);padding:6px 10px;border-radius:6px;font-weight:700'
          const tagInput = document.createElement('input'); tagInput.placeholder = 'tag-name'; tagInput.className = 'act-tag'; tagInput.style.cssText = 'background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px'; if (init?.tag) tagInput.value = init.tag
          const kindSel = document.createElement('select'); kindSel.className = 'act-kind'; kindSel.style.cssText = 'background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:8px;border-radius:6px'
          const kinds = ['URL','API','PIN-SCREENSHOT','PIN-STREAM','VIDEO','PICTURE','VOICEMEMO','MIC','COMMAND','PDF','FILE','DOCS','SIGNAL','OTHER']
          kinds.forEach(k=>{ const op=document.createElement('option'); op.value=k; op.textContent=k; if(!init?.kind && k==='OTHER') op.selected=true; if(init?.kind===k) op.selected=true; kindSel.appendChild(op) })
          const extraSel = document.createElement('select'); extraSel.className = 'act-extra'; extraSel.style.cssText = 'background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:8px;border-radius:6px;display:none'
          const delBtn = document.createElement('button'); delBtn.textContent = '×'; delBtn.title='Remove'; delBtn.style.cssText = 'background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:0 10px;border-radius:6px;cursor:pointer'
          delBtn.addEventListener('click', ()=> row.remove())
          const syncExtra = () => {
            const v = kindSel.value
            if (v==='PIN-SCREENSHOT' || v==='PIN-STREAM') { extraSel.style.display='block'; loadPinnedInto(v as any, extraSel) } else { extraSel.style.display='none'; extraSel.innerHTML='' }
          }
          kindSel.addEventListener('change', syncExtra)
          row.appendChild(hash); row.appendChild(tagInput); row.appendChild(kindSel); row.appendChild(delBtn)
          // Insert extra select before delete when visible
          row.insertBefore(extraSel, delBtn)
          syncExtra()
          if (init?.extra) { try { extraSel.value = init.extra } catch {} }
          return row
        }
        if (activeList && activeAddBtn) {
          activeAddBtn.addEventListener('click', ()=>{ activeList.appendChild(makeTriggerRow()) })
          // Rehydrate previously entered triggers if available
          if (persistedActiveTriggers && persistedActiveTriggers.length > 0) {
            activeList.innerHTML = ''
            persistedActiveTriggers.forEach(t => activeList.appendChild(makeTriggerRow({ tag: t.tag, kind: t.kind, extra: t.extra })))
          } else if (activeList.childElementCount === 0) {
            activeList.appendChild(makeTriggerRow())
          }
        }

        const rAdd = configOverlay.querySelector('#R-add-accept') as HTMLButtonElement | null
        const eAdd = configOverlay.querySelector('#E-add-accept') as HTMLButtonElement | null
        const lRep = configOverlay.querySelector('#L-add-report') as HTMLButtonElement | null
        const eRep = null as unknown as HTMLButtonElement | null
        const eWf = configOverlay.querySelector('#E-add-workflow') as HTMLButtonElement | null
        rAdd && rAdd.addEventListener('click', () => addRow('#R-accept-list', 'acc-row', 'route-kind', 'route-specific'))
        eAdd && eAdd.addEventListener('click', () => addRow('#E-accept-list', 'acc-row', 'route-kind', 'route-specific'))
        lRep && lRep.addEventListener('click', () => addRow('#L-report-list', 'rep-row', 'route-kind', 'route-specific'))
        const rRepBtn = configOverlay.querySelector('#R-add-report') as HTMLButtonElement | null
        rRepBtn && rRepBtn.addEventListener('click', () => addRow('#R-report-list', 'rep-row', 'route-kind', 'route-specific'))
        // Listener add report rows and execution workflows
        eWf && eWf.addEventListener('click', () => addWorkflowRow('#E-workflow-list'))

        // Execution special destinations (addable rows)
        const eSpecialList = configOverlay.querySelector('#E-special-list') as HTMLElement | null
        const eSpecialAdd = configOverlay.querySelector('#E-special-add') as HTMLButtonElement | null
        const buildAgentChecklist = (host: HTMLElement) => {
          const wrap = document.createElement('div')
          wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px'
          try {
            ensureActiveSession((_key: string, session: any) => {
              const agents = Array.isArray(session?.agents) ? session.agents : []
              const builtins = ['summarize','research','execute']
              const merged = [
                ...builtins.map(id => ({ id, name: `Agent ${getOrAssignAgentNumber(id)} — ${id}` })),
                ...agents.map((a:any)=>({ id: a.key || a.id || a.name || 'agent', name: a.name || a.id || a.key }))
              ]
              const seen = new Set<string>()
              merged.forEach(a => {
                if (seen.has(a.id)) return; seen.add(a.id)
                const label = document.createElement('label')
                label.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 6px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:6px'
                const cb = document.createElement('input'); cb.type='checkbox'; cb.value=a.id; cb.className='E-agent'
                const span = document.createElement('span'); span.textContent = a.name
                label.appendChild(cb); label.appendChild(span)
                wrap.appendChild(label)
              })
            })
          } catch {}
          host.appendChild(wrap)
        }
        const addSpecialRow = (def?: { kind?: string }) => {
          if (!eSpecialList) return
          const row = document.createElement('div')
          row.className = 'esp-row'
          row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px'
          const opts = [
            { label: 'Agent Boxes (default)', value: 'agentBox' },
            { label: 'Agent', value: 'agent' },
            { label: 'Clipboard – Summary', value: 'clip-summary' },
            { label: 'Clipboard – Screenshot', value: 'clip-screenshot' },
            { label: 'PDF – Summary', value: 'pdf-summary' },
            { label: 'PDF – Screenshot', value: 'pdf-screenshot' },
            { label: 'PDF – Summary + Screenshot', value: 'pdf-both' },
            { label: 'Image – Screenshot (PNG/WebP)', value: 'image-screenshot' },
            { label: 'Chat Inline – Summary', value: 'chat-inline-summary' }
          ]
          const sel = makeSelect(opts, 'esp-kind', def?.kind || 'agentBox')
          const del = document.createElement('button')
          del.textContent = '×'
          del.title = 'Remove'
          del.style.cssText = 'background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:0 10px;border-radius:6px;cursor:pointer'
          del.addEventListener('click', () => row.remove())
          row.appendChild(sel)
          row.appendChild(del)
          // Agent checklist container if needed
          const agentHost = document.createElement('div')
          agentHost.className = 'esp-agents'
          agentHost.style.cssText = 'display:none'
          row.appendChild(agentHost)
          const sync = () => {
            const v = sel.value
            agentHost.style.display = v === 'agent' ? 'block' : 'none'
            if (v === 'agent' && agentHost.childElementCount === 0) buildAgentChecklist(agentHost)
          }
          sel.addEventListener('change', sync)
          sync()
          eSpecialList.appendChild(row)
        }
        eSpecialAdd && eSpecialAdd.addEventListener('click', () => addSpecialRow())
        if (eSpecialList && eSpecialList.childElementCount === 0) addSpecialRow()

        // Default last report target to Agent Box
        // Removed default E-report; reports are configured once at Listener bottom

        // Custom field add button
        const rCustomBtn = configOverlay.querySelector('#R-add-custom') as HTMLButtonElement | null
        const rCustomList = configOverlay.querySelector('#R-custom-list') as HTMLElement | null
        rCustomBtn && rCustomList && rCustomBtn.addEventListener('click', () => {
          const row = document.createElement('div')
          row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px'
          const key = document.createElement('input')
          key.placeholder = 'Custom field (name)'
          key.style.cssText = 'background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px'
          const val = document.createElement('input')
          val.placeholder = 'value'
          val.style.cssText = 'background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px'
          const del = document.createElement('button')
          del.textContent = '×'
          del.title = 'Remove'
          del.style.cssText = 'background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:0 10px;border-radius:6px;cursor:pointer'
          del.addEventListener('click', () => row.remove())
          row.appendChild(key); row.appendChild(val); row.appendChild(del)
          rCustomList.appendChild(row)
        })

        // Apply-for population based on active tags
        const getActiveTags = (): string[] => Array.from(configOverlay.querySelectorAll('#L-active-list .act-row .act-tag')).map((el:any)=> (el.value||'').trim()).filter((v:string, i:number, a:string[])=> v && a.indexOf(v)===i)
        const refreshApplyForOptions = () => {
          const tags = getActiveTags()
          const updateSelect = (sel: HTMLSelectElement | null) => {
            if (!sel) return
            const prev = sel.value
            sel.innerHTML = ''
            const any = document.createElement('option'); any.value='__any__'; any.textContent='Any Tag'; sel.appendChild(any)
            tags.forEach(t=>{ const op=document.createElement('option'); op.value=t; op.textContent=t; sel.appendChild(op) })
            if (Array.from(sel.options).some(o=>o.value===prev)) sel.value = prev
          }
          updateSelect(configOverlay.querySelector('#R-apply') as HTMLSelectElement | null)
          updateSelect(configOverlay.querySelector('#E-apply') as HTMLSelectElement | null)
          configOverlay.querySelectorAll('.R-section .R-apply').forEach((el:any)=> updateSelect(el as HTMLSelectElement))
          configOverlay.querySelectorAll('.E-section .E-apply-sub').forEach((el:any)=> updateSelect(el as HTMLSelectElement))
          const addBtn = configOverlay.querySelector('#R-add-section') as HTMLButtonElement | null
          if (addBtn) addBtn.style.display = tags.length >= 1 ? 'inline-block' : 'none'
          const eAddSec = configOverlay.querySelector('#E-add-section') as HTMLButtonElement | null
          if (eAddSec) eAddSec.style.display = tags.length >= 1 ? 'inline-block' : 'none'
        }
        refreshApplyForOptions()
        activeList?.addEventListener('input', (e)=>{
          const tgt = e.target as HTMLElement
          if (tgt && tgt.classList.contains('act-tag')) refreshApplyForOptions()
        })
        // Add extra Reasoning sections
        const rExtra = configOverlay.querySelector('#R-sections-extra') as HTMLElement | null
        const rAddSection = configOverlay.querySelector('#R-add-section') as HTMLButtonElement | null
        const createRSection = () => {
          const sec = document.createElement('div')
          sec.className = 'R-section'
          sec.style.cssText = 'border:1px dashed rgba(255,255,255,.35);padding:10px;border-radius:8px'
          const accId = `R-acc-sub-${Math.random().toString(36).slice(2,8)}`
          const repId = `R-rep-sub-${Math.random().toString(36).slice(2,8)}`
          sec.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin:6px 0">
              <label>Apply for:
                <select class="R-apply" style="margin-left:6px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:6px;border-radius:6px">
                  <option value="__any__">Any Tag</option>
                </select>
              </label>
              <button class="R-del" title="Remove" style="background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:2px 8px;border-radius:6px;cursor:pointer">×</button>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin:6px 0"><span>Listen from</span></div>
              <div id="${accId}" class="R-accept-list-sub" style="display:flex;flex-direction:column;gap:8px"></div>
              <button class="R-add-accept-sub" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Add</button>
            </div>
            <label style="margin-top:6px">Goals (System instructions)
              <textarea class="R-goals" style="width:100%;min-height:70px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px"></textarea>
            </label>
            <label>Role (optional)
              <input class="R-role" style="width:100%;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px">
            </label>
            <label>Rules
              <textarea class="R-rules" style="width:100%;min-height:60px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px"></textarea>
            </label>
            <div class="R-custom-list" style="display:flex;flex-direction:column;gap:8px;margin-top:6px"></div>
            <button class="R-add-custom" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Custom field</button>
            <div style="margin-top:8px">
              <div style="font-weight:600;margin:6px 0">Report to (optional)</div>
              <div id="${repId}" class="R-report-list-sub" style="display:flex;flex-direction:column;gap:8px"></div>
              <button class="R-add-report-sub" style="background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;margin-top:6px">+ Add</button>
            </div>
          `
          ;(sec.querySelector('.R-del') as HTMLButtonElement).addEventListener('click', ()=> sec.remove())
          ;(sec.querySelector('.R-add-custom') as HTMLButtonElement).addEventListener('click', ()=>{
            const list = sec.querySelector('.R-custom-list') as HTMLElement
            const row = document.createElement('div')
            row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px'
            const key = document.createElement('input'); key.placeholder='Custom field (name)'; key.style.cssText='background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px'
            const val = document.createElement('input'); val.placeholder='value'; val.style.cssText='background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);color:#fff;padding:8px;border-radius:6px'
            const del = document.createElement('button'); del.textContent='×'; del.title='Remove'; del.style.cssText='background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:0 10px;border-radius:6px;cursor:pointer'; del.addEventListener('click', ()=> row.remove())
            row.appendChild(key); row.appendChild(val); row.appendChild(del)
            list.appendChild(row)
          })
          // Ensure each new Execution section starts with one workflow row by default
          setTimeout(()=>{
            try {
              const addW = sec.querySelector('.E-add-workflow-sub') as HTMLButtonElement
              addW?.click()
            } catch {}
          }, 0)
          ;(sec.querySelector('.R-add-accept-sub') as HTMLButtonElement).addEventListener('click', ()=> addRow(`#${accId}`, 'acc-row', 'route-kind', 'route-specific'))
          ;(sec.querySelector('.R-add-report-sub') as HTMLButtonElement).addEventListener('click', ()=> addRow(`#${repId}`, 'rep-row', 'route-kind', 'route-specific'))
          return sec
        }
        rAddSection && rExtra && rAddSection.addEventListener('click', ()=>{
          const sec = createRSection()
          rExtra.appendChild(sec)
          refreshApplyForOptions()
        })

        // Add extra Execution sections (same structure as base Execution block)
        const eExtra = configOverlay.querySelector('#E-sections-extra') as HTMLElement | null
        const eAddSection = configOverlay.querySelector('#E-add-section') as HTMLButtonElement | null
        const createESection = () => {
          const sec = document.createElement('div')
          sec.className = 'E-section'
          sec.style.cssText = 'border:1px dashed rgba(255,255,255,.35);padding:10px;border-radius:8px'
          const wfId = `E-wf-sub-${Math.random().toString(36).slice(2,8)}`
          const accId = `E-acc-sub-${Math.random().toString(36).slice(2,8)}`
          sec.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin:6px 0">
              <label>Apply for:
                <select class="E-apply-sub" style="margin-left:6px;background:#fff;color:#0f172a;border:1px solid #cbd5e1;padding:6px;border-radius:6px">
                  <option value="__any__">Any Tag</option>
                </select>
              </label>
              <button class="E-del" title="Remove" style="background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:2px 8px;border-radius:6px;cursor:pointer">×</button>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;margin:6px 0"><span>Listen from</span></div>
              <div id="${accId}" class="E-accept-list-sub" style="display:flex;flex-direction:column;gap:8px"></div>
              <button class="E-add-accept-sub" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Add</button>
            </div>
            <div style="margin-top:8px">
              <div id="${wfId}" class="E-workflow-list-sub" style="display:flex;flex-direction:column;gap:8px"></div>
              <button class="E-add-workflow-sub" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer">+ Add Workflow</button>
            </div>
            <div style="margin-top:8px">
              <div style="font-weight:600;margin:6px 0">Report to</div>
              <div class="E-special-list-sub" style="display:flex;flex-direction:column;gap:8px"></div>
              <button class="E-special-add-sub" style="background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;margin-top:6px">+ Add</button>
            </div>
          `
          ;(sec.querySelector('.E-del') as HTMLButtonElement).addEventListener('click', ()=> sec.remove())
          // wire add for special destinations within section
          const list = sec.querySelector('.E-special-list-sub') as HTMLElement
          const addBtn = sec.querySelector('.E-special-add-sub') as HTMLButtonElement
          addBtn.addEventListener('click', ()=>{
            // reuse addSpecialRow logic by temporarily pointing eSpecialList
            const opts = [
              { label: 'Agent Boxes (default)', value: 'agentBox' },
              { label: 'Agent', value: 'agent' },
              { label: 'Clipboard – Summary', value: 'clip-summary' },
              { label: 'Clipboard – Screenshot', value: 'clip-screenshot' },
              { label: 'PDF – Summary', value: 'pdf-summary' },
              { label: 'PDF – Screenshot', value: 'pdf-screenshot' },
              { label: 'PDF – Summary + Screenshot', value: 'pdf-both' },
              { label: 'Image – Screenshot (PNG/WebP)', value: 'image-screenshot' },
              { label: 'Chat Inline – Summary', value: 'chat-inline-summary' }
            ]
            const row = document.createElement('div')
            row.className = 'esp-row'
            row.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px'
            const sel = makeSelect(opts, 'esp-kind', 'agentBox')
            const del = document.createElement('button'); del.textContent='×'; del.title='Remove'; del.style.cssText='background:#f44336;color:#fff;border:1px solid rgba(255,255,255,.25);padding:0 10px;border-radius:6px;cursor:pointer'; del.addEventListener('click', ()=> row.remove())
            row.appendChild(sel); row.appendChild(del)
            const agentHost = document.createElement('div'); agentHost.className='esp-agents'; agentHost.style.cssText='display:none'; row.appendChild(agentHost)
            const sync = () => { const v = sel.value; agentHost.style.display = v==='agent' ? 'block' : 'none'; if (v==='agent' && agentHost.childElementCount===0) buildAgentChecklist(agentHost) }
            sel.addEventListener('change', sync); sync()
            list.appendChild(row)
          })
          ;(sec.querySelector('.E-add-workflow-sub') as HTMLButtonElement).addEventListener('click', ()=> addWorkflowRow(`#${wfId}`))
          ;(sec.querySelector('.E-add-accept-sub') as HTMLButtonElement).addEventListener('click', ()=> addRow(`#${accId}`, 'acc-row', 'route-kind', 'route-specific'))
          // Default one workflow row
          setTimeout(()=>{ try { (sec.querySelector('.E-add-workflow-sub') as HTMLButtonElement)?.click() } catch {} }, 0)
          return sec
        }
        eAddSection && eExtra && eAddSection.addEventListener('click', ()=>{
          const sec = createESection()
          eExtra.appendChild(sec)
          refreshApplyForOptions()
        })
      }
      const hook = (el: HTMLInputElement | null) => el && el.addEventListener('change', render)
      hook(capL); hook(capR); hook(capE)
      render()
    } catch {}
    
    // Close handlers
    document.getElementById('close-agent-config').onclick = () => configOverlay.remove()
    document.getElementById('agent-config-cancel').onclick = () => configOverlay.remove()
    // Save handler
    document.getElementById('agent-config-save').onclick = () => {
      let dataToSave = ''
      if (type === 'instructions') {
        // Collect draft
        const draft:any = {
          id: agentName,
          name: (document.getElementById('ag-name') as HTMLInputElement)?.value || agentName,
          icon: (document.getElementById('ag-icon') as HTMLInputElement)?.value || '🤖',
          capabilities: [],
        }
        const L = (document.getElementById('cap-listening') as HTMLInputElement).checked
        const R = (document.getElementById('cap-reasoning') as HTMLInputElement).checked
        const E = (document.getElementById('cap-execution') as HTMLInputElement).checked
        if (L) draft.capabilities.push('listening')
        if (R) draft.capabilities.push('reasoning')
        if (E) draft.capabilities.push('execution')
        // Listening
        if (L) {
          const passiveEnabled = !!(document.getElementById('L-toggle-passive') as HTMLInputElement)?.checked
          const activeEnabled = !!(document.getElementById('L-toggle-active') as HTMLInputElement)?.checked
          const tags = Array.from(document.querySelectorAll('.L-tag'))
            .filter((el:any)=>el.checked).map((el:any)=>el.value)
          const src = (document.getElementById('L-source') as HTMLSelectElement)?.value || ''
          const listening:any = {
            passiveEnabled,
            activeEnabled
          }
          if (passiveEnabled) {
            listening.expectedContext = (document.getElementById('L-context') as HTMLTextAreaElement)?.value || ''
            listening.tags = tags
            listening.source = src
            listening.website = src==='website' ? ((document.getElementById('L-website') as HTMLInputElement)?.value || '') : ''
          }
          if (activeEnabled) {
            const triggers:any[] = []
            document.querySelectorAll('#L-active-list .act-row').forEach((row:any)=>{
              const name = (row.querySelector('.act-tag') as HTMLInputElement)?.value || ''
              const kind = (row.querySelector('.act-kind') as HTMLSelectElement)?.value || 'OTHER'
              const extraSel = row.querySelector('.act-extra') as HTMLSelectElement | null
              const extra = extraSel && extraSel.style.display !== 'none' ? (extraSel.value || '') : ''
              if (name || kind || extra) {
                triggers.push({ tag: { name, kind, extra } })
              }
            })
            listening.active = { triggers }
          }
          draft.listening = listening
        }
        // Reasoning
        if (R) {
          const accepts:string[] = []
          document.querySelectorAll('#R-accept-list .acc-row .acc-target').forEach((n:any)=> accepts.push(n.value))
          const base:any = {
            applyFor: (document.getElementById('R-apply') as HTMLSelectElement)?.value || '__any__',
            goals: (document.getElementById('R-goals') as HTMLTextAreaElement)?.value || '',
            role: (document.getElementById('R-role') as HTMLInputElement)?.value || '',
            rules: (document.getElementById('R-rules') as HTMLTextAreaElement)?.value || '',
            custom: [],
            acceptFrom: accepts
          }
          document.querySelectorAll('#R-custom-list > div').forEach((row:any)=>{
            const key = (row.querySelector('input:nth-child(1)') as HTMLInputElement)?.value || ''
            const value = (row.querySelector('input:nth-child(2)') as HTMLInputElement)?.value || ''
            if (key || value) base.custom.push({ key, value })
          })
          const sections:any[] = [base]
          document.querySelectorAll('#R-sections-extra .R-section').forEach((sec:any)=>{
            const s:any = {
              applyFor: (sec.querySelector('.R-apply') as HTMLSelectElement)?.value || '__any__',
              goals: (sec.querySelector('.R-goals') as HTMLTextAreaElement)?.value || '',
              role: (sec.querySelector('.R-role') as HTMLInputElement)?.value || '',
              rules: (sec.querySelector('.R-rules') as HTMLTextAreaElement)?.value || '',
              custom: []
            }
            sec.querySelectorAll('.R-custom-list > div').forEach((row:any)=>{
              const key = (row.querySelector('input:nth-child(1)') as HTMLInputElement)?.value || ''
              const value = (row.querySelector('input:nth-child(2)') as HTMLInputElement)?.value || ''
              if (key || value) s.custom.push({ key, value })
            })
            sections.push(s)
          })
          draft.reasoning = { acceptFrom: accepts, goals: base.goals, role: base.role, rules: base.rules, custom: {}, applyFor: base.applyFor }
          ;(draft as any).reasoningSections = sections
        }
        // Execution
        if (E) {
          const eAccepts:string[] = []
          document.querySelectorAll('#E-accept-list .acc-row .acc-target').forEach((n:any)=> eAccepts.push(n.value))
          const eWfs:string[] = []
          document.querySelectorAll('#E-workflow-list .wf-row .wf-target').forEach((n:any)=> eWfs.push(n.value))
          const eKindsMain = Array.from(document.querySelectorAll('#E-special-list .esp-row .esp-kind')) as HTMLSelectElement[]
          const eDestinationsMain = eKindsMain.map(sel => {
            const agents = Array.from(sel.parentElement?.querySelectorAll('.esp-agents .E-agent') || []).filter((cb:any)=> cb.checked).map((cb:any)=> cb.value)
            return { kind: sel.value, agents: sel.value==='agent' ? agents : [] }
          })
          const eSections:any[] = []
          document.querySelectorAll('#E-sections-extra .E-section').forEach((sec:any)=>{
            const applyFor = (sec.querySelector('.E-apply-sub') as HTMLSelectElement)?.value || '__any__'
            const kinds = Array.from(sec.querySelectorAll('.E-special-list-sub .esp-row .esp-kind')) as HTMLSelectElement[]
            const dests = kinds.map(sel => {
              const agents = Array.from(sel.parentElement?.querySelectorAll('.esp-agents .E-agent') || []).filter((cb:any)=> cb.checked).map((cb:any)=> cb.value)
              return { kind: sel.value, agents: sel.value==='agent' ? agents : [] }
            })
            eSections.push({ applyFor, specialDestinations: dests })
          })
          draft.execution = {
            acceptFrom: eAccepts,
            workflows: eWfs,
            reportTo: Array.from(document.querySelectorAll('#L-report-list .rep-row .rep-target')).map((n:any)=> n.value),
            applyFor: (document.getElementById('E-apply') as HTMLSelectElement)?.value || '__any__',
            specialDestinations: eDestinationsMain,
            executionSections: eSections
          }
        }
        dataToSave = JSON.stringify(draft)
        localStorage.setItem('agent_model_v2_'+agentName, dataToSave)
      } else if (type === 'context') {
        dataToSave = document.getElementById('agent-context').value
        localStorage.setItem(storageKey + '_memory', document.getElementById('agent-memory').value)
        localStorage.setItem(storageKey + '_source', document.getElementById('agent-context-source').value)
        localStorage.setItem(storageKey + '_persist', document.getElementById('agent-persist-memory').checked)
      } else if (type === 'settings') {
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

    // Delegated listeners for broader compatibility
    configOverlay.addEventListener('input', (ev) => {
      const el = ev.target as HTMLElement | null
      if (!el) return
      const id = (el as HTMLInputElement).id || ''
      if (id === 'cap-listening' || id === 'cap-reasoning' || id === 'cap-execution') {
        updateBoxes()
      } else if (id === 'L-source') {
        updateWebsiteVisibility()
      }
    })
    configOverlay.addEventListener('click', (ev) => {
      const el = ev.target as HTMLElement | null
      if (!el) return
      // If clicking the label, defer until checkbox toggled
      const input = (el.closest('label') || el).querySelector?.('input#cap-listening, input#cap-reasoning, input#cap-execution') as HTMLInputElement | null
      if (input) {
        setTimeout(() => updateBoxes(), 0)
      }
      if ((el as HTMLElement).id === 'L-source') {
        setTimeout(() => updateWebsiteVisibility(), 0)
      }
    })

    // Ensure first paint reflects state
    requestAnimationFrame(() => updateBoxes())
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
      
      // Persist via manager then re-render from session
      addAgentToSession(agentName, agentIcon, () => {
        renderAgentsGrid(parentOverlay)
        configOverlay.remove()
      })
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

    // Immediately re-theme docked Command Chat if present
    try { setDockedChatTheme(theme) } catch {}
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
          <h2 style="margin: 0; font-size: 20px;">📄 Global Context Management</h2>
          <button id="close-context-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
          <!-- Tab Navigation -->
          <div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.3);">
            <button id="user-context-tab" style="
              padding: 10px 20px; background: rgba(255,255,255,0.2); border: none; 
              color: white; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;
              transition: all 0.3s ease;
            ">👤 User Context (Session)</button>
            <button id="publisher-context-tab" style="
              padding: 10px 20px; background: rgba(255,255,255,0.1); border: none; 
              color: white; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;
              transition: all 0.3s ease;
            ">🌐 Publisher Context (Session)</button>
            <button id="account-context-tab" style="
              padding: 10px 20px; background: rgba(255,255,255,0.1); border: none; 
              color: white; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 14px;
              transition: all 0.3s ease;
            ">🏢 Account Context</button>
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
          
          <!-- Account Context Tab Button -->
          <div style="margin-top:10px"></div>
          <div id="account-context-content" style="display: none;">
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 10px; font-size:12px;opacity:.9">
              Account context is persistent across all sessions (e.g. a company's knowledgebase), while session context only applies within a single active session.
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #66FF66;">Auto-scrape Website Context</h3>
              <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                <button id="account-scrape-context" style="background: #34D399; color: white; border: none; padding: 10px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; display:flex;align-items:center;gap:6px">🔎 Scrape Current Page</button>
              </div>
              <textarea id="account-context-input" placeholder="Enter your context information here or use the scrape button above..." style="width: 100%; height: 160px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 10px;"></textarea>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #66FF66;">Upload PDF Files</h3>
              <input id="account-context-pdf" type="file" accept="application/pdf" multiple style="background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 8px; width: 100%;" />
              <div id="account-pdf-list" style="margin-top: 10px; font-size: 12px; opacity: 0.8;">No PDF files uploaded</div>
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
    const accountTab = document.getElementById('account-context-tab')
    const userContent = document.getElementById('user-context-content')
    const publisherContent = document.getElementById('publisher-context-content')
    const accountContent = document.getElementById('account-context-content')
    
    userTab?.addEventListener('click', () => {
      userTab.style.background = 'rgba(255,255,255,0.2)'
      publisherTab.style.background = 'rgba(255,255,255,0.1)'
      if (accountTab) accountTab.style.background = 'rgba(255,255,255,0.1)'
      userContent.style.display = 'block'
      publisherContent.style.display = 'none'
      if (accountContent) accountContent.style.display = 'none'
    })
    
    publisherTab?.addEventListener('click', () => {
      publisherTab.style.background = 'rgba(255,255,255,0.2)'
      userTab.style.background = 'rgba(255,255,255,0.1)'
      if (accountTab) accountTab.style.background = 'rgba(255,255,255,0.1)'
      publisherContent.style.display = 'block'
      userContent.style.display = 'none'
      if (accountContent) accountContent.style.display = 'none'
    })
    
    accountTab?.addEventListener('click', () => {
      accountTab.style.background = 'rgba(255,255,255,0.2)'
      userTab.style.background = 'rgba(255,255,255,0.1)'
      publisherTab.style.background = 'rgba(255,255,255,0.1)'
      if (accountContent) accountContent.style.display = 'block'
      userContent.style.display = 'none'
      publisherContent.style.display = 'none'
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

  // ---- Sessions data model and local store ----
  type SessionType = 'DeepFix' | 'OptiScan'
  // Updated FixLedger lifecycle
  type SessionState = 'Detected' | 'Co-Auth Draft' | 'Needs-Review' | 'Verified' | 'Playbook Extracted' | 'Embedded' | 'Deprecated/Rejected'
  interface EvidenceItem {
    id: string
    kind: 'voice' | 'text' | 'image' | 'video' | 'file'
    mimeType?: string
    name?: string
    text?: string
    dataUrl?: string
    createdAt: string
    meta?: Record<string, any>
  }
  interface ReviewLogEntry {
    id: string
    at: string
    action: 'created' | 'updated' | 'state-change' | 'note' | 'embedded' | 'rejected'
    by?: string
    message?: string
    from?: SessionState
    to?: SessionState
    role?: 'human' | 'ai'
  }
  interface EmbeddingJob {
    id: string
    createdAt: string
    target: 'Local VDB' | 'Project KB'
    status: 'queued' | 'running' | 'done' | 'failed'
    size?: number
  }
  interface SessionItem {
    id: string
    title: string
    type: SessionType
    durationSec: number
    aiRootCause?: string
    aiSteps?: string
    confidencePct?: number
    tags?: string[]
    evidenceCount: number
    status: SessionState
    createdAt: string
    updatedAt: string
    evidence: EvidenceItem[]
    jobs: EmbeddingJob[]
    review: ReviewLogEntry[]
    impact?: string
    // FixLedger extensions
    humanAiMix?: number // 0..100
    downtimeSavedMins?: number
    evidenceHashes?: string[]
    playbookId?: string
    wrStamp?: string
  }
  const SessionsStore = (() => {
    const KEY = 'optimando-sessions-v1'
    const loadAll = (): SessionItem[] => {
      try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
    }
    const saveAll = (items: SessionItem[]) => { try { localStorage.setItem(KEY, JSON.stringify(items)) } catch {} }
    const upsert = (item: SessionItem) => {
      const all = loadAll()
      const idx = all.findIndex(s => s.id === item.id)
      if (idx >= 0) all[idx] = item; else all.push(item)
      saveAll(all)
      return item
    }
    const get = (id: string) => loadAll().find(s => s.id === id) || null
    const addEvidence = (id: string, ev: EvidenceItem) => {
      const it = get(id); if (!it) return null
      it.evidence.push(ev); it.evidenceCount = it.evidence.length; it.updatedAt = new Date().toISOString()
      it.review.push({ id: 'log_'+Math.random().toString(36).slice(2), at: new Date().toISOString(), action: 'updated', message: 'Added evidence: '+(ev.name || ev.kind), role: 'human' })
      return upsert(it)
    }
    const transition = (id: string, to: SessionState) => {
      const it = get(id); if (!it) return null
      const from = it.status
      const allowed: Record<SessionState, SessionState[]> = {
        'Detected': ['Co-Auth Draft','Deprecated/Rejected'],
        'Co-Auth Draft': ['Needs-Review','Deprecated/Rejected'],
        'Needs-Review': ['Verified','Deprecated/Rejected'],
        'Verified': ['Playbook Extracted','Embedded','Deprecated/Rejected'],
        'Playbook Extracted': ['Embedded','Deprecated/Rejected'],
        'Embedded': [],
        'Deprecated/Rejected': []
      }
      if (!allowed[from].includes(to)) return it
      it.status = to; it.updatedAt = new Date().toISOString()
      it.review.push({ id: 'log_'+Math.random().toString(36).slice(2), at: new Date().toISOString(), action: 'state-change', from, to })
      return upsert(it)
    }
    const seedIfEmpty = () => {
      const all = loadAll(); if (all.length) return
      saveAll([])
    }
    seedIfEmpty()
    return { loadAll, saveAll, upsert, get, addEvidence, transition }
  })()

  function openMemoryLightbox() {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483650; display:flex;align-items:center;justify-content:center;
      backdrop-filter: blur(6px);
    `
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 85vw; max-width: 900px; height: 80vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">💽 Global Memory Management</h2>
          <button id="close-memory-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="flex:1; padding: 20px; overflow-y:auto;">
          <div style="display:flex; gap:10px; margin-bottom: 16px; border-bottom:1px solid rgba(255,255,255,0.3)">
            <button id="mem-session-tab" style="padding:10px 16px; background: rgba(255,255,255,0.2); border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer">🗂️ Session Memory</button>
            <button id="mem-account-tab" style="padding:10px 16px; background: rgba(255,255,255,0.1); border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer">🏢 Account Memory</button>
            <button id="mem-sessions-tab" style="margin-left:auto;padding:10px 16px; background: rgba(255,255,255,0.1); border:0; color:#fff; border-radius:8px 8px 0 0; cursor:pointer">🧾 KnowledgeVault</button>
          </div>
          <div id="mem-session" style="display:block">
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <label style="display:block;margin-bottom:10px;font-size:14px;color:#FFD700;font-weight:bold;">🧠 Memory:</label>
              <textarea id="mem-session-text" style="width:100%;height:180px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);color:white;padding:12px;border-radius:6px;font-size:12px;resize:vertical;"></textarea>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display:block;margin-bottom:10px;font-size:14px;color:#FFD700;font-weight:bold;">📦 Memory Allocation:</label>
              <div style="display:flex;align-items:center;gap:8px">
                <input id="mem-session-alloc-mb" type="number" min="1" step="1" value="200" style="flex:0 0 120px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);color:white;padding:12px;border-radius:6px;font-size:12px;"> <span>MB</span>
              </div>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-top: 12px;">
              <label style="display: block; margin-bottom: 15px; font-size: 14px; color: #FFD700; font-weight: bold;">💾 Memory Settings:</label>
              <label style="display: flex; align-items: center; font-size: 12px; cursor: pointer;">
                <input type="checkbox" id="mem-session-persist" style="margin-right: 10px; transform: scale(1.2);" checked>
                <span>Persist memory across sessions</span>
              </label>
            </div>
          </div>
          <div id="mem-account" style="display:none">
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <label style="display:block;margin-bottom:10px;font-size:14px;color:#FFD700;font-weight:bold;">🧠 Memory:</label>
              <textarea id="mem-account-text" style="width:100%;height:180px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);color:white;padding:12px;border-radius:6px;font-size:12px;resize:vertical;"></textarea>
            </div>
            <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
              <label style="display:block;margin-bottom:10px;font-size:14px;color:#FFD700;font-weight:bold;">📦 Memory Allocation:</label>
              <div style="display:flex;align-items:center;gap:8px">
                <input id="mem-account-alloc-mb" type="number" min="1" step="1" value="200" style="flex:0 0 120px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);color:white;padding:12px;border-radius:6px;font-size:12px;"> <span>MB</span>
              </div>
            </div>
          </div>
          <div id="mem-sessions" style="display:none">
            <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
              <button class="sess-filter" data-k="Runs" style="padding:6px 10px;background:#334155;border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;cursor:pointer">Runs</button>
              <button class="sess-filter" data-k="Queue" style="padding:6px 10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;cursor:pointer">Queue (to-embed)</button>
              <button class="sess-filter" data-k="Verified" style="padding:6px 10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:6px;cursor:pointer">Verified</button>
            </div>
            <div style="margin:-2px 0 8px 0; font-size:12px; opacity:0.9; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.15); padding:10px; border-radius:8px;">
              KnowledgeVault – Captures human input and AI findings from DeepFix and OptiScan, with AI speeding up documentation. Solutions are bundled, embedded into the local AI, and easy to reuse later.
            </div>
            <div id="sess-empty" style="display:none;padding:18px;background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.25);border-radius:8px;font-size:12px;">
              No runs yet. DeepFix/OptiScan runs are detected automatically or can be started manually.
            </div>
            <div id="sess-table-wrap" style="overflow:auto;">
              <table id="sess-table" style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr>
                    <th style="text-align:left;padding:6px;border-bottom:1px solid rgba(255,255,255,.2)">Title</th>
                    <th style="text-align:left;padding:6px;border-bottom:1px solid rgba(255,255,255,.2)">Type</th>
                    <th style="text-align:left;padding:6px;border-bottom:1px solid rgba(255,255,255,.2)">Evidence</th>
                    <th style="text-align:left;padding:6px;border-bottom:1px solid rgba(255,255,255,.2)">Root Cause</th>
                    <th style="text-align:left;padding:6px;border-bottom:1px solid rgba(255,255,255,.2)">Fix</th>
                    <th style="text-align:left;padding:6px;border-bottom:1px solid rgba(255,255,255,.2)">Status</th>
                    <th style="text-align:left;padding:6px;border-bottom:1px solid rgba(255,255,255,.2)">Actions</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
        </div>
        <div style="padding: 16px; border-top:1px solid rgba(255,255,255,0.3); display:flex; justify-content:flex-end; gap:12px; background: rgba(255,255,255,0.05)">
          <button id="memory-cancel" style="padding:10px 20px;background:rgba(255,255,255,0.2);border:0;color:white;border-radius:6px;cursor:pointer;font-size:12px">Cancel</button>
          <button id="memory-save" style="padding:10px 20px;background:#4CAF50;border:0;color:white;border-radius:6px;cursor:pointer;font-size:12px">💾 Save</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const sTab = overlay.querySelector('#mem-session-tab') as HTMLButtonElement
    const aTab = overlay.querySelector('#mem-account-tab') as HTMLButtonElement
    const xTab = overlay.querySelector('#mem-sessions-tab') as HTMLButtonElement
    const sBox = overlay.querySelector('#mem-session') as HTMLElement
    const aBox = overlay.querySelector('#mem-account') as HTMLElement
    const xBox = overlay.querySelector('#mem-sessions') as HTMLElement
    const activate = (which: 's'|'a'|'x') => {
      sBox.style.display = which==='s' ? 'block' : 'none'
      aBox.style.display = which==='a' ? 'block' : 'none'
      xBox.style.display = which==='x' ? 'block' : 'none'
      sTab.style.background = which==='s' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'
      aTab.style.background = which==='a' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'
      xTab.style.background = which==='x' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)'
    }
    sTab?.addEventListener('click', ()=> activate('s'))
    aTab?.addEventListener('click', ()=> activate('a'))
    xTab?.addEventListener('click', ()=> { activate('x'); renderSessions() })

    overlay.querySelector('#close-memory-lightbox')?.addEventListener('click', ()=> overlay.remove())
    overlay.querySelector('#memory-cancel')?.addEventListener('click', ()=> overlay.remove())
    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) overlay.remove() })

    // --- Sessions UI wiring ---
    function short(s?: string, n: number = 60) { if (!s) return ''; return s.length>n? s.slice(0,n-1)+'…': s }
    function fmtDur(sec: number) { const m = Math.floor(sec/60); const s = sec%60; return `${m}m ${s}s` }
    function renderSessions(filter: string = 'Runs') {
      const tbody = overlay.querySelector('#sess-table tbody') as HTMLElement
      const empty = overlay.querySelector('#sess-empty') as HTMLElement
      if (!tbody || !empty) return
      let items = SessionsStore.loadAll()
      if (filter === 'Verified') items = items.filter(i=> i.status==='Verified')
      if (filter === 'Queue') items = items.filter(i=> i.status==='Verified' || i.status==='Playbook Extracted')
      // Evidence or Playbooks views are placeholders for now
      tbody.innerHTML = ''
      if (items.length === 0) {
        empty.style.display = 'block'
        return
      }
      empty.style.display = 'none'
      items.forEach(it => {
        const tr = document.createElement('tr')
        tr.style.cursor = 'pointer'
        tr.innerHTML = `
          <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,.08)">${it.title || '(untitled)'}<div style=\"opacity:.7;font-size:10px\">${it.id}</div></td>
          <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,.08)">${it.type}</td>
          <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,.08)">${it.evidenceCount}</td>
          <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,.08)">${short(it.aiRootCause, 48)}</td>
          <td style=\"padding:6px;border-bottom:1px solid rgba(255,255,255,.08)\"><button class=\"sess-open\" data-id=\"${it.id}\" style=\"padding:4px 8px;border:1px solid rgba(34,197,94,.6);background:rgba(34,197,94,.15);color:#bbf7d0;border-radius:6px;cursor:pointer\">Fix</button></td>
          <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,.08)">${it.status}</td>
          <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,.08)"><button class=\"sess-open\" data-id=\"${it.id}\" style=\"padding:4px 8px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:6px;cursor:pointer\">Open</button></td>
        `
        tr.addEventListener('click', (ev) => {
          const tgt = ev.target as HTMLElement
          if (tgt && tgt.classList.contains('sess-open')) { openDrawer(it.id); return }
          openDrawer(it.id)
        })
        tbody.appendChild(tr)
      })
      overlay.querySelectorAll('.sess-filter').forEach(btn => {
        btn.addEventListener('click', () => renderSessions((btn as HTMLElement).getAttribute('data-k') || 'Runs'))
      })
    }
    function openDrawer(id: string) {
      const item = SessionsStore.get(id); if (!item) return
      const drawer = document.createElement('div')
      drawer.style.cssText = 'position:fixed;top:0;right:0;height:100vh;width:520px;background:rgba(17,24,39,.98);color:#fff;z-index:2147483650;box-shadow:-4px 0 24px rgba(0,0,0,.4);display:flex;flex-direction:column;'
      drawer.innerHTML = `
        <div style="padding:16px;border-bottom:1px solid rgba(255,255,255,.2);display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:700">${item.title || '(untitled)'} <span style="opacity:.8;font-weight:400">(${item.type})</span></div>
            <div style="font-size:12px;opacity:.85">${item.status} • ${fmtDur(item.durationSec)} • Confidence ${item.confidencePct ?? '-'}% • Human/Ai ${item.humanAiMix ?? 0}%</div>
          </div>
          <button id="sess-close" style="width:30px;height:30px;border-radius:50%;border:0;background:rgba(255,255,255,.2);color:#fff;cursor:pointer">×</button>
        </div>
        <div style="flex:1;overflow:auto;padding:16px;display:grid;gap:12px">
          <div style="background:rgba(255,255,255,.06);padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:8px">
            <div style="font-weight:700;margin-bottom:6px">Co-Authoring Timeline</div>
            <div style="font-size:12px;display:grid;gap:6px">${item.review.map(l=>`<div> ${l.role==='human'?'👤':'🤖'} ${new Date(l.at).toLocaleString()} – ${l.action}${l.from?` ${l.from} → ${l.to}`:''} ${l.message?('– '+l.message):''}</div>`).join('')}</div>
          </div>
          <div style="background:rgba(255,255,255,.06);padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:8px">
            <div style="font-weight:700;margin-bottom:6px">AI Solution Detection</div>
            <div style="font-size:12px;margin-bottom:6px"><b>Root cause:</b> ${item.aiRootCause || '—'}</div>
            <div style="font-size:12px;margin-bottom:6px"><b>Steps:</b> ${item.aiSteps || '—'}</div>
            <div style="font-size:12px;margin-bottom:6px"><b>Impact:</b> ${item.impact || '—'}</div>
            <div style="display:flex;gap:8px">
              <button id="sess-accept-draft" style="padding:6px 10px;background:#22c55e;border:0;color:#0b1e12;border-radius:6px;cursor:pointer">Accept as Draft</button>
              <button id="sess-edit" style="padding:6px 10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:6px;cursor:pointer">Edit</button>
              <button id="sess-rerun" style="padding:6px 10px;background:#2563eb;border:0;color:#fff;border-radius:6px;cursor:pointer">Re-run</button>
            </div>
          </div>
          <div style="background:rgba(255,255,255,.06);padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:8px">
            <div style="font-weight:700;margin-bottom:6px">Evidence</div>
            <input id="sess-add-files" type="file" multiple accept="audio/*,image/*,video/*,application/pdf,application/json,.md,.txt,.zip" style="margin-bottom:8px">
            <div id="sess-ev-list" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"></div>
          </div>
          <div style="background:rgba(255,255,255,.06);padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:8px">
            <div style="font-weight:700;margin-bottom:6px">Validation</div>
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><input id="val-redact" type="checkbox"> Redact PII</label>
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><input id="val-accepted" type="checkbox" checked> Include accepted steps</label>
            <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><input id="val-bind" type="checkbox" disabled checked> Bind to Account Memory</label>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
              <span style="font-size:12px">Target:</span>
              <select id="embed-target" style="background:#111827;color:#fff;border:1px solid rgba(255,255,255,.25);padding:6px;border-radius:6px">
                <option>Local VDB</option>
                <option>Project KB</option>
              </select>
              <button id="do-embed" style="margin-left:auto;padding:6px 10px;background:#22c55e;border:0;color:#0b1e12;border-radius:6px;cursor:pointer">Embed → Queue</button>
            </div>
          </div>
          <div style="background:rgba(255,255,255,.06);padding:12px;border:1px solid rgba(255,255,255,.15);border-radius:8px">
            <div style="font-weight:700;margin-bottom:6px">Governance</div>
            <div style="display:flex;gap:8px;margin-bottom:8px">
              <input id="gov-reviewer" placeholder="Reviewer" style="flex:1;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;padding:6px;border-radius:6px;font-size:12px">
              <input id="gov-wrstamp" placeholder="WRStamp" style="flex:1;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);color:#fff;padding:6px;border-radius:6px;font-size:12px">
            </div>
            <div style="font-weight:600;margin:6px 0">Audit Log</div>
            <div id="audit-log" style="font-size:12px;max-height:120px;overflow:auto;margin-bottom:8px"></div>
            <div style="display:flex;gap:8px">
              <button id="export-json" style="padding:6px 10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:6px;cursor:pointer">Export JSON</button>
              <button id="export-md" style="padding:6px 10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:6px;cursor:pointer">Export MD</button>
              <button id="export-pdf" style="padding:6px 10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:6px;cursor:pointer">Export PDF</button>
            </div>
          </div>
        </div>
      `
      document.body.appendChild(drawer)
      ;(drawer.querySelector('#sess-close') as HTMLButtonElement)?.addEventListener('click', ()=> drawer.remove())
      // evidence render
      const evList = drawer.querySelector('#sess-ev-list') as HTMLElement
      const renderEv = () => {
        evList.innerHTML = ''
        item.evidence.forEach(ev => {
          const cell = document.createElement('div')
          cell.style.cssText = 'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:6px;display:flex;gap:6px;align-items:center'
          const label = document.createElement('div')
          label.style.cssText = 'font-size:11px;flex:1'
          label.textContent = ev.name || ev.kind
          if (ev.dataUrl && ev.kind==='image') {
            const img = document.createElement('img'); img.src = ev.dataUrl; img.style.maxWidth = '64px'; img.style.borderRadius = '4px'; cell.appendChild(img)
          }
          cell.appendChild(label)
          evList.appendChild(cell)
        })
      }
      renderEv()
      const addFiles = drawer.querySelector('#sess-add-files') as HTMLInputElement
      addFiles?.addEventListener('change', async ()=>{
        const files = Array.from(addFiles.files||[])
        for (const f of files) {
          const kind: EvidenceItem['kind'] = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'voice' : (f.type.startsWith('text/') || f.name.endsWith('.md')) ? 'text' : 'file'
          const dataUrl = (kind==='image' || kind==='video' || kind==='voice') ? await new Promise<string>(res=>{ const r = new FileReader(); r.onload=()=>res(String(r.result||'')); r.readAsDataURL(f) }) : undefined
          // compute SHA-256
          const buf = await f.arrayBuffer()
          const hashBuf = await crypto.subtle.digest('SHA-256', buf)
          const hashArr = Array.from(new Uint8Array(hashBuf))
          const hash = hashArr.map(b=>b.toString(16).padStart(2,'0')).join('')
          const updated = SessionsStore.addEvidence(item.id, { id: 'ev_'+Math.random().toString(36).slice(2), kind, mimeType: f.type, name: f.name, dataUrl, createdAt: new Date().toISOString(), meta: { sha256: hash, size: f.size } })
          if (updated) {
            updated.evidenceHashes = Array.from(new Set([...(updated.evidenceHashes||[]), hash]))
            SessionsStore.upsert(updated)
          }
        }
        Object.assign(item, SessionsStore.get(item.id))
        renderEv(); renderSessions()
      })
      // audit log
      const audit = drawer.querySelector('#audit-log') as HTMLElement
      audit.innerHTML = item.review.map(l=>`<div>${new Date(l.at).toLocaleString()} – ${l.action}${l.from?` ${l.from} → ${l.to}`:''} ${l.message?('– '+l.message):''}</div>`).join('')
      // export handlers
      const download = (name: string, content: string, mime='application/octet-stream') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], {type:mime})); a.download=name; a.click(); URL.revokeObjectURL(a.href) }
      ;(drawer.querySelector('#export-json') as HTMLButtonElement)?.addEventListener('click', ()=> download(`session-${item.id}.json`, JSON.stringify(item, null, 2), 'application/json'))
      ;(drawer.querySelector('#export-md') as HTMLButtonElement)?.addEventListener('click', ()=> {
        const md = `# ${item.title}\n\n- Type: ${item.type}\n- Status: ${item.status}\n- Duration: ${fmtDur(item.durationSec)}\n- Confidence: ${item.confidencePct ?? '-'}%\n\n## Root Cause\n${item.aiRootCause||''}\n\n## Steps\n${item.aiSteps||''}`
        download(`session-${item.id}.md`, md, 'text/markdown')
      })
      ;(drawer.querySelector('#export-pdf') as HTMLButtonElement)?.addEventListener('click', ()=> {
        const w = window.open('', '_blank')
        if (!w) return
        w.document.write(`<pre style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace; white-space:pre-wrap;">${(item.title||'')+"\n\n"+(item.aiRootCause||'')+"\n\n"+(item.aiSteps||'')}</pre>`)
        w.document.close(); w.focus(); w.print()
      })
      // actions
      ;(drawer.querySelector('#sess-accept-draft') as HTMLButtonElement)?.addEventListener('click', ()=>{ SessionsStore.transition(item.id, 'Co-Auth Draft'); renderSessions(); drawer.remove() })
      ;(drawer.querySelector('#do-embed') as HTMLButtonElement)?.addEventListener('click', ()=>{ SessionsStore.transition(item.id, 'Embedded'); renderSessions(); drawer.remove() })
    }
  }

  // WRVault Lightbox
  function openWRVaultLightbox() {
    const overlay = document.createElement('div')
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:2147483649;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(5px)`
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 85vw; max-width: 900px; height: 80vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;">
        <div style="padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:8px;font-size:18px;font-weight:700">🔒 WRVault – Secure Data Vault</div>
          <button id="wrv-close" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
        </div>
        <div style="padding:10px 20px; background: rgba(255,255,255,0.06); border-bottom:1px solid rgba(255,255,255,0.2); font-size:12px;">
          ⚠️ This is a UI prototype only. Real encryption, storage, and access control must be implemented by security experts.
        </div>
        <div style="flex:1; display:flex; flex-direction:column; padding: 16px 20px; overflow:auto;">
          <div style="display:flex; gap:8px; border-bottom:1px solid rgba(255,255,255,0.25); margin-bottom:12px;">
            <button class="wrv-tab" data-k="pw" style="padding:8px 12px; background: rgba(255,255,255,0.2); border:0; color:white; border-radius:8px 8px 0 0; cursor:pointer">Passwords</button>
            <button class="wrv-tab" data-k="pii" style="padding:8px 12px; background: rgba(255,255,255,0.1); border:0; color:white; border-radius:8px 8px 0 0; cursor:pointer">PII</button>
            <button class="wrv-tab" data-k="bucket" style="padding:8px 12px; background: rgba(255,255,255,0.1); border:0; color:white; border-radius:8px 8px 0 0; cursor:pointer">Sensitive Bucket</button>
            <button class="wrv-tab" data-k="pay" style="padding:8px 12px; background: rgba(255,255,255,0.1); border:0; color:white; border-radius:8px 8px 0 0; cursor:pointer">Payment Methods</button>
          </div>
          <div id="wrv-content"></div>
        </div>
      </div>
    `
    const root = overlay.querySelector('#wrv-content') as HTMLElement
    function render(kind:'pw'|'pii'|'bucket'|'pay'){
      const mkRow = (label:string, valueMask:string) => `
        <div style="display:grid; grid-template-columns: 1fr 1fr auto; gap:8px; align-items:center; background: rgba(0,0,0,0.12); padding:8px; border-radius:8px; border:1px solid rgba(255,255,255,0.18)">
          <div>${label}</div>
          <div style="opacity:.8">${valueMask}</div>
          <div style="display:flex; gap:6px;">
            <button disabled style="opacity:.6; cursor:not-allowed; padding:4px 8px; background: rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:6px;">Reveal 🔒</button>
            <button disabled style="opacity:.6; cursor:not-allowed; padding:4px 8px; background: rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:6px;">Copy 🔒</button>
            <button disabled style="opacity:.6; cursor:not-allowed; padding:4px 8px; background: rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:6px;">Use in Workflow 🔒</button>
          </div>
        </div>`
      const addBtn = `<button id="wrv-add" style="margin-bottom:10px;padding:6px 10px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:white;border-radius:6px;cursor:pointer">${kind==='pay'?'+ Add Payment Method':'+ Add New'}</button>`
      if (kind==='pw') root.innerHTML = addBtn + [mkRow('GitHub Login','••••••••'), mkRow('Email – Work','••••••••')].join('<div style="height:8px"></div>')
      else if (kind==='pii') root.innerHTML = addBtn + [mkRow('Home Address','Hidden until unlock'), mkRow('Government ID','Hidden until unlock')].join('<div style="height:8px"></div>')
      else if (kind==='bucket') root.innerHTML = addBtn + [mkRow('SSH Notes','Hidden until unlock'), mkRow('Production access notes','Hidden until unlock')].join('<div style="height:8px"></div>')
      else root.innerHTML = addBtn + [mkRow('Visa **** 1234','••/••'), mkRow('PayPal – masked','Hidden until unlock')].join('<div style="height:8px"></div>')
    }
    ;['pw','pii','bucket','pay'].forEach((k,idx)=>{
      const btn = overlay.querySelector(`.wrv-tab[data-k="${k}"]`) as HTMLButtonElement
      btn?.addEventListener('click', ()=>{
        overlay.querySelectorAll('.wrv-tab').forEach(b=> (b as HTMLButtonElement).style.background='rgba(255,255,255,0.1)')
        btn.style.background = 'rgba(255,255,255,0.2)'
        render(k as any)
      })
      if (idx===0) btn?.click()
    })
    overlay.querySelector('#wrv-close')?.addEventListener('click', ()=> overlay.remove())
    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
  }

  type CaptureRect = { x: number, y: number, w: number, h: number }

  function computeCaptureScaleFromImage(img: HTMLImageElement){
    const naturalWidth = Math.max(1, img.naturalWidth || img.width || 1)
    const naturalHeight = Math.max(1, img.naturalHeight || img.height || 1)
    const viewportWidth = Math.max(1, window.innerWidth)
    const viewportHeight = Math.max(1, window.innerHeight)
    const scaleX = naturalWidth / viewportWidth
    const scaleY = naturalHeight / viewportHeight
    return {
      scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
      scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1
    }
  }

  async function cropCapturedImageToRect(dataUrl:string, rect: CaptureRect): Promise<string>{
    return await new Promise<string>((resolve)=>{
      try{
        const img = new Image()
        img.onload = ()=>{
          try{
            const { scaleX, scaleY } = computeCaptureScaleFromImage(img)
            const cropLeft = Math.max(0, Math.round(rect.x * scaleX))
            const cropTop = Math.max(0, Math.round(rect.y * scaleY))
            const cropWidth = Math.max(1, Math.round(rect.w * scaleX))
            const cropHeight = Math.max(1, Math.round(rect.h * scaleY))
            const cnv = document.createElement('canvas')
            cnv.width = cropWidth
            cnv.height = cropHeight
            const ctx = cnv.getContext('2d')
            if (ctx){
              ctx.drawImage(img, cropLeft, cropTop, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
              resolve(cnv.toDataURL('image/png'))
              return
            }
          }catch{}
          resolve(dataUrl)
        }
        img.onerror = ()=> resolve(dataUrl)
        img.src = dataUrl
      }catch{ resolve(dataUrl) }
    })
  }

  // Simple screen selection overlay with controls (Screenshot | Stream | [ ] Create Tagged Trigger)
  function beginScreenSelect(messagesEl: HTMLElement, preset?: { rect: CaptureRect, mode: 'screenshot'|'stream' }){
    try {
      const existing = document.getElementById('og-select-overlay')
      if (existing) existing.remove()

      const dpr = Math.max(1, (window as any).devicePixelRatio || 1)
      const ov = document.createElement('div')
      ov.id = 'og-select-overlay'
      ov.style.cssText = 'position:fixed; inset:0; z-index:2147483647; cursor:crosshair; background:rgba(0,0,0,0.05);'
      const box = document.createElement('div')
      box.style.cssText = 'position:fixed; border:2px dashed #0ea5e9; background:rgba(14,165,233,0.08); pointer-events:none; display:none;'
      ov.appendChild(box)

      let startX = 0, startY = 0, curX = 0, curY = 0, isDragging = false
      let hasSelected = false
      function setBox(a:number,b:number,c:number,d:number){
        const x = Math.min(a,c), y = Math.min(b,d)
        const w = Math.abs(c-a), h = Math.abs(d-b)
        box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px'
        box.style.display = 'block'
      }
      function coords(){
        const r = box.getBoundingClientRect()
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
      }

      // Controls toolbar
      const toolbar = document.createElement('div')
      toolbar.style.cssText = 'position:fixed; display:none; gap:8px; background:#111827; color:white; padding:6px 8px; border-radius:8px; border:1px solid rgba(255,255,255,0.25); font-size:12px; pointer-events:auto; z-index:2147483648;'
      const btnShot = document.createElement('button'); btnShot.textContent = 'Screenshot'; btnShot.style.cssText='background:#10b981;border:0;color:white;padding:4px 8px;border-radius:6px;cursor:pointer'
      const btnStream = document.createElement('button'); btnStream.textContent = 'Stream'; btnStream.style.cssText='background:#3b82f6;border:0;color:white;padding:4px 8px;border-radius:6px;cursor:pointer'
      const btnRec = document.createElement('button'); btnRec.textContent = '⏺'; btnRec.title = 'Record'; btnRec.style.cssText='background:#ef4444;border:0;color:white;padding:4px 8px;border-radius:6px;cursor:pointer;display:none'
      const btnStop = document.createElement('button'); btnStop.textContent = '⏹'; btnStop.title = 'Stop'; btnStop.style.cssText='background:#991b1b;border:0;color:white;padding:4px 8px;border-radius:6px;cursor:pointer;display:none'
      const timerEl = document.createElement('span'); timerEl.textContent = '00:00'; timerEl.title = 'Recording time'; timerEl.style.cssText='color:#e5e7eb;opacity:.9;font-variant-numeric:tabular-nums;display:none;align-self:center'
      const lab = document.createElement('label'); lab.style.cssText='display:flex;align-items:center;gap:6px;color:white;user-select:none'
      const cbCreate = document.createElement('input'); cbCreate.type='checkbox'
      const spanTxt = document.createElement('span'); spanTxt.textContent = 'Create Tagged Trigger'
      lab.append(cbCreate, spanTxt)
      // Close control (×)
      const btnClose = document.createElement('button'); btnClose.textContent='×'; btnClose.title='Close selection'; btnClose.style.cssText='background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.25);color:white;padding:4px 8px;border-radius:6px;cursor:pointer'
      toolbar.append(btnShot, btnStream, btnRec, btnStop, timerEl, lab, btnClose)
      document.body.appendChild(toolbar)
      // Prevent toolbar clicks from bubbling to overlay handlers
      ;[toolbar, btnShot, btnStream, btnRec, btnStop, lab, cbCreate, spanTxt, btnClose].forEach(el=>{
        el.addEventListener('mousedown', e=>{ e.stopPropagation() })
        el.addEventListener('mouseup', e=>{ e.stopPropagation() })
        el.addEventListener('click', e=>{ e.stopPropagation() })
      })

      let recTimer: any = null
      let mediaRecorder: MediaRecorder | null = null
      let recordedChunks: BlobPart[] = []
      let stopAll: (()=>void) | null = null
      let frameTimer: any = null
      let recBadge: HTMLElement | null = null
      let recStartMs: number = 0

      function formatTime(ms:number){
        const total = Math.max(0, Math.floor(ms/1000))
        const m = Math.floor(total/60).toString().padStart(2,'0')
        const s = (total%60).toString().padStart(2,'0')
        return m+':'+s
      }

      function placeToolbar(){
        const r = box.getBoundingClientRect()
        const tx = Math.max(8, Math.min(window.innerWidth - 220, r.left))
        const ty = Math.max(8, r.top - 36)
        toolbar.style.left = tx + 'px'; toolbar.style.top = ty + 'px'; toolbar.style.display='flex'
      }

      ov.addEventListener('mousedown', (e)=>{ const t=e.target as Element|null; if (t && (t===toolbar || toolbar.contains(t))) { e.stopPropagation(); return; } if (hasSelected) { e.stopPropagation(); return; } isDragging = true; startX = e.clientX; startY = e.clientY; curX = startX; curY = startY; setBox(startX,startY,curX,curY) })
      ov.addEventListener('mousemove', (e)=>{ if(!isDragging) return; curX=e.clientX; curY=e.clientY; setBox(startX,startY,curX,curY) })
      ov.addEventListener('mouseup', (e)=>{ const t=e.target as Element|null; if (t && (t===toolbar || toolbar.contains(t))) { e.stopPropagation(); return; } if(!isDragging) return; isDragging=false; hasSelected = true; placeToolbar(); toolbar.style.pointerEvents='auto'; try{ (ov as HTMLElement).style.cursor='default'; (ov as HTMLElement).style.pointerEvents='none' }catch{} })

      // Close selection and controls
      function closeSelection(){
        try{ clearInterval(frameTimer) }catch{}
        try{ mediaRecorder && mediaRecorder.state !== 'inactive' && mediaRecorder.stop() }catch{}
        try{ recBadge && recBadge.remove() }catch{}
        try{ toolbar.remove() }catch{}
        try{ ov.remove() }catch{}
      }
      btnClose.onclick = (ev:any)=>{ try{ ev.preventDefault(); ev.stopPropagation() }catch{}; closeSelection() }

      async function captureVisibleTab(): Promise<string|null>{
        try {
          // First try standard captureVisibleTab
          const dataUrl = await new Promise<string|null>((resolve)=>{ try{ chrome.runtime.sendMessage({ type:'CAPTURE_VISIBLE_TAB' }, (res:any)=> resolve(res?.dataUrl||null)) }catch{ resolve(null) } })
          if (dataUrl) return dataUrl
        } catch {}
        // Fallback: draw current viewport using html2canvas style approach via paint worklet is not available; skip.
        return null
      }

      async function cropImageToRect(dataUrl:string, rect: CaptureRect){
        return await cropCapturedImageToRect(dataUrl, rect)
      }
      function pasteVideoToChat(url:string){
        try{
          const target = (messagesEl || (document.getElementById('ccf-messages') as HTMLElement | null) || (document.getElementById('ccd-messages') as HTMLElement | null)) as HTMLElement | null
          if (!target) return null
          const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='flex-end'
          const bub = document.createElement('div'); bub.style.maxWidth='78%'; bub.style.padding='6px'; bub.style.borderRadius='10px'; bub.style.fontSize='12px'; bub.style.background='var(--bubble-user-bg, rgba(34,197,94,0.12))'; bub.style.border='1px solid var(--bubble-user-border, rgba(34,197,94,0.45))'
          const vid = document.createElement('video'); vid.src=url; vid.controls = true; vid.style.maxWidth='260px'; vid.style.borderRadius='8px'
          bub.appendChild(vid); row.appendChild(bub); target.appendChild(row); target.scrollTop = 1e9
          try { chrome.runtime?.sendMessage({ type:'COMMAND_POPUP_APPEND', kind:'video', url }) } catch {}
          return row
        }catch{ return null }
      }
      function pasteImageToChat(url:string){
        try{
          // Prefer the provided element; fallback to popup then docked messages containers
          const target = (messagesEl || (document.getElementById('ccf-messages') as HTMLElement | null) || (document.getElementById('ccd-messages') as HTMLElement | null)) as HTMLElement | null
          if (!target) return null
          const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='flex-end'
          const bub = document.createElement('div'); bub.style.maxWidth='78%'; bub.style.padding='6px'; bub.style.borderRadius='10px'; bub.style.fontSize='12px'; bub.style.background='var(--bubble-user-bg, rgba(34,197,94,0.12))'; bub.style.border='1px solid var(--bubble-user-border, rgba(34,197,94,0.45))'
          const img = document.createElement('img'); img.src=url; img.style.maxWidth='260px'; img.style.height='auto'; img.style.borderRadius='8px'; img.alt='screenshot'
          bub.appendChild(img); row.appendChild(bub); target.appendChild(row); target.scrollTop = 1e9
          try { chrome.runtime?.sendMessage({ type:'COMMAND_POPUP_APPEND', kind:'image', url }) } catch {}
          return row
        }catch{ return null }
      }
      function renderTriggerPrompt(url:string, rect:{x:number,y:number,w:number,h:number}, mode:'screenshot'|'stream'){
        try{
          if (!cbCreate.checked) return
          const composer = (document.getElementById('ccd-compose') || document.getElementById('ccf-compose')) as HTMLElement | null
          if (!composer) return
          // avoid duplicates
          composer.querySelector('#og-trigger-savebar')?.remove()
          const bar = document.createElement('div')
          bar.id = 'og-trigger-savebar'
          bar.style.cssText = 'grid-column:1 / -1; display:flex; align-items:center; gap:8px; padding:6px 8px; background:rgba(2,6,23,0.85); color:#e5e7eb; border:1px solid rgba(255,255,255,0.15); border-radius:6px;'
          const label = document.createElement('span'); label.textContent='Tagged Trigger name:'
          const nameIn = document.createElement('input'); nameIn.type='text'; nameIn.placeholder='Trigger name'; nameIn.style.cssText='flex:1; min-width:120px; padding:4px 6px; border:1px solid #e5e7eb; border-radius:6px; font-size:12px; background:#0b1220; color:#e5e7eb'
          const save = document.createElement('button'); save.textContent='Save'; save.style.cssText='background:#2563eb;border:0;color:white;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px'
          const cancel = document.createElement('button'); cancel.textContent='Cancel'; cancel.style.cssText='background:rgba(255,255,255,0.12);border:0;color:#e5e7eb;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px'
          bar.append(label, nameIn, save, cancel)
          composer.appendChild(bar)
          nameIn.focus()
          cancel.onclick = ()=> bar.remove()
          save.onclick = ()=>{
            const name = (nameIn.value||'').trim() || ('Trigger ' + new Date().toLocaleString())
            try{
              const key='optimando-tagged-triggers'
              chrome.storage?.local?.get([key], (data:any)=>{
                try{
                  const prev = Array.isArray(data?.[key]) ? data[key] : []
                  prev.push({ name, at: Date.now(), image: url, rect, mode })
                  chrome.storage?.local?.set({ [key]: prev }, ()=>{
                    try{ window.dispatchEvent(new CustomEvent('optimando-triggers-updated')) }catch{}
                    try{ chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) }catch{}
                  })
                }catch{}
              })
            }catch{}
            // Also send to Electron so it appears in Electron's dropdown
            // Note: Extension triggers don't have displayId, Electron will detect the display
            try{
              chrome.runtime?.sendMessage({
                type: 'EXTENSION_SAVE_TRIGGER',
                name,
                mode,
                rect,
                imageUrl: url,
                detectDisplay: true // Ask Electron to detect which display the browser is on
              })
            }catch{}
            bar.remove()
          }
        }catch{}
      }

      btnShot.onclick = async (ev:any)=>{
        try{ ev.preventDefault(); ev.stopPropagation() }catch{}
        const r = coords(); const raw = await captureVisibleTab(); if(!raw) return; const cropped = await cropCapturedImageToRect(raw, r); pasteImageToChat(cropped); renderTriggerPrompt(cropped, r, 'screenshot'); try{ closeSelection() }catch{}
      }
      btnStream.onclick = async (ev:any)=>{
        try{ ev.preventDefault(); ev.stopPropagation() }catch{}
        // Reveal recording controls for selected region
        btnRec.style.display='inline-block'; btnStop.style.display='inline-block'
      }
      btnRec.onclick = async (ev:any)=>{
        try{ ev.preventDefault(); ev.stopPropagation() }catch{}
        try{
          const r = coords()
          const dpr = Math.max(1, (window as any).devicePixelRatio || 1)
          const cnv = document.createElement('canvas'); cnv.width = Math.max(1, Math.round(r.w*dpr)); cnv.height = Math.max(1, Math.round(r.h*dpr))
          const ctx = cnv.getContext('2d')!
          const stream = (cnv as any).captureStream ? (cnv as any).captureStream(5) : null
          if (!stream) return
          recordedChunks = []
          const preferred = [
            'video/mp4;codecs=h264',
            'video/mp4',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
          ]
          const mime = preferred.find(t=>{ try { return (MediaRecorder as any).isTypeSupported ? MediaRecorder.isTypeSupported(t) : false } catch { return false } }) || 'video/webm'
          mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 })
          mediaRecorder.ondataavailable = (e)=>{ if (e.data && e.data.size > 0) recordedChunks.push(e.data) }
          mediaRecorder.onstop = ()=>{
            try{ clearInterval(frameTimer) }catch{}
            try{ (stream.getTracks()||[]).forEach((t:any)=>t.stop()) }catch{}
            const blob = new Blob(recordedChunks, { type: mime })
            const url = URL.createObjectURL(blob)
            pasteVideoToChat(url)
            renderTriggerPrompt(url as any, r, 'stream')
            try{ if(recTimer){ clearInterval(recTimer); recTimer=null } }catch{}
            try{ timerEl.style.display='none'; timerEl.textContent='00:00' }catch{}
            try{ closeSelection() }catch{}
          }
          mediaRecorder.start(500)
          // Periodically capture frames of the visible tab and draw cropped region
          frameTimer = setInterval(async ()=>{
            try{
              const raw = await captureVisibleTab(); if(!raw) return
              await new Promise<void>((resolve)=>{ const img=new Image(); img.onload=()=>{ try{ ctx.drawImage(img, Math.round(r.x*dpr), Math.round(r.y*dpr), Math.round(r.w*dpr), Math.round(r.h*dpr), 0, 0, Math.round(r.w*dpr), Math.round(r.h*dpr)) }catch{}; resolve() }; img.src=raw })
            }catch{}
          }, 200)
          // Hide overlay so it is not captured
          try{ ov.style.pointerEvents='none'; box.style.display='block' }catch{}
          // Visual recording badge
          try {
            recBadge = document.createElement('div')
            recBadge.id = 'og-rec-ind'
            recBadge.style.cssText = 'position:fixed; top:8px; right:12px; z-index:2147483647; display:flex; align-items:center; gap:6px; background:rgba(17,24,39,0.85); color:#fecaca; border:1px solid rgba(239,68,68,0.6); padding:4px 8px; border-radius:8px; font-size:12px;'
            recBadge.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:#ef4444;animation:pulse 1s infinite"></span><span>REC</span>'
            const st = document.createElement('style'); st.textContent='@keyframes pulse{0%{opacity:1}50%{opacity:.35}100%{opacity:1}}'; recBadge.appendChild(st)
            document.body.appendChild(recBadge)
          } catch{}
          // Start timer next to controls
          try {
            recStartMs = Date.now();
            timerEl.style.display='inline-block';
            timerEl.textContent = '00:00';
            recTimer = setInterval(()=>{ try{ timerEl.textContent = formatTime(Date.now()-recStartMs) }catch{} }, 1000)
          } catch {}
          stopAll = ()=>{
            try{ clearInterval(frameTimer) }catch{}
            try{ mediaRecorder && mediaRecorder.state !== 'inactive' && mediaRecorder.stop() }catch{}
            try{ recBadge && recBadge.remove() }catch{}
            try{ if(recTimer){ clearInterval(recTimer); recTimer=null } }catch{}
            try{ timerEl.style.display='none'; timerEl.textContent='00:00' }catch{}
          }
        }catch{}
      }
      btnStop.onclick = (ev:any)=>{
        try{ ev.preventDefault(); ev.stopPropagation() }catch{}
        // Stop timer if running
        if (recTimer){ try{ clearInterval(recTimer) }catch{} recTimer=null }
        if (stopAll) stopAll()
      }
      // removed explicit button; checkbox governs prompt on actions

      document.body.appendChild(ov)

      // If a preset is provided, auto-apply the rectangle and optionally auto-start stream
      try {
        if (preset && preset.rect && preset.mode){
          const r = preset.rect
          // Apply rectangle visually
          setBox(r.x, r.y, r.x + r.w, r.y + r.h)
          hasSelected = true
          placeToolbar(); toolbar.style.pointerEvents='auto'
          try{ (ov as HTMLElement).style.cursor='default'; (ov as HTMLElement).style.pointerEvents='none' }catch{}
          if (preset.mode === 'stream'){
            // Reveal controls then auto-start recording
            try{ btnStream.click() }catch{}
            setTimeout(()=>{ try{ btnRec.click() }catch{} }, 0)
          }
        }
      } catch {}

      // External cancel support from popup or Electron
      try {
        const cancelHandler = (incoming:any)=>{
          try{ if (!incoming || !incoming.type) return; if (incoming.type !== 'OG_CANCEL_SELECTION') return; }catch{ return }
          try{ clearInterval(frameTimer) }catch{}
          try{ mediaRecorder && mediaRecorder.state !== 'inactive' && mediaRecorder.stop() }catch{}
          try{ recBadge && recBadge.remove() }catch{}
          try{ toolbar.remove() }catch{}
          try{ ov.remove() }catch{}
        }
        chrome.runtime?.onMessage.addListener(cancelHandler)
      } catch {}

      // Handle selection results coming back from Electron (for popup window mode)
      try {
        const onElectronResult = (evt:any)=>{
          try{
            const msg = evt?.detail || evt
            if (!msg || !msg.type) return
            if (msg.type === 'ELECTRON_SELECTION_RESULT'){
              const kind = msg.kind || 'image'
              const url = msg.dataUrl || msg.url
              if (!url) return
              if (kind === 'video') { pasteVideoToChat(url); try{ closeSelection() }catch{} }
              else pasteImageToChat(url)
              try{ recBadge && recBadge.remove() }catch{}
            }
          }catch{}
        }
        // Also listen via chrome.runtime messaging in case background forwards it
        chrome.runtime?.onMessage.addListener((incoming:any)=>{
          try{
            if (incoming && incoming.type === 'ELECTRON_SELECTION_RESULT'){
              const kind = incoming.kind || 'image'
              const url = incoming.dataUrl || incoming.url
              if (!url) return
              if (kind === 'video') { pasteVideoToChat(url); try{ closeSelection() }catch{} }
              else pasteImageToChat(url)
              try{ recBadge && recBadge.remove() }catch{}
            }
          }catch{}
        })
      } catch {}
    } catch {}
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
      // Feature flag: disable auto-connecting to local desktop WebSocket unless explicitly enabled
      const DESKTOP_WS_ENABLED = false
      if (!DESKTOP_WS_ENABLED) {
        console.log('ℹ️ Desktop WebSocket disabled; skipping connect for LOAD_SESSION')
        return
      }
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
      const DESKTOP_WS_ENABLED = false
      if (!DESKTOP_WS_ENABLED) {
        console.log('ℹ️ Desktop WebSocket disabled; skipping connect for SAVE_SESSION_DATA')
        return
      }
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
    // Feature flag: disable auto-connecting to local desktop WebSocket unless explicitly enabled
    const DESKTOP_WS_ENABLED = false
    if (!DESKTOP_WS_ENABLED) {
      console.log('ℹ️ Desktop WebSocket disabled; not initializing connection')
      return
    }
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
  // Only initialize if feature flag enables it (guard inside function)
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
      pointer-events: auto;
    `
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; height: 85vh; max-width: 1200px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px;">⚙️ Extension Settings</h2>
          <div style="display:flex; gap:10px; align-items:center;">
            <button id="settings-whitelist-btn" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.4); color: white; padding: 6px 10px; border-radius: 999px; cursor: pointer; font-size: 11px; font-weight:700;">🛡️ Whitelist</button>
          <button id="close-settings-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
          </div>
        </div>
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
          <div style="display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 16px; align-items: stretch;">
            <!-- Account & Billing (TOP) -->
            <div style="background: rgba(255,255,255,0.10); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); grid-column: 1 / -1;">
              <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 8px;">
                <h4 style="margin: 0; font-size: 12px; color: #FFD700;">💳 Account & Billing</h4>
                <div id="account-balance" style="font-size: 12px; font-weight: 700;">Balance: $0.00</div>
              </div>
              <div style="display:flex; gap:10px;">
                <button id="btn-payg" style="flex:1; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 11px;">Pay-as-you-go</button>
                <button id="btn-subscription" style="flex:1; background: #4CAF50; border: none; color: white; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700;">Subscription (incl. BYOK)</button>
              </div>
              <div style="margin-top: 8px; font-size: 10px; opacity: 0.9;">Free usage available – Subscription unlocks BYOK and advanced features.</div>
            </div>
            
            <!-- API Keys Configuration (moved first) -->
            <div style="background: rgba(255,255,255,0.10); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); grid-column: 1 / 2; height: 100%; display: flex; flex-direction: column;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="margin: 0; font-size: 12px; color: #FFD700;">🔑 API Keys</h4>
                <div style="display:flex; gap:6px;">
                  <button id="add-custom-api-key" style="background: rgba(76,175,80,0.85); border: none; color: white; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 700;">+ Custom</button>
                  <button id="save-api-keys" style="background: #4CAF50; border: none; color: white; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 700;">Save</button>
                </div>
              </div>
              <div id="byok-requirement" style="display:none; font-size:10px; margin:6px 0; padding:6px; background: rgba(244,67,54,0.20); border:1px solid rgba(244,67,54,0.35); border-radius:6px;">
                You need an active subscription to bring your own keys.
              </div>
              <div id="api-keys-container" style="display: grid; gap: 6px;">
                <div class="api-key-row" data-provider="OpenAI" style="display: grid; grid-template-columns: 80px 1fr 24px; gap: 6px; align-items: center; background: rgba(0,0,0,0.12); padding: 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.18);">
                  <label style="font-size:10px; font-weight:700; opacity:0.95;">OpenAI</label>
                  <input type="password" id="key-OpenAI" placeholder="sk-..." style="background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: white; padding: 6px; border-radius: 4px; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
                  <button class="toggle-visibility" data-target="key-OpenAI" title="Show/Hide" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">👁️</button>
                </div>
                <div class="api-key-row" data-provider="Claude" style="display: grid; grid-template-columns: 80px 1fr 24px; gap: 6px; align-items: center; background: rgba(0,0,0,0.12); padding: 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.18);">
                  <label style="font-size:10px; font-weight:700; opacity:0.95;">Claude</label>
                  <input type="password" id="key-Claude" placeholder="sk-ant-..." style="background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: white; padding: 6px; border-radius: 4px; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
                  <button class="toggle-visibility" data-target="key-Claude" title="Show/Hide" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">👁️</button>
                </div>
                <div class="api-key-row" data-provider="Gemini" style="display: grid; grid-template-columns: 80px 1fr 24px; gap: 6px; align-items: center; background: rgba(0,0,0,0.12); padding: 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.18);">
                  <label style="font-size:10px; font-weight:700; opacity:0.95;">Gemini</label>
                  <input type="password" id="key-Gemini" placeholder="AIza..." style="background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: white; padding: 6px; border-radius: 4px; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
                  <button class="toggle-visibility" data-target="key-Gemini" title="Show/Hide" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">👁️</button>
                </div>
                <div class="api-key-row" data-provider="Grok" style="display: grid; grid-template-columns: 80px 1fr 24px; gap: 6px; align-items: center; background: rgba(0,0,0,0.12); padding: 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.18);">
                  <label style="font-size:10px; font-weight:700; opacity:0.95;">Grok</label>
                  <input type="password" id="key-Grok" placeholder="xai-..." style="background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: white; padding: 6px; border-radius: 4px; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
                  <button class="toggle-visibility" data-target="key-Grok" title="Show/Hide" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">👁️</button>
                </div>
              </div>
            </div>

            <!-- Local LLMs (next to API Keys) -->
            <div id="local-llms-panel" style="background: rgba(255,255,255,0.10); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); grid-column: 2 / 3; height: 100%; display: flex; flex-direction: column;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="margin: 0; font-size: 12px; color: #FFD700;">💻 Local LLMs</h4>
                <div style="display:flex; gap:6px;">
                  <button id="add-local-llm-row" style="background: rgba(76,175,80,0.85); border: none; color: white; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 700;">+ Add</button>
                  <button id="save-local-llms" style="background: #4CAF50; border: none; color: white; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 700;">Save</button>
                </div>
              </div>
              <div id="local-llms-container" style="display: grid; gap: 6px;"></div>
              <div style="margin-top: 8px; font-size: 10px; opacity: 0.9;">Local models run offline via Ollama/llama.cpp. Installation prompts may appear.</div>

              <div id="finetuned-llms" style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.25);">
                <div style="display:flex; justify-content: space-between; align-items:center; margin-bottom: 6px;">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:12px; color:#FFD700; font-weight:700;">🎛️ Finetuned local LLMs</span>
                    <span id="finetuned-pro-badge" style="display:none; font-size:10px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color:white; padding:2px 6px; border-radius:999px;">PRO</span>
                  </div>
                </div>
              <div id="finetuned-locked" style="display:none; font-size:10px; margin:6px 0; padding:6px; background: rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.22); border-radius:6px;">
                  🔒 Finetuned models are available for Pro subscribers.
                  <button id="unlock-finetuned" style="margin-left: 8px; background: #22c55e; border: none; color: #0b1e12; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 10px; font-weight: 700;">Upgrade</button>
                </div>
                <div id="finetuned-list" style="display:none; gap: 6px;">
                  <div id="finetuned-items" style="display:grid; gap:6px;"></div>
                  <button id="add-finetuned-row" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 10px;">+ Add Finetuned</button>
                </div>
              </div>
            </div>

            <!-- Appearance (moved up) -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; grid-column: 3 / 4; height: 100%; display: flex; flex-direction: column;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🎨 Appearance</h4>
              <div style="font-size: 10px; display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center;">
                <label style="display:block;">Theme:</label>
                <select id="optimando-theme-select" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px; pointer-events: auto; cursor: pointer;">
                  <option value="default" selected>Default (Original)</option>
                  <option value="dark">Dark</option>
                  <option value="professional">Professional</option>
                </select>
                <div style="grid-column: 1 / span 2; font-size: 9px; opacity: 0.85;">Only sidebars and the top header bar are themed. Main page stays unchanged.</div>
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
            
            

            
            
            <!-- Export/Import -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; grid-column: 1 / -1;">
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
        
      </div>
    `
    
    document.body.appendChild(overlay)
    document.getElementById('close-settings-lightbox').onclick = () => overlay.remove()
    const whitelistBtnInSettings = document.getElementById('settings-whitelist-btn')
    if (whitelistBtnInSettings) {
      whitelistBtnInSettings.addEventListener('click', () => {
        overlay.remove()
        try { openWhitelistLightbox() } catch (e) { console.error('Failed to open whitelist from settings', e) }
      })
    }
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove() }
    
    // Theme select wiring - attach immediately after DOM insertion
    const themeSelect = document.getElementById('optimando-theme-select') as HTMLSelectElement | null
    console.log('🎨 Theme select element found:', themeSelect)
    if (themeSelect) {
      // initialize from saved (keep default if none)
      try {
        const savedTheme = localStorage.getItem('optimando-ui-theme')
        console.log('🎨 Saved theme from localStorage:', savedTheme)
        if (savedTheme === 'dark' || savedTheme === 'professional') {
          themeSelect.value = savedTheme
        } else {
          themeSelect.value = 'default'
        }
        console.log('🎨 Theme select value set to:', themeSelect.value)
      } catch (error) {
        console.error('🎨 Error loading saved theme:', error)
      }

      function handleThemeChange() {
        const theme = themeSelect.value
        console.log('🎨 Theme changed to:', theme)
        try { 
          localStorage.setItem('optimando-ui-theme', theme) 
          try { chrome.storage?.local?.set({ 'optimando-ui-theme': theme }) } catch {}
          console.log('🎨 Theme saved to localStorage:', theme)
        } catch (error) {
          console.error('🎨 Error saving theme:', error)
        }
        
        // apply only to extension UIs
        if (theme === 'default') {
          try { 
            console.log('🎨 Applying default theme...')
            resetToDefaultTheme() 
          } catch (error) {
            console.error('🎨 Error applying default theme:', error)
          }
        } else {
          try { 
            console.log('🎨 Applying theme:', theme)
            applyTheme(theme) 
          } catch (error) {
            console.error('🎨 Error applying theme:', error, theme)
          }
        }

        // Notify other components (e.g., docked Command Chat) to re-style immediately
        try { window.dispatchEvent(new CustomEvent('optimando-theme-changed', { detail: { theme } })) } catch {}
      }

      themeSelect.addEventListener('change', handleThemeChange)
      themeSelect.addEventListener('click', () => {
        console.log('🎨 Theme select clicked!')
      })
      themeSelect.addEventListener('focus', () => {
        console.log('🎨 Theme select focused!')
      })
      console.log('🎨 Theme select event listener attached')
    }
    
    // API Keys helpers
    function loadApiKeys() {
      try {
        const raw = localStorage.getItem('optimando-api-keys')
        const data = raw ? JSON.parse(raw) : {}
        const setVal = (id: string, val: string) => {
          const el = document.getElementById(id) as HTMLInputElement | null
          if (el && typeof val === 'string') el.value = val
        }
        setVal('key-OpenAI', data.OpenAI || '')
        setVal('key-Claude', data.Claude || '')
        setVal('key-Gemini', data.Gemini || '')
        setVal('key-Grok', data.Grok || '')
      } catch {}
    }
    function saveApiKeys() {
      const getVal = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value || ''
      const data: any = {
        OpenAI: getVal('key-OpenAI'),
        Claude: getVal('key-Claude'),
        Gemini: getVal('key-Gemini'),
        Grok: getVal('key-Grok')
      }
      // Collect custom rows
      const container = document.getElementById('api-keys-container')
      if (container) {
        container.querySelectorAll('.api-key-row.custom').forEach(row => {
          const nameEl = row.querySelector('.api-name') as HTMLInputElement | null
          const valEl = row.querySelector('.api-value') as HTMLInputElement | null
          const key = (nameEl?.value || '').trim()
          const val = valEl?.value || ''
          if (key) data[key] = val
        })
      }
      try { localStorage.setItem('optimando-api-keys', JSON.stringify(data)) } catch {}
    }
    function wireApiKeyUI() {
      overlay.querySelectorAll('.toggle-visibility').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = (btn as HTMLElement).getAttribute('data-target') || ''
          const input = document.getElementById(target) as HTMLInputElement | null
          if (!input) return
          input.type = input.type === 'password' ? 'text' : 'password'
        })
      })
      const addBtn = document.getElementById('add-custom-api-key')
      if (addBtn) addBtn.addEventListener('click', () => {
        const container = document.getElementById('api-keys-container')
        if (!container) return
        const idSuffix = Math.random().toString(36).slice(2, 8)
        const row = document.createElement('div')
        row.className = 'api-key-row custom'
        row.style.display = 'grid'
        row.style.gridTemplateColumns = '80px 1fr 24px 24px'
        row.style.gap = '6px'
        row.style.alignItems = 'center'
        row.style.background = 'rgba(0,0,0,0.12)'
        row.style.padding = '6px'
        row.style.borderRadius = '6px'
        row.style.border = '1px solid rgba(255,255,255,0.18)'
        row.innerHTML = `
          <input class="api-name" placeholder="Name" style="background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: white; padding: 6px; border-radius: 4px; font-size: 10px;">
          <input class="api-value" type="password" id="key-custom-${idSuffix}" placeholder="key..." style="background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: white; padding: 6px; border-radius: 4px; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">
          <button class="toggle-visibility" data-target="key-custom-${idSuffix}" title="Show/Hide" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">👁️</button>
          <button class="remove-custom" title="Remove" style="background: rgba(244,67,54,0.5); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">✕</button>
        `
        container.appendChild(row)
        // hook up toggles and remove
        const vis = row.querySelector('.toggle-visibility') as HTMLElement
        vis?.addEventListener('click', () => {
          const input = document.getElementById(`key-custom-${idSuffix}`) as HTMLInputElement | null
          if (input) input.type = input.type === 'password' ? 'text' : 'password'
        })
        const rem = row.querySelector('.remove-custom') as HTMLElement
        rem?.addEventListener('click', () => row.remove())
      })
      const saveBtn = document.getElementById('save-api-keys')
      if (saveBtn) saveBtn.addEventListener('click', () => {
        // Block BYOK without subscription
        const notice = document.getElementById('byok-requirement') as HTMLElement | null
        const hasActive = (window as any).optimandoHasActiveSubscription === true
        if (!hasActive) {
          if (notice) notice.style.display = 'block'
          return
        }
        saveApiKeys()
      })
      loadApiKeys()
    }
    wireApiKeyUI()

    // Local LLMs + Finetuned (Pro-gated)
    function getLocalLLMOptionsHTML() {
      return (
        '<option value="" disabled selected>Select local model</option>'+
        '<optgroup label="Ollama">'+
          '<option value="ollama:llama3.1">llama3.1</option>'+
          '<option value="ollama:llama3.2">llama3.2</option>'+
          '<option value="ollama:phi3">phi3</option>'+
          '<option value="ollama:mistral">mistral</option>'+
          '<option value="ollama:neural-chat">neural-chat</option>'+
          '<option value="ollama:nemotron-9b">nemotron-9b</option>'+
          '<option value="ollama:qwen2.5:7b-instruct">qwen2.5-7b-instruct</option>'+
          '<option value="ollama:gptneox-20b">gpt-neox-20b</option>'+
        '</optgroup>'+
        '<optgroup label="llama.cpp">'+
          '<option value="llamacpp:llama3-8b-instruct">Llama 3 8B Instruct</option>'+
          '<option value="llamacpp:mixtral-8x7b-instruct">Mixtral 8x7B Instruct</option>'+
        '</optgroup>'
      )
    }
    function loadLocalLLMs() {
      try { return JSON.parse(localStorage.getItem('optimando-local-llms') || '[]') } catch { return [] }
    }
    function saveLocalLLMs(data: any[]) {
      try { localStorage.setItem('optimando-local-llms', JSON.stringify(data)) } catch {}
    }
    function renderLocalLLMs() {
      const container = document.getElementById('local-llms-container') as HTMLElement | null
      if (!container) return
      container.innerHTML = ''
      const items: any[] = loadLocalLLMs()
      items.forEach((it, idx) => {
        const row = document.createElement('div')
        row.className = 'local-llm-row'
        row.style.display = 'grid'
        row.style.gridTemplateColumns = '1fr 90px 24px'
        row.style.gap = '6px'
        row.style.alignItems = 'center'
        row.style.background = 'rgba(0,0,0,0.12)'
        row.style.padding = '6px'
        row.style.borderRadius = '6px'
        row.style.border = '1px solid rgba(255,255,255,0.18)'
        row.innerHTML = (
          '<select class="local-llm-select" style="width:100%; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.28); color: #0f172a; padding: 6px; border-radius: 4px; font-size: 10px;">'+
            getLocalLLMOptionsHTML()+
          '</select>'+
          '<button class="install-local-llm" style="background: #2563eb; border: none; color: white; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 10px;">'+(it.installed ? 'Installed ✓' : 'Install')+'</button>'+
          '<button class="remove-local-llm" title="Remove" style="background: rgba(244,67,54,0.5); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">✕</button>'
        )
        container.appendChild(row)
        const select = row.querySelector('.local-llm-select') as HTMLSelectElement
        if (select && it.value) select.value = it.value
        // Show white text for placeholder (no selection), dark text for chosen model
        if (select) {
          const applyPlaceholderColor = () => {
            const isPlaceholder = !select.value || select.value === ''
            select.style.color = isPlaceholder ? 'white' : '#0f172a'
          }
          select.addEventListener('change', applyPlaceholderColor)
          applyPlaceholderColor()
        }
        const installBtn = row.querySelector('.install-local-llm') as HTMLButtonElement
        const removeBtn = row.querySelector('.remove-local-llm') as HTMLButtonElement
        installBtn.disabled = !!it.installed
        installBtn.addEventListener('click', () => {
          const current = loadLocalLLMs()
          const currentRow = current[idx] || {}
          const val = (select?.value || '').trim()
          if (!val) { alert('Please select a local model to install.'); return }
          // Placeholder installation handler
          installBtn.textContent = 'Installing…'
          installBtn.disabled = true
          setTimeout(() => {
            currentRow.value = val
            currentRow.installed = true
            current[idx] = currentRow
            saveLocalLLMs(current)
            installBtn.textContent = 'Installed ✓'
          }, 500)
        })
        removeBtn.addEventListener('click', () => {
          const current = loadLocalLLMs()
          current.splice(idx, 1)
          saveLocalLLMs(current)
          renderLocalLLMs()
        })
        if (!it.value) {
          // ensure a default placeholder is selected statefully
          select.selectedIndex = 0
        }
      })
    }
    function addLocalLLMRow() {
      const items: any[] = loadLocalLLMs()
      items.push({ value: '', installed: false })
      saveLocalLLMs(items)
      renderLocalLLMs()
    }
    function wireLocalLLMsUI() {
      const addBtn = document.getElementById('add-local-llm-row')
      const saveBtn = document.getElementById('save-local-llms')
      addBtn?.addEventListener('click', addLocalLLMRow)
      saveBtn?.addEventListener('click', () => {
        // Persist current selections
        const container = document.getElementById('local-llms-container')
        if (!container) return
        const rows = Array.from(container.querySelectorAll('.local-llm-row'))
        const data = rows.map(row => {
          const select = row.querySelector('.local-llm-select') as HTMLSelectElement | null
          const btn = row.querySelector('.install-local-llm') as HTMLButtonElement | null
          return { value: (select?.value || '').trim(), installed: !!(btn && btn.textContent && btn.textContent.includes('Installed')) }
        }).filter(x => x.value)
        saveLocalLLMs(data)
      })
      // Initial render
      if (loadLocalLLMs().length === 0) addLocalLLMRow()
      else renderLocalLLMs()

      // Finetuned gating
      const hasActive = (window as any).optimandoHasActiveSubscription === true
      const badge = document.getElementById('finetuned-pro-badge') as HTMLElement | null
      const locked = document.getElementById('finetuned-locked') as HTMLElement | null
      const list = document.getElementById('finetuned-list') as HTMLElement | null
      if (badge) badge.style.display = hasActive ? 'none' : 'inline-block'
      if (locked) locked.style.display = hasActive ? 'none' : 'block'
      if (list) list.style.display = hasActive ? 'grid' : 'none'
      const unlockBtn = document.getElementById('unlock-finetuned')
      unlockBtn?.addEventListener('click', () => openBillingModal('subscription'))

      function loadFinetuned() { try { return JSON.parse(localStorage.getItem('optimando-finetuned-llms') || '[]') } catch { return [] } }
      function saveFinetuned(data: any[]) { try { localStorage.setItem('optimando-finetuned-llms', JSON.stringify(data)) } catch {} }
      function renderFinetuned() {
        const itemsRoot = document.getElementById('finetuned-items') as HTMLElement | null
        if (!itemsRoot) return
        itemsRoot.innerHTML = ''
        const items: any[] = loadFinetuned()
        items.forEach((it, idx) => {
          const row = document.createElement('div')
          row.style.display = 'grid'
          row.style.gridTemplateColumns = '1fr 1fr 24px'
          row.style.gap = '6px'
          row.style.alignItems = 'center'
          row.style.background = 'rgba(0,0,0,0.12)'
          row.style.padding = '6px'
          row.style.borderRadius = '6px'
          row.style.border = '1px solid rgba(255,255,255,0.18)'
          row.innerHTML = (
            '<input class="ft-name" placeholder="Name (e.g., support-bot-finetune)" style="background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: white; padding: 6px; border-radius: 4px; font-size: 10px;">'+
            '<input class="ft-base" placeholder="Base model (e.g., llama3.1)" style="background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.25); color: white; padding: 6px; border-radius: 4px; font-size: 10px;">'+
            '<button class="ft-remove" title="Remove" style="background: rgba(244,67,54,0.5); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px;">✕</button>'
          )
          itemsRoot.appendChild(row)
          const n = row.querySelector('.ft-name') as HTMLInputElement
          const b = row.querySelector('.ft-base') as HTMLInputElement
          const r = row.querySelector('.ft-remove') as HTMLButtonElement
          if (n) n.value = it.name || ''
          if (b) b.value = it.base || ''
          r.addEventListener('click', () => {
            const data = loadFinetuned()
            data.splice(idx, 1)
            saveFinetuned(data)
            renderFinetuned()
          })
          function saveDebounced() {
            const data = loadFinetuned()
            data[idx] = { name: n?.value || '', base: b?.value || '' }
            saveFinetuned(data)
          }
          n.addEventListener('input', saveDebounced)
          b.addEventListener('input', saveDebounced)
        })
      }
      const addFt = document.getElementById('add-finetuned-row')
      addFt?.addEventListener('click', () => {
        const data = loadFinetuned()
        data.push({ name: '', base: '' })
        saveFinetuned(data)
        renderFinetuned()
      })
      if (hasActive) {
        if ((loadFinetuned() as any[]).length === 0) {
          const data = [] as any[]; data.push({ name: '', base: '' }); saveFinetuned(data)
        }
        renderFinetuned()
      }
    }
    wireLocalLLMsUI()

    // Wire Billing buttons to placeholder modals
    const btnPAYG = document.getElementById('btn-payg')
    const btnSub = document.getElementById('btn-subscription')
    btnPAYG?.addEventListener('click', () => openBillingModal('payg'))
    btnSub?.addEventListener('click', () => openBillingModal('subscription'))

    function getModalThemeGradient() {
      // Always use default gradient for a consistent, professional look
      return 'linear-gradient(135deg,#667eea,#764ba2)'
    }
    function openBillingModal(kind: 'payg' | 'subscription') {
      const m = document.createElement('div')
      m.style.cssText = 'position:fixed;inset:0;background:'+getModalThemeGradient()+';z-index:2147483650;display:flex;align-items:center;justify-content:center;'
      const b = document.createElement('div')
      b.style.cssText = 'background:'+getModalThemeGradient()+';color:#fff;border-radius:12px;max-width:820px;width:92vw;max-height:80vh;overflow:auto;box-shadow:0 20px 40px rgba(0,0,0,.35)'
      if (kind === 'payg') {
        b.innerHTML = (
          '<div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.25);display:flex;justify-content:space-between;align-items:center">' +
            '<div style="font-weight:800">Pay-as-you-go</div>' +
            '<button id="billing-close" style="background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;padding:6px 8px;cursor:pointer">×</button>' +
          '</div>' +
          '<div style="padding:16px 18px;display:grid;gap:12px">' +
            '<div style="font-size:12px;line-height:1.6">Simple usage-based billing. Only pay for what you use. Top up balance and consume credits when using cloud AI models. Local LLM usage stays free.</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
              '<div style="background:rgba(0,0,0,.12);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:12px">' +
                '<div style="font-weight:700;font-size:12px;margin-bottom:6px">Load Balance</div>' +
                '<div style="font-size:11px;opacity:.9;margin-bottom:8px">Choose a quick top-up amount to add credits to your account.</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="quick-topup" data-amount="10" style="flex:1;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:8px 10px;font-size:11px;cursor:pointer">$10</button>' +
                  '<button class="quick-topup" data-amount="25" style="flex:1;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:8px 10px;font-size:11px;cursor:pointer">$25</button>' +
                  '<button class="quick-topup" data-amount="50" style="flex:1;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:8px 10px;font-size:11px;cursor:pointer">$50</button>' +
                  '<button class="quick-topup" data-amount="100" style="flex:1;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:8px 10px;font-size:11px;cursor:pointer">$100</button>' +
                '</div>' +
                '<div style="margin-top:8px;display:flex;gap:8px;align-items:center">' +
                  '<input id="custom-topup" type="number" min="10" step="1" placeholder="Custom amount (min $10)" style="flex:1;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);color:#fff;padding:8px;border-radius:6px;font-size:11px" />' +
                  '<button id="topup-now" style="background:#22c55e;border:0;color:#0b1e12;border-radius:6px;padding:8px 12px;font-size:11px;font-weight:700;cursor:pointer">Top up</button>' +
                '</div>' +
              '</div>' +
              '<div style="background:rgba(0,0,0,.12);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:12px">' +
                '<div style="font-weight:700;font-size:12px;margin-bottom:6px">Payment Method</div>' +
                '<div style="font-size:11px;opacity:.9;margin-bottom:8px">Select a payment method to use when adding balance.</div>' +
                '<div style="display:grid;gap:8px">' +
                  '<label style="display:flex;gap:8px;align-items:center;font-size:11px"><input type="radio" name="payg-method" checked> Credit / Debit Card</label>' +
                  '<label style="display:flex;gap:8px;align-items:center;font-size:11px"><input type="radio" name="payg-method"> PayPal</label>' +
                  '<label style="display:flex;gap:8px;align-items:center;font-size:11px"><input type="radio" name="payg-method"> Invoice (Business)</label>' +
                '</div>' +
                '<button style="margin-top:10px;width:100%;background:#2563eb;border:0;color:white;border-radius:6px;padding:8px 12px;font-size:11px;cursor:pointer">Continue</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        )
      } else {
        b.innerHTML = (
          '<div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.25);display:flex;justify-content:space-between;align-items:center">' +
            '<div style="font-weight:800">Subscription Plans</div>' +
            '<button id="billing-close" style="background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:6px;padding:6px 8px;cursor:pointer">×</button>' +
          '</div>' +
          '<div style="padding:16px 18px;display:grid;gap:12px">' +
            // Informational box about local LLMs and optional balance top-up
            '<div style="background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:10px;display:flex;gap:10px;align-items:flex-start">' +
              '<div style="font-size:18px">💡</div>' +
              '<div style="font-size:12px;line-height:1.55">Using local LLMs is free. You can optionally load balance to use powerful cloud AI on demand.</div>' +
            '</div>' +
            '<div id="agents-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">' +
              // Basic
              '<div style="background:rgba(0,0,0,.12);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);display:flex;flex-direction:column;height:100%">' +
                '<div style="font-weight:800;font-size:12px;margin-bottom:6px">Basic</div>' +
                '<div style="font-size:20px;font-weight:800;margin-bottom:6px">$0</div>' +
                '<ul style="margin:0 0 8px 16px;padding:0;font-size:11px;line-height:1.6;flex:1">' +
                  '<li>Unlimited WR Codes</li>' +
                  '<li>Unlimited local context (offline, private)</li>' +
                  '<li>WR Code account required</li>' +
                  '<li>Runs with local LLMs</li>' +
                  '<li style="color:#66FF66;list-style:\'✓ \';">Pay-as-you-go (Cloud)</li>' +
                '</ul>' +
                '<button style="width:100%;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:white;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;margin-top:auto">Choose Basic</button>' +
              '</div>' +
              // Private
              '<div style="background:rgba(0,0,0,.12);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);display:flex;flex-direction:column;height:100%">' +
                '<div style="font-weight:800;font-size:12px;margin-bottom:6px">Pro (Private)</div>' +
                '<div style="font-size:20px;font-weight:800;margin-bottom:6px">$29.95<span style="font-size:11px;opacity:.85">/year</span></div>' +
                '<ul style="margin:0 0 8px 16px;padding:0;font-size:11px;line-height:1.6;flex:1">' +
                  '<li>Unlimited WR Codes</li>' +
                  '<li>WR Code generation (non-commercial use)</li>' +
                  '<li>1 GB hosted context</li>' +
                  '<li>Hosted verification</li>' +
                  '<li>Basic analytics</li>' +
                  '<li style="color:#66FF66;list-style:\'✓ \';">BYOK or Pay-as-you-go</li>' +
                '</ul>' +
                '<button style="width:100%;background:#2563eb;border:0;color:white;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;margin-top:auto">Choose Private</button>' +
              '</div>' +
              // Publisher
              '<div style="background:rgba(255,255,255,.10);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,.22);position:relative;display:flex;flex-direction:column;height:100%">' +
                '<div style="position:absolute;top:-10px;right:10px;background:#22c55e;color:#0b1e12;border-radius:999px;padding:2px 8px;font-size:10px;font-weight:800">Solo Pro</div>' +
                '<div style="font-weight:800;font-size:12px;margin-bottom:6px">Publisher</div>' +
                '<div id="publisher-price" style="font-size:20px;font-weight:800;margin-bottom:6px">$9.95<span style="font-size:11px;opacity:.85">/month</span></div>' +
                '<div style="display:flex;gap:6px;margin-bottom:8px">' +
                  '<button id="publisher-annual" style="flex:1;background:#22c55e;border:0;color:#0b1e12;border-radius:6px;padding:4px 6px;font-size:10px;font-weight:700;cursor:pointer">Annual</button>' +
                  '<button id="publisher-monthly" style="flex:1;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:4px 6px;font-size:10px;cursor:pointer">Monthly</button>' +
                '</div>' +
                '<ul style="margin:0 0 8px 16px;padding:0;font-size:11px;line-height:1.6;flex:1">' +
                  '<li>Unlimited WR Codes</li>' +
                  '<li>WR Code generation (commercial use)</li>' +
                  '<li>5 GB hosted context</li>' +
                  '<li>Publisher branding</li>' +
                  '<li>Custom domain</li>' +
                  '<li>Advanced analytics</li>' +
                  '<li>Priority queue</li>' +
                  '<li style="color:#66FF66;list-style:\'✓ \';">BYOK or Pay-as-you-go</li>' +
                '</ul>' +
                '<button style="width:100%;background:#16a34a;border:0;color:white;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;font-weight:700;margin-top:auto">Choose Publisher</button>' +
              '</div>' +
              // Business/Enterprise
              '<div style="background:rgba(255,255,255,.10);padding:12px;border-radius:8px;border:1px solid rgba(255,255,255,.22);display:flex;flex-direction:column;height:100%">' +
                '<div style="font-weight:800;font-size:12px;margin-bottom:6px">Business/Enterprise</div>' +
                '<div id="enterprise-price" style="font-size:20px;font-weight:800;margin-bottom:6px">$59<span style="font-size:11px;opacity:.85">/month</span></div>' +
                '<div style="display:flex;gap:6px;margin-bottom:8px">' +
                  '<button id="enterprise-annual" style="flex:1;background:#22c55e;border:0;color:#0b1e12;border-radius:6px;padding:4px 6px;font-size:10px;font-weight:700;cursor:pointer">Annual</button>' +
                  '<button id="enterprise-monthly" style="flex:1;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:6px;padding:4px 6px;font-size:10px;cursor:pointer">Monthly</button>' +
                '</div>' +
                '<ul style="margin:0 0 8px 16px;padding:0;font-size:11px;line-height:1.6;flex:1">' +
                  '<li>&gt;5 employees</li>' +
                  '<li>Unlimited WR Codes</li>' +
                  '<li>WR Code generation (enterprise use)</li>' +
                  '<li>25 GB hosted context</li>' +
                  '<li>Multiple domains</li>' +
                  '<li>Team features & roles</li>' +
                  '<li>SSO/SAML, DPA</li>' +
                  '<li>SLA + dedicated support</li>' +
                  '<li style="color:#66FF66;list-style:\'✓ \';">BYOK or Pay-as-you-go</li>' +
                '</ul>' +
                '<button style="width:100%;background:#0ea5e9;border:0;color:white;border-radius:6px;padding:6px 10px;font-size:11px;cursor:pointer;margin-top:auto">Contact Sales</button>' +
              '</div>' +
            '</div>' +
            '<div style="font-size:11px;opacity:.9">🔑 BYOK Feature: Use your own API keys from OpenAI, Claude, Gemini, Grok, and more.</div>' +
          '</div>'
        )
      }
      m.appendChild(b)
      document.body.appendChild(m)
      const closeBtn = b.querySelector('#billing-close') as HTMLElement | null
      closeBtn?.addEventListener('click', () => m.remove())
      m.addEventListener('click', (e) => { if (e.target === m) m.remove() })

      // Wire Pay-as-you-go quick topups and custom amount validation
      const quickButtons = b.querySelectorAll('.quick-topup')
      const customInput = b.querySelector('#custom-topup') as HTMLInputElement | null
      const topupNow = b.querySelector('#topup-now') as HTMLButtonElement | null
      quickButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const amt = (btn as HTMLElement).getAttribute('data-amount') || '10'
          if (customInput) customInput.value = amt
        })
      })
      if (topupNow) {
        topupNow.addEventListener('click', () => {
          const value = parseFloat((customInput?.value || '0').replace(/[^0-9.]/g, ''))
          if (isNaN(value) || value < 10) {
            alert('Minimum top-up is $10')
            if (customInput) customInput.focus()
            return
          }
          alert(`✅ Top-up initialized: $${value.toFixed(2)}`)
        })
      }

      // Wire Publisher pricing toggle if present
      const priceEl = b.querySelector('#publisher-price') as HTMLElement | null
      const annualBtn = b.querySelector('#publisher-annual') as HTMLButtonElement | null
      const monthlyBtn = b.querySelector('#publisher-monthly') as HTMLButtonElement | null
      if (priceEl && annualBtn && monthlyBtn) {
        const setAnnual = () => {
          priceEl.innerHTML = '$9.95<span style="font-size:11px;opacity:.85">/month</span>'
          annualBtn.style.background = '#22c55e'
          annualBtn.style.color = '#0b1e12'
          annualBtn.style.border = '0'
          monthlyBtn.style.background = 'rgba(255,255,255,.15)'
          monthlyBtn.style.color = '#fff'
          monthlyBtn.style.border = '1px solid rgba(255,255,255,.3)'
        }
        const setMonthly = () => {
          priceEl.innerHTML = '$19.95<span style="font-size:11px;opacity:.85">/month</span>'
          monthlyBtn.style.background = '#2563eb'
          monthlyBtn.style.color = '#fff'
          monthlyBtn.style.border = '0'
          annualBtn.style.background = 'rgba(255,255,255,.15)'
          annualBtn.style.color = '#fff'
          annualBtn.style.border = '1px solid rgba(255,255,255,.3)'
        }
        annualBtn.addEventListener('click', setAnnual)
        monthlyBtn.addEventListener('click', setMonthly)
        setAnnual()
      }
      // Wire Enterprise pricing toggle if present
      const entPrice = b.querySelector('#enterprise-price') as HTMLElement | null
      const entAnnual = b.querySelector('#enterprise-annual') as HTMLButtonElement | null
      const entMonthly = b.querySelector('#enterprise-monthly') as HTMLButtonElement | null
      if (entPrice && entAnnual && entMonthly) {
        const setEntAnnual = () => {
          entPrice.innerHTML = '$59<span style="font-size:11px;opacity:.85">/month</span>'
          entAnnual.style.background = '#22c55e'
          entAnnual.style.color = '#0b1e12'
          entAnnual.style.border = '0'
          entMonthly.style.background = 'rgba(255,255,255,.15)'
          entMonthly.style.color = '#fff'
          entMonthly.style.border = '1px solid rgba(255,255,255,.3)'
        }
        const setEntMonthly = () => {
          entPrice.innerHTML = '$99<span style="font-size:11px;opacity:.85">/month</span>'
          entMonthly.style.background = '#0ea5e9'
          entMonthly.style.color = '#fff'
          entMonthly.style.border = '0'
          entAnnual.style.background = 'rgba(255,255,255,.15)'
          entAnnual.style.color = '#fff'
          entAnnual.style.border = '1px solid rgba(255,255,255,.3)'
        }
        entAnnual.addEventListener('click', setEntAnnual)
        entMonthly.addEventListener('click', setEntMonthly)
        setEntAnnual()
      }
    }

    // Add event handler for display port configuration
    document.getElementById('configure-display-ports').onclick = () => {
      openDisplayPortsConfig(overlay)
    }

  }
  // Legacy code continues below

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
    document.getElementById('close-hybrid-select').onclick = close
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
    document.getElementById('hybrid-count').addEventListener('change', updateUrlFields)

    document.getElementById('hybrid-save-open').onclick = () => {
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
      
      // SIMPLIFIED SESSION UPDATE - Use active session key directly
      console.log('🔄 UPDATING SESSION WITH DISPLAY GRIDS...')
      let activeSessionKey = getCurrentSessionKey()
      
      if (!activeSessionKey) {
        // Create new session if none exists
        activeSessionKey = `session_${Date.now()}`
        setCurrentSessionKey(activeSessionKey)
        console.log('🆕 Created new session for display grids:', activeSessionKey)
      }
      // Load the active session and update it
      chrome.storage.local.get([activeSessionKey], (result) => {
        let sessionData = result[activeSessionKey] || {
          ...currentTabData,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          isLocked: true
        }
        
        // Update session with new displayGrids
        sessionData.displayGrids = currentTabData.displayGrids
        sessionData.timestamp = new Date().toISOString()
        
        console.log('💾 Saving session with', sessionData.displayGrids.length, 'display grids')
        
        chrome.storage.local.set({ [activeSessionKey]: sessionData }, () => {
          if (chrome.runtime.lastError) {
            console.error('❌ Failed to save session:', chrome.runtime.lastError)
          } else {
            console.log('✅ Session updated with display grids:', activeSessionKey)
            
            // Show success feedback
            const note = document.createElement('div')
            note.textContent = '✅ Display grids added to session'
            note.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#4CAF50;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
            document.body.appendChild(note)
            setTimeout(() => note.remove(), 3000)
          }
        })
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
    console.log('🔍 DEBUG: currentTabData.displayGrids at grid open:', currentTabData.displayGrids)
    
    // Get current theme
    const currentTheme = localStorage.getItem('optimando-ui-theme') || 'default'
    console.log('🎨 DEBUG: Current theme for grid:', currentTheme)
    console.log('🎨 DEBUG: Theme value from localStorage:', localStorage.getItem('optimando-ui-theme'))
    console.log('🎨 DEBUG: Theme will be passed to createGridHTML:', currentTheme)
    
    // CRITICAL: Ensure we have displayGrids data before creating HTML
    if (currentTabData.displayGrids) {
      const gridEntry = currentTabData.displayGrids.find(g => g.layout === layout)
      if (gridEntry && (gridEntry as any).config) {
        console.log('✅ Found grid config for', layout, ':', (gridEntry as any).config)
        console.log('✅ Grid has', Object.keys((gridEntry as any).config.slots || {}).length, 'configured slots')
      } else {
        console.log('❌ No grid config found for', layout)
      }
    } else {
      console.log('❌ No displayGrids in currentTabData')
    }
    
    // Create the complete HTML content for the new tab
    console.log('🎨 DEBUG: Creating grid HTML with theme:', currentTheme)
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
        // Always try to bind edit-slot handlers even if there's no save button in this template
        try {
          const bindEditHandlers = () => {
            try {
              const editButtons = Array.from(doc.querySelectorAll('.edit-slot')) as HTMLElement[]
              editButtons.forEach((eb: any) => {
                if (eb._optimandoEditBound) return
                eb._optimandoEditBound = true
                eb.addEventListener('click', (ev: any) => {
                  try { ev.preventDefault(); ev.stopPropagation() } catch {}
                  const sid = eb.getAttribute('data-slot-id') || ''
                  const invoke = () => {
                    const fn = (gridWindow as any).openGridSlotEditor
                    if (typeof fn === 'function') {
                      try { fn(sid) } catch (e) { console.error('❌ openGridSlotEditor failed:', e) }
                    } else {
                      setTimeout(invoke, 150)
                    }
                  }
                  invoke()
                })
              })
            } catch {}
          }
          bindEditHandlers()
          setTimeout(bindEditHandlers, 500)
        } catch {}

        const btn = doc && doc.getElementById('save-grid-btn')
        if (!btn) {
          // No save button present; we've still bound edit handlers above. Keep polling for future elements.
          setTimeout(tryAttach, 400)
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
        // Bind edit-slot buttons to open the slot editor even if inline onclick fails
        try {
          const bindEditHandlers = () => {
            try {
              const editButtons = Array.from(doc.querySelectorAll('.edit-slot')) as HTMLElement[]
              editButtons.forEach((eb: any) => {
                if (eb._optimandoEditBound) return
                eb._optimandoEditBound = true
                eb.addEventListener('click', (ev: any) => {
                  try { ev.preventDefault(); ev.stopPropagation() } catch {}
                  const sid = eb.getAttribute('data-slot-id') || ''
                  const invoke = () => {
                    const fn = (gridWindow as any).openGridSlotEditor
                    if (typeof fn === 'function') {
                      try { fn(sid) } catch (e) { console.error('❌ openGridSlotEditor failed:', e) }
                    } else {
                      setTimeout(invoke, 150)
                    }
                  }
                  invoke()
                })
              })
            } catch {}
          }
          bindEditHandlers()
          setTimeout(bindEditHandlers, 500)
        } catch {}
      } catch (e) {
        setTimeout(tryAttach, 150)
      }
    }
    tryAttach()
  }

  function persistGridConfig(config: { layout: string, sessionId: string, slots: any }) {
    console.log('💾 GLOBAL SESSION PERSIST: Grid config save started')
    console.log('💾 Config:', config)
    
    // STEP 1: Get or create active session
    let activeSessionKey = getCurrentSessionKey()
    if (!activeSessionKey) {
      activeSessionKey = `session_${Date.now()}`
      setCurrentSessionKey(activeSessionKey)
      console.log('🔧 Created new session for grid persistence:', activeSessionKey)
    } else {
      console.log('🔧 Using existing session:', activeSessionKey)
    }
    
    // STEP 2: Load ALL sessions to find and update the correct one
    chrome.storage.local.get(null, (allData) => {
      console.log('📊 LOADING ALL SESSIONS FOR UPDATE')
      
      // Find the target session
      let sessionData = allData[activeSessionKey]
      if (!sessionData) {
        // Create new session if it doesn't exist
        sessionData = {
          ...currentTabData,
          timestamp: new Date().toISOString(),
          url: window.location.href,
          isLocked: true,
          displayGrids: []
        }
        console.log('🆕 Created new session data')
      }
      
      // STEP 3: Initialize displayGrids array if needed
      if (!sessionData.displayGrids) {
        sessionData.displayGrids = []
        console.log('🔧 Initialized displayGrids array')
      }
      
      // STEP 4: Find or create the grid entry
      let gridEntry = sessionData.displayGrids.find(g => g.layout === config.layout)
      if (!gridEntry) {
        gridEntry = {
          layout: config.layout,
          sessionId: config.sessionId,
          url: 'about:blank',
          timestamp: new Date().toISOString()
        }
        sessionData.displayGrids.push(gridEntry)
        console.log('✅ Added new grid entry:', config.layout)
      } else {
        console.log('✅ Found existing grid entry:', config.layout)
      }
      
      // STEP 5: Update the grid configuration
      gridEntry.config = {
        layout: config.layout,
        sessionId: config.sessionId,
        slots: config.slots
      }
      gridEntry.timestamp = new Date().toISOString()
      
      console.log('📊 FINAL SESSION DISPLAYGRIDS:', sessionData.displayGrids)
      console.log('📊 GRID CONFIG SLOTS:', Object.keys(config.slots).length)
      
      // STEP 6: Save the complete session back to storage
      const finalSessionData = {
        ...sessionData,
        displayGrids: sessionData.displayGrids,
        timestamp: new Date().toISOString(),
        isLocked: true
      }
      
      chrome.storage.local.set({ [activeSessionKey]: finalSessionData }, () => {
        if (chrome.runtime.lastError) {
          console.error('❌ FAILED TO SAVE SESSION:', chrome.runtime.lastError)
        } else {
          console.log('🎯 SUCCESS: Grid config saved to GLOBAL session:', activeSessionKey)
          console.log('🎯 Session now contains', finalSessionData.displayGrids.length, 'display grids')
          
          // Update local currentTabData to stay in sync
          currentTabData.displayGrids = sessionData.displayGrids
          saveTabDataToStorage()
          
          // Show success feedback
          const note = document.createElement('div')
          note.textContent = '✅ Grid config saved to session history'
          note.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#4CAF50;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
          document.body.appendChild(note)
          setTimeout(() => note.remove(), 3000)
        }
      })
    })
  }
  // Check chrome.storage.local for grid saves
  let lastGridSaveCheck = 0
  setInterval(() => {
    try {
      chrome.storage.local.get(['optimando_last_grid_save'], (result) => {
        const saveInfo = result.optimando_last_grid_save
        if (!saveInfo || saveInfo.timestamp <= lastGridSaveCheck) return
        
        lastGridSaveCheck = saveInfo.timestamp
        console.log('📥 Detected grid save:', saveInfo.key)
        
        // Get the actual grid data
        chrome.storage.local.get([saveInfo.key], (gridResult) => {
          const payload = gridResult[saveInfo.key]
          if (!payload) return
          console.log('💾 Grid config received:', payload)
          
          // Store in currentTabData
          if (!currentTabData.displayGrids) currentTabData.displayGrids = []
          let entry = currentTabData.displayGrids.find(g => g.layout === payload.layout)
          if (!entry) {
            entry = { 
              layout: payload.layout, 
              sessionId: payload.sessionId || Date.now().toString(), 
              url: '', 
              timestamp: new Date().toISOString() 
            } as any
            currentTabData.displayGrids.push(entry)
          }
          ;(entry as any).config = payload
          
          // Save to current session
          saveTabDataToStorage()
          
          // Create session if needed and save
          let sessionKey = getCurrentSessionKey()
          if (!sessionKey) {
            sessionKey = `session_${Date.now()}`
            currentTabData.isLocked = true
            setCurrentSessionKey(sessionKey)
            console.log('🔧 Created session for grid save:', sessionKey)
          }
          
          // First get the existing session data to merge with
          chrome.storage.local.get([sessionKey], (result) => {
            const existingSession = result[sessionKey] || {}
            
            // Merge displayGrids into the session
            const sessionData = {
              ...existingSession,
              ...currentTabData,
              displayGrids: currentTabData.displayGrids,
              timestamp: new Date().toISOString(),
              url: existingSession.url || window.location.href, // Keep original URL
              isLocked: true
            }
            
            chrome.storage.local.set({ [sessionKey]: sessionData }, () => {
              console.log('✅ Grid config saved to session:', sessionKey)
              console.log('✅ Session now contains displayGrids:', sessionData.displayGrids)
            
              // Show success feedback
              const note = document.createElement('div')
              note.textContent = '✅ Grid config saved to session'
              note.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#4CAF50;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
              document.body.appendChild(note)
              setTimeout(() => note.remove(), 2500)
            })
          })
        })
      })
    } catch (e) {
      console.log('Error checking grid saves:', e)
    }
  }, 1000)
  
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
    const activeSessionKeyForGrid = (typeof getCurrentSessionKey === 'function' ? (getCurrentSessionKey() || '') : '')

    // Prefill from currentTabData if a config exists
    console.log('🔍 DEBUG: createGridHTML - currentTabData.displayGrids:', currentTabData.displayGrids)
    console.log('🔍 DEBUG: createGridHTML - looking for sessionId:', sessionId, 'layout:', layout)
    
    // Look for entry by layout only, since sessionId might be different when loading from history
    const entry = (currentTabData && currentTabData.displayGrids)
      ? currentTabData.displayGrids.find(g => g.layout === layout)
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
      
      // Log what we're loading for this slot
      if (savedSlots[String(slotNum)]) {
        console.log(`🔍 DEBUG: Slot ${slotNum} saved config:`, savedSlots[String(slotNum)])
      }
      
      const savedTitle = (savedSlots[String(slotNum)] && savedSlots[String(slotNum)].title) ? savedSlots[String(slotNum)].title : `Display Port ${slotNum}`
      const savedAgent = (savedSlots[String(slotNum)] && savedSlots[String(slotNum)].agent) ? savedSlots[String(slotNum)].agent : ''
      const savedProvider = (savedSlots[String(slotNum)] && savedSlots[String(slotNum)].provider) ? savedSlots[String(slotNum)].provider : ''
      const savedModel = (savedSlots[String(slotNum)] && savedSlots[String(slotNum)].model) ? savedSlots[String(slotNum)].model : ''
      const agentNumForAB = savedAgent ? savedAgent.replace('agent', '').padStart(2, '0') : ''
      const abCode = `AB${String(slotNum).padStart(2, '0')}${agentNumForAB}`
      let displayParts = [savedTitle]
      if (savedModel && savedModel !== 'auto') {
        displayParts.push(savedModel)
      } else if (savedProvider) {
        displayParts.push(savedProvider)
      }
      const displayText = displayParts.join(' · ')
      
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
        headerColor = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' // updated dark gradient
        textColor = '#e5e7eb'
        inputBg = 'rgba(255,255,255,0.06)'
        inputBorder = 'rgba(255,255,255,0.14)'
        slotBg = 'rgba(255,255,255,0.06)'
      } else if (theme === 'professional') {
        headerColor = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)' // professional light gradient
        textColor = '#1e293b'
        inputBg = 'rgba(255,255,255,0.8)'
        inputBorder = 'rgba(0,0,0,0.2)'
        slotBg = 'white'
      }
      
      console.log(`🔍 DEBUG: Slot ${slotNum} display:`, { abCode, displayText, savedAgent, savedProvider, savedModel })
      console.log(`🎨 DEBUG: Slot ${slotNum} theme colors:`, { headerColor, textColor, slotBg, theme })
      
      slotsHTML += `
        <div data-slot-id="${slotNum}" data-slot-config='${JSON.stringify({ title: savedTitle, agent: savedAgent, provider: savedProvider, model: savedModel })}' style="background: ${slotBg} !important; border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); ${gridRowStyle}">
          <div style="background: ${headerColor}; padding: 6px 8px; font-size: 11px; display: flex; justify-content: space-between; align-items: center; border-radius: 8px 8px 0 0; min-height: 32px; flex-shrink: 0;">
            <div style="display: flex; align-items: center; color: ${textColor}; font-weight: bold; min-width: 0; flex: 1;">
              <span style="margin-right: 4px; white-space: nowrap; font-family: monospace; font-size: 10px;">${abCode}</span>
              <span style="margin-right: 4px;">🖥️</span>
              <span class="slot-display-text" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px;">${displayText}</span>
            </div>
            <div style="display: flex; align-items: center; flex-shrink: 0; gap: 4px;">
              <button class="edit-slot" data-slot-id="${slotNum}" title="Setup Agent Box" onclick="if(window.openGridSlotEditor) window.openGridSlotEditor('${slotNum}'); else console.log('❌ openGridSlotEditor not found');" style="background: ${theme === 'professional' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'}; border: none; color: ${textColor}; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;">✏️</button>
              <button class="close-slot" style="background: ${theme === 'professional' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'}; border: none; color: ${textColor}; width: 18px; height: 18px; border-radius: 50%; cursor: pointer; font-size: 10px; font-weight: bold; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">×</button>
            </div>
          </div>
          <div style="flex: 1; display: flex; align-items: center; justify-content: center; font-size: 14px; color: ${theme === 'dark' ? '#e5e7eb' : (theme === 'professional' ? '#1e293b' : '#333')}; text-align: center; padding: 16px; background: ${slotBg} !important; min-height: 0;">
          </div>
        </div>
      `
    }
    
    // Attach tool lightbox handlers after slots are rendered
    setTimeout(() => {
      document.querySelectorAll('.slot-add-tool')?.forEach(btn => {
        btn.addEventListener('click', (e:any) => {
          const slotId = (e.currentTarget as HTMLElement).getAttribute('data-slot-id') || ''
          openToolLibraryLightbox(slotId)
        })
      })
    }, 0)

    // Theme background/text for page
    let bodyBg = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    let bodyText = '#ffffff'
    let actionBtnBg = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    let actionBtnText = '#ffffff'
    console.log('🎨 DEBUG: Applying theme:', theme)
    console.log('🎨 DEBUG: Theme parameter received:', theme, typeof theme)
    
    if (theme === 'dark') {
      bodyBg = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
      bodyText = '#e5e7eb'
      actionBtnBg = 'rgba(255,255,255,0.15)'
      actionBtnText = '#e5e7eb'
      console.log('🎨 Applied dark theme - bodyBg:', bodyBg)
    } else if (theme === 'professional') {
      bodyBg = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
      bodyText = '#333333'
      actionBtnBg = 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)'
      actionBtnText = '#ffffff'
      console.log('🎨 Applied professional theme - bodyBg:', bodyBg)
    } else if (theme === 'default') {
      bodyBg = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      bodyText = '#ffffff'
      actionBtnBg = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      actionBtnText = '#ffffff'
      console.log('🎨 Applied default theme - bodyBg:', bodyBg)
    }
    
  ;(window as any).openToolLibraryLightbox = function(slotId: string){
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:2147483647;display:flex;align-items:center;justify-content:center'
    overlay.onclick = (e:any)=>{ if (e.target === overlay) overlay.remove() }

    // demo tool data
    const tools = [
      { id:'web-search', name:'Web Search', desc:'Search the web with Bing/Google', cat:'Information' },
      { id:'summarizer', name:'Text Summarizer', desc:'Summarize selected content', cat:'NLP' },
      { id:'screenshot', name:'Screenshot', desc:'Capture visible area', cat:'Utility' },
      { id:'translate', name:'Translate', desc:'Translate text to target language', cat:'NLP' },
    ]

    const panel = document.createElement('div')
    panel.style.cssText = 'width:720px;max-width:92vw;max-height:82vh;overflow:auto;background:#0b1220;color:#e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4)'
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)">
        <div style="font-weight:700">Add Tools to Agent Box ${slotId}</div>
        <div><button id="tl-close" style="padding:6px 10px;background:#475569;border:none;color:#e2e8f0;border-radius:6px;cursor:pointer">Close</button></div>
      </div>
      <div style="padding:12px 14px;display:flex;gap:10px;align-items:center">
        <input id="tl-search" placeholder="Search tools..." style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#0f172a;color:#e2e8f0" />
      </div>
      <div id="tl-list" style="padding:8px 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        <div style="grid-column:1/-1;opacity:.7;font-size:12px">No tools yet. Use search to browse the catalog (coming soon).</div>
      </div>
    `
    overlay.appendChild(panel)
    document.body.appendChild(overlay)

    function render(list:any[]){
      const el = panel.querySelector('#tl-list') as HTMLElement
      el.innerHTML = list.map(t => `
        <div data-id="${t.id}" style="background:#111827;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:6px">
          <div style="font-weight:700">${t.name}</div>
          <div style="font-size:12px;opacity:.8">${t.desc}</div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:11px;opacity:.7">${t.cat}</span>
            <button class="tl-add" data-id="${t.id}" style="padding:6px 10px;background:#22c55e;border:none;color:#07210f;border-radius:6px;cursor:pointer;font-weight:700">Add</button>
          </div>
        </div>
      `).join('')
      ;(panel.querySelectorAll('.tl-add') as any).forEach((btn:HTMLElement)=>{
        btn.onclick = ()=>{
          const id = btn.getAttribute('data-id') || ''
          try {
            const key = `agent-tools:${slotId}`
            const current = JSON.parse(localStorage.getItem(key) || '[]')
            if (!current.includes(id)) current.push(id)
            localStorage.setItem(key, JSON.stringify(current))
          } catch {}
          btn.textContent = 'Added'
          btn.setAttribute('disabled','true')
        }
      })
    }

    render(tools)
    const search = panel.querySelector('#tl-search') as HTMLInputElement
    search.oninput = ()=>{
      const q = search.value.toLowerCase()
      render(tools.filter(t => t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)))
    }

    ;(panel.querySelector('#tl-close') as HTMLButtonElement).onclick = ()=> overlay.remove()
  }

    console.log('🎨 DEBUG: Final theme colors:', { bodyBg, bodyText, actionBtnBg, actionBtnText })
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
        
        <!-- Control Buttons Container (no Save Grid per spec) -->
        <div style="
          position: fixed;
          bottom: 20px;
          right: 20px;
          display: flex;
          gap: 10px;
          z-index: 1000;
        ">
          <!-- Fullscreen Button -->
          <button id="fullscreen-btn" style="
            width: 48px;
            height: 48px;
            background: ${actionBtnBg};
            border: none;
            color: ${actionBtnText};
            border-radius: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
            transition: all 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          " title="Fullscreen" onclick="toggleFullscreen()">
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
        <!-- Pass data to grid-script.js via data attributes on script -->
        <script src="${chrome.runtime.getURL('grid-script.js')}" data-session-id="${sessionId}" data-layout="${layout}" data-session-key="${activeSessionKeyForGrid}" id="grid-script"></script>
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
    
    // Show loading state immediately
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; max-width: 900px; height: 85vh; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;">
        <div style="text-align: center;">
          <div style="font-size: 24px; margin-bottom: 10px;">⏳</div>
          <div style="font-size: 16px;">Loading sessions...</div>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    
    // Get saved sessions from chrome.storage.local
    chrome.storage.local.get(null, (allData) => {
      console.log('📋 Loading sessions from storage, total keys:', Object.keys(allData).length)
      
      const activeSessionKey = getCurrentSessionKey()
      const sessions = Object.entries(allData)
        .filter(([key]) => key.startsWith('session_'))
        .map(([key, data]) => ({ id: key, ...data, isActive: key === activeSessionKey }))
        .sort((a, b) => {
          // Active session always first
          if (a.isActive) return -1
          if (b.isActive) return 1
          // Then sort by timestamp
          return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
        })
      
      console.log('📋 Found sessions:', sessions.map(s => ({
        id: s.id,
        tabName: s.tabName,
        timestamp: s.timestamp,
        isLocked: s.isLocked,
        hasDisplayGrids: !!s.displayGrids?.length
      })))
      
      const generateSessionsHTML = () => {
        if (sessions.length === 0) {
          return '<div style="text-align: center; padding: 40px; opacity: 0.7;"><p>No saved sessions found</p></div>'
        }
        
                return sessions.map(session => `
          <div style="margin-bottom: 16px;">
            <!-- Session title outside the box -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; padding: 0 4px;">
              <h4 style="margin: 0; font-size: 16px; font-weight: bold; color: #FFEF94; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${session.tabName || 'Unnamed Session'}${session.isActive ? ' <span style="background: #4CAF50; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; margin-left: 8px;">ACTIVE</span>' : ''}</h4>
              <div style="display: flex; gap: 6px;">
                <button class="rename-session-btn" data-session-id="${session.id}" style="background: linear-gradient(135deg, #2196F3, #1976D2); border: none; color: white; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; transition: all 0.2s ease;" title="Rename session" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">✏️</button>
                <button class="agentbox-overview-btn" data-session-id="${session.id}" style="background: linear-gradient(135deg, #10b981, #059669); border: none; color: white; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; transition: all 0.2s ease;" title="Agent Box Overview" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">📦</button>
                <button class="delete-session-btn" data-session-id="${session.id}" style="background: linear-gradient(135deg, #f44336, #d32f2f); border: none; color: white; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; transition: all 0.2s ease;" title="Delete session" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">🗑️</button>
        </div>
            </div>
            <!-- Session box with content -->
            <div class="session-item" data-session-id="${session.id}" style="background: ${session.isActive ? 'linear-gradient(135deg, rgba(76,175,80,0.25) 0%, rgba(76,175,80,0.15) 100%)' : 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)'}; border-radius: 12px; padding: 14px; cursor: pointer; transition: all 0.3s ease; border: 2px solid ${session.isActive ? 'rgba(76,175,80,0.5)' : 'transparent'}; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" onmouseover="this.style.borderColor='${session.isActive ? 'rgba(76,175,80,0.8)' : 'rgba(255,255,255,0.4)'}'; this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(0,0,0,0.2)'" onmouseout="this.style.borderColor='${session.isActive ? 'rgba(76,175,80,0.5)' : 'transparent'}'; this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.1)'">
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
      
      // Add direct event listeners to agent box overview buttons
      overlay.querySelectorAll('.agentbox-overview-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          const sessionId = btn.getAttribute('data-session-id')
          console.log('📦 Direct click handler - Agent Box Overview for session:', sessionId)
          if (sessionId) {
            overlay.remove()
            setTimeout(() => openAgentBoxOverview(sessionId), 100)
          }
        })
      })
      
      // Session click handlers - make entire session clickable
      overlay.querySelectorAll('.session-item').forEach(sessionEl => {
        sessionEl.addEventListener('click', (e) => {
          // Don't trigger if clicking on action buttons
          if (e.target.classList.contains('rename-session-btn') || 
              e.target.classList.contains('delete-session-btn') ||
              e.target.classList.contains('agentbox-overview-btn')) {
            
            // Handle Agent Box Overview button
            if (e.target.classList.contains('agentbox-overview-btn')) {
              e.stopPropagation()
              const sessionId = sessionEl.dataset.sessionId
              console.log('📦 Agent Box Overview clicked for session:', sessionId)
              if (sessionId) {
                overlay.remove() // Close sessions lightbox first
                setTimeout(() => openAgentBoxOverview(sessionId), 100) // Small delay after overlay removal
              }
            }
            return
          }
          
          const sessionId = sessionEl.dataset.sessionId
          const sessionData = sessions.find(s => s.id === sessionId)
          
          if (sessionData) {
            console.log('🔧 DEBUG: Session data:', sessionData)
            console.log('🔧 DEBUG: Helper tabs data:', sessionData.helperTabs)
            
            // Close overlay immediately to preserve user gesture for window.open
            try { overlay.remove() } catch {}
            
            // Persist active session key globally and in this tab
            setCurrentSessionKey(sessionId)

            // CRITICAL: Restore session data to currentTabData IMMEDIATELY before any window.open
            currentTabData = {
              ...currentTabData,
              ...sessionData,
              tabId: currentTabData.tabId,  // Keep current tab ID
              isLocked: true  // Ensure session is marked as locked when restored
            }
            
            // Save restored data to localStorage to persist it
            saveTabDataToStorage()
            
            console.log('🔧 DEBUG: Session data restored to currentTabData BEFORE opening windows')
            console.log('🔧 DEBUG: currentTabData.displayGrids:', currentTabData.displayGrids)

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
              
              // Session data already restored above - just log status
              
              console.log('🔧 DEBUG: Session restored - currentTabData.agentBoxes:', currentTabData.agentBoxes)
              console.log('🔧 DEBUG: Session restored - currentTabData.context:', currentTabData.context)
              console.log('🔧 DEBUG: Session restored - currentTabData.displayGrids:', currentTabData.displayGrids)
              console.log('🔧 DEBUG: Session restored - currentTabData.isLocked:', currentTabData.isLocked)
              
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
                console.log('🔧 DEBUG: Session displayGrids have configs:', sessionData.displayGrids.map(g => ({ 
                  layout: g.layout, 
                  hasConfig: !!(g as any).config,
                  slotCount: (g as any).config ? Object.keys((g as any).config.slots || {}).length : 0
                })))
                
                // currentTabData already has displayGrids from the restore above
                console.log('🔧 DEBUG: Using currentTabData.displayGrids:', currentTabData.displayGrids)
                console.log('🔧 DEBUG: currentTabData.displayGrids details:', currentTabData.displayGrids.map(g => ({
                  layout: g.layout,
                  hasConfig: !!(g as any).config,
                  configSlots: (g as any).config ? (g as any).config.slots : null
                })))
                
                sessionData.displayGrids.forEach((grid, index) => {
                  console.log('🔧 DEBUG: Opening display grid ' + (index + 1) + ':', grid.layout)
                  console.log('🔧 DEBUG: Grid config:', (grid as any).config)
                  
                  // CRITICAL: Ensure grid config is available in currentTabData BEFORE opening
                  if (!currentTabData.displayGrids) currentTabData.displayGrids = []
                  let existingEntry = currentTabData.displayGrids.find(g => g.layout === grid.layout)
                  
                  if (!existingEntry) {
                    // Add the complete grid entry with config
                    currentTabData.displayGrids.push({
                      ...grid,
                      config: (grid as any).config
                    })
                    console.log('✅ Added complete grid entry to currentTabData:', grid.layout)
                  } else if (!(existingEntry as any).config && (grid as any).config) {
                    // Update existing entry with config
                    (existingEntry as any).config = (grid as any).config
                    console.log('✅ Updated existing grid entry with config:', grid.layout)
                  }
                  
                  if ((grid as any).config && (grid as any).config.slots) {
                    console.log('✅ Grid has', Object.keys((grid as any).config.slots).length, 'configured slots')
                  } else {
                    console.log('⚠️ Grid has no config or slots:', grid.layout)
                  }
                  
                  // Add delay to ensure data is available
                  setTimeout(() => {
                    try {
                      openGridFromSession(grid.layout, grid.sessionId)
                      console.log(`✅ Successfully opened display grid ${index + 1}:`, grid.layout)
                    } catch (error) {
                      console.error(`❌ Failed to open display grid ${index + 1}:`, error)
                    }
                  }, index * 100) // Small delay between grids
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
              // Session data already restored above - just log
              
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
        console.log('🗑️ CLEAR ALL SESSIONS - Starting complete cleanup')
        if (confirm('⚠️ This will delete ALL session history permanently.\n\nThis includes:\n• All master tab configurations\n• All display grid configurations\n• All web sources\n• All saved contexts\n\nAre you sure?')) {
          
          // NUCLEAR OPTION: Clear everything
          console.log('🚀 NUCLEAR CLEAR: Removing all Optimando data')
          
          // Clear ALL chrome.storage.local
          chrome.storage.local.clear(() => {
            if (chrome.runtime.lastError) {
              console.error('❌ Error clearing chrome storage:', chrome.runtime.lastError)
              alert('Failed to clear sessions: ' + chrome.runtime.lastError.message)
            } else {
              console.log('✅ ALL chrome.storage.local cleared')
              
              // Clear localStorage
              const localKeys = Object.keys(localStorage).filter(key => key.toLowerCase().includes('optimando'))
              localKeys.forEach(key => localStorage.removeItem(key))
              console.log('✅ Cleared', localKeys.length, 'localStorage items')
              
              // Clear sessionStorage
              const sessionKeys = Object.keys(sessionStorage).filter(key => key.toLowerCase().includes('optimando'))
              sessionKeys.forEach(key => sessionStorage.removeItem(key))
              console.log('✅ Cleared', sessionKeys.length, 'sessionStorage items')
              
              // Reset currentTabData
              if (typeof currentTabData !== 'undefined') {
                currentTabData.displayGrids = []
                currentTabData.helperTabs = null
                currentTabData.isLocked = false
              }
              
              overlay.remove()
              
              // Show success message
              const successNote = document.createElement('div')
              successNote.textContent = '🎯 ALL SESSIONS CLEARED - Complete cleanup done!'
              successNote.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#4CAF50;color:#fff;padding:12px 16px;border-radius:8px;font-size:13px;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
              document.body.appendChild(successNote)
              setTimeout(() => {
                successNote.remove()
                // Suggest reload
                const reloadNote = document.createElement('div')
                reloadNote.textContent = '💡 Reload the page to start fresh'
                reloadNote.style.cssText = `position:fixed;top:20px;right:20px;z-index:2147483650;background:#2196F3;color:#fff;padding:10px 14px;border-radius:8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3)`
                document.body.appendChild(reloadNote)
                setTimeout(() => reloadNote.remove(), 5000)
              }, 3000)
            }
          })
        }
      }
    })
  }

  function openAgentBoxOverview(sessionKey: string) {
    console.log('📦 Opening Agent Box Overview for session:', sessionKey)
    
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 2147483650;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    // Show loading state
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #1f2937 0%, #111827 100%); border-radius: 16px; padding: 40px; color: white; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 10px;">⏳</div>
        <div>Loading agent boxes...</div>
      </div>
    `
    
    document.body.appendChild(overlay)
    console.log('📦 Overlay created and added to DOM')
    
    // Load session data to get agent boxes
    chrome.storage.local.get([sessionKey], (result) => {
      const session = result[sessionKey]
      if (!session) {
        overlay.innerHTML = `
          <div style="background: linear-gradient(135deg, #1f2937 0%, #111827 100%); border-radius: 16px; padding: 40px; color: white; text-align: center;">
            <div style="font-size: 24px; margin-bottom: 10px;">❌</div>
            <div>Session not found</div>
            <button onclick="this.closest('div').parentElement.remove()" style="margin-top: 20px; padding: 10px 20px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer;">Close</button>
          </div>
        `
        return
      }
      
      // Build registered agent boxes list
      const registeredBoxes: Array<{
        number: number;
        agentId: string;
        title: string;
        location: string;
        provider?: string;
        model?: string;
      }> = []
      
      // First 4 boxes from master tab (always registered)
      if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
        session.agentBoxes.forEach((box: any) => {
          if (box && box.number && box.number <= 4) {
            // Extract CURRENT agent allocation from the stored data
            let agentId = `agent${box.number}` // Default: box 1 = agent1, box 2 = agent2, etc.
            
            // First check the agentId field directly
            if (box.agentId && String(box.agentId).match(/agent(\d+)/)) {
              const match = String(box.agentId).match(/agent(\d+)/)
              agentId = `agent${match[1]}`
            }
            // Then check if model contains agent info (this overrides agentId)
            else if (box.model && String(box.model).match(/agent(\d+)/)) {
              const match = String(box.model).match(/agent(\d+)/)
              agentId = `agent${match[1]}`
            }
            
            console.log(`📦 Box ${box.number}: agentId="${box.agentId}", model="${box.model}" → resolved agentId="${agentId}"`)
            
            registeredBoxes.push({
              number: box.number,
              agentId: agentId,
              title: box.title || `Agent Box ${box.number}`,
              location: 'Master Tab',
              provider: box.provider,
              model: box.model
            })
          }
        })
      }
      // Add additional master tab boxes that are set up (number > 4)
      if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
        session.agentBoxes.forEach((box: any) => {
          if (box && box.number && box.number > 4 && (box.title || box.agentId || box.model || box.provider)) {
            // Extract agent number from agentId or model
            let agentId = 'agent0'
            if (box.agentId && String(box.agentId).match(/\d+/)) {
              const match = String(box.agentId).match(/\d+/)
              agentId = `agent${match[0]}`
            } else if (box.model && String(box.model).match(/agent[- ]?(\d+)/i)) {
              const match = String(box.model).match(/agent[- ]?(\d+)/i)
              agentId = `agent${match[1]}`
            }
            
            registeredBoxes.push({
              number: box.number,
              agentId: agentId,
              title: box.title || `Agent Box ${box.number}`,
              location: 'Master Tab',
              provider: box.provider,
              model: box.model
            })
          }
        })
      }
      
      // Add display grid slots that are set up
      if (session.displayGrids && Array.isArray(session.displayGrids)) {
        session.displayGrids.forEach((grid: any) => {
          if (grid.config && grid.config.slots) {
            Object.entries(grid.config.slots).forEach(([slotId, slotData]: [string, any]) => {
              const slotNum = parseInt(slotId)
              if (!isNaN(slotNum) && slotData && (slotData.title || slotData.agent || slotData.model || slotData.provider)) {
                // Extract agent number
                let agentId = 'agent0'
                if (slotData.agent && String(slotData.agent).match(/\d+/)) {
                  const match = String(slotData.agent).match(/\d+/)
                  agentId = `agent${match[0]}`
                }
                
                registeredBoxes.push({
                  number: slotNum,
                  agentId: agentId,
                  title: slotData.title || `Display Port ${slotNum}`,
                  location: `Grid: ${grid.layout}`,
                  provider: slotData.provider,
                  model: slotData.model
                })
              }
            })
          }
        })
      }
      
      // Sort by number for consistent display
      registeredBoxes.sort((a, b) => a.number - b.number)
      
      // Generate HTML for each registered box
      const boxesHTML = registeredBoxes.map(box => {
        // Generate AB identifier dynamically: AB[BoxNumber][AgentNumber]
        const boxNum = String(box.number).padStart(2, '0')
        
        // Extract current agent number from agentId or model
        let agentNum = '00' // Default if no agent
        
        // Check agentId first
        if (box.agentId && box.agentId.match(/agent(\d+)/)) {
          const match = box.agentId.match(/agent(\d+)/)
          agentNum = match[1].padStart(2, '0')
        }
        // Override with model if it contains agent info
        else if (box.model && box.model.match(/agent(\d+)/)) {
          const match = box.model.match(/agent(\d+)/)
          agentNum = match[1].padStart(2, '0')
        }
        // Fallback: use box number as agent number for first 4 boxes
        else if (box.number <= 4) {
          agentNum = String(box.number).padStart(2, '0')
        }
        
        const identifier = `AB${boxNum}${agentNum}`
        
        console.log(`📦 Box ${box.number}: agentId="${box.agentId}", model="${box.model}" → identifier="${identifier}"`)
        
        
        // Get LLM info
        const llmInfo = box.provider && box.model 
          ? `${box.provider} - ${box.model}`
          : box.provider || box.model || 'Not configured'
        
        return `
          <div style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2); border-radius: 10px; padding: 12px; margin: 8px 0; display: grid; grid-template-columns: 110px 1fr 1fr 140px; gap: 12px; align-items: center;">
            <div style="font-family: monospace; font-weight: 700; color: #fbbf24; font-size: 16px;">${identifier}</div>
            <div style="font-size: 14px;">${box.title}</div>
            <div style="font-size: 13px; opacity: 0.9;">${llmInfo}</div>
            <div style="font-size: 12px; opacity: 0.8;">${box.location}</div>
          </div>
        `
      }).join('')
      overlay.innerHTML = `
        <div style="background: linear-gradient(135deg, #1f2937 0%, #111827 100%); border-radius: 16px; width: 90vw; max-width: 900px; max-height: 85vh; overflow: hidden; color: white; box-shadow: 0 20px 40px rgba(0,0,0,0.4); display: flex; flex-direction: column;">
          <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <h3 style="margin: 0; font-size: 18px; font-weight: 600;">📦 Agent Box Overview</h3>
              <div style="font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 4px;">
                Session: ${sessionKey.split('_')[1]} | Registered Boxes: ${registeredBoxes.length}
              </div>
            </div>
            <button id="close-agentbox-overview" style="background: rgba(255,255,255,0.15); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
          </div>
          
          <div style="flex: 1; padding: 20px; overflow-y: auto;">
            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
              <div style="font-size: 12px; color: rgba(255,255,255,0.7); line-height: 1.6;">
                <strong>Identifier System:</strong><br>
                • AB[BoxNumber][AgentNumber] format (e.g., AB0101 = Box 01 with Agent 01)<br>
                • First 4 boxes (AB01-AB04) are registered by default<br>
                • Additional boxes register when set up with agent/title/model
              </div>
            </div>
            
            <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; margin-bottom: 15px;">
              <div style="display: grid; grid-template-columns: 110px 1fr 1fr 140px; gap: 12px; font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.6); text-transform: uppercase;">
                <div>Identifier</div>
                <div>Title</div>
                <div>Selected LLM</div>
                <div>Location</div>
              </div>
            </div>
            
            ${boxesHTML || '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.6);">No registered agent boxes</div>'}
          </div>
        </div>
      `
      
      // Event handlers
      document.getElementById('close-agentbox-overview')?.addEventListener('click', () => overlay.remove())
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
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
    currentTabData.isLocked = true
    setCurrentSessionKey(sessionKey)
    
    const sessionData = {
      ...currentTabData,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      isLocked: true
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
        { id: 'brainstorm', agentId: 'agent1', number: 1, title: '#1 🧠 Brainstorm Support Ideas', color: '#4CAF50', outputId: 'brainstorm-output' },
        { id: 'knowledge', agentId: 'agent2', number: 2, title: '#2 🔍 Knowledge Gap Detection', color: '#2196F3', outputId: 'knowledge-output' },
        { id: 'risks', agentId: 'agent3', number: 3, title: '#3 ⚖️ Risks & Chances', color: '#FF9800', outputId: 'risks-output' },
        { id: 'explainer', agentId: 'agent4', number: 4, title: '#4 🎬 Explainer Video Suggestions', color: '#9C27B0', outputId: 'explainer-output' }
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
  
  // Dynamic margin applier to avoid top bar overlap on all sites (e.g., YouTube)
  function applyLayoutOffsets(){
    try {
      const topH = Math.max(0, Math.round((bottomSidebar as HTMLElement)?.getBoundingClientRect()?.height || 45))
      document.body.style.marginLeft = currentTabData.uiConfig.leftSidebarWidth + 'px'
      document.body.style.marginRight = currentTabData.uiConfig.rightSidebarWidth + 'px'
      document.body.style.marginTop = topH + 'px'
      document.body.style.overflowX = 'hidden'
    } catch {}
  }
  
  // React to top bar height changes (expanded/collapsed) and window resizes
  try {
    const ro = new (window as any).ResizeObserver?.(() => applyLayoutOffsets())
    if (ro) ro.observe(bottomSidebar)
  } catch {}
  window.addEventListener('resize', applyLayoutOffsets)
  applyLayoutOffsets()
  // Hybrid right panel behaviors after mount
  if (isHybridMaster) {
    // Only handle Add button click - no agent boxes to render
    document.getElementById('add-agent-box-btn-right')?.addEventListener('click', () => {
      try { openAddAgentBoxDialog() } catch (e) {}
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
  // Restore original approach for now to stop crashes (no DOM reparenting)
  document.body.style.marginLeft = currentTabData.uiConfig.leftSidebarWidth + 'px'
  document.body.style.marginRight = currentTabData.uiConfig.rightSidebarWidth + 'px'
  document.body.style.marginTop = '45px'  // Exact sidebar height
  document.body.style.overflowX = 'hidden'
  // Event handlers - AFTER DOM elements are created and added
  setTimeout(() => {
    // Reasoning header click (entire header area)
    document.getElementById('reasoning-header')?.addEventListener('click', toggleBottomPanel)
    
    // Agents and Settings lightbox buttons
    document.getElementById('agents-lightbox-btn')?.addEventListener('click', openAgentsLightbox)
    document.getElementById('context-lightbox-btn')?.addEventListener('click', openContextLightbox)
    document.getElementById('memory-lightbox-btn')?.addEventListener('click', openMemoryLightbox)
    document.getElementById('settings-lightbox-btn')?.addEventListener('click', openSettingsLightbox)
    // Dock/Undock Command Chat
    const dockBtn = document.getElementById('dock-chat-btn') as HTMLButtonElement | null
    function isChatDocked(): boolean { try { return localStorage.getItem('optimando-chat-docked') === 'true' } catch { return false } }
    function updateDockButtonUI() {
      if (!dockBtn) return
      const docked = isChatDocked()
      dockBtn.title = docked ? 'Undock from sidepanel' : 'Dock to sidepanel'
      dockBtn.textContent = docked ? '📌✓' : '📌'
    }
    // Context Bucket shared types/hook and helpers
    type IngestItem = { kind: 'file'|'image'|'audio'|'video'|'text'|'url'; payload: File|Blob|string; mime?: string; name?: string }
    type IngestTarget = 'session' | 'account'
    function showToast(message: string, kind: 'info'|'success'|'error' = 'info') {
      const note = document.createElement('div')
      note.textContent = message
      note.style.cssText = 'position:fixed;bottom:18px;left:18px;z-index:2147483650;padding:8px 12px;border-radius:8px;font-size:12px;box-shadow:0 6px 16px rgba(0,0,0,.35)'
      note.style.background = kind==='success' ? '#14532d' : (kind==='error' ? '#7f1d1d' : '#0b1220')
      note.style.color = '#e5e7eb'
      note.style.border = '1px solid rgba(255,255,255,0.18)'
      document.body.appendChild(note)
      setTimeout(()=> note.remove(), 1800)
    }
    async function parseDataTransfer(dt: DataTransfer): Promise<IngestItem[]> {
      const items: IngestItem[] = []
      try {
        for (const f of Array.from(dt.files || [])) {
          const t = (f.type||'').toLowerCase()
          const kind: IngestItem['kind'] = t.startsWith('image/') ? 'image' : t.startsWith('audio/') ? 'audio' : t.startsWith('video/') ? 'video' : 'file'
          items.push({ kind, payload: f, mime: f.type, name: f.name })
        }
        const url = dt.getData('text/uri-list') || dt.getData('text/url')
        if (url) items.push({ kind:'url', payload: url })
        const txt = dt.getData('text/plain')
        if (txt && !url) items.push({ kind:'text', payload: txt })
      } catch {}
      return items
    }
    function openEmbedConfirm(items: IngestItem[], onPick: (target: IngestTarget)=>void) {
      const ov = document.createElement('div')
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483651;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)'
      const box = document.createElement('div')
      box.style.cssText = 'width:420px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border-radius:12px;border:1px solid rgba(255,255,255,.25);box-shadow:0 12px 30px rgba(0,0,0,.4);overflow:hidden'
      box.innerHTML = `
        <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.25);font-weight:700">Where to embed?</div>
        <div style="padding:14px 16px;font-size:12px">
          <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="radio" name="ing-target" value="session"> <span>Session Memory (this session only)</span></label>
          <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="radio" name="ing-target" value="account"> <span>Account Memory (account-wide, long term)</span></label>
          <div style="margin-top:10px;opacity:.9">Content will be processed (OCR/ASR/Parsing), chunked, and embedded locally.</div>
        </div>
        <div style="padding:12px 16px;background:rgba(255,255,255,.08);display:flex;gap:8px;justify-content:flex-end">
          <button id="ing-cancel" style="padding:6px 10px;border:0;border-radius:6px;background:rgba(255,255,255,.18);color:white;cursor:pointer">Cancel</button>
          <button id="ing-run" style="padding:6px 10px;border:0;border-radius:6px;background:#22c55e;color:#0b1e12;cursor:pointer">Embed</button>
        </div>`
      ov.appendChild(box)
      document.body.appendChild(ov)
      ;(box.querySelector('#ing-cancel') as HTMLButtonElement)?.addEventListener('click', ()=> ov.remove())
      ;(box.querySelector('#ing-run') as HTMLButtonElement)?.addEventListener('click', ()=>{
        const sel = box.querySelector('input[name="ing-target"]:checked') as HTMLInputElement | null
        if (!sel) { showToast('Please select a target', 'error'); return }
        ov.remove(); onPick(sel.value as IngestTarget)
      })
    }
    function useContextBucketIngestion() {
      async function handleDrop(ev: DragEvent) {
        ev.preventDefault()
        const dt = ev.dataTransfer; if (!dt) return
        const items = await parseDataTransfer(dt)
        if (!items.length) { showToast('Keine Inhalte erkannt', 'error'); return }
        openEmbedConfirm(items, (target)=> runEmbed(items, target))
      }
      function runEmbed(items: IngestItem[], target: IngestTarget) {
        showToast('Vorverarbeitung…', 'info')
        setTimeout(()=>{
          try {
            const key = target==='session' ? 'optimando-context-bucket-session' : 'optimando-context-bucket-account'
            const prev = JSON.parse(localStorage.getItem(key) || '[]')
            const serialized = items.map(it => ({ kind: it.kind, name: (it as any).name || undefined, mime: it.mime || undefined, size: (it.payload as any)?.size || undefined, text: typeof it.payload==='string'? it.payload : undefined }))
            prev.push({ at: Date.now(), items: serialized })
            localStorage.setItem(key, JSON.stringify(prev))
          } catch {}
          showToast('Einbettung abgeschlossen', 'success')
        }, 900)
      }
      return { handleDrop }
    }
    function mountContextBucket(container: HTMLElement, btnId: string) {
      const { handleDrop } = useContextBucketIngestion()
      const file = document.createElement('input'); file.type='file'; (file as any).multiple = true; file.style.display='none'
      container.appendChild(file)
      container.addEventListener('dragover', (e)=>{ e.preventDefault() })
      container.addEventListener('drop', (e)=> handleDrop(e))
      const btn = container.querySelector('#'+btnId) as HTMLButtonElement | null
      btn?.addEventListener('click', ()=> file.click())
      file.addEventListener('change', ()=>{
        const dt = new DataTransfer(); Array.from(file.files||[]).forEach(f=> dt.items.add(f));
        const fake = new DragEvent('drop', { dataTransfer: dt })
        handleDrop(fake)
        file.value = ''
      })
    }
    function removeDockedChat() {
      const existing = document.getElementById('command-chat-docked')
      if (existing) existing.remove()
    }
    function createDockedChat() {
      // Insert right below the header and above agent boxes
      const container = document.createElement('div')
      container.id = 'command-chat-docked'
      // Theme-aware styles
      let theme: 'default'|'dark'|'professional' = 'default'
      try { const t = localStorage.getItem('optimando-ui-theme'); if (t === 'professional' || t === 'dark') theme = t as any } catch {}
      const bg = theme === 'professional' ? '#ffffff' : 'rgba(255,255,255,0.10)'
      const br = theme === 'professional' ? '#e2e8f0' : 'rgba(255,255,255,0.20)'
      const fg = theme === 'professional' ? '#0f172a' : 'white'
      const hdr = theme === 'professional' ? 'linear-gradient(135deg,#ffffff,#f1f5f9)' : (theme==='dark' ? 'linear-gradient(135deg,#0f172a,#1e293b)' : 'linear-gradient(135deg,#667eea,#764ba2)')
      container.style.cssText = `background:${bg}; color:${fg}; border:1px solid ${br}; border-radius:8px; padding:0; margin: 0 0 12px 0; overflow:hidden; position:relative;`
      container.innerHTML = `
        <div id=\"ccd-header\" style=\"display:flex; align-items:center; justify-content:space-between; padding:6px 8px; background:${hdr}; border-bottom:1px solid ${br};\">\n            <div style=\"display:flex; align-items:center; gap:8px; color:${theme==='professional'?'#0f172a':'white'}\">\n            <div style=\"font-size:12px; font-weight:700;\">💬 Command Chat</div>\n            <div style=\"display:flex; gap:6px; align-items:center;\">\n              <button id=\"ccd-bucket\" title=\"Context Bucket: Embed context directly into the session\" style=\"height:28px;background:${theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.08)'}; border:1px solid ${br}; color:#ef4444; border-radius:6px; padding:0 8px; font-size:12px; cursor:pointer; display:flex;align-items:center;justify-content:center;\">🪣</button>\n              <button id=\"ccd-lm-one\" title=\"LmGTFY - Capture a screen area as screenshot or stream and send it to your pre-defined automation tasks.\" style=\"background:${theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.15)'}; border:1px solid ${br}; color:${fg}; border-radius:6px; padding:2px 6px; font-size:12px; cursor:pointer;\">✎</button>\n            </div>\n          </div>\n          <div style=\"display:flex; gap:6px; align-items:center;\">\n            <button id=\"ccd-undock\" title=\"Undock from sidepanel\" style=\"background:${theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.15)'}; border:1px solid ${br}; color:${fg}; border-radius:6px; padding:4px 6px; font-size:10px; cursor:pointer;\">↗</button>\n          </div>\n        </div>
        <div id="ccd-messages" style="height:160px; overflow:auto; display:flex; flex-direction:column; gap:6px; background:${theme==='professional'?'#f8fafc':'rgba(255,255,255,0.06)'}; border-left:0; border-right:0; border-top:0; border-bottom:1px solid ${br}; padding:8px;"></div>
        <div id="ccd-compose" style="display:grid; grid-template-columns:1fr 36px 36px 68px; gap:6px; align-items:center; padding:8px;">
          <textarea id="ccd-input" placeholder="Type..." style="box-sizing:border-box; height:36px; resize:vertical; background:${theme==='professional'?'#ffffff':'rgba(255,255,255,0.08)'}; border:1px solid ${br}; color:${fg}; border-radius:6px; padding:8px; font-size:12px;"></textarea>
          <input id="ccd-file" type="file" multiple style="display:none" />
          <button id="ccd-attach" title="Attach" style="height:36px; background:${theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.15)'}; border:1px solid ${br}; color:${fg}; border-radius:6px; cursor:pointer;">📎</button>
          <button id="ccd-mic" title="Voice" style="height:36px; background:${theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.15)'}; border:1px solid ${br}; color:${fg}; border-radius:6px; cursor:pointer;">🎙️</button>
          <button id="ccd-send" class="send-btn">Send</button>
        </div>
      `
      // Insert before agent boxes
      const agentBoxes = leftSidebar?.querySelector('#agent-boxes-container')
      if (leftSidebar && agentBoxes) leftSidebar.insertBefore(container, agentBoxes)
      else if (leftSidebar) leftSidebar.appendChild(container)
      // Wire actions
      const msgs = container.querySelector('#ccd-messages') as HTMLElement
      const input = container.querySelector('#ccd-input') as HTMLTextAreaElement
      const send = container.querySelector('#ccd-send') as HTMLButtonElement
      const attach = container.querySelector('#ccd-attach') as HTMLButtonElement
      const file = container.querySelector('#ccd-file') as HTMLInputElement
      const undock = container.querySelector('#ccd-undock') as HTMLButtonElement
      function addRow(role: 'user'|'assistant', text: string){
        const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent = role==='user'?'flex-end':'flex-start'
        const bub = document.createElement('div'); bub.style.maxWidth='78%'; bub.style.padding='8px 10px'; bub.style.borderRadius='10px'; bub.style.fontSize='12px'; bub.style.lineHeight='1.45';
        if (role==='user'){ bub.style.background = 'rgba(34,197,94,0.12)'; bub.style.border='1px solid rgba(34,197,94,0.45)'} else { bub.style.background = theme==='professional'?'#f1f5f9':'rgba(255,255,255,0.10)'; bub.style.border = theme==='professional'?'1px solid #e2e8f0':'1px solid rgba(255,255,255,0.20)'}
        bub.textContent = text; row.appendChild(bub); msgs.appendChild(row); msgs.scrollTop = msgs.scrollHeight
      }
      send.addEventListener('click', () => { const v=(input.value||'').trim(); if(!v) return; addRow('user', v); input.value=''; setTimeout(()=>addRow('assistant','Acknowledged: '+v), 250) })
      input.addEventListener('keydown', (e)=>{ if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send.click() } })
      attach.addEventListener('click', ()=> file.click())
      file.addEventListener('change', ()=>{ const n=(file.files||[]).length; if(n) addRow('user', `Uploaded ${n} file(s).`) })
      undock.addEventListener('click', ()=>{ undockCommandChat() })
      // Mount context bucket (drag & drop + click-to-pick)
      mountContextBucket(container, 'ccd-bucket')
      // Tags dropdown next to pencil for quick re-use of saved areas (docked)
      try {
        const lmBtn = container.querySelector('#ccd-lm-one') as HTMLButtonElement | null
        const toolsParent = lmBtn?.parentElement as HTMLElement | null
        if (toolsParent){
          const ddWrap = document.createElement('div'); ddWrap.style.position='relative'; ddWrap.style.display='inline-flex'
          const tagBtn = document.createElement('button'); tagBtn.type='button'; tagBtn.title='Tags'; tagBtn.textContent='Tags'; tagBtn.style.cssText='display:inline-flex;align-items:center;gap:6px;background:'+ (theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.08)') +'; border:1px solid '+br+'; color:'+fg+'; border-radius:6px; padding:2px 6px; font-size:12px; cursor:pointer'
          const caret = document.createElement('span'); caret.textContent='▾'; caret.style.cssText='font-size:12px; opacity:.9'
          tagBtn.appendChild(caret)
          // Dropdown menu (custom)
          const menu = document.createElement('div');
          menu.id = 'ccd-tags-menu'
          menu.style.cssText = 'position:fixed; display:none; min-width:220px; width:320px; max-height:260px; overflow:auto; z-index:2147483647; background:'+ (theme==='professional'?'#ffffff':'#111827') +'; color:'+fg+'; border:1px solid '+br+'; border-radius:8px; box-shadow:0 10px 22px rgba(0,0,0,0.35)'
          document.body.appendChild(menu)
          function closeMenu(){ try{ menu.style.display='none' }catch{}; window.removeEventListener('mousedown', outside) }
          function outside(e:MouseEvent){ const t=e.target as HTMLElement; if (!t) return; if (t===menu || menu.contains(t) || t===tagBtn) return; closeMenu() }
          function openMenu(){
            try{
              const r = tagBtn.getBoundingClientRect();
              menu.style.left = Math.max(8, Math.min(window.innerWidth-340, r.left)) + 'px'
              menu.style.top = Math.min(window.innerHeight-280, r.bottom + 6) + 'px'
              menu.style.display='block'
              setTimeout(()=> window.addEventListener('mousedown', outside), 0)
            }catch{}
          }
          function renderItems(items:any[]){
            try{
              menu.innerHTML = ''
              if (!items.length){ const empty=document.createElement('div'); empty.textContent='No tags yet'; empty.style.cssText='padding:8px 10px; font-size:12px; opacity:.8'; menu.appendChild(empty); return }
              items.forEach((t:any, i:number)=>{
                const rowWrapper = document.createElement('div')
                rowWrapper.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-bottom:1px solid '+br+';'
                rowWrapper.onmouseenter = ()=>{ rowWrapper.style.background = (theme==='professional'?'#f1f5f9':'rgba(255,255,255,0.06)') }
                rowWrapper.onmouseleave = ()=>{ rowWrapper.style.background = 'transparent' }
                
                const row = document.createElement('button'); row.type='button'; row.style.cssText='flex:1;text-align:left;padding:0;font-size:12px;background:transparent;border:0;color:inherit;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;'
                row.title = t.name || ('Trigger '+(i+1))
                row.textContent = t.name || ('Trigger '+(i+1))
                
                const deleteBtn = document.createElement('button')
                deleteBtn.textContent = '×'
                deleteBtn.type = 'button'
                deleteBtn.style.cssText = 'width:20px;height:20px;border:none;background:rgba(239,68,68,0.2);color:#ef4444;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;padding:0;margin-left:8px;flex-shrink:0;'
                deleteBtn.onmouseenter = () => { deleteBtn.style.background = 'rgba(239,68,68,0.4)' }
                deleteBtn.onmouseleave = () => { deleteBtn.style.background = 'rgba(239,68,68,0.2)' }
                deleteBtn.onclick = (e) => {
                  e.stopPropagation()
                  if (confirm(`Delete trigger "${t.name||('Trigger '+(i+1))}"?`)) {
                    const key='optimando-tagged-triggers'
                    chrome.storage?.local?.get([key], (data:any)=>{
                      const list = Array.isArray(data?.[key]) ? data[key] : []
                      list.splice(i, 1)
                      chrome.storage?.local?.set({ [key]: list }, ()=>{
                        refreshMenu()
                        try{ chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) }catch{}
                        try{ window.dispatchEvent(new CustomEvent('optimando-triggers-updated')) }catch{}
                      })
                    })
                  }
                }
                
                row.onclick = ()=>{
                  closeMenu()
                  try{
                    // Send trigger to Electron for execution (respects displayId for multi-monitor)
                    console.log('[CONTENT] Executing trigger via Electron:', t)
                    chrome.runtime?.sendMessage({ 
                      type: 'ELECTRON_EXECUTE_TRIGGER', 
                      trigger: t 
                    })
                  }catch(err){
                    console.log('[CONTENT] Error executing trigger:', err)
                  }
                }
                rowWrapper.appendChild(row)
                rowWrapper.appendChild(deleteBtn)
                menu.appendChild(rowWrapper)
              })
            }catch{}
          }
          function refreshMenu(){
            try{
              const key='optimando-tagged-triggers'
              chrome.storage?.local?.get([key], (data:any)=>{
                try{ const list = Array.isArray(data?.[key]) ? data[key] : []; renderItems(list) }catch{}
              })
            }catch{}
          }
          refreshMenu(); window.addEventListener('optimando-triggers-updated', refreshMenu)
          tagBtn.onclick = ()=>{ refreshMenu(); openMenu() }
          ddWrap.appendChild(tagBtn); toolsParent.appendChild(ddWrap)
        }
      } catch {}
      ;(container.querySelector('#ccd-lm-one') as HTMLButtonElement | null)?.addEventListener('click', (e)=>{ 
        try{ e.preventDefault(); e.stopPropagation() }catch{}
        console.log('[CONTENT] Docked pencil button clicked')
        // Trigger Electron overlay for screen selection (can capture outside browser)
        try{ 
          chrome.runtime?.sendMessage({ type:'ELECTRON_START_SELECTION', source:'docked-chat' })
          console.log('[CONTENT] Sent ELECTRON_START_SELECTION message')
        }catch(err){
          console.log('[CONTENT] Error sending message:', err)
        }
      })

      // Allow vertical resize by dragging the outer bottom border of the docked box
      let startY = 0, startBoxH = 0, startMsgsH = 0
      const minMsgs = 120, maxMsgs = 500
      const headerEl = container.querySelector('#ccd-header') as HTMLElement
      const composeEl = container.querySelector('#ccd-compose') as HTMLElement
      function beginResize(e: MouseEvent) {
        startY = e.clientY
        // Lock current heights for smooth drag
        startBoxH = container.offsetHeight
        startMsgsH = msgs.offsetHeight
        container.style.height = startBoxH + 'px'
        document.body.style.userSelect = 'none'
        window.addEventListener('mousemove', onDrag)
        window.addEventListener('mouseup', endResize, { once: true })
      }
      function onDrag(e: MouseEvent) {
        const delta = e.clientY - startY
        const newMsgs = Math.max(minMsgs, Math.min(maxMsgs, startMsgsH + delta))
        msgs.style.height = newMsgs + 'px'
        const total = (headerEl?.offsetHeight || 0) + newMsgs + (composeEl?.offsetHeight || 0)
        container.style.height = (total + 2) + 'px'
      }
      function endResize() { window.removeEventListener('mousemove', onDrag); document.body.style.userSelect = '' }
      // Invisible handle sitting on the outer bottom border
      const edgeHandle = document.createElement('div')
      edgeHandle.style.cssText = 'position:absolute; left:0; right:0; bottom:0; height:8px; cursor: ns-resize; background: transparent;'
      edgeHandle.title = 'Drag to resize'
      edgeHandle.addEventListener('mousedown', beginResize)
      container.appendChild(edgeHandle)
    }
    function setDockedChatTheme(theme: 'default'|'dark'|'professional') {
      const container = document.getElementById('command-chat-docked') as HTMLElement | null
      if (!container) return
      const bg = theme === 'professional' ? '#ffffff' : 'rgba(255,255,255,0.10)'
      const br = theme === 'professional' ? '#e2e8f0' : 'rgba(255,255,255,0.20)'
      const fg = theme === 'professional' ? '#0f172a' : 'white'
      const hdr = theme === 'professional' ? 'linear-gradient(135deg,#ffffff,#f1f5f9)' : (theme==='dark' ? 'linear-gradient(135deg,#0f172a,#1e293b)' : 'linear-gradient(135deg,#667eea,#764ba2)')
      container.style.background = bg
      container.style.color = fg
      container.style.border = '1px solid ' + br
      const hdrEl = container.firstElementChild as HTMLElement | null
      if (hdrEl) {
        hdrEl.style.background = hdr
        hdrEl.style.borderBottom = '1px solid ' + br
        hdrEl.style.color = (theme==='professional'?'#0f172a':'white')
        // Also update the inner title div which has an inline color set at creation time
        const titleEl = hdrEl.firstElementChild as HTMLElement | null
        if (titleEl) titleEl.style.color = (theme==='professional'?'#0f172a':'white')
        const undockBtn = hdrEl.querySelector('#ccd-undock') as HTMLButtonElement | null
        if (undockBtn) {
          undockBtn.style.background = (theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.15)')
          undockBtn.style.border = '1px solid ' + br
          undockBtn.style.color = fg
        }
      }
      const msgs = container.querySelector('#ccd-messages') as HTMLElement | null
      if (msgs) { msgs.style.background = (theme==='professional'?'#f8fafc':'rgba(255,255,255,0.06)'); msgs.style.borderBottom = '1px solid ' + br }
      const ta = container.querySelector('#ccd-input') as HTMLTextAreaElement | null
      if (ta) { ta.style.background = (theme==='professional'?'#ffffff':'rgba(255,255,255,0.08)'); ta.style.border = '1px solid ' + br; ta.style.color = fg }
      ;['ccd-attach','ccd-mic'].forEach(id => {
        const btn = container.querySelector('#'+id) as HTMLButtonElement | null
        if (btn) { btn.style.background = (theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.15)'); btn.style.border = '1px solid ' + br; btn.style.color = fg }
      })
    }
    function dockCommandChat() { removeDockedChat(); removeFloatingChat(); createDockedChat(); try { localStorage.setItem('optimando-chat-docked','true') } catch {}; updateDockButtonUI() }
    function undockCommandChat() { removeDockedChat(); removeFloatingChat(); try { localStorage.setItem('optimando-chat-docked','false') } catch {}; updateDockButtonUI() }

    function removeFloatingChat(){ document.getElementById('command-chat-float')?.remove() }
    function createFloatingChat(){
      const existing = document.getElementById('command-chat-float'); if (existing) existing.remove()
      let theme: 'default'|'dark'|'professional' = 'default'
      try { const t = localStorage.getItem('optimando-ui-theme'); if (t === 'professional' || t === 'dark') theme = t as any } catch {}
      const bg = theme === 'professional' ? '#ffffff' : 'rgba(0,0,0,0.75)'
      const br = theme === 'professional' ? '#e2e8f0' : 'rgba(255,255,255,0.20)'
      const fg = theme === 'professional' ? '#0f172a' : 'white'
      const hdr = theme === 'professional' ? 'linear-gradient(135deg,#ffffff,#f1f5f9)' : (theme==='dark' ? 'linear-gradient(135deg,#0f172a,#1e293b)' : 'linear-gradient(135deg,#667eea,#764ba2)')
      const box = document.createElement('div')
      box.id = 'command-chat-float'
      box.style.cssText = 'position:fixed; right:20px; bottom:20px; width:360px; z-index:2147483646; background:'+bg+'; color:'+fg+'; border:1px solid '+br+'; border-radius:10px; overflow:hidden; backdrop-filter: blur(6px); box-shadow: 0 8px 24px rgba(0,0,0,0.35);'
      box.innerHTML = `
        <div id="ccf-header" style="display:flex; align-items:center; justify-content:space-between; padding:6px 8px; background:${hdr}; border-bottom:1px solid ${br};">
          <div style="display:flex; align-items:center; gap:8px; color:${theme==='professional'?'#0f172a':'white'}">
            <div style="font-size:12px; font-weight:700;">💬 Command Chat</div>
            <div style="display:flex; gap:6px; align-items:center;">
              <button id="ccf-lm-one" title="LmGTFY - Capture a screen area as screenshot or stream and send it to your pre-defined automation tasks." style="background:${theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.15)'}; border:1px solid ${br}; color:${fg}; border-radius:6px; padding:2px 6px; font-size:12px; cursor:pointer;">✎</button>
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center;">
            <button id="ccf-close" title="Close" style="background:${theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.15)'}; border:1px solid ${br}; color:${fg}; border-radius:6px; padding:4px 6px; font-size:10px; cursor:pointer;">×</button>
          </div>
        </div>
        
        <div id="ccf-messages" style="height:160px; overflow:auto; display:flex; flex-direction:column; gap:6px; background:${theme==='professional'?'#f8fafc':'rgba(255,255,255,0.06)'}; border-left:0; border-right:0; border-top:0; border-bottom:1px solid ${br}; padding:8px;"></div>
        <div id="ccf-compose" style="display:grid; grid-template-columns:1fr 68px; gap:6px; align-items:center; padding:8px;">
          <textarea id="ccf-input" placeholder="Type..." style="box-sizing:border-box; height:36px; resize:vertical; background:${theme==='professional'?'#ffffff':'rgba(255,255,255,0.08)'}; border:1px solid ${br}; color:${fg}; border-radius:6px; padding:8px; font-size:12px;"></textarea>
          <button id="ccf-send" class="send-btn">Send</button>
        </div>
      `
      document.body.appendChild(box)
      // Ensure floating composer has no unused icons. Keep only textarea + Send.
      try {
        const compose = box.querySelector('#ccf-compose') as HTMLElement | null
        if (compose) {
          compose.querySelectorAll('button').forEach(btn => {
            const id = (btn as HTMLElement).id || ''
            if (id !== 'ccf-send') (btn as HTMLElement).remove()
          })
          // Normalize layout back to 2 columns
          ;(compose as HTMLElement).style.gridTemplateColumns = '1fr 68px'
        }
        // Extra safety: remove any non-whitelisted buttons anywhere inside floating chat
        box.querySelectorAll('button').forEach(btn => {
          const id = (btn as HTMLElement).id || ''
          const allow = id === 'ccf-send' || id === 'ccf-close' || id === 'ccf-lm-one'
          const insideCompose = (btn as HTMLElement).closest('#ccf-compose')
          if (insideCompose && !allow) (btn as HTMLElement).remove()
        })
      } catch {}
      ;(box.querySelector('#ccf-close') as HTMLButtonElement | null)?.addEventListener('click', ()=> box.remove())
      const headerTools = box.querySelector('#ccf-header > div:first-child > div:last-child') as HTMLElement | null
      if (headerTools) {
        const bucket = document.createElement('button')
        bucket.id = 'ccf-bucket'
        bucket.title = 'Context Bucket: Embed context directly into the session'
        bucket.textContent = '🪣'
        // professional theme gets pill background + border for visibility
        bucket.style.background = (theme==='professional'?'#e2e8f0':'transparent')
        bucket.style.border = (theme==='professional'?'1px solid '+br:'0')
        bucket.style.color = '#ef4444'
        bucket.style.borderRadius = '6px'
        bucket.style.padding = '2px 6px'
        bucket.style.fontSize = '12px'
        bucket.style.cursor = 'pointer'
        headerTools.appendChild(bucket)
        // Tags dropdown next to pencil for quick re-use of saved areas
        const ddWrap = document.createElement('div'); ddWrap.style.cssText = 'position:relative;'
        const ddBtn = document.createElement('button')
        ddBtn.id = 'ccf-tags-btn'
        ddBtn.textContent = '▾ Tags'
        ddBtn.style.cssText = 'background:'+ (theme==='professional'?'#e2e8f0':'rgba(255,255,255,0.08)') +'; border:1px solid '+br+'; color:'+fg+'; border-radius:6px; padding:2px 8px; font-size:12px; cursor:pointer;'
        
        const ddDropdown = document.createElement('div')
        ddDropdown.id = 'ccf-tags-dropdown'
        ddDropdown.style.cssText = 'display:none;position:absolute;top:100%;left:0;min-width:200px;max-height:300px;overflow-y:auto;background:'+ (theme==='professional'?'#ffffff':'rgba(17,24,39,0.95)') +';border:1px solid '+br+';border-radius:6px;margin-top:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:1000;'
        
        let isDropdownOpen = false
        
        function refreshDD(){
          try{
            const key='optimando-tagged-triggers'
            chrome.storage?.local?.get([key], (data:any)=>{
              try{
                const list = Array.isArray(data?.[key]) ? data[key] : []
                ddDropdown.innerHTML = ''
                
                if (list.length === 0) {
                  const empty = document.createElement('div')
                  empty.style.cssText = 'padding:8px 12px;font-size:11px;color:'+fg+';opacity:0.6;text-align:center;'
                  empty.textContent = 'No saved triggers'
                  ddDropdown.appendChild(empty)
                  return
                }
                
                list.forEach((t:any,i:number)=>{
                  const item = document.createElement('div')
                  item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;font-size:11px;cursor:pointer;border-bottom:1px solid '+br+';'
                  item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.1)')
                  item.addEventListener('mouseleave', () => item.style.background = 'transparent')
                  
                  const name = document.createElement('span')
                  name.textContent = t.name||('Trigger '+(i+1))
                  name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
                  
                  const deleteBtn = document.createElement('button')
                  deleteBtn.textContent = '×'
                  deleteBtn.style.cssText = 'width:20px;height:20px;border:none;background:rgba(239,68,68,0.2);color:#ef4444;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;padding:0;margin-left:8px;flex-shrink:0;'
                  deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = 'rgba(239,68,68,0.4)')
                  deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = 'rgba(239,68,68,0.2)')
                  deleteBtn.onclick = (e) => {
                    e.stopPropagation()
                    if (confirm(`Delete trigger "${t.name||('Trigger '+(i+1))}"?`)) {
                      const key='optimando-tagged-triggers'
                      chrome.storage?.local?.get([key], (data:any)=>{
                        const list = Array.isArray(data?.[key]) ? data[key] : []
                        list.splice(i, 1)
                        chrome.storage?.local?.set({ [key]: list }, ()=>{
                          refreshDD()
                          try{ chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) }catch{}
                          try{ window.dispatchEvent(new CustomEvent('optimando-triggers-updated')) }catch{}
                        })
                      })
                    }
                  }
                  
                  const triggerData = t
                  const triggerIndex = i
                  item.onclick = async () => {
                    isDropdownOpen = false
                    ddDropdown.style.display = 'none'
                    // Execute trigger logic (moved from dd.onchange)
                    await executeTrigger(triggerData, triggerIndex)
                  }
                  
                  item.append(name, deleteBtn)
                  ddDropdown.appendChild(item)
                })
              }catch{}
            })
          }catch{}
        }
        refreshDD()
        window.addEventListener('optimando-triggers-updated', refreshDD)
        
        // Toggle dropdown
        ddBtn.onclick = (e) => {
          e.stopPropagation()
          isDropdownOpen = !isDropdownOpen
          ddDropdown.style.display = isDropdownOpen ? 'block' : 'none'
        }
        
        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
          if (isDropdownOpen) {
            isDropdownOpen = false
            ddDropdown.style.display = 'none'
          }
        })
        
        // Extract trigger execution logic into a function
        async function executeTrigger(t: any, idx: number) {
          try{
            // Send trigger to Electron for execution (respects displayId for multi-monitor)
            console.log('[CONTENT] Executing trigger via Electron:', t)
            chrome.runtime?.sendMessage({ 
              type: 'ELECTRON_EXECUTE_TRIGGER', 
              trigger: t 
            })
            return
            /* OLD BROWSER-BASED CAPTURE (doesn't support multi-monitor):
            if ((t.mode||'screenshot') === 'stream'){
              try{
                const r = t.rect || { x:0,y:0,w:0,h:0 }
                const dpr = Math.max(1, (window as any).devicePixelRatio || 1)
                const cnv = document.createElement('canvas'); cnv.width = Math.max(1, Math.round(r.w*dpr)); cnv.height = Math.max(1, Math.round(r.h*dpr))
                const ctx = cnv.getContext('2d')!
                const stream = (cnv as any).captureStream ? (cnv as any).captureStream(5) : null
                if (!stream) { dd.value=''; return }
                const preferred = ['video/mp4;codecs=h264','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
                const mime = preferred.find(t=>{ try { return (MediaRecorder as any).isTypeSupported ? MediaRecorder.isTypeSupported(t) : false } catch { return false } }) || 'video/webm'
                let recorded: BlobPart[] = []
                const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_500_000 })
                rec.ondataavailable = (e)=>{ if (e.data && e.data.size>0) recorded.push(e.data) }
                let frameTimer:any = null
                let timer:any = null
                let badge:HTMLElement|null = null
                const startMs = Date.now()
                const fmt=(ms:number)=>{ const s=Math.floor(ms/1000); const m2=String(Math.floor(s/60)).padStart(2,'0'); const s2=String(s%60).padStart(2,'0'); return m2+':'+s2 }
                function stopAll(){ try{ frameTimer&&clearInterval(frameTimer) }catch{}; try{ rec.state!=='inactive'&&rec.stop() }catch{}; try{ (stream.getTracks()||[]).forEach((t:any)=>t.stop()) }catch{}; try{ timer&&clearInterval(timer) }catch{}; try{ badge&&badge.remove() }catch{} }
                rec.onstop = ()=>{
                  const blob = new Blob(recorded, { type: mime })
                  const url = URL.createObjectURL(blob)
                  const msgs = (document.getElementById('ccf-messages') || document.getElementById('ccd-messages')) as HTMLElement | null
                  if (msgs){ const row=document.createElement('div'); row.style.display='flex'; row.style.justifyContent='flex-end'; const bub=document.createElement('div'); bub.style.maxWidth='78%'; bub.style.padding='6px'; bub.style.borderRadius='10px'; bub.style.fontSize='12px'; bub.style.background='var(--bubble-user-bg, rgba(34,197,94,0.12))'; bub.style.border='1px solid var(--bubble-user-border, rgba(34,197,94,0.45))'; const vid=document.createElement('video'); vid.src=url; vid.controls=true; vid.style.maxWidth='260px'; vid.style.borderRadius='8px'; bub.appendChild(vid); row.appendChild(bub); msgs.appendChild(row); msgs.scrollTop = 1e9 }
                }
                rec.start(500)
                frameTimer = setInterval(async ()=>{
                  try{
                    const raw = await new Promise<string|null>((resolve)=>{ try{ chrome.runtime.sendMessage({ type:'CAPTURE_VISIBLE_TAB' }, (res:any)=> resolve(res?.dataUrl||null)) }catch{ resolve(null) } })
                    if(!raw) return
                    await new Promise<void>((resolve)=>{ const img=new Image(); img.onload=()=>{ try{ ctx.drawImage(img, Math.round(r.x*dpr), Math.round(r.y*dpr), Math.round(r.w*dpr), Math.round(r.h*dpr), 0, 0, Math.round(r.w*dpr), Math.round(r.h*dpr)) }catch{}; resolve() }; img.src=raw })
                  }catch{}
                }, 200)
                // Floating stop + timer
                try{
                  badge = document.createElement('div'); badge.style.cssText='position:fixed; top:8px; right:12px; z-index:2147483647; display:flex; align-items:center; gap:8px; background:rgba(17,24,39,0.85); color:#fecaca; border:1px solid rgba(239,68,68,0.6); padding:4px 8px; border-radius:8px; font-size:12px;'
                  const dot=document.createElement('span'); dot.style.cssText='display:inline-block;width:8px;height:8px;border-radius:9999px;background:#ef4444;animation:pulse 1s infinite';
                  const time=document.createElement('span'); time.textContent='00:00'
                  const stop=document.createElement('button'); stop.textContent='⏹'; stop.style.cssText='background:#991b1b;border:0;color:white;padding:2px 6px;border-radius:6px;cursor:pointer'
                  const st = document.createElement('style'); st.textContent='@keyframes pulse{0%{opacity:1}50%{opacity:.35}100%{opacity:1}}'
                  stop.onclick = (e)=>{ try{ e.preventDefault(); e.stopPropagation() }catch{}; stopAll() }
                  badge.appendChild(dot); badge.appendChild(time); badge.appendChild(stop); badge.appendChild(st); document.body.appendChild(badge)
                  timer = setInterval(()=>{ try{ time.textContent = fmt(Date.now()-startMs) }catch{} }, 1000)
                }catch{}
              }catch{}
            } else {
              const raw = await new Promise<string|null>((resolve)=>{ try{ chrome.runtime.sendMessage({ type:'CAPTURE_VISIBLE_TAB' }, (res:any)=> resolve(res?.dataUrl||null)) }catch{ resolve(null) } })
              if(!raw) return
              const dpr = Math.max(1, (window as any).devicePixelRatio || 1)
              const cnv = document.createElement('canvas'); cnv.width = Math.max(1, Math.round(t.rect.w*dpr)); cnv.height = Math.max(1, Math.round(t.rect.h*dpr))
              const ctx = cnv.getContext('2d')!
              const img = new Image(); img.onload=()=>{ try{ ctx.drawImage(img, Math.round(t.rect.x*dpr), Math.round(t.rect.y*dpr), Math.round(t.rect.w*dpr), Math.round(t.rect.h*dpr), 0, 0, Math.round(t.rect.w*dpr), Math.round(t.rect.h*dpr)); const out = cnv.toDataURL('image/png');
                const msgs = (document.getElementById('ccf-messages') || document.getElementById('ccd-messages')) as HTMLElement | null
                if (msgs) {
                  const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='flex-end'
                  const bub = document.createElement('div'); bub.style.maxWidth='78%'; bub.style.padding='6px'; bub.style.borderRadius='10px'; bub.style.fontSize='12px'; bub.style.background='var(--bubble-user-bg, rgba(34,197,94,0.12))'; bub.style.border='1px solid var(--bubble-user-border, rgba(34,197,94,0.45))'
                  const image = document.createElement('img'); image.src=out; image.style.maxWidth='240px'; image.style.borderRadius='8px'; image.alt='screenshot'
                  bub.appendChild(image); row.appendChild(bub); msgs.appendChild(row); msgs.scrollTop = 1e9
                }
              }catch{}}
              img.src = raw
            }
            */
          }catch(err){
            console.log('[CONTENT] Error executing trigger:', err)
          }
        }
        ddWrap.appendChild(ddBtn); ddWrap.appendChild(ddDropdown); headerTools.appendChild(ddWrap)
      }
      ;(box.querySelector('#ccf-lm-one') as HTMLButtonElement | null)?.addEventListener('click', (e)=>{ 
        try{ e.preventDefault(); e.stopPropagation() }catch{}
        console.log('[CONTENT] Floating pencil button clicked')
        // Trigger Electron overlay for screen selection (can capture outside browser)
        try{ 
          chrome.runtime?.sendMessage({ type:'ELECTRON_START_SELECTION', source:'floating-popup' })
          console.log('[CONTENT] Sent ELECTRON_START_SELECTION message')
        }catch(err){
          console.log('[CONTENT] Error sending message:', err)
        }
      })
      // Mount context bucket to popup (drop anywhere in the box)
      mountContextBucket(box, 'ccf-bucket')
    }
    function startLmgtfy(mode: 'screenshot'|'stream'){
      // Disabled deep link launcher to avoid empty popups; use WS bridge instead
      try { chrome.runtime?.sendMessage({ type:'ELECTRON_START_SELECTION', source:'content', mode }) } catch {}
      const note = document.createElement('div')
      note.textContent = `Starting LETmeGIRAFFETHATFORYOU: ${mode}`
      note.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483650;background:#0b1220;color:#e5e7eb;padding:8px 12px;border:1px solid rgba(255,255,255,0.18);border-radius:8px;font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,0.35)'
      document.body.appendChild(note)
      setTimeout(()=> note.remove(), 1800)
    }
    dockBtn?.addEventListener('click', () => { if (isChatDocked()) undockCommandChat(); else dockCommandChat() })
    // Listen for theme change broadcast and restyle docked chat, without inline CSS rewrite logic
    window.addEventListener('optimando-theme-changed', (e: any) => {
      const t = (e?.detail?.theme || localStorage.getItem('optimando-ui-theme') || 'default') as 'default'|'dark'|'professional'
      try { setDockedChatTheme(t) } catch {}
      // Re-style WRVault button gradient per theme
      try {
        const btn = document.getElementById('wrvault-open-btn') as HTMLButtonElement | null
        if (btn) {
          if (t === 'professional') {
            btn.style.background = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
            btn.style.border = '1px solid #cbd5e1'
            btn.style.color = '#1e293b'
          } else if (t === 'dark') {
            btn.style.background = 'linear-gradient(135deg,#334155,#1e293b)'
            btn.style.color = '#e5e7eb'
          } else {
            btn.style.background = 'linear-gradient(135deg,#667eea,#764ba2)'
            btn.style.color = '#ffffff'
          }
        }
      } catch {}
    })
    // Apply initial state
    updateDockButtonUI(); if (isChatDocked()) createDockedChat()
    // Initial theme styling for WRVault button
    try {
      const currentTheme = (localStorage.getItem('optimando-ui-theme') || 'default') as 'default'|'dark'|'professional'
      const btn = document.getElementById('wrvault-open-btn') as HTMLButtonElement | null
      if (btn) {
        if (currentTheme === 'professional') {
          btn.style.background = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)'
          btn.style.border = '1px solid #cbd5e1'
          btn.style.color = '#1e293b'
        } else if (currentTheme === 'dark') {
          btn.style.background = 'linear-gradient(135deg,#334155,#1e293b)'
          btn.style.color = '#e5e7eb'
        } else {
          btn.style.background = 'linear-gradient(135deg,#667eea,#764ba2)'
          btn.style.color = '#ffffff'
        }
      }
    } catch {}
    
    // Right sidebar buttons
    document.getElementById('add-helpergrid-btn')?.addEventListener('click', openHelperGridLightbox)
    document.getElementById('sessions-history-btn')?.addEventListener('click', openSessionsLightbox)
    document.getElementById('save-session-btn')?.addEventListener('click', saveCurrentSession)
    document.getElementById('sync-btn')?.addEventListener('click', syncSession)
    document.getElementById('export-btn')?.addEventListener('click', exportSession)
    document.getElementById('import-btn')?.addEventListener('click', importSession)
    document.getElementById('wrvault-open-btn')?.addEventListener('click', openWRVaultLightbox)
    
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
    // Command Center button -> open standalone popup via background
    document.getElementById('command-center-btn')?.addEventListener('click', () => {
      try {
        let theme = 'default'
        try {
          const t = localStorage.getItem('optimando-ui-theme')
          if (t === 'professional' || t === 'dark') theme = t
        } catch {}
        chrome.runtime.sendMessage({ type: 'OPEN_COMMAND_CENTER_POPUP', theme })
      } catch (e) {
        console.error('Failed to request Command Chat popup:', e)
      }
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
            console.log('🔒 Session saved:', sessionKey, 'with', sessionData.helperTabs?.urls?.length || 0, 'helper tabs,', sessionData.agentBoxes?.length || 0, 'agent boxes')
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

// Debug function to view all stored sessions
;(window as any).viewOptimandoSessions = function() {
  console.log('📋 Viewing all Optimando storage...')
  chrome.storage.local.get(null, (allData) => {
    const sessionKeys = Object.keys(allData).filter(key => key.startsWith('session_'))
    console.log('📊 Found', sessionKeys.length, 'sessions:')
    sessionKeys.forEach(key => {
      const session = allData[key]
      console.log(`\n📁 ${key}:`, {
        tabName: session.tabName,
        timestamp: session.timestamp,
        isLocked: session.isLocked,
        displayGrids: session.displayGrids?.length || 0,
        agentBoxes: session.agentBoxes?.length || 0,
        url: session.url
      })
    })
    
    // Also check localStorage
    const localKeys = Object.keys(localStorage).filter(key => key.includes('optimando'))
    console.log('\n📦 localStorage items:', localKeys.length)
    localKeys.forEach(key => {
      console.log(`  - ${key}:`, localStorage.getItem(key)?.substring(0, 100) + '...')
    })
  })
}

// Debug function to manually clear all sessions from console
;(window as any).clearAllOptimandoSessions = function() {
  console.log('🗑️ Manual NUCLEAR clear - removing EVERYTHING Optimando related')
  
  // Clear chrome.storage.local
  chrome.storage.local.clear(() => {
    if (chrome.runtime.lastError) {
      console.error('❌ Error clearing chrome.storage.local:', chrome.runtime.lastError)
    } else {
      console.log('✅ Cleared ALL chrome.storage.local')
    }
  })
  
  // Clear ALL localStorage items with optimando
  const localKeys = Object.keys(localStorage).filter(key => key.toLowerCase().includes('optimando'))
  localKeys.forEach(key => {
    localStorage.removeItem(key)
    console.log('  ✅ Removed localStorage:', key)
  })
  console.log('✅ Cleared', localKeys.length, 'localStorage items')
  
  // Clear sessionStorage
  const sessionKeys = Object.keys(sessionStorage).filter(key => key.toLowerCase().includes('optimando'))
  sessionKeys.forEach(key => {
    sessionStorage.removeItem(key)
    console.log('  ✅ Removed sessionStorage:', key)
  })
  console.log('✅ Cleared', sessionKeys.length, 'sessionStorage items')
  
  // Reset currentTabData if it exists
  if (typeof currentTabData !== 'undefined') {
    (window as any).currentTabData.displayGrids = []
    console.log('✅ Reset currentTabData.displayGrids')
  }
  
  console.log('🎯 NUCLEAR CLEAR COMPLETE - All Optimando data removed!')
  console.log('⚠️ Reload the page to start fresh')
}

if (isExtensionActive) {
  console.log('🚀 Initializing extension automatically...')
  console.log('💡 TIP: To manually clear all sessions, run: clearAllOptimandoSessions()')
  initializeExtension()
} else {
  console.log('❌ Extension not active, skipping initialization')
}