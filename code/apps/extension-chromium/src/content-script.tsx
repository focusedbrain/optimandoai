// Content script with full AI Orchestrator - COMPLETE SYSTEM
console.log('🚀 Optimando AI Orchestrator lädt...')

// Check if already loaded to prevent duplicates
if (document.getElementById('optimando-sidebars')) {
  console.log('⚠️ Content Script bereits geladen, überspringe...')
} else {

// Tab-spezifische Datenstrukturen
interface TabReasoningData {
  tabId: string
  tabName: string
  url: string
  title: string
  isLocked: boolean
  goals: {
    shortTerm: string
    midTerm: string
    longTerm: string
  }
  aiSchemas: string[]
  userIntentDetection: {
    detected: string
    confidence: number
    lastUpdate: string
  }
  uiConfig: {
    leftSidebarWidth: number
    rightSidebarWidth: number
    bottomSidebarHeight: number
  }
}

// Globale State-Variablen
let currentTabData: TabReasoningData = {
  tabId: generateVoiceFriendlyTabId(),
  tabName: generateVoiceFriendlyTabName(),
  url: window.location.href,
  title: document.title,
  isLocked: false,
  goals: {
    shortTerm: '',
    midTerm: '',
    longTerm: ''
  },
  aiSchemas: [],
  userIntentDetection: {
    detected: 'Browse & Research',
    confidence: 85,
    lastUpdate: 'Just now'
  },
  uiConfig: {
    leftSidebarWidth: 280,
    rightSidebarWidth: 280,
    bottomSidebarHeight: 250
  }
}

// Voice-friendly Tab ID Generator
function generateVoiceFriendlyTabId(): string {
  const adjectives = ['clever', 'swift', 'bright', 'smart', 'quick', 'wise', 'keen', 'alert']
  const nouns = ['falcon', 'eagle', 'wolf', 'tiger', 'shark', 'bear', 'lion', 'fox']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const noun = nouns[Math.floor(Math.random() * nouns.length)]
  const num = Math.floor(Math.random() * 100)
  return `${adj}-${noun}-${num}`
}

// Voice-friendly Tab Name Generator
function generateVoiceFriendlyTabName(): string {
  const domain = window.location.hostname.replace('www.', '').split('.')[0]
  const title = document.title.split(' ').slice(0, 3).join(' ')
  return `${domain} ${title}`.substring(0, 30)
}

// localStorage Utilities
function saveTabDataToStorage() {
  const key = `optimando_tab_${currentTabData.tabId}`
  localStorage.setItem(key, JSON.stringify(currentTabData))
  console.log('💾 Tab-Daten gespeichert:', currentTabData.tabId)
}

function loadTabDataFromStorage() {
  const keys = Object.keys(localStorage).filter(key => key.startsWith('optimando_tab_'))
  if (keys.length > 0) {
    const lastKey = keys[keys.length - 1]
    const data = localStorage.getItem(lastKey)
    if (data) {
      currentTabData = JSON.parse(data)
      console.log('📂 Tab-Daten geladen:', currentTabData.tabId)
    }
  }
}

// Create the sidebars container
const sidebarsDiv = document.createElement('div')
sidebarsDiv.id = 'optimando-sidebars'
sidebarsDiv.style.cssText = `
  position: fixed;
  left: 0;
  top: 0;
  width: 100vw;
  height: 100vh;
  z-index: 999998;
  display: none;
  pointer-events: none;
`

// Inject overlay CSS to prevent layout disruption
function injectOverlayCSS() {
  const styleElement = document.createElement('style')
  styleElement.id = 'optimando-overlay-styles'
  styleElement.textContent = `
    body.optimando-sidebars-active {
      margin-left: ${currentTabData.uiConfig.leftSidebarWidth}px !important;
      margin-right: ${currentTabData.uiConfig.rightSidebarWidth}px !important;
      margin-bottom: ${currentTabData.uiConfig.bottomSidebarHeight}px !important;
      transition: margin 0.3s ease !important;
    }
    
    #optimando-sidebars * {
      box-sizing: border-box;
    }
  `
  document.head.appendChild(styleElement)
}

// Add left sidebar
const leftSidebar = document.createElement('div')
leftSidebar.id = 'left-sidebar'
leftSidebar.style.cssText = `
  position: absolute;
  left: 0;
  top: 0;
  width: ${currentTabData.uiConfig.leftSidebarWidth}px;
  height: 100vh;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
  color: white;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  box-shadow: 2px 0 10px rgba(0,0,0,0.3);
  transition: width 0.3s ease;
  pointer-events: auto;
  overflow-y: auto;
  backdrop-filter: blur(10px);
`

// Add close button to left sidebar
const leftCloseBtn = document.createElement('button')
leftCloseBtn.innerHTML = '✕'
leftCloseBtn.style.cssText = `
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(255,255,255,0.2);
  border: none;
  color: white;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
`
leftCloseBtn.onmouseover = () => leftCloseBtn.style.background = 'rgba(255,255,255,0.3)'
leftCloseBtn.onmouseout = () => leftCloseBtn.style.background = 'rgba(255,255,255,0.2)'
leftCloseBtn.onclick = () => {
  leftSidebar.style.width = '0px'
  leftSidebar.style.overflow = 'hidden'
  leftSidebar.style.padding = '0'
  leftCloseBtn.style.display = 'none'
  leftResizeHandle.style.display = 'none'
  currentTabData.uiConfig.leftSidebarWidth = 0
  adjustBrowserContent()
  saveTabDataToStorage()
}

// Add resize handle to left sidebar
const leftResizeHandle = document.createElement('div')
leftResizeHandle.style.cssText = `
  position: absolute;
  right: 0;
  top: 0;
  width: 5px;
  height: 100%;
  background: rgba(255,255,255,0.3);
  cursor: ew-resize;
  transition: background 0.2s;
`
leftResizeHandle.onmouseover = () => leftResizeHandle.style.background = 'rgba(255,255,255,0.5)'
leftResizeHandle.onmouseout = () => leftResizeHandle.style.background = 'rgba(255,255,255,0.3)'

// Resize functionality for left sidebar
let isResizingLeft = false
leftResizeHandle.onmousedown = (e) => {
  isResizingLeft = true
  e.preventDefault()
}
document.addEventListener('mousemove', (e) => {
  if (isResizingLeft) {
    const newWidth = Math.max(200, Math.min(500, e.clientX))
    leftSidebar.style.width = newWidth + 'px'
    currentTabData.uiConfig.leftSidebarWidth = newWidth
    adjustBrowserContent()
  }
})
document.addEventListener('mouseup', () => {
  if (isResizingLeft) {
    isResizingLeft = false
    saveTabDataToStorage()
  }
})

// Left sidebar content - AI AGENT OUTPUT DISPLAY PORTS
const leftContent = document.createElement('div')
leftContent.innerHTML = `
  <h2 style="margin: 0 0 20px 0; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 10px;">
    🤖 AI Agent Outputs
  </h2>
  
  <!-- Display Port 1: Summarize Agent -->
  <div id="display-port-summarize" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px;">
    <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #4CAF50;">📝 Summarize Agent</h4>
    <div style="font-size: 12px; opacity: 0.8;">
      <div id="summarize-output">Bereit für Zusammenfassungen...</div>
    </div>
  </div>

  <!-- Display Port 2: Research Agent -->
  <div id="display-port-research" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px;">
    <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #2196F3;">🔍 Research Agent</h4>
    <div style="font-size: 12px; opacity: 0.8;">
      <div id="research-output">Bereit für Analysen...</div>
    </div>
  </div>

  <!-- Display Port 3: Goal Tracker -->
  <div id="display-port-goals" style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px;">
    <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #FF9800;">🎯 Goal Tracker</h4>
    <div style="font-size: 12px; opacity: 0.8;">
      <div id="goals-output">Bereit für Ziel-Tracking...</div>
    </div>
  </div>

  <!-- Monitor Output Info -->
  <div style="margin-top: 30px; padding: 15px; background: rgba(255,215,0,0.1); border-radius: 8px; border: 1px solid rgba(255,215,0,0.3);">
    <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #FFD700;">🖥️ Monitor Output</h4>
    <div style="font-size: 12px; opacity: 0.8;">
      Größere AI-Ausgaben werden direkt auf Monitor per Electron App angezeigt.
    </div>
  </div>
`

leftSidebar.appendChild(leftContent)
leftSidebar.appendChild(leftCloseBtn)
leftSidebar.appendChild(leftResizeHandle)

// Add right sidebar
const rightSidebar = document.createElement('div')
rightSidebar.id = 'right-sidebar'
rightSidebar.style.cssText = `
  position: absolute;
  right: 0;
  top: 0;
  width: ${currentTabData.uiConfig.rightSidebarWidth}px;
  height: 100vh;
  background: linear-gradient(135deg, rgba(118, 75, 162, 0.95) 0%, rgba(102, 126, 234, 0.95) 100%);
  color: white;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  box-shadow: -2px 0 10px rgba(0,0,0,0.3);
  transition: width 0.3s ease;
  pointer-events: auto;
  overflow-y: auto;
  backdrop-filter: blur(10px);
`

// Add close button to right sidebar
const rightCloseBtn = document.createElement('button')
rightCloseBtn.innerHTML = '✕'
rightCloseBtn.style.cssText = `
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(255,255,255,0.2);
  border: none;
  color: white;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
`
rightCloseBtn.onmouseover = () => rightCloseBtn.style.background = 'rgba(255,255,255,0.3)'
rightCloseBtn.onmouseout = () => rightCloseBtn.style.background = 'rgba(255,255,255,0.2)'
rightCloseBtn.onclick = () => {
  rightSidebar.style.width = '0px'
  rightSidebar.style.overflow = 'hidden'
  rightSidebar.style.padding = '0'
  rightCloseBtn.style.display = 'none'
  rightResizeHandle.style.display = 'none'
  currentTabData.uiConfig.rightSidebarWidth = 0
  adjustBrowserContent()
  saveTabDataToStorage()
}

// Add resize handle to right sidebar
const rightResizeHandle = document.createElement('div')
rightResizeHandle.style.cssText = `
  position: absolute;
  left: 0;
  top: 0;
  width: 5px;
  height: 100%;
  background: rgba(255,255,255,0.3);
  cursor: ew-resize;
  transition: background 0.2s;
`
rightResizeHandle.onmouseover = () => rightResizeHandle.style.background = 'rgba(255,255,255,0.5)'
rightResizeHandle.onmouseout = () => rightResizeHandle.style.background = 'rgba(255,255,255,0.3)'

// Resize functionality for right sidebar
let isResizingRight = false
rightResizeHandle.onmousedown = (e) => {
  isResizingRight = true
  e.preventDefault()
}
document.addEventListener('mousemove', (e) => {
  if (isResizingRight) {
    const newWidth = Math.max(200, Math.min(500, window.innerWidth - e.clientX))
    rightSidebar.style.width = newWidth + 'px'
    currentTabData.uiConfig.rightSidebarWidth = newWidth
    adjustBrowserContent()
  }
})
document.addEventListener('mouseup', () => {
  if (isResizingRight) {
    isResizingRight = false
    saveTabDataToStorage()
  }
})

// Right sidebar content with Controls
const rightContent = document.createElement('div')
rightContent.innerHTML = `
  <h2 style="margin: 0 0 20px 0; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 10px;">
    ⚙️ AI Control Center
  </h2>
  <div style="margin-bottom: 20px;">
    <button id="wrscan-btn" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 5px; cursor: pointer; margin-bottom: 10px; font-size: 14px;">
      📱 WRScan
    </button>
    <button id="qr-scanner-btn" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 5px; cursor: pointer; margin-bottom: 10px; font-size: 14px;">
      📱 QR Code Scanner
    </button>
    <button id="ai-agents-btn" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 5px; cursor: pointer; margin-bottom: 10px; font-size: 14px;">
      🤖 AI Agenten
    </button>
    <button id="session-save-btn" style="width: 100%; padding: 12px; background: rgba(76, 175, 80, 0.8); border: none; color: white; border-radius: 5px; cursor: pointer; margin-bottom: 10px; font-size: 14px; font-weight: bold;">
      💾 Save Session
    </button>
    <button id="display-config-btn" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 5px; cursor: pointer; margin-bottom: 10px; font-size: 14px;">
      🖥️ Display Config
    </button>
    <button id="settings-btn" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 5px; cursor: pointer; font-size: 14px;">
      ⚙️ Einstellungen
    </button>
  </div>
  <div style="margin-top: 30px;">
    <h3 style="margin: 0 0 15px 0; font-size: 16px;">Quick Actions</h3>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <button style="padding: 8px; background: rgba(255,152,0,0.8); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">
        🔥 Hot Reload
      </button>
      <button style="padding: 8px; background: rgba(244,67,54,0.8); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">
        🚫 Emergency
      </button>
      <button style="padding: 8px; background: rgba(156,39,176,0.8); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">
        🎨 Theme
      </button>
      <button style="padding: 8px; background: rgba(33,150,243,0.8); border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">
        🔄 Sync
      </button>
    </div>
  </div>
`

rightSidebar.appendChild(rightContent)
rightSidebar.appendChild(rightCloseBtn)
rightSidebar.appendChild(rightResizeHandle)

// Add bottom sidebar - THE REASONING PANEL
const bottomSidebar = document.createElement('div')
bottomSidebar.id = 'bottom-sidebar'
bottomSidebar.style.cssText = `
  position: absolute;
  left: ${currentTabData.uiConfig.leftSidebarWidth}px;
  right: ${currentTabData.uiConfig.rightSidebarWidth}px;
  bottom: 0;
  height: ${currentTabData.uiConfig.bottomSidebarHeight}px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
  color: white;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  box-shadow: 0 -2px 10px rgba(0,0,0,0.3);
  transition: height 0.3s ease;
  pointer-events: auto;
  overflow-y: auto;
  backdrop-filter: blur(10px);
`

// Add close button to bottom sidebar
const bottomCloseBtn = document.createElement('button')
bottomCloseBtn.innerHTML = '✕'
bottomCloseBtn.style.cssText = `
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(255,255,255,0.2);
  border: none;
  color: white;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  transition: background 0.2s;
`
bottomCloseBtn.onmouseover = () => bottomCloseBtn.style.background = 'rgba(255,255,255,0.3)'
bottomCloseBtn.onmouseout = () => bottomCloseBtn.style.background = 'rgba(255,255,255,0.2)'
bottomCloseBtn.onclick = () => {
  bottomSidebar.style.height = '0px'
  bottomSidebar.style.overflow = 'hidden'
  bottomSidebar.style.padding = '0'
  bottomCloseBtn.style.display = 'none'
  bottomResizeHandle.style.display = 'none'
  currentTabData.uiConfig.bottomSidebarHeight = 0
  adjustBrowserContent()
  saveTabDataToStorage()
}

// Add resize handle to bottom sidebar
const bottomResizeHandle = document.createElement('div')
bottomResizeHandle.style.cssText = `
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 5px;
  background: rgba(255,255,255,0.3);
  cursor: ns-resize;
  transition: background 0.2s;
`
bottomResizeHandle.onmouseover = () => bottomResizeHandle.style.background = 'rgba(255,255,255,0.5)'
bottomResizeHandle.onmouseout = () => bottomResizeHandle.style.background = 'rgba(255,255,255,0.3)'

// Resize functionality for bottom sidebar
let isResizingBottom = false
bottomResizeHandle.onmousedown = (e) => {
  isResizingBottom = true
  e.preventDefault()
}
document.addEventListener('mousemove', (e) => {
  if (isResizingBottom) {
    const newHeight = Math.max(150, Math.min(400, window.innerHeight - e.clientY))
    bottomSidebar.style.height = newHeight + 'px'
    currentTabData.uiConfig.bottomSidebarHeight = newHeight
    adjustBrowserContent()
  }
})
document.addEventListener('mouseup', () => {
  if (isResizingBottom) {
    isResizingBottom = false
    saveTabDataToStorage()
  }
})

// Bottom sidebar - COMPLETE AI ORCHESTRATION CENTER
const orchestrationTabs = document.createElement('div')
orchestrationTabs.style.cssText = `
  display: flex;
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  margin-bottom: 15px;
  overflow: hidden;
`

const tabs = ['reasoning', 'agents', 'templates', 'settings']
const tabNames = ['🧠 Reasoning', '🤖 Agents', '📋 Templates', '⚙️ Settings']

tabs.forEach((tab, index) => {
  const tabBtn = document.createElement('button')
  tabBtn.textContent = tabNames[index]
  tabBtn.style.cssText = `
    flex: 1;
    padding: 10px;
    background: ${index === 0 ? 'rgba(255,255,255,0.2)' : 'transparent'};
    border: none;
    color: white;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.3s ease;
  `
  tabBtn.onclick = () => switchOrchestrationTab(tab)
  orchestrationTabs.appendChild(tabBtn)
})

// Tab Content Container
const orchestrationContent = document.createElement('div')
orchestrationContent.id = 'orchestration-content'
orchestrationContent.style.cssText = `
  height: calc(100% - 80px);
  overflow-y: auto;
`

// Tab 1: Reasoning Panel (Default)
const reasoningPanel = document.createElement('div')
reasoningPanel.id = 'reasoning-tab'
reasoningPanel.style.cssText = `display: flex; gap: 15px; height: 100%;`

// Column 1: User Intent Detection
const col1 = document.createElement('div')
col1.style.cssText = `flex: 1; background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;`
col1.innerHTML = `
  <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #FFD700;">🎯 Intent Detection</h4>
  <div style="font-size: 11px; opacity: 0.8;">
    <div>Detected: <span style="color: #4CAF50;" id="detected-intent">${currentTabData.userIntentDetection.detected}</span></div>
    <div style="margin-top: 6px;">Confidence: <span id="confidence">${currentTabData.userIntentDetection.confidence}%</span></div>
    <div style="margin-top: 6px;">Last Update: <span id="last-update">${currentTabData.userIntentDetection.lastUpdate}</span></div>
  </div>
`

// Column 2: Goals (Editable)
const col2 = document.createElement('div')
col2.style.cssText = `flex: 1; background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;`
col2.innerHTML = `
  <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #FFD700;">🎯 Goals</h4>
  <div style="font-size: 11px;">
    <div style="margin-bottom: 8px;">
      <strong>Short:</strong><br>
      <input type="text" id="short-term-goal" value="${currentTabData.goals.shortTerm}" placeholder="Now..." style="width: 100%; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 3px; font-size: 10px; margin-top: 2px;">
    </div>
    <div style="margin-bottom: 8px;">
      <strong>Mid:</strong><br>
      <input type="text" id="mid-term-goal" value="${currentTabData.goals.midTerm}" placeholder="Next..." style="width: 100%; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 3px; font-size: 10px; margin-top: 2px;">
    </div>
    <div>
      <strong>Long:</strong><br>
      <input type="text" id="long-term-goal" value="${currentTabData.goals.longTerm}" placeholder="Big picture..." style="width: 100%; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 3px; font-size: 10px; margin-top: 2px;">
    </div>
  </div>
`

// Column 3: AI Reasoning
const col3 = document.createElement('div')
col3.style.cssText = `flex: 1; background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;`
col3.innerHTML = `
  <h4 style="margin: 0 0 10px 0; font-size: 13px; color: #FFD700;">🤖 AI Reasoning</h4>
  <div style="font-size: 11px; opacity: 0.8;">
    <div>Active: <span id="active-agents-count">0</span></div>
    <div style="margin-top: 6px;">Status: <span id="reasoning-status">Standby</span></div>
    <div style="margin-top: 10px;">
      <button id="activate-reasoning-btn" style="width: 100%; padding: 5px; background: rgba(76, 175, 80, 0.8); border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">
        🚀 Activate
      </button>
    </div>
  </div>
`

reasoningPanel.appendChild(col1)
reasoningPanel.appendChild(col2)
reasoningPanel.appendChild(col3)

// Tab 2: AI Agents Management
const agentsPanel = document.createElement('div')
agentsPanel.id = 'agents-tab'
agentsPanel.style.cssText = `display: none; height: 100%; overflow-y: auto;`
agentsPanel.innerHTML = `
  <div style="margin-bottom: 15px;">
    <button id="add-agent-btn" style="padding: 8px 15px; background: #4CAF50; border: none; color: white; border-radius: 5px; cursor: pointer; font-size: 12px; margin-right: 10px;">
      ➕ New Agent
    </button>
    <button id="start-workflow-btn" style="padding: 8px 15px; background: #2196F3; border: none; color: white; border-radius: 5px; cursor: pointer; font-size: 12px;">
      🚀 Start Workflow
    </button>
  </div>
  
  <div id="agents-list" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
    <!-- Agent 1 -->
    <div class="agent-card" style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 12px; font-weight: bold; color: #4CAF50;">📝 Summarize</span>
        <button class="agent-toggle" data-agent="summarize" style="background: #f44336; border: none; color: white; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px;">
          OFF
        </button>
      </div>
      <textarea id="summarize-instructions" style="width: 100%; height: 60px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 10px;" placeholder="AI Instructions...">Du bist ein Experte im Zusammenfassen von Inhalten.</textarea>
      <div style="margin-top: 8px;">
        <select id="summarize-display" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 3px; font-size: 10px;">
          <option value="left-sidebar">Left Display Port</option>
          <option value="monitor">Monitor Output</option>
        </select>
      </div>
    </div>
    
    <!-- Agent 2 -->
    <div class="agent-card" style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 12px; font-weight: bold; color: #2196F3;">🔍 Research</span>
        <button class="agent-toggle" data-agent="research" style="background: #f44336; border: none; color: white; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px;">
          OFF
        </button>
      </div>
      <textarea id="research-instructions" style="width: 100%; height: 60px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 10px;" placeholder="AI Instructions...">Du bist ein Research-Spezialist für Web-Analysen.</textarea>
      <div style="margin-top: 8px;">
        <select id="research-display" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 3px; font-size: 10px;">
          <option value="left-sidebar">Left Display Port</option>
          <option value="monitor" selected>Monitor Output</option>
        </select>
      </div>
    </div>
    
    <!-- Agent 3 -->
    <div class="agent-card" style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 12px; font-weight: bold; color: #FF9800;">🎯 Goal Tracker</span>
        <button class="agent-toggle" data-agent="goals" style="background: #f44336; border: none; color: white; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px;">
          OFF
        </button>
      </div>
      <textarea id="goals-instructions" style="width: 100%; height: 60px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 10px;" placeholder="AI Instructions...">Du bist ein Goal-Tracking Experte.</textarea>
      <div style="margin-top: 8px;">
        <select id="goals-display" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 3px; font-size: 10px;">
          <option value="left-sidebar" selected>Left Display Port</option>
          <option value="monitor">Monitor Output</option>
        </select>
      </div>
    </div>
    
    <!-- Add New Agent Placeholder -->
    <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px; border: 2px dashed rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; cursor: pointer;" onclick="addNewAgent()">
      <span style="font-size: 12px; opacity: 0.6;">➕ Add Agent</span>
    </div>
  </div>
`

// Tab 3: Templates
const templatesPanel = document.createElement('div')
templatesPanel.id = 'templates-tab'
templatesPanel.style.cssText = `display: none; height: 100%; overflow-y: auto;`
templatesPanel.innerHTML = `
  <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px;">
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center;">
      <div style="font-size: 24px; margin-bottom: 10px;">📚</div>
      <h4 style="margin: 0 0 8px 0; font-size: 14px;">Research Template</h4>
      <p style="font-size: 11px; opacity: 0.8; margin-bottom: 15px;">Summarize + Research Agents</p>
      <button style="padding: 6px 12px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 11px;">Load</button>
    </div>
    
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center;">
      <div style="font-size: 24px; margin-bottom: 10px;">🎯</div>
      <h4 style="margin: 0 0 8px 0; font-size: 14px;">Goal Management</h4>
      <p style="font-size: 11px; opacity: 0.8; margin-bottom: 15px;">Goal Tracker + Monitor</p>
      <button style="padding: 6px 12px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 11px;">Load</button>
    </div>
    
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center;">
      <div style="font-size: 24px; margin-bottom: 10px;">🤖</div>
      <h4 style="margin: 0 0 8px 0; font-size: 14px;">Multi-Agent</h4>
      <p style="font-size: 11px; opacity: 0.8; margin-bottom: 15px;">All Agents + Pipeline</p>
      <button style="padding: 6px 12px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 11px;">Load</button>
    </div>
  </div>
  
  <div style="margin-top: 20px;">
    <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #FFD700;">💉 Template Injection</h4>
    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
      <input type="text" id="template-url" placeholder="Template URL from wrcode.org" style="flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px; border-radius: 4px; font-size: 12px;">
      <button style="padding: 8px 15px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">📥 Load</button>
    </div>
    <button id="qr-scan-btn" style="width: 100%; padding: 8px; background: #FF9800; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">📱 QR Code Scan</button>
  </div>
`

// Tab 4: Settings
const settingsPanel = document.createElement('div')
settingsPanel.id = 'settings-tab'
settingsPanel.style.cssText = `display: none; height: 100%; overflow-y: auto;`
settingsPanel.innerHTML = `
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
    <div>
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #FFD700;">🔧 System Settings</h4>
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 11px; margin-bottom: 3px;">Max Agents:</label>
        <input type="number" id="max-agents" value="5" min="1" max="20" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 11px;">
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 11px; margin-bottom: 3px;">Memory Retention (days):</label>
        <input type="number" id="memory-retention" value="30" min="1" max="365" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 11px;">
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 11px; margin-bottom: 3px;">Debug Mode:</label>
        <select id="debug-mode" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 11px;">
          <option value="false">Off</option>
          <option value="true">On</option>
        </select>
      </div>
    </div>
    
    <div>
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #FFD700;">🖥️ Display Settings</h4>
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 11px; margin-bottom: 3px;">Theme:</label>
        <select id="theme" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 11px;">
          <option value="dark" selected>Dark</option>
          <option value="light">Light</option>
          <option value="auto">Auto</option>
        </select>
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 11px; margin-bottom: 3px;">Monitor Output:</label>
        <select id="monitor-output" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 11px;">
          <option value="electron" selected>Electron App</option>
          <option value="browser">Browser Window</option>
          <option value="popup">Popup Window</option>
        </select>
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 11px; margin-bottom: 3px;">API Endpoint:</label>
        <input type="text" id="api-endpoint" value="localhost:51247" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 11px;">
      </div>
    </div>
  </div>
  
  <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2);">
    <button style="padding: 8px 15px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 10px;">💾 Save Settings</button>
    <button style="padding: 8px 15px; background: #f44336; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px; margin-right: 10px;">🔄 Reset</button>
    <button style="padding: 8px 15px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">📤 Export</button>
  </div>
`

// Add ALL panels to orchestration content initially
orchestrationContent.appendChild(reasoningPanel)
orchestrationContent.appendChild(agentsPanel)
orchestrationContent.appendChild(templatesPanel)
orchestrationContent.appendChild(settingsPanel)

// Set default visibility - only show reasoning initially
reasoningPanel.style.display = 'flex'
agentsPanel.style.display = 'none'
templatesPanel.style.display = 'none'
settingsPanel.style.display = 'none'

const bottomContent = document.createElement('div')
bottomContent.style.cssText = `height: 100%;`
bottomContent.appendChild(orchestrationTabs)
bottomContent.appendChild(orchestrationContent)

// Create Tab Header for Bottom Sidebar
const tabHeader = document.createElement('div')
tabHeader.style.cssText = `
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.3);
`

const tabNameSection = document.createElement('div')
tabNameSection.style.cssText = `display: flex; align-items: center; gap: 10px;`

const tabNameInput = document.createElement('input')
tabNameInput.type = 'text'
tabNameInput.value = currentTabData.tabName
tabNameInput.style.cssText = `
  background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.3);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  width: 150px;
`
tabNameInput.oninput = () => {
  currentTabData.tabName = tabNameInput.value
  saveTabDataToStorage()
}

const lockButton = document.createElement('button')
lockButton.innerHTML = currentTabData.isLocked ? '🔒' : '🔓'
lockButton.style.cssText = `
  background: rgba(255,255,255,0.2);
  border: none;
  color: white;
  width: 25px;
  height: 25px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
`
lockButton.onclick = () => {
  currentTabData.isLocked = !currentTabData.isLocked
  lockButton.innerHTML = currentTabData.isLocked ? '🔒' : '🔓'
  tabNameInput.disabled = currentTabData.isLocked
  tabNameInput.style.opacity = currentTabData.isLocked ? '0.5' : '1'
  saveTabDataToStorage()
}

tabNameSection.appendChild(tabNameInput)
tabNameSection.appendChild(lockButton)

const tabId = document.createElement('span')
tabId.textContent = `ID: ${currentTabData.tabId}`
tabId.style.cssText = `font-size: 10px; opacity: 0.7;`

tabHeader.appendChild(tabNameSection)
tabHeader.appendChild(tabId)

bottomSidebar.appendChild(tabHeader)
bottomSidebar.appendChild(bottomContent)
bottomSidebar.appendChild(bottomCloseBtn)
bottomSidebar.appendChild(bottomResizeHandle)

// Add all sidebars to container
sidebarsDiv.appendChild(leftSidebar)
sidebarsDiv.appendChild(rightSidebar)
sidebarsDiv.appendChild(bottomSidebar)

// Add container to page
document.body.appendChild(sidebarsDiv)
console.log('✅ Sidebars container hinzugefügt')

// Function to adjust browser content margins (like Microsoft Copilot)
function adjustBrowserContent() {
  try {
    const leftWidth = leftSidebar.style.width === '0px' ? 0 : parseInt(leftSidebar.style.width) || currentTabData.uiConfig.leftSidebarWidth
    const rightWidth = rightSidebar.style.width === '0px' ? 0 : parseInt(rightSidebar.style.width) || currentTabData.uiConfig.rightSidebarWidth
    const bottomHeight = bottomSidebar.style.height === '0px' ? 0 : parseInt(bottomSidebar.style.height) || currentTabData.uiConfig.bottomSidebarHeight
    
    // Apply margins to body to push content away from sidebars
    document.body.style.marginLeft = leftWidth + 'px'
    document.body.style.marginRight = rightWidth + 'px'
    document.body.style.marginBottom = bottomHeight + 'px'
    document.body.style.transition = 'margin 0.3s ease'
    
    // Also adjust the bottom sidebar position based on left/right sidebar widths
    if (bottomSidebar.style.height !== '0px') {
      bottomSidebar.style.left = leftWidth + 'px'
      bottomSidebar.style.right = rightWidth + 'px'
    }
    
    console.log('Browser-Inhalt angepasst:', { leftWidth, rightWidth, bottomHeight })
  } catch (error) {
    console.log('Fehler beim Anpassen der Browser-Inhalte:', error)
  }
}

// Function to update reasoning panel with current data
function updateReasoningPanel() {
  // Update tab name input
  const tabNameInput = document.getElementById('tab-name-input') as HTMLInputElement
  if (tabNameInput) tabNameInput.value = currentTabData.tabName
  
  // Update intent detection
  const detectedIntent = document.getElementById('detected-intent')
  if (detectedIntent) detectedIntent.textContent = currentTabData.userIntentDetection.detected
  
  const confidence = document.getElementById('confidence')
  if (confidence) confidence.textContent = currentTabData.userIntentDetection.confidence + '%'
  
  const lastUpdate = document.getElementById('last-update')
  if (lastUpdate) lastUpdate.textContent = currentTabData.userIntentDetection.lastUpdate
  
  // Update goals
  const shortTermGoal = document.getElementById('short-term-goal') as HTMLInputElement
  if (shortTermGoal) shortTermGoal.value = currentTabData.goals.shortTerm
  
  const midTermGoal = document.getElementById('mid-term-goal') as HTMLInputElement
  if (midTermGoal) midTermGoal.value = currentTabData.goals.midTerm
  
  const longTermGoal = document.getElementById('long-term-goal') as HTMLInputElement
  if (longTermGoal) longTermGoal.value = currentTabData.goals.longTerm
}

// Event Listeners for Goals
setTimeout(() => {
  const shortTermGoal = document.getElementById('short-term-goal') as HTMLInputElement
  const midTermGoal = document.getElementById('mid-term-goal') as HTMLInputElement
  const longTermGoal = document.getElementById('long-term-goal') as HTMLInputElement
  
  if (shortTermGoal) {
    shortTermGoal.oninput = () => {
      currentTabData.goals.shortTerm = shortTermGoal.value
      saveTabDataToStorage()
    }
  }
  
  if (midTermGoal) {
    midTermGoal.oninput = () => {
      currentTabData.goals.midTerm = midTermGoal.value
      saveTabDataToStorage()
    }
  }
  
  if (longTermGoal) {
    longTermGoal.oninput = () => {
      currentTabData.goals.longTerm = longTermGoal.value
      saveTabDataToStorage()
    }
  }
  
  // Session Management Buttons
  const saveSessionBtn = document.getElementById('save-session-btn')
  if (saveSessionBtn) {
    saveSessionBtn.onclick = () => {
      saveTabDataToStorage()
      alert('Session saved successfully!')
    }
  }
  
  const loadSessionBtn = document.getElementById('load-session-btn')
  if (loadSessionBtn) {
    loadSessionBtn.onclick = () => {
      loadTabDataFromStorage()
      updateReasoningPanel()
      alert('Session loaded successfully!')
    }
  }
  
  const voiceControlBtn = document.getElementById('voice-control-btn')
  if (voiceControlBtn) {
    voiceControlBtn.onclick = () => {
      alert(`Voice Control activated for Tab: ${currentTabData.tabId}`)
    }
  }
  
  // Agent Toggle Buttons
  document.querySelectorAll('.agent-toggle').forEach(btn => {
    btn.onclick = () => {
      const agentName = btn.getAttribute('data-agent')
      if (agentName) {
        toggleAgent(agentName)
      }
    }
  })
  
  // Session Save Button
  const sessionSaveBtn = document.getElementById('session-save-btn')
  if (sessionSaveBtn) {
    sessionSaveBtn.onclick = () => {
      saveTabDataToStorage()
      alert('Session saved successfully!')
    }
  }
  
  // Activate Reasoning Button
  const activateReasoningBtn = document.getElementById('activate-reasoning-btn')
  if (activateReasoningBtn) {
    activateReasoningBtn.onclick = () => {
      const reasoningStatus = document.getElementById('reasoning-status')
      if (reasoningStatus) {
        reasoningStatus.textContent = 'Active'
        reasoningStatus.style.color = '#4CAF50'
      }
      alert('AI Reasoning activated!')
    }
  }
}, 100)

// Orchestration Tab Switching Function
function switchOrchestrationTab(tabName) {
  console.log('🔄 Switching to tab:', tabName)
  
  // Reset all tab buttons
  const tabButtons = orchestrationTabs.querySelectorAll('button')
  tabButtons.forEach(btn => {
    btn.style.background = 'transparent'
  })
  
  // Hide all panels
  reasoningPanel.style.display = 'none'
  agentsPanel.style.display = 'none'
  templatesPanel.style.display = 'none'
  settingsPanel.style.display = 'none'
  
  // Activate selected tab button
  const activeButton = Array.from(tabButtons).find(btn => 
    btn.textContent.includes(
      tabName === 'reasoning' ? '🧠' : 
      tabName === 'agents' ? '🤖' : 
      tabName === 'templates' ? '📋' : '⚙️'
    )
  )
  if (activeButton) {
    activeButton.style.background = 'rgba(255,255,255,0.2)'
  }
  
  // Show selected panel
  switch (tabName) {
    case 'reasoning':
      reasoningPanel.style.display = 'flex'
      break
    case 'agents':
      agentsPanel.style.display = 'block'
      break
    case 'templates':
      templatesPanel.style.display = 'block'
      break
    case 'settings':
      settingsPanel.style.display = 'block'
      break
  }
  
  console.log('✅ Tab switched to:', tabName)
}

// Agent Toggle Function
function toggleAgent(agentName) {
  const toggleBtn = document.querySelector(`[data-agent="${agentName}"]`)
  if (!toggleBtn) return
  
  const isActive = toggleBtn.textContent.trim() === 'ON'
  
  if (isActive) {
    toggleBtn.textContent = 'OFF'
    toggleBtn.style.background = '#f44336'
  } else {
    toggleBtn.textContent = 'ON'
    toggleBtn.style.background = '#4CAF50'
  }
  
  // Update active agents count
  const activeCount = document.querySelectorAll('[data-agent]').length - document.querySelectorAll('button:contains("OFF")').length
  const activeAgentsElement = document.getElementById('active-agents-count')
  if (activeAgentsElement) {
    activeAgentsElement.textContent = Math.max(0, activeCount)
  }
  
  // Update display port
  updateDisplayPort(agentName, !isActive)
}

// Update Display Port Function
function updateDisplayPort(agentName, isActive) {
  const displayPortId = `display-port-${agentName === 'goals' ? 'goals' : agentName}`
  const displayPort = document.getElementById(displayPortId)
  
  if (displayPort) {
    const outputElement = displayPort.querySelector(`#${agentName}-output`)
    if (outputElement) {
      if (isActive) {
        outputElement.textContent = `${agentName.charAt(0).toUpperCase() + agentName.slice(1)} Agent aktiv - Bereit für Eingaben...`
      } else {
        outputElement.textContent = `Bereit für ${agentName === 'summarize' ? 'Zusammenfassungen' : agentName === 'research' ? 'Analysen' : 'Ziel-Tracking'}...`
      }
    }
  }
}

// Add New Agent Function
function addNewAgent() {
  const agentName = prompt('Agent Name:')
  if (!agentName) return
  
  const agentId = agentName.toLowerCase().replace(/\s+/g, '-')
  
  // Add to agents list
  const agentsList = document.getElementById('agents-list')
  const newAgentCard = document.createElement('div')
  newAgentCard.className = 'agent-card'
  newAgentCard.style.cssText = 'background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;'
  
  newAgentCard.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-size: 12px; font-weight: bold; color: #9C27B0;">🤖 ${agentName}</span>
      <button class="agent-toggle" data-agent="${agentId}" style="background: #f44336; border: none; color: white; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 10px;">
        OFF
      </button>
    </div>
    <textarea id="${agentId}-instructions" style="width: 100%; height: 60px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 5px; border-radius: 3px; font-size: 10px;" placeholder="AI Instructions...">Du bist ein spezialisierter AI Agent für ${agentName}.</textarea>
    <div style="margin-top: 8px;">
      <select id="${agentId}-display" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 3px; font-size: 10px;">
        <option value="left-sidebar">Left Display Port</option>
        <option value="monitor">Monitor Output</option>
      </select>
    </div>
  `
  
  // Insert before the "Add New Agent" placeholder
  const placeholder = agentsList.querySelector('[onclick="addNewAgent()"]')
  agentsList.insertBefore(newAgentCard, placeholder)
  
  // Add event listener for new toggle button
  const newToggleBtn = newAgentCard.querySelector('.agent-toggle')
  newToggleBtn.onclick = () => toggleAgent(agentId)
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Nachricht erhalten:', message)
  
  if (message.type === 'TOGGLE_SIDEBARS') {
    console.log('Toggle sidebars:', message.visible)
    
    // Toggle sidebars
    if (sidebarsDiv) {
      sidebarsDiv.style.display = message.visible ? 'block' : 'none'
      
      if (message.visible) {
        // Reset sidebar sizes when showing
        leftSidebar.style.width = currentTabData.uiConfig.leftSidebarWidth + 'px'
        rightSidebar.style.width = currentTabData.uiConfig.rightSidebarWidth + 'px'
        bottomSidebar.style.height = currentTabData.uiConfig.bottomSidebarHeight + 'px'
        leftCloseBtn.style.display = 'block'
        rightCloseBtn.style.display = 'block'
        bottomCloseBtn.style.display = 'block'
        leftResizeHandle.style.display = 'block'
        rightResizeHandle.style.display = 'block'
        bottomResizeHandle.style.display = 'block'
        leftSidebar.style.overflow = 'auto'
        rightSidebar.style.overflow = 'auto'
        bottomSidebar.style.overflow = 'auto'
        leftSidebar.style.padding = '20px'
        rightSidebar.style.padding = '20px'
        bottomSidebar.style.padding = '20px'
        
        // Load saved tab data
        loadTabDataFromStorage()
        updateReasoningPanel()
      } else {
        // Reset body margins when hiding
        document.body.style.marginLeft = '0px'
        document.body.style.marginRight = '0px'
        document.body.style.marginBottom = '0px'
      }
      
      adjustBrowserContent()
    }
    
    sendResponse({ success: true })
  }
  
  return true
})

// Initialize system
setTimeout(() => {
  // Load saved tab data
  loadTabDataFromStorage()
  
  // Initialize reasoning panel
  updateReasoningPanel()
  
  // Initialize overlay CSS
  injectOverlayCSS()
  
  console.log('✅ System initialisiert')
}, 1000)

console.log('✅ Message listener hinzugefügt')
console.log('✅ Optimando AI Orchestrator vollständig geladen!')

} // End if-else block