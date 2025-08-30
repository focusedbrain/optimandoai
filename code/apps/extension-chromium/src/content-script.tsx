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
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 10px;">
      <h2 style="margin: 0; font-size: 18px;">
        🤖 AI Agent Outputs
      </h2>
      <button id="quick-expand-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s ease;" title="Quick expand to maximum width">
        ⇄
      </button>
    </div>
    
    <!-- Display Port #1: Summarize Agent -->
    <div style="background: rgba(255,255,255,0.95); color: black; border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #4CAF50; font-weight: bold;">#1 📝 Summarize Agent</h4>
      <div style="font-size: 12px; color: #333; line-height: 1.4;">
        <div id="summarize-output">Bereit für Zusammenfassungen...</div>
      </div>
    </div>

    <!-- Display Port #2: Research Agent -->
    <div style="background: rgba(255,255,255,0.95); color: black; border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #2196F3; font-weight: bold;">#2 🔍 Research Agent</h4>
      <div style="font-size: 12px; color: #333; line-height: 1.4;">
        <div id="research-output">Bereit für Analysen...</div>
      </div>
    </div>

    <!-- Display Port #3: Goal Tracker -->
    <div style="background: rgba(255,255,255,0.95); color: black; border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #FF9800; font-weight: bold;">#3 🎯 Goal Tracker</h4>
      <div style="font-size: 12px; color: #333; line-height: 1.4;">
        <div id="goals-output">Bereit für Ziel-Tracking...</div>
      </div>
    </div>

    <!-- Display Port #4: Analysis Agent -->
    <div style="background: rgba(255,255,255,0.95); color: black; border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #9C27B0; font-weight: bold;">#4 🧮 Analysis Agent</h4>
      <div style="font-size: 12px; color: #333; line-height: 1.4;">
        <div id="analysis-output">Bereit für Datenanalyse...</div>
      </div>
    </div>

    <!-- Display Port #5: Assistant Agent -->
    <div style="background: rgba(255,255,255,0.95); color: black; border-radius: 8px; padding: 15px; margin-bottom: 15px; min-height: 80px; border: 1px solid rgba(0,0,0,0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
      <h4 style="margin: 0 0 10px 0; font-size: 14px; color: #607D8B; font-weight: bold;">#5 🤖 Assistant Agent</h4>
      <div style="font-size: 12px; color: #333; line-height: 1.4;">
        <div id="assistant-output">Bereit für Unterstützung...</div>
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
    
    const newWidth = Math.max(200, Math.min(800, startWidth + (e.clientX - startX)))
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
    </div>

    <!-- WR Code Connection -->
    <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;">📱 WR Code</h3>
      
      <!-- QR Code Placeholder -->
      <div style="width: 120px; height: 120px; background: white; border-radius: 8px; margin: 0 auto 15px auto; display: flex; align-items: center; justify-content: center; border: 2px dashed #ccc;">
        <div style="text-align: center; color: #666;">
          <div style="font-size: 24px;">📱</div>
          <div style="font-size: 10px; margin-top: 5px;">QR Code</div>
        </div>
      </div>
      
      <div style="font-size: 11px; color: rgba(255,255,255,0.8); margin-bottom: 15px;">
        Scan to connect your WR account
      </div>
      
      <button id="wr-connect-btn" style="width: 100%; padding: 10px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px; margin-bottom: 10px;">
        🔗 Connect WR Account
      </button>
      
      <div id="wr-status" style="font-size: 10px; color: #FF9800;">
        ● Not Connected
      </div>
    </div>

    <!-- Session History -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 14px;">📚 Sessions History</h3>
      </div>
      
      <button id="sessions-history-btn" style="width: 100%; padding: 12px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px; margin-bottom: 10px;">
        📋 View All Sessions
      </button>
      
      <!-- Recent Sessions Preview -->
      <div style="font-size: 10px; color: rgba(255,255,255,0.7);">
        <div style="margin-bottom: 5px;">Recent:</div>
        <div class="session-item" data-session="session-1" style="padding: 5px 8px; background: rgba(255,255,255,0.05); border-radius: 3px; margin-bottom: 3px; cursor: pointer;">
          🚀 Dev Session - 2024-01-15
        </div>
        <div class="session-item" data-session="session-2" style="padding: 5px 8px; background: rgba(255,255,255,0.05); border-radius: 3px; margin-bottom: 3px; cursor: pointer;">
          📊 Analysis Work - 2024-01-14
        </div>
        <div class="session-item" data-session="session-3" style="padding: 5px 8px; background: rgba(255,255,255,0.05); border-radius: 3px; cursor: pointer;">
          🎯 Project Planning - 2024-01-13
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;">⚡ Quick Actions</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button id="save-session-btn" style="padding: 8px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">💾 Save</button>
        <button id="sync-btn" style="padding: 8px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">🔄 Sync</button>
        <button id="export-btn" style="padding: 8px; background: #FF9800; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">📤 Export</button>
        <button id="import-btn" style="padding: 8px; background: #9C27B0; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">📥 Import</button>
      </div>
    </div>

    <!-- Connection Status -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px;">
      <h3 style="margin: 0 0 15px 0; font-size: 14px;">🔗 Connection Status</h3>
      <div style="font-size: 11px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>WR Account:</span>
          <span id="wr-account-status" style="color: #FF9800;">Disconnected</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <span>Sync Status:</span>
          <span style="color: #4CAF50;">● Local</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Sessions:</span>
          <span id="session-count">3 Saved</span>
        </div>
      </div>
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
                <option value="monitor">Monitor Output</option>
              </select>
            </div>

            <!-- Agent 3: Goal Tracker -->
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;">
              <div style="font-size: 32px; margin-bottom: 8px;">🎯</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #FF9800; font-weight: bold;">Goal Tracker</h4>
              <button class="agent-toggle" data-agent="goals" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 8px;">OFF</button>
              
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="goals" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="goals" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Context">📄</button>
                <button class="lightbox-btn" data-agent="goals" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
              
              <select style="width: 100%; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 3px; font-size: 8px;">
                <option value="1">#1 Display Port</option>
                <option value="2">#2 Display Port</option>
                <option value="3" selected>#3 Display Port</option>
                <option value="4">#4 Display Port</option>
                <option value="5">#5 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>

            <!-- Agent 4: Analysis -->
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;">
              <div style="font-size: 32px; margin-bottom: 8px;">🧮</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #9C27B0; font-weight: bold;">Analysis</h4>
              <button class="agent-toggle" data-agent="analysis" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 8px;">OFF</button>
              
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="analysis" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="analysis" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Context">📄</button>
                <button class="lightbox-btn" data-agent="analysis" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
              
              <select style="width: 100%; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 3px; font-size: 8px;">
                <option value="1">#1 Display Port</option>
                <option value="2">#2 Display Port</option>
                <option value="3">#3 Display Port</option>
                <option value="4" selected>#4 Display Port</option>
                <option value="5">#5 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>

            <!-- Agent 5: Assistant -->
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; text-align: center; position: relative;">
              <div style="font-size: 32px; margin-bottom: 8px;">🤖</div>
              <h4 style="margin: 0 0 8px 0; font-size: 12px; color: #607D8B; font-weight: bold;">Assistant</h4>
              <button class="agent-toggle" data-agent="assistant" style="padding: 4px 8px; background: #f44336; border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 9px; margin-bottom: 8px;">OFF</button>
              
              <div style="display: flex; justify-content: center; gap: 6px; margin-top: 10px;">
                <button class="lightbox-btn" data-agent="assistant" data-type="instructions" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="AI Instructions">📋</button>
                <button class="lightbox-btn" data-agent="assistant" data-type="context" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Context">📄</button>
                <button class="lightbox-btn" data-agent="assistant" data-type="settings" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 4px; border-radius: 3px; cursor: pointer; font-size: 8px;" title="Settings">⚙️</button>
              </div>
              
              <select style="width: 100%; margin-top: 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 2px; border-radius: 3px; font-size: 8px;">
                <option value="1">#1 Display Port</option>
                <option value="2">#2 Display Port</option>
                <option value="3">#3 Display Port</option>
                <option value="4">#4 Display Port</option>
                <option value="5" selected>#5 Display Port</option>
                <option value="monitor">Monitor Output</option>
              </select>
            </div>
          </div>

          <!-- Add New Agent Button -->
          <div style="text-align: center; margin-top: 15px;">
            <button style="padding: 8px 16px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 10px;">
              ➕ Add New Agent
            </button>
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

  // Set initial body margins and safe scrollbar prevention
  document.body.style.marginLeft = currentTabData.uiConfig.leftSidebarWidth + 'px'
  document.body.style.marginRight = currentTabData.uiConfig.rightSidebarWidth + 'px'
  document.body.style.marginBottom = '45px'
  document.body.style.overflowX = 'hidden'

  // SESSION HISTORY LIGHTBOX FUNCTION
  window.openSessionsHistoryLightbox = function() {
    // Remove existing lightbox if any
    const existing = document.getElementById('temp-lightbox')
    if (existing) existing.remove()
    
    // Create sessions history lightbox
    const overlay = document.createElement('div')
    overlay.id = 'temp-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; width: 90vw; height: 85vh; max-width: 1000px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 18px;">📚 Sessions History</h2>
          <button id="close-lightbox-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 20px; font-weight: bold;">×</button>
        </div>
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
          
          <!-- Search & Filter -->
          <div style="margin-bottom: 20px; display: flex; gap: 10px;">
            <input type="text" placeholder="Search sessions..." style="flex: 1; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 6px;">
            <select style="padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; border-radius: 6px;">
              <option>All Sessions</option>
              <option>Development</option>
              <option>Analysis</option>
              <option>Planning</option>
            </select>
          </div>
          
          <!-- Sessions Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px;">
            
            <!-- Session 1 -->
            <div class="session-card" data-session="session-1" style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; border: 2px solid transparent;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0; color: #FFD700;">🚀 Dev Session</h4>
                <span style="font-size: 10px; color: rgba(255,255,255,0.6);">2024-01-15</span>
              </div>
              <p style="margin: 0 0 10px 0; font-size: 12px; color: rgba(255,255,255,0.8);">
                Full-stack development session with 5 AI agents. React frontend, Node.js backend orchestration.
              </p>
              <div style="font-size: 10px; color: rgba(255,255,255,0.6);">
                <div>• 5 AI Agents configured</div>
                <div>• Template: Web Development</div>
                <div>• Display Ports: #1-#5</div>
              </div>
            </div>
            
            <!-- Session 2 -->
            <div class="session-card" data-session="session-2" style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; border: 2px solid transparent;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0; color: #4CAF50;">📊 Analysis Work</h4>
                <span style="font-size: 10px; color: rgba(255,255,255,0.6);">2024-01-14</span>
              </div>
              <p style="margin: 0 0 10px 0; font-size: 12px; color: rgba(255,255,255,0.8);">
                Data analysis and research session. Market research with competitive analysis agents.
              </p>
              <div style="font-size: 10px; color: rgba(255,255,255,0.6);">
                <div>• 3 AI Agents configured</div>
                <div>• Template: Research & Analysis</div>
                <div>• Display Ports: #1-#3</div>
              </div>
            </div>
            
            <!-- Session 3 -->
            <div class="session-card" data-session="session-3" style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px; cursor: pointer; transition: all 0.2s ease; border: 2px solid transparent;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0; color: #2196F3;">🎯 Project Planning</h4>
                <span style="font-size: 10px; color: rgba(255,255,255,0.6);">2024-01-13</span>
              </div>
              <p style="margin: 0 0 10px 0; font-size: 12px; color: rgba(255,255,255,0.8);">
                Strategic planning session with goal tracking and timeline management agents.
              </p>
              <div style="font-size: 10px; color: rgba(255,255,255,0.6);">
                <div>• 4 AI Agents configured</div>
                <div>• Template: Project Management</div>
                <div>• Display Ports: #1-#4</div>
              </div>
            </div>
            
            <!-- Add New Session -->
            <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 8px; cursor: pointer; border: 2px dashed rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; min-height: 140px;">
              <div style="text-align: center; color: rgba(255,255,255,0.6);">
                <div style="font-size: 24px; margin-bottom: 10px;">➕</div>
                <div style="font-size: 12px;">Create New Session</div>
              </div>
            </div>
            
          </div>
          
        </div>
      </div>
    `
    
    // Close on overlay click
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove()
    }
    
    document.body.appendChild(overlay)
    
    // Set close button listener
    const closeBtn = document.getElementById('close-lightbox-btn')
    if (closeBtn) {
      closeBtn.onclick = function() {
        overlay.remove()
      }
    }
    
    // Session card click handlers
    const sessionCards = overlay.querySelectorAll('.session-card')
    sessionCards.forEach(card => {
      card.onclick = function() {
        const sessionId = this.getAttribute('data-session')
        window.loadSession(sessionId)
        overlay.remove()
      }
      
      // Hover effect
      card.onmouseenter = function() {
        this.style.border = '2px solid rgba(255,215,0,0.5)'
        this.style.transform = 'scale(1.02)'
      }
      card.onmouseleave = function() {
        this.style.border = '2px solid transparent'
        this.style.transform = 'scale(1)'
      }
    })
  }
  
  // LOAD SESSION FUNCTION
  window.loadSession = function(sessionId) {
    console.log('Loading session:', sessionId)
    // TODO: Implement session loading logic
    alert(`Loading session: ${sessionId}`)
  }

  // LIGHTBOX FUNCTIONS - ULTRA SIMPLE VERSION
  window.openAgentLightbox = function(agentName, type) {
    // Remove existing lightbox if any
    const existing = document.getElementById('temp-lightbox')
    if (existing) existing.remove()
    
    // Create completely new lightbox
    const overlay = document.createElement('div')
    overlay.id = 'temp-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    const agentEmojis = { summarize: '📝', research: '🔍', goals: '🎯', analysis: '🧮', assistant: '🤖' }
    const typeNames = { instructions: 'AI Instructions', context: 'Context', settings: 'Settings' }
    
    let content = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; width: 90vw; height: 85vh; max-width: 1200px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 18px;">${agentEmojis[agentName] || '🤖'} ${agentName.charAt(0).toUpperCase() + agentName.slice(1)} - ${typeNames[type] || type}</h2>
          <button id="close-lightbox-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 20px; font-weight: bold;">×</button>
        </div>
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
    `
    
    if (type === 'instructions') {
      content += `
        <h3 style="color: #FFD700; margin-bottom: 20px;">📋 AI Instructions</h3>
        <textarea style="width: 100%; height: 400px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 13px;" placeholder="Gib hier die AI-Anweisungen ein...">Du bist ein Experte für ${agentName}...</textarea>
        <div style="margin-top: 20px;">
          <button style="padding: 10px 20px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; margin-right: 10px;">💾 Save</button>
          <button style="padding: 10px 20px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer;">🧪 Test</button>
        </div>
      `
    } else if (type === 'context') {
      content += `
        <h3 style="color: #FFD700; margin-bottom: 20px;">📄 Context Information</h3>
        <textarea style="width: 100%; height: 350px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 15px; border-radius: 6px; font-family: monospace; font-size: 13px;" placeholder="Gib hier den Kontext ein...">Aktueller Webseiten-Inhalt wird hier automatisch eingefügt...</textarea>
        <div style="margin-top: 20px;">
          <button style="padding: 10px 20px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; margin-right: 10px;">💾 Save</button>
          <button style="padding: 10px 20px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer;">🌐 Load Page</button>
        </div>
      `
    } else if (type === 'settings') {
      content += `
        <h3 style="color: #FFD700; margin-bottom: 20px;">⚙️ Settings</h3>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; text-align: left;">
          <div>
            <label style="display: block; margin-bottom: 8px;">LLM Provider:</label>
            <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px; border-radius: 4px; margin-bottom: 15px;">
              <option>Local LLM</option>
              <option>GPT-4</option>
              <option>GPT-5</option>
              <option>Claude Sonnet</option>
              <option>Gemini Pro</option>
            </select>
            <label style="display: block; margin-bottom: 8px;">Temperature: 0.7</label>
            <input type="range" min="0" max="1" step="0.1" value="0.7" style="width: 100%; margin-bottom: 15px;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 8px;">Output Mode:</label>
            <select style="width: 100%; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px; border-radius: 4px; margin-bottom: 15px;">
              <option>Direct Output</option>
              <option>Feedback Loop</option>
              <option>Iterative Refinement</option>
            </select>
            <label style="display: flex; align-items: center; margin-bottom: 10px;">
              <input type="checkbox" style="margin-right: 8px;"> Auto-processing
            </label>
          </div>
        </div>
        <div style="margin-top: 30px; text-align: center;">
          <button style="padding: 10px 20px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer;">💾 Save Settings</button>
        </div>
      `
    }
    
    content += `
        </div>
      </div>
    `
    
    overlay.innerHTML = content
    
    // Close on overlay click
    overlay.onclick = function(e) {
      if (e.target === overlay) overlay.remove()
    }
    
    document.body.appendChild(overlay)
    
    // DIRECT X-Button listener - set AFTER DOM append
    const closeBtn = document.getElementById('close-lightbox-btn')
    if (closeBtn) {
      closeBtn.onclick = function() {
        overlay.remove()
      }
    }
  }

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

    // Lightbox buttons - NEW SYSTEM
    document.querySelectorAll('.lightbox-btn').forEach(btn => {
      btn.onclick = () => {
        const agentName = btn.getAttribute('data-agent')
        const type = btn.getAttribute('data-type')
        window.openAgentLightbox(agentName, type)
      }
    })

    // Quick expand button for left sidebar
    document.getElementById('quick-expand-btn')?.addEventListener('click', () => {
      const currentWidth = currentTabData.uiConfig.leftSidebarWidth
      const isExpanded = currentWidth >= 700
      const newWidth = isExpanded ? 300 : 800 // Toggle between normal and max expanded
      
      currentTabData.uiConfig.leftSidebarWidth = newWidth
      leftSidebar.style.width = newWidth + 'px'
      document.body.style.marginLeft = newWidth + 'px'
      document.body.style.overflowX = 'hidden'
      
      // Update bottom panel position
      const bottomSidebar = document.getElementById('bottom-sidebar')
      if (bottomSidebar) {
        bottomSidebar.style.left = newWidth + 'px'
      }
      
      // Update button icon and tooltip
      const expandBtn = document.getElementById('quick-expand-btn')
      if (expandBtn) {
        expandBtn.innerHTML = isExpanded ? '⇄' : '⇆'
        expandBtn.title = isExpanded ? 'Quick expand to maximum width' : 'Collapse to normal width'
        expandBtn.style.background = 'rgba(255,215,0,0.6)'
        setTimeout(() => {
          expandBtn.style.background = 'rgba(255,255,255,0.2)'
        }, 200)
      }
      
      // Save the change
      saveTabDataToStorage()
    })

    // Add hover effect for quick expand button
    document.getElementById('quick-expand-btn')?.addEventListener('mouseover', function() {
      this.style.background = 'rgba(255,215,0,0.6)'
    })
    
    document.getElementById('quick-expand-btn')?.addEventListener('mouseout', function() {
      this.style.background = 'rgba(255,255,255,0.2)'
    })

    // Sessions History Button
    document.getElementById('sessions-history-btn')?.addEventListener('click', () => {
      window.openSessionsHistoryLightbox()
    })

    // Session item clicks (in right sidebar)
    document.querySelectorAll('.session-item').forEach(item => {
      item.onclick = () => {
        const sessionId = item.getAttribute('data-session')
        window.loadSession(sessionId)
      }
    })

    // WR Connect Button
    document.getElementById('wr-connect-btn')?.addEventListener('click', () => {
      // TODO: Implement WR Code generation and scanning
      alert('WR Code connection will be implemented - scanning QR codes from wrcode.org')
    })

    // Export/Import Buttons
    document.getElementById('export-btn')?.addEventListener('click', () => {
      // TODO: Export current session configuration
      alert('Export session functionality')
    })

    document.getElementById('import-btn')?.addEventListener('click', () => {
      // TODO: Import session configuration
      alert('Import session functionality')
    })

    // Other buttons
    document.getElementById('save-session-btn')?.addEventListener('click', () => {
      saveTabDataToStorage()
      alert('Session saved!')
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