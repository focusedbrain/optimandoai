/// <reference types="chrome-types"/>

// Per-Tab Activation System
let isExtensionActive = false
const tabUrl = window.location.href
const extensionStateKey = `optimando-active-${btoa(tabUrl).substring(0, 20)}`

// Check if extension was previously activated for this URL
const savedState = localStorage.getItem(extensionStateKey)
if (savedState === 'true') {
  isExtensionActive = true
}

// Listen for toggle message from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_SIDEBARS') {
    if (message.visible && !isExtensionActive) {
      isExtensionActive = true
      localStorage.setItem(extensionStateKey, 'true')
      initializeExtension()
      console.log('🚀 Extension activated for tab')
    } else if (!message.visible && isExtensionActive) {
      isExtensionActive = false
      localStorage.setItem(extensionStateKey, 'false')
      deactivateExtension()
      console.log('🔴 Extension deactivated for tab')
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
  document.body.style.marginBottom = ''
  
  console.log('🔴 Optimando AI Extension deactivated')
}

function initializeExtension() {
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
    tabName: 'Development Tab',
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
      leftSidebarWidth: 250,
      rightSidebarWidth: 250,
      bottomSidebarHeight: 45
    }
  }

  // Save/Load functions
  function saveTabDataToStorage() {
    localStorage.setItem(`optimando-tab-${tabId}`, JSON.stringify(currentTabData))
  }

  function loadTabDataFromStorage() {
    const saved = localStorage.getItem(`optimando-tab-${tabId}`)
    if (saved) {
      currentTabData = { ...currentTabData, ...JSON.parse(saved) }
    }
  }

  loadTabDataFromStorage()

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
    bottom: 45px;
    width: ${currentTabData.uiConfig.leftSidebarWidth}px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
    color: white;
    padding: 20px;
    box-shadow: 2px 0 10px rgba(0,0,0,0.3);
    pointer-events: auto;
    overflow-y: auto;
    backdrop-filter: blur(10px);
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
    <h2 style="margin: 0 0 20px 0; font-size: 18px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 10px;">
      🤖 AI Agent Outputs
    </h2>
    
    <!-- Display Port 1: Summarize Agent -->
    <div style="background: rgba(255,255,255,0.95); color: black; border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #4CAF50; font-weight: bold;">📝 Summarize Agent</h4>
      <div style="font-size: 12px; color: #333; line-height: 1.4;">
        <div id="summarize-output">Bereit für Zusammenfassungen...</div>
      </div>
    </div>

    <!-- Display Port 2: Research Agent -->
    <div style="background: rgba(255,255,255,0.95); color: black; border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #2196F3; font-weight: bold;">🔍 Research Agent</h4>
      <div style="font-size: 12px; color: #333; line-height: 1.4;">
        <div id="research-output">Bereit für Analysen...</div>
      </div>
    </div>

    <!-- Display Port 3: Goal Tracker -->
    <div style="background: rgba(255,255,255,0.95); color: black; border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #FF9800; font-weight: bold;">🎯 Goal Tracker</h4>
      <div style="font-size: 12px; color: #333; line-height: 1.4;">
        <div id="goals-output">Bereit für Ziel-Tracking...</div>
      </div>
    </div>

    <!-- Monitor Output Info -->
    <div style="margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.95); color: black; border-radius: 8px; border: 2px solid #FFD700; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #E65100; font-weight: bold;">🖥️ Monitor Output</h4>
      <div style="font-size: 11px; color: #555; line-height: 1.4;">
        Größere AI-Ausgaben werden direkt auf Monitor per Electron App angezeigt.
        <br><br>
        <strong>Status:</strong> <span style="color: #4CAF50;">● Verbunden</span><br>
        <strong>Endpoint:</strong> localhost:51247<br>
        <strong>Active Streams:</strong> 0
      </div>
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
    
    const newWidth = Math.max(200, Math.min(500, startWidth + (e.clientX - startX)))
    currentTabData.uiConfig.leftSidebarWidth = newWidth
    
    // Update left sidebar width
    leftSidebar.style.width = newWidth + 'px'
    
    // Update body margin
    document.body.style.marginLeft = newWidth + 'px'
    
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
    bottom: 45px;
    width: ${currentTabData.uiConfig.rightSidebarWidth}px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
    color: white;
    padding: 20px;
    box-shadow: -2px 0 10px rgba(0,0,0,0.3);
    pointer-events: auto;
    overflow-y: auto;
    backdrop-filter: blur(10px);
  `

  rightSidebar.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px;">⚙️ AI Control Center</h2>
      <button id="wr-login-btn" style="padding: 6px 12px; background: #FF9800; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 11px;">
        🔐 WR Code Login
      </button>
    </div>

    <!-- Quick Actions -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;">Quick Actions</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button id="hot-reload-btn" style="padding: 8px; background: #FF5722; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">🔥 Hot Reload</button>
        <button id="emergency-btn" style="padding: 8px; background: #F44336; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">🚨 Emergency</button>
        <button id="theme-btn" style="padding: 8px; background: #9C27B0; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">🎨 Theme</button>
        <button id="sync-btn" style="padding: 8px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">🔄 Sync</button>
      </div>
    </div>

    <!-- WR Code Scanner -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;">📱 WR Code Scanner</h3>
      <button id="qr-code-scanner-btn" style="width: 100%; padding: 10px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">
        📱 QR Code Scanner
      </button>
    </div>

    <!-- AI Agenten -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;">🤖 AI Agenten</h3>
      <div style="font-size: 11px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>📝 Summarize:</span>
          <button class="agent-toggle" data-agent="summarize" style="padding: 2px 6px; background: #f44336; border: none; color: white; border-radius: 2px; cursor: pointer; font-size: 9px;">OFF</button>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>🔍 Research:</span>
          <button class="agent-toggle" data-agent="research" style="padding: 2px 6px; background: #f44336; border: none; color: white; border-radius: 2px; cursor: pointer; font-size: 9px;">OFF</button>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>🎯 Goals:</span>
          <button class="agent-toggle" data-agent="goals" style="padding: 2px 6px; background: #f44336; border: none; color: white; border-radius: 2px; cursor: pointer; font-size: 9px;">OFF</button>
        </div>
      </div>
      <button id="save-session-btn" style="width: 100%; padding: 8px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 11px;">
        💾 Save Session
      </button>
    </div>

    <!-- Display Config -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;">📺 Display Config</h3>
      <div style="font-size: 11px; margin-bottom: 10px;">
        <div style="margin-bottom: 8px;">
          <label style="display: block; margin-bottom: 3px;">Output Mode:</label>
          <select style="width: 100%; padding: 4px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 3px; font-size: 10px;">
            <option value="electron">Electron App</option>
            <option value="browser">Browser Window</option>
          </select>
        </div>
      </div>
      <button style="width: 100%; padding: 8px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 11px;">
        ⚙️ Einstellungen
      </button>
    </div>
  `

  // BOTTOM PANEL - Minimal with Expand
  const bottomSidebar = document.createElement('div')
  bottomSidebar.id = 'bottom-sidebar'
  bottomSidebar.style.cssText = `
    position: absolute;
    left: ${currentTabData.uiConfig.leftSidebarWidth}px;
    right: ${currentTabData.uiConfig.rightSidebarWidth}px;
    bottom: 0;
    height: 45px;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
    color: white;
    padding: 8px 15px;
    box-shadow: 0 -2px 10px rgba(0,0,0,0.3);
    pointer-events: auto;
    backdrop-filter: blur(10px);
    cursor: pointer;
    transition: height 0.3s ease;
  `

  // Bottom Panel Content
  let isExpanded = false
  const expandedHeight = 300

  function createBottomContent() {
    return `
      <!-- Compact Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; height: 29px;">
        <!-- Tabs -->
        <div style="display: flex; gap: 10px;">
          <button id="status-tab" class="bottom-tab active" style="padding: 4px 8px; background: rgba(255,255,255,0.2); border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">🧠 Status</button>
          <button id="agents-tab" class="bottom-tab" style="padding: 4px 8px; background: transparent; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">🤖 Agents</button>
          <button id="settings-tab" class="bottom-tab" style="padding: 4px 8px; background: transparent; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">⚙️ Settings</button>
        </div>
        
        <!-- Tab Info + Expand -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <input id="tab-name-input" type="text" value="${currentTabData.tabName}" 
                 style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; 
                        padding: 2px 6px; border-radius: 3px; font-size: 11px; width: 120px; 
                        ${currentTabData.isLocked ? 'opacity: 0.6; pointer-events: none;' : ''}"
                 ${currentTabData.isLocked ? 'disabled' : ''}>
          <span style="font-size: 9px; opacity: 0.6;">${currentTabData.tabId}</span>
          <button id="lock-btn" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 20px; height: 20px; border-radius: 3px; cursor: pointer; font-size: 10px; ${currentTabData.isLocked ? 'background: rgba(255,215,0,0.3);' : ''}">${currentTabData.isLocked ? '🔒' : '🔓'}</button>
          <button id="expand-btn" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 24px; height: 20px; border-radius: 3px; cursor: pointer; font-size: 12px; transition: transform 0.3s ease;">⌄</button>
        </div>
      </div>

      <!-- Expandable Content -->
      <div id="expandable-content" style="display: none; margin-top: 15px; height: ${expandedHeight - 60}px; overflow-y: auto;">
        
        <!-- Status Content -->
        <div id="status-content" class="tab-content">
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; height: 100%;">
            
            <!-- Intent Detection -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🎯 Intent Detection</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;"><strong>Current:</strong> ${currentTabData.userIntentDetection.detected}</div>
                <div style="margin-bottom: 8px;"><strong>Confidence:</strong> ${currentTabData.userIntentDetection.confidence}%</div>
                <div><strong>Updated:</strong> ${currentTabData.userIntentDetection.lastUpdate}</div>
              </div>
            </div>

            <!-- Goals -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">📋 Goals</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 6px;">
                  <strong>Short:</strong><br>
                  <textarea id="short-goal" style="width: 100%; height: 30px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px; resize: none;">${currentTabData.goals.shortTerm}</textarea>
                </div>
                <div style="margin-bottom: 6px;">
                  <strong>Mid:</strong><br>
                  <textarea id="mid-goal" style="width: 100%; height: 30px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px; resize: none;">${currentTabData.goals.midTerm}</textarea>
                </div>
                <div>
                  <strong>Long:</strong><br>
                  <textarea id="long-goal" style="width: 100%; height: 30px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px; resize: none;">${currentTabData.goals.longTerm}</textarea>
                </div>
              </div>
            </div>

            <!-- Reasoning -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🤖 Reasoning</h4>
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

        <!-- Agents Content -->
        <div id="agents-content" class="tab-content" style="display: none;">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px;">
            
            <!-- Agent 1 -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <div style="text-align: center; margin-bottom: 10px;">
                <div style="font-size: 20px; margin-bottom: 5px;">📝</div>
                <h4 style="margin: 0; font-size: 11px; color: #4CAF50;">Summarize</h4>
                <button class="agent-toggle" data-agent="summarize" style="margin-top: 5px; padding: 2px 6px; background: #f44336; border: none; color: white; border-radius: 2px; cursor: pointer; font-size: 8px;">OFF</button>
              </div>
              <div style="font-size: 9px;">
                <div style="margin-bottom: 8px;">
                  <strong>Instructions:</strong><br>
                  <textarea style="width: 100%; height: 40px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 8px; resize: none;">Du bist ein Experte im Zusammenfassen von Inhalten.</textarea>
                </div>
                <div style="margin-bottom: 8px;">
                  <strong>Context:</strong><br>
                  <textarea style="width: 100%; height: 30px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 8px; resize: none;">Webseiten-Inhalt</textarea>
                </div>
                <div>
                  <strong>Output:</strong><br>
                  <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 2px; font-size: 8px;">
                    <option>Left Display Port</option>
                    <option>Monitor Output</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Agent 2 -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <div style="text-align: center; margin-bottom: 10px;">
                <div style="font-size: 20px; margin-bottom: 5px;">🔍</div>
                <h4 style="margin: 0; font-size: 11px; color: #2196F3;">Research</h4>
                <button class="agent-toggle" data-agent="research" style="margin-top: 5px; padding: 2px 6px; background: #f44336; border: none; color: white; border-radius: 2px; cursor: pointer; font-size: 8px;">OFF</button>
              </div>
              <div style="font-size: 9px;">
                <div style="margin-bottom: 8px;">
                  <strong>Instructions:</strong><br>
                  <textarea style="width: 100%; height: 40px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 8px; resize: none;">Du bist ein Research-Spezialist.</textarea>
                </div>
                <div style="margin-bottom: 8px;">
                  <strong>Context:</strong><br>
                  <textarea style="width: 100%; height: 30px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 8px; resize: none;">Aktuelle Webseite</textarea>
                </div>
                <div>
                  <strong>Output:</strong><br>
                  <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 2px; font-size: 8px;">
                    <option>Left Display Port</option>
                    <option selected>Monitor Output</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Agent 3 -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <div style="text-align: center; margin-bottom: 10px;">
                <div style="font-size: 20px; margin-bottom: 5px;">🎯</div>
                <h4 style="margin: 0; font-size: 11px; color: #FF9800;">Goal Tracker</h4>
                <button class="agent-toggle" data-agent="goals" style="margin-top: 5px; padding: 2px 6px; background: #f44336; border: none; color: white; border-radius: 2px; cursor: pointer; font-size: 8px;">OFF</button>
              </div>
              <div style="font-size: 9px;">
                <div style="margin-bottom: 8px;">
                  <strong>Instructions:</strong><br>
                  <textarea style="width: 100%; height: 40px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 8px; resize: none;">Du trackst Benutzerziele.</textarea>
                </div>
                <div style="margin-bottom: 8px;">
                  <strong>Context:</strong><br>
                  <textarea style="width: 100%; height: 30px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 8px; resize: none;">Benutzer-Aktivitäten</textarea>
                </div>
                <div>
                  <strong>Output:</strong><br>
                  <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 2px; font-size: 8px;">
                    <option selected>Left Display Port</option>
                    <option>Monitor Output</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Settings Content -->
        <div id="settings-content" class="tab-content" style="display: none;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            
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
                  <input type="text" value="localhost:51247" style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 3px; border-radius: 2px; font-size: 9px;">
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
      
      // Update body margin
      document.body.style.marginBottom = expandedHeight + 'px'
    } else {
      bottomSidebar.style.height = '45px'
      bottomSidebar.style.cursor = 'pointer'
      expandBtn.style.transform = 'rotate(0deg)'
      expandableContent.style.display = 'none'
      
      // Update body margin
      document.body.style.marginBottom = '45px'
    }
  }

  // Tab switching
  function switchTab(tabName) {
    // Hide all content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.style.display = 'none'
    })
    
    // Reset all tab buttons
    document.querySelectorAll('.bottom-tab').forEach(btn => {
      btn.style.background = 'transparent'
      btn.classList.remove('active')
    })
    
    // Show selected content and activate tab
    const selectedContent = document.getElementById(tabName + '-content')
    const selectedTab = document.getElementById(tabName + '-tab')
    
    if (selectedContent) selectedContent.style.display = 'block'
    if (selectedTab) {
      selectedTab.style.background = 'rgba(255,255,255,0.2)'
      selectedTab.classList.add('active')
    }
  }

  // Agent toggle function
  function toggleAgent(agentName) {
    const toggleBtns = document.querySelectorAll(`[data-agent="${agentName}"]`)
    toggleBtns.forEach(btn => {
      const isActive = btn.textContent.trim() === 'ON'
      if (isActive) {
        btn.textContent = 'OFF'
        btn.style.background = '#f44336'
      } else {
        btn.textContent = 'ON'
        btn.style.background = '#4CAF50'
      }
    })
  }

  // Add all sidebars to page
  sidebarsDiv.appendChild(leftSidebar)
  sidebarsDiv.appendChild(rightSidebar)
  sidebarsDiv.appendChild(bottomSidebar)
  document.body.appendChild(sidebarsDiv)

  // Set initial body margins
  document.body.style.marginLeft = currentTabData.uiConfig.leftSidebarWidth + 'px'
  document.body.style.marginRight = currentTabData.uiConfig.rightSidebarWidth + 'px'
  document.body.style.marginBottom = '45px'

  // Event Listeners
  setTimeout(() => {
    // Expand button
    const expandBtn = document.getElementById('expand-btn')
    if (expandBtn) {
      expandBtn.onclick = (e) => {
        e.stopPropagation()
        toggleBottomPanel()
      }
    }

    // Tab name input
    const tabNameInput = document.getElementById('tab-name-input')
    if (tabNameInput) {
      tabNameInput.addEventListener('input', () => {
        if (!currentTabData.isLocked) {
          currentTabData.tabName = tabNameInput.value
          saveTabDataToStorage()
          console.log('📝 Tab name updated:', currentTabData.tabName)
        }
      })
      
      tabNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          tabNameInput.blur()
        }
      })
    }

    // Lock button
    const lockBtn = document.getElementById('lock-btn')
    if (lockBtn) {
      lockBtn.onclick = (e) => {
        e.stopPropagation()
        currentTabData.isLocked = !currentTabData.isLocked
        
        // Update lock button appearance
        lockBtn.innerHTML = currentTabData.isLocked ? '🔒' : '🔓'
        lockBtn.style.background = currentTabData.isLocked ? 'rgba(255,215,0,0.3)' : 'rgba(255,255,255,0.1)'
        
        // Update tab name input
        if (tabNameInput) {
          tabNameInput.disabled = currentTabData.isLocked
          tabNameInput.style.opacity = currentTabData.isLocked ? '0.6' : '1'
          tabNameInput.style.pointerEvents = currentTabData.isLocked ? 'none' : 'auto'
        }
        
        // Save session when locking
        saveTabDataToStorage()
        
        if (currentTabData.isLocked) {
          // Show notification
          const notification = document.createElement('div')
          notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(76, 175, 80, 0.9);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 2147483648;
            animation: slideIn 0.3s ease;
          `
          notification.innerHTML = `🔒 Session "${currentTabData.tabName}" gespeichert!`
          document.body.appendChild(notification)
          
          setTimeout(() => {
            notification.remove()
          }, 3000)
          
          console.log('🔒 Session locked and saved:', currentTabData.tabName)
        } else {
          console.log('🔓 Session unlocked:', currentTabData.tabName)
        }
      }
    }

    // Tab buttons
    document.getElementById('status-tab')?.addEventListener('click', () => switchTab('status'))
    document.getElementById('agents-tab')?.addEventListener('click', () => switchTab('agents'))
    document.getElementById('settings-tab')?.addEventListener('click', () => switchTab('settings'))

    // Agent toggles
    document.querySelectorAll('.agent-toggle').forEach(btn => {
      btn.onclick = () => {
        const agentName = btn.getAttribute('data-agent')
        toggleAgent(agentName)
      }
    })

    // Other buttons
    document.getElementById('save-session-btn')?.addEventListener('click', () => {
      saveTabDataToStorage()
      alert('Session saved!')
    })

    document.getElementById('wr-login-btn')?.addEventListener('click', () => {
      alert('WR Code Login activated!')
    })

    document.getElementById('qr-code-scanner-btn')?.addEventListener('click', () => {
      alert('QR Code Scanner activated!')
    })

    console.log('✅ All event listeners attached')
  }, 100)

  console.log('✅ Optimando AI Extension loaded successfully')
}

// Initialize extension if it was previously activated for this URL
if (isExtensionActive) {
  initializeExtension()
}