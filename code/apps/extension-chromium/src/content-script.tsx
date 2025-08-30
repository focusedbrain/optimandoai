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
  // Check if extension should be disabled for this URL
  const urlParams = new URLSearchParams(window.location.search)
  if (urlParams.get('optimando_extension') === 'disabled') {
    console.log('🚫 Optimando AI Extension disabled for this tab (via URL parameter)')
    return
  }
  
  // Check if this URL is marked as excluded
  const currentUrl = window.location.href
  const tabKey = 'optimando-excluded-' + btoa(currentUrl.split('?')[0]).substring(0, 20)
  if (localStorage.getItem(tabKey) === 'true') {
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
      
      <!-- QR Code -->
      <div style="width: 120px; height: 120px; background: white; border-radius: 8px; margin: 0 auto 15px auto; display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDI1IDI1IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMjUiIGhlaWdodD0iMjUiIGZpbGw9IndoaXRlIi8+CjwhLS0gUVIgQ29kZSBQYXR0ZXJuIC0tPgo8IS0tIFRvcCBMZWZ0IEZpbmRlciAtLT4KPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjciIGhlaWdodD0iNyIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMiIgeT0iMiIgd2lkdGg9IjUiIGhlaWdodD0iNSIgZmlsbD0id2hpdGUiLz4KPHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjMiIGhlaWdodD0iMyIgZmlsbD0iYmxhY2siLz4KCjwhLS0gVG9wIFJpZ2h0IEZpbmRlciAtLT4KPHJlY3QgeD0iMTciIHk9IjEiIHdpZHRoPSI3IiBoZWlnaHQ9IjciIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE4IiB5PSIyIiB3aWR0aD0iNSIgaGVpZ2h0PSI1IiBmaWxsPSJ3aGl0ZSIvPgo8cmVjdCB4PSIxOSIgeT0iMyIgd2lkdGg9IjMiIGhlaWdodD0iMyIgZmlsbD0iYmxhY2siLz4KCjwhLS0gQm90dG9tIExlZnQgRmluZGVyIC0tPgo8cmVjdCB4PSIxIiB5PSIxNyIgd2lkdGg9IjciIGhlaWdodD0iNyIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMiIgeT0iMTgiIHdpZHRoPSI1IiBoZWlnaHQ9IjUiIGZpbGw9IndoaXRlIi8+CjxyZWN0IHg9IjMiIHk9IjE5IiB3aWR0aD0iMyIgaGVpZ2h0PSIzIiBmaWxsPSJibGFjayIvPgoKPCEtLSBUaW1pbmcgUGF0dGVybnMgLS0+CjxyZWN0IHg9IjkiIHk9IjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSIxIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPCEtLSBEYXRhIFBhdHRlcm4gLS0+CjxyZWN0IHg9IjkiIHk9IjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSIzIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSI1IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSI3IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSI1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSI3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8IS0tIE1vcmUgZGF0YSBwYXR0ZXJucyAtLT4KPHJlY3QgeD0iOSIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEwIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTIiIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNCIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE2IiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSIxMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIxNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTMiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSI5IiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMTciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE1IiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjkiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMSIgeT0iMTkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjEzIiB5PSIxOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTUiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iOSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjExIiB5PSIyMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTMiIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxNSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+Cgo8cmVjdCB4PSI5IiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMTEiIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxMyIgeT0iMjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjE1IiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KCjxyZWN0IHg9IjE3IiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjEiIHk9IjkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIzIiB5PSI5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjExIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjEzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTUiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxNSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE1IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxNyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE3IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMTkiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIxOSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjE5IiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMjEiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIyMSIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjIxIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgoKPHJlY3QgeD0iMTciIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8cmVjdCB4PSIxOSIgeT0iMjMiIHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9ImJsYWNrIi8+CjxyZWN0IHg9IjIxIiB5PSIyMyIgd2lkdGg9IjEiIGhlaWdodD0iMSIgZmlsbD0iYmxhY2siLz4KPHJlY3QgeD0iMjMiIHk9IjIzIiB3aWR0aD0iMSIgaGVpZ2h0PSIxIiBmaWxsPSJibGFjayIvPgo8L3N2Zz4=" style="width: 110px; height: 110px;" alt="QR Code" />
      </div>
      
      <div style="font-size: 11px; color: rgba(255,255,255,0.8); margin-bottom: 15px;">
        Scan to connect your WR account
      </div>
      
      <button id="wr-connect-btn" style="width: 100%; padding: 10px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px; margin-bottom: 10px;">
        🔗 Connect WR Account
      </button>
      

      </div>

    <!-- Add Helpergrid Button -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <button id="add-helpergrid-btn" style="width: 100%; padding: 15px; background: #FF6B6B; border: none; color: white; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; transition: all 0.3s ease;">
        🚀 Add Helpergrid
      </button>
    </div>

    <!-- Session History -->
    <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 14px;">📚 Sessions History</h3>
      </div>
      
      <button id="sessions-history-btn" style="width: 100%; padding: 12px; background: #2196F3; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 12px;">
        📋 View All Sessions
      </button>
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

  // HELPER GRID LIGHTBOX FUNCTION
  function openHelperGridLightbox() {
    // Remove existing lightbox if any
    const existing = document.getElementById('temp-lightbox')
    if (existing) existing.remove()
    
    // Create helper grid lightbox
    const overlay = document.createElement('div')
    overlay.id = 'temp-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; height: 85vh; max-width: 1200px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 24px; font-weight: bold;">🚀 Helper Grid Options</h2>
          <button id="close-helpergrid-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 24px; font-weight: bold; display: flex; align-items: center; justify-content: center;">×</button>
        </div>
        
        <div style="flex: 1; padding: 30px; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 30px;">
          
          <!-- Grid Option 1: 4 Helper LLMs -->
          <div class="grid-option" data-grid="helper-llms" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; transition: all 0.3s ease;">
            <div style="width: 100%; height: 150px; background: rgba(255,255,255,0.1); border-radius: 8px; margin-bottom: 15px; display: flex; align-items: center; justify-content: center; border: 2px dashed rgba(255,255,255,0.3);">
              <div style="text-align: center; color: rgba(255,255,255,0.7);">
                <div style="font-size: 48px; margin-bottom: 10px;">🤖</div>
                <div style="font-size: 12px;">4 Helper LLMs Grid</div>
              </div>
            </div>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #4CAF50;">🤖 4 Helper LLMs</h3>
            <p style="margin: 0; font-size: 14px; opacity: 0.8; line-height: 1.4;">Display a 2x2 grid with 4 specialized AI assistants for different tasks</p>
          </div>
          
          <!-- Grid Option 2: Helper Tabs -->
          <div class="grid-option" data-grid="helper-tabs" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; transition: all 0.3s ease;">
            <div style="width: 100%; height: 150px; background: rgba(255,255,255,0.1); border-radius: 8px; margin-bottom: 15px; display: flex; align-items: center; justify-content: center; border: 2px dashed rgba(255,255,255,0.3);">
              <div style="text-align: center; color: rgba(255,255,255,0.7);">
                <div style="font-size: 48px; margin-bottom: 10px;">🔗</div>
                <div style="font-size: 12px;">Helper Tabs Setup</div>
              </div>
            </div>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #2196F3;">🔗 Helper Tabs</h3>
            <p style="margin: 0; font-size: 14px; opacity: 0.8; line-height: 1.4;">Configure custom websites (up to 10 URLs) for your helper tabs workflow</p>
          </div>
          
          <!-- Grid Option 3: Custom Grid Slots -->
          <div class="grid-option" data-grid="custom-slots" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; transition: all 0.3s ease;">
            <div style="width: 100%; height: 150px; background: rgba(255,255,255,0.1); border-radius: 8px; margin-bottom: 15px; display: flex; align-items: center; justify-content: center; border: 2px dashed rgba(255,255,255,0.3);">
              <div style="text-align: center; color: rgba(255,255,255,0.7);">
                <div style="font-size: 48px; margin-bottom: 10px;">🎯</div>
                <div style="font-size: 12px;">Custom 4 Slots</div>
              </div>
              </div>
            <h3 style="margin: 0 0 10px 0; font-size: 18px; color: #FF9800;">🎯 Grid with 4 slots</h3>
            <p style="margin: 0; font-size: 14px; opacity: 0.8; line-height: 1.4;">Create a configurable grid with 4 slots for injecting context and AI instructions</p>
            </div>
            
              </div>
        
        <div style="padding: 20px; border-top: 1px solid rgba(255,255,255,0.2); text-align: center;">
          <p style="margin: 0; font-size: 12px; opacity: 0.6;">Select a grid configuration to set up your AI assistant workspace</p>
              </div>
            </div>
    `
    
    document.body.appendChild(overlay)
    
    // Add click handler for close button
    document.getElementById('close-helpergrid-lightbox').onclick = () => {
      overlay.remove()
    }
    
    // Add click handlers for grid options
    document.querySelectorAll('.grid-option').forEach(option => {
      option.onmouseenter = () => {
        option.style.transform = 'translateY(-5px)'
        option.style.background = 'rgba(255,255,255,0.15)'
      }
      option.onmouseleave = () => {
        option.style.transform = 'translateY(0)'
        option.style.background = 'rgba(255,255,255,0.1)'
      }
      option.onclick = () => {
        const gridType = option.getAttribute('data-grid')
        
        if (gridType === 'helper-tabs') {
          // Open Helper Tabs Configuration
          openHelperTabsConfig()
          overlay.remove()
        } else {
          // Other grid types - placeholder for now
          alert(`Selected grid: ${gridType}\n\nThis will be implemented in the next iteration with specific functionality for each grid type.`)
          overlay.remove()
        }
      }
    })
    
    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove()
      }
    }
  }

  // OPEN HELPER TABS CONFIGURATION
  function openHelperTabsConfig() {
    // Remove any existing lightbox
    const existing = document.getElementById('temp-lightbox')
    if (existing) existing.remove()
    
    // Create configuration lightbox
    const overlay = document.createElement('div')
    overlay.id = 'temp-lightbox'
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.8); z-index: 2147483649;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(5px);
    `
    
    // Load existing URLs from localStorage if any
    const savedUrls = JSON.parse(localStorage.getItem('optimando-helper-tabs-urls') || '[]')
    
    // Default URLs if none saved (start with one field, or load saved URLs)
    const initialUrls = savedUrls.length > 0 ? savedUrls : ['']
    
    function generateUrlFieldsHTML(urls) {
      let urlInputsHTML = ''
      
      urls.forEach((url, i) => {
        urlInputsHTML += `
          <div class="url-field-row" data-index="${i}" style="display: flex; gap: 10px; margin-bottom: 12px; align-items: center;">
            <div style="flex: 1;">
              <input 
                type="url" 
                class="url-input" 
                data-index="${i}"
                value="${url}" 
                placeholder="https://example.com"
                style="width: 100%; padding: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white !important; border-radius: 6px; font-size: 14px; box-sizing: border-box; -webkit-text-fill-color: white !important;"
              />
            </div>
            <button type="button" class="add-url-btn" data-index="${i}" style="background: #4CAF50; border: none; color: white; width: 40px; height: 40px; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; transition: all 0.2s ease;" title="Add new URL field">
              +
            </button>
            ${urls.length > 1 ? `
              <button type="button" class="remove-url-btn" data-index="${i}" style="background: #F44336; border: none; color: white; width: 40px; height: 40px; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; transition: all 0.2s ease;" title="Remove this field">
                ×
              </button>
            ` : ''}
          </div>
        `
      })
      
      return urlInputsHTML
    }
    
    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #2196F3 0%, #1976D2 100%); border-radius: 16px; width: 90vw; height: 85vh; max-width: 600px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px; font-weight: bold;">🔗 Helper Tabs Configuration</h2>
          <button id="close-config-lightbox" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 20px; font-weight: bold;">×</button>
        </div>
        
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
          <div style="margin-bottom: 20px;">
            <p style="margin: 0 0 15px 0; font-size: 14px; opacity: 0.9; line-height: 1.5;">
              Configure custom websites that will open as helper tabs. Click + to add more fields.
            </p>
            <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
              <div style="font-size: 12px; opacity: 0.8;">
                💡 <strong>Examples:</strong><br/>
                • https://chatgpt.com - ChatGPT AI Assistant<br/>
                • https://claude.ai - Claude AI Assistant<br/>
                • https://www.perplexity.ai - Perplexity AI Search<br/>
                • https://github.com - Code Repository<br/>
                • https://stackoverflow.com - Programming Q&A
              </div>
            </div>
          </div>
          
          <div id="url-fields-container">
            ${generateUrlFieldsHTML(initialUrls)}
          </div>
          
          <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.2); display: flex; gap: 15px; justify-content: space-between;">
            <div style="display: flex; gap: 10px;">
              <button type="button" id="clear-all-urls" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 12px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: all 0.2s ease;">
                🗑️ Clear All
              </button>
              <button type="button" id="load-defaults" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 12px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: all 0.2s ease;">
                🔄 Load Defaults
              </button>
            </div>
            <div style="display: flex; gap: 10px;">
              <button type="button" id="cancel-config" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: all 0.2s ease;">
                Cancel
              </button>
              <button type="button" id="save-and-open" style="background: rgba(255,255,255,0.9); border: none; color: #2196F3; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; transition: all 0.2s ease;">
                💾 Save & Open Tabs
              </button>
            </div>
          </div>
        </div>
      </div>
    `
    
    document.body.appendChild(overlay)
    
    // Function to re-attach event handlers after DOM changes
    function attachFieldEventHandlers() {
      // Add URL field handlers
      overlay.querySelectorAll('.add-url-btn').forEach(btn => {
        btn.onclick = function(e) {
          e.preventDefault()
          addNewUrlField()
        }
        
        btn.onmouseenter = function() {
          this.style.background = '#45a049'
          this.style.transform = 'scale(1.05)'
        }
        btn.onmouseleave = function() {
          this.style.background = '#4CAF50'
          this.style.transform = 'scale(1)'
        }
      })
      
      // Remove URL field handlers
      overlay.querySelectorAll('.remove-url-btn').forEach(btn => {
        btn.onclick = function(e) {
          e.preventDefault()
          const index = parseInt(this.getAttribute('data-index'))
          removeUrlField(index)
        }
        
        btn.onmouseenter = function() {
          this.style.background = '#d32f2f'
          this.style.transform = 'scale(1.05)'
        }
        btn.onmouseleave = function() {
          this.style.background = '#F44336'
          this.style.transform = 'scale(1)'
        }
      })
    }
    
    // Function to add new URL field
    function addNewUrlField() {
      const container = overlay.querySelector('#url-fields-container')
      const currentFields = container.querySelectorAll('.url-field-row')
      
      if (currentFields.length >= 10) {
        alert('❌ Maximum 10 URLs allowed!')
        return
      }
      
      const currentUrls = Array.from(container.querySelectorAll('.url-input')).map(input => input.value)
      currentUrls.push('')
      
      container.innerHTML = generateUrlFieldsHTML(currentUrls)
      attachFieldEventHandlers()
      
      // Focus the new input field
      const newInput = container.querySelector('.url-input:last-of-type')
      if (newInput) {
        newInput.focus()
      }
    }
    
    // Function to remove URL field
    function removeUrlField(indexToRemove) {
      const container = overlay.querySelector('#url-fields-container')
      const currentUrls = Array.from(container.querySelectorAll('.url-input')).map(input => input.value)
      
      if (currentUrls.length <= 1) {
        return // Don't remove the last field
      }
      
      currentUrls.splice(indexToRemove, 1)
      container.innerHTML = generateUrlFieldsHTML(currentUrls)
      attachFieldEventHandlers()
    }
    
    // Event handlers
    document.getElementById('close-config-lightbox').onclick = () => overlay.remove()
    document.getElementById('cancel-config').onclick = () => overlay.remove()
    
    // Clear all URLs
    document.getElementById('clear-all-urls').onclick = () => {
      const container = overlay.querySelector('#url-fields-container')
      container.innerHTML = generateUrlFieldsHTML([''])
      attachFieldEventHandlers()
    }
    
    // Load default URLs
    document.getElementById('load-defaults').onclick = () => {
      const defaultUrls = [
        'https://chatgpt.com',
        'https://claude.ai', 
        'https://bard.google.com',
        'https://www.perplexity.ai',
        'https://github.com',
        'https://stackoverflow.com'
      ]
      
      const container = overlay.querySelector('#url-fields-container')
      container.innerHTML = generateUrlFieldsHTML(defaultUrls)
      attachFieldEventHandlers()
    }
    
    // Save and open tabs
    document.getElementById('save-and-open').onclick = () => {
      const inputs = overlay.querySelectorAll('.url-input')
      const urls = []
      
      inputs.forEach(input => {
        const url = input.value.trim()
        if (url) {
          // Basic URL validation
          try {
            new URL(url)
            urls.push(url)
          } catch (e) {
            alert('❌ Invalid URL: ' + url + '\\n\\nPlease enter a valid URL starting with http:// or https://')
            input.focus()
            return
          }
        }
      })
      
      if (urls.length === 0) {
        alert('❌ Please enter at least one valid URL!')
        return
      }
      
      // Save URLs to localStorage
      localStorage.setItem('optimando-helper-tabs-urls', JSON.stringify(urls))
      
      // Open the helper tabs
      openCustomHelperTabs(urls)
      overlay.remove()
    }
    
    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove()
      }
    }
    
    // Attach initial event handlers
    attachFieldEventHandlers()
    
    // Focus first input field
    setTimeout(() => {
      const firstInput = overlay.querySelector('.url-input')
      if (firstInput) {
        firstInput.focus()
        if (!firstInput.value) {
          firstInput.select()
        }
      }
    }, 100)
  }
  
  // OPEN CUSTOM HELPER TABS FUNCTION
  function openCustomHelperTabs(urls) {
    const sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9)
    const sessionName = 'Helper Tabs (' + urls.length + ' sites) - ' + new Date().toLocaleDateString()
    
    // Check if popups are blocked
    const testPopup = window.open('', 'test', 'width=1,height=1')
    if (!testPopup || testPopup.closed || typeof testPopup.closed === 'undefined') {
      alert('❌ Popup blockiert!\\n\\nBitte erlauben Sie Popups für diese Website um Helper Tabs zu öffnen.')
      return
    }
    testPopup.close()
    
    const sessionData = {
      id: sessionId,
      name: sessionName,
      type: 'helper-tabs',
      createdAt: new Date().toISOString(),
      savedToBrowser: true,
      agents: [],
      tabs: [],
      urls: urls
    }
    
    const tabs = []
    
    urls.forEach((url, index) => {
      setTimeout(() => {
        const agentId = 'helper-' + (index + 1)
        const urlWithParams = url + 
          (url.includes('?') ? '&' : '?') +
          'optimando_extension=disabled' +
          '&session_id=' + sessionId +
          '&agent_id=' + agentId +
          '&tab_number=' + (index + 1)
        
        const tab = window.open(urlWithParams, 'helper-' + sessionId + '-tab-' + (index + 1))
        if (tab) {
          tabs.push(tab)
          sessionData.agents.push({
            id: agentId,
            name: 'Helper ' + (index + 1),
            emoji: '🔗',
            number: index + 1,
            url: urlWithParams,
            originalUrl: url,
            tabId: 'helper-' + sessionId + '-tab-' + (index + 1)
          })
          sessionData.tabs.push({
            id: agentId,
            url: urlWithParams,
            originalUrl: url,
            tabId: 'helper-' + sessionId + '-tab-' + (index + 1),
            opened: new Date().toISOString()
          })
          console.log('Helper Tab ' + (index + 1) + ' opened: ' + url)
        }
      }, index * 300) // Stagger opening
    })
    
    setTimeout(() => {
      if (tabs.length > 0) {
        // Save session
        const existingSessions = JSON.parse(localStorage.getItem('optimando-sessions') || '[]')
        existingSessions.push(sessionData)
        localStorage.setItem('optimando-sessions', JSON.stringify(existingSessions))
        localStorage.setItem('optimando-current-session', sessionId)
        saveSessionToBrowser(sessionData)
        
        alert('✅ Helper Tabs Session "' + sessionName + '" erstellt!\\n\\n' + 
              tabs.length + ' Helper Tabs geöffnet:\\n' +
              urls.map((url, i) => '🔗 Tab ' + (i+1) + ': ' + new URL(url).hostname).join('\\n') + 
              '\\n\\nSession und alle Tabs werden automatisch gespeichert.')
        
        // Update current tab data
        currentTabData.sessionId = sessionId
        currentTabData.sessionName = sessionName
        currentTabData.helperTabs = sessionData.agents
        saveTabDataToStorage()
      } else {
        alert('❌ Keine Tabs konnten geöffnet werden. Bitte überprüfen Sie Ihre Popup-Einstellungen.')
      }
    }, urls.length * 300 + 500)
    
    console.log('🚀 ' + urls.length + ' Helper Tabs werden geöffnet für Session: ' + sessionName)
  }

  // 4 WEBSITES GRID FUNCTION (Legacy - kept for backward compatibility)
  function open4WebsitesGrid() {
    // Create session with 4 ChatGPT agents
    const sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9)
    const sessionName = '4 ChatGPT Agents - ' + new Date().toLocaleDateString()
    const chatGPTUrl = 'https://chatgpt.com'
    
    // Check if popups are allowed
    const testTab = window.open('', '_blank')
    if (!testTab) {
      alert('Popup blockiert! Bitte erlauben Sie Popups für diese Seite, um 4 ChatGPT Tabs zu öffnen.')
      return
    }
    testTab.close()
    
    // Create session data structure
    const sessionData = {
      id: sessionId,
      name: sessionName,
      createdAt: new Date().toISOString(),
      type: 'chatgpt-grid',
      agents: [],
      tabs: []
    }
    
    // Open 4 ChatGPT tabs with agent assignments
    const tabs = []
    const agentNames = ['Summarizer', 'Researcher', 'Analyst', 'Assistant']
    const agentEmojis = ['📝', '🔍', '🧮', '🤖']
    
    for (let i = 1; i <= 4; i++) {
      setTimeout(() => {
        // Create agent-specific URL with session and agent info
        const agentId = 'agent-' + i
        const urlWithParams = chatGPTUrl + 
          '?optimando_extension=disabled' +
          '&session_id=' + sessionId +
          '&agent_id=' + agentId +
          '&agent_name=' + encodeURIComponent(agentNames[i-1]) +
          '&agent_number=' + i
        
        const tab = window.open(urlWithParams, 'chatgpt-' + sessionId + '-agent-' + i)
        if (tab) {
          tabs.push(tab)
          
          // Add agent to session data
          sessionData.agents.push({
            id: agentId,
            name: agentNames[i-1],
            emoji: agentEmojis[i-1],
            number: i,
            tabId: tab.name || ('chatgpt-' + sessionId + '-agent-' + i),
            url: urlWithParams,
            status: 'active'
          })
          
          // Add tab reference to session
          sessionData.tabs.push({
            agentId: agentId,
            url: urlWithParams,
            tabName: tab.name || ('chatgpt-' + sessionId + '-agent-' + i),
            opened: new Date().toISOString()
          })
          
          console.log('Agent ' + i + ' (' + agentNames[i-1] + ') Tab geöffnet')
        }
      }, i * 300) // 300ms delay between each tab
    }
    
    // Save session to localStorage after all tabs are created
    setTimeout(() => {
      if (tabs.length > 0) {
        // Save session data
        const existingSessions = JSON.parse(localStorage.getItem('optimando-sessions') || '[]')
        existingSessions.push(sessionData)
        localStorage.setItem('optimando-sessions', JSON.stringify(existingSessions))
        
        // Also save current active session
        localStorage.setItem('optimando-current-session', sessionId)
        
        // AUTOMATICALLY save session to browser storage (persistent across browser restarts)
        saveSessionToBrowser(sessionData)
        
        alert('✅ Session "' + sessionName + '" erstellt!\\n\\n' + 
              tabs.length + ' Agenten geöffnet:\\n' +
              '📝 Agent 1: Summarizer\\n' +
              '🔍 Agent 2: Researcher\\n' +
              '🧮 Agent 3: Analyst\\n' +
              '🤖 Agent 4: Assistant\\n\\n' +
              'Session und alle Tabs werden automatisch gespeichert.')
              
        // Update current tab data to include session reference
        currentTabData.sessionId = sessionId
        currentTabData.sessionName = sessionName
        currentTabData.chatGPTAgents = sessionData.agents
        saveTabDataToStorage()
        
      } else {
        alert('❌ Keine Tabs konnten geöffnet werden. Bitte überprüfen Sie Ihre Popup-Einstellungen.')
      }
    }, 1500)
    
    console.log('🚀 4 ChatGPT Agent-Tabs werden geöffnet für Session: ' + sessionName)
  }

  // BROWSER SESSION MANAGEMENT
  function saveSessionToBrowser(sessionData) {
    // Use chrome.storage to persist session data across browser restarts
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({
        ['optimando-browser-session-' + sessionData.id]: {
          ...sessionData,
          savedToBrowser: true,
          browserSaveTime: new Date().toISOString()
        }
      }, () => {
        console.log('✅ Session saved to browser storage:', sessionData.name)
      })
    } else {
      // Fallback: use localStorage with special key for browser sessions
      const browserSessions = JSON.parse(localStorage.getItem('optimando-browser-sessions') || '{}')
      browserSessions[sessionData.id] = {
        ...sessionData,
        savedToBrowser: true,
        browserSaveTime: new Date().toISOString()
      }
      localStorage.setItem('optimando-browser-sessions', JSON.stringify(browserSessions))
      console.log('✅ Session saved to localStorage (browser sessions):', sessionData.name)
    }
  }

  function loadSessionFromBrowser(sessionId) {
    // Try to load from chrome.storage first
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['optimando-browser-session-' + sessionId], (result) => {
        const sessionData = result['optimando-browser-session-' + sessionId]
        if (sessionData) {
          console.log('📂 Loading session from browser storage:', sessionData.name)
          restoreChatGPTSession(sessionData)
        } else {
          console.log('❌ Session not found in browser storage:', sessionId)
        }
      })
    } else {
      // Fallback: load from localStorage
      const browserSessions = JSON.parse(localStorage.getItem('optimando-browser-sessions') || '{}')
      const sessionData = browserSessions[sessionId]
      if (sessionData) {
        console.log('📂 Loading session from localStorage (browser sessions):', sessionData.name)
        restoreChatGPTSession(sessionData)
      } else {
        console.log('❌ Session not found in localStorage (browser sessions):', sessionId)
      }
    }
  }

  // NO AUTO-RESTORE - Sessions are only loaded manually via "View All Sessions"

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
    
    // Load all saved sessions from localStorage AND browser storage
    const localSessions = JSON.parse(localStorage.getItem('optimando-sessions') || '[]')
    const browserSessions = JSON.parse(localStorage.getItem('optimando-browser-sessions') || '{}')
    
    // Combine and deduplicate sessions
    const allSessions = [...localSessions]
    Object.values(browserSessions).forEach(browserSession => {
      if (!allSessions.find(s => s.id === browserSession.id)) {
        allSessions.push(browserSession)
      }
    })
    
    // Sort by creation date (newest first)
    allSessions.sort((a, b) => new Date(b.createdAt || b.browserSaveTime || 0) - new Date(a.createdAt || a.browserSaveTime || 0))
    
    let sessionsHTML = ''
    
    if (allSessions.length === 0) {
      sessionsHTML = `
        <div style="text-align: center; padding: 60px 20px; opacity: 0.7;">
          <div style="font-size: 64px; margin-bottom: 20px;">📭</div>
          <h3 style="margin: 0 0 15px 0;">Keine Sessions gefunden</h3>
          <p style="margin: 0 0 20px 0;">Erstellen Sie eine Session mit "Add Helpergrid" um sie hier zu sehen.</p>
          <div style="font-size: 12px; opacity: 0.6;">
            Sessions werden automatisch gespeichert wenn Sie ChatGPT Grids erstellen.
              </div>
              </div>
      `
    } else {
      sessionsHTML = '<div style="display: grid; gap: 20px;">'
      
      allSessions.forEach(session => {
        const sessionDate = new Date(session.createdAt || session.browserSaveTime || Date.now()).toLocaleDateString('de-DE')
        const sessionTime = new Date(session.createdAt || session.browserSaveTime || Date.now()).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})
        
        let sessionIcon = '📄'
        let sessionTypeLabel = 'Normal Session'
        let agentInfo = ''
        let statusBadge = ''
        
                if (session.type === 'chatgpt-grid') {
          sessionIcon = '🤖'
          sessionTypeLabel = 'ChatGPT Agent Grid'
          if (session.agents && session.agents.length > 0) {
            agentInfo = `
              <div style="margin: 15px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid #4CAF50;">
                <div style="font-size: 11px; opacity: 0.8; margin-bottom: 8px;">Configured Agents:</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px;">
                  ${session.agents.map(agent => 
                    '<div style="display: flex; align-items: center; gap: 6px;"><span>' + agent.emoji + '</span><span>' + agent.name + '</span></div>'
                  ).join('')}
                </div>
              </div>
            `
          }
        } else if (session.type === 'helper-tabs') {
          sessionIcon = '🔗'
          sessionTypeLabel = 'Helper Tabs'
          if (session.urls && session.urls.length > 0) {
            agentInfo = `
              <div style="margin: 15px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid #2196F3;">
                <div style="font-size: 11px; opacity: 0.8; margin-bottom: 8px;">Configured Tabs (${session.urls.length}):</div>
                <div style="display: grid; gap: 4px; font-size: 10px; max-height: 80px; overflow-y: auto;">
                  ${session.urls.slice(0, 5).map((url, i) => {
                    try {
                      const hostname = new URL(url).hostname
                      return '<div style="display: flex; align-items: center; gap: 6px; opacity: 0.9;"><span>🔗</span><span>' + (i+1) + '. ' + hostname + '</span></div>'
                    } catch {
                      return '<div style="display: flex; align-items: center; gap: 6px; opacity: 0.7;"><span>❌</span><span>' + (i+1) + '. Invalid URL</span></div>'
                    }
                  }).join('')}
                  ${session.urls.length > 5 ? '<div style="opacity: 0.6; font-style: italic;">... und ' + (session.urls.length - 5) + ' weitere</div>' : ''}
                </div>
              </div>
            `
          }
        }
        
        if (session.savedToBrowser) {
          statusBadge = '<span style="background: #4CAF50; color: white; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: bold;">💾 PERSISTENT</span>'
        } else {
          statusBadge = '<span style="background: #FF9800; color: white; padding: 2px 6px; border-radius: 10px; font-size: 9px; font-weight: bold;">⚠️ LOCAL</span>'
        }
        
        sessionsHTML += `
          <div class="session-card" data-session="${session.id}" style="background: rgba(255,255,255,0.1); border-radius: 12px; padding: 24px; cursor: pointer; transition: all 0.3s ease; border: 2px solid rgba(255,255,255,0.1); position: relative;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
              <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                  <h3 class="session-title" style="margin: 0; font-size: 18px; font-weight: bold;">${sessionIcon} ${session.name}</h3>
                  <button class="rename-session-btn" data-session="${session.id}" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 12px; opacity: 0.7; transition: all 0.2s ease;" title="Session umbenennen">✏️</button>
                  ${statusBadge}
                </div>
                <div style="font-size: 12px; opacity: 0.8; color: #E3F2FD;">${sessionTypeLabel}</div>
              </div>
              <div style="text-align: right; font-size: 11px; opacity: 0.7; min-width: 80px;">
                <div style="margin-bottom: 2px;">📅 ${sessionDate}</div>
                <div>🕐 ${sessionTime}</div>
              </div>
            </div>
            
            ${agentInfo}
            
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
              <div style="font-size: 11px; opacity: 0.6;">
                ${session.savedToBrowser ? 
                  '✅ Browser-persistent • Wird automatisch wiederhergestellt' : 
                  '⚠️ Nur lokal gespeichert • Nicht browser-persistent'
                }
          </div>
              <div style="font-size: 11px; opacity: 0.8; background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 12px;">
                Click to restore
              </div>
            </div>
          </div>
        `
      })
      
      sessionsHTML += '</div>'
    }

    overlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; width: 90vw; height: 85vh; max-width: 1000px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column;">
        <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 20px; font-weight: bold;">📚 Sessions History (${allSessions.length} Sessions)</h2>
          <button id="close-lightbox-btn" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 20px; font-weight: bold;">×</button>
        </div>
        <div style="flex: 1; padding: 20px; overflow-y: auto;">
          ${sessionsHTML}
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
      card.onclick = function(e) {
        // Don't trigger session load if clicking on rename button
        if (e.target.classList.contains('rename-session-btn')) {
          return
        }
        
        const sessionId = this.getAttribute('data-session')
        console.log('🔄 Loading session from history:', sessionId)
        window.loadSession(sessionId)
        overlay.remove()
      }
      
      // Hover effect
      card.onmouseenter = function() {
        this.style.background = 'rgba(255,255,255,0.2)'
        this.style.transform = 'translateY(-2px)'
        this.style.boxShadow = '0 8px 25px rgba(0,0,0,0.2)'
        
        // Show rename button more prominently on hover
        const renameBtn = this.querySelector('.rename-session-btn')
        if (renameBtn) {
          renameBtn.style.opacity = '1'
          renameBtn.style.background = 'rgba(255,255,255,0.3)'
        }
      }
      card.onmouseleave = function() {
        this.style.background = 'rgba(255,255,255,0.1)'
        this.style.transform = 'translateY(0)'
        this.style.boxShadow = 'none'
        
        // Hide rename button again
        const renameBtn = this.querySelector('.rename-session-btn')
        if (renameBtn) {
          renameBtn.style.opacity = '0.7'
          renameBtn.style.background = 'rgba(255,255,255,0.2)'
        }
      }
    })
    
    // Add rename button handlers
    const renameButtons = overlay.querySelectorAll('.rename-session-btn')
    renameButtons.forEach(btn => {
      btn.onclick = function(e) {
        e.stopPropagation() // Prevent session card click
        const sessionId = this.getAttribute('data-session')
        renameSession(sessionId, overlay)
      }
      
      btn.onmouseenter = function() {
        this.style.opacity = '1'
        this.style.background = 'rgba(255,255,255,0.4)'
        this.style.transform = 'scale(1.1)'
      }
      btn.onmouseleave = function() {
        this.style.opacity = '0.7'
        this.style.background = 'rgba(255,255,255,0.2)'
        this.style.transform = 'scale(1)'
      }
    })
  }
  
  // Restore Helper Tabs Session
  function restoreHelperTabsSession(session) {
    console.log('Restoring Helper Tabs session:', session.name)
    
    // Check if popups are blocked
    const testPopup = window.open('', 'test', 'width=1,height=1')
    if (!testPopup || testPopup.closed || typeof testPopup.closed === 'undefined') {
      alert('❌ Popup blockiert!\\n\\nBitte erlauben Sie Popups für diese Website um Helper Tabs zu wiederherzustellen.')
      return
    }
    testPopup.close()
    
    const urls = session.urls || []
    
    if (urls.length === 0) {
      alert('❌ Keine URLs in dieser Session gefunden!')
      return
    }
    
    const tabs = []
    
    console.log('🔄 Restoring ' + urls.length + ' Helper Tabs...')
    
    urls.forEach((url, index) => {
      setTimeout(() => {
        const agentId = 'helper-' + (index + 1)
        const urlWithParams = url + 
          (url.includes('?') ? '&' : '?') +
          'optimando_extension=disabled' +
          '&session_id=' + session.id +
          '&agent_id=' + agentId +
          '&tab_number=' + (index + 1) +
          '&restored=true'
        
        const tab = window.open(urlWithParams, 'helper-' + session.id + '-tab-' + (index + 1))
        if (tab) {
          tabs.push(tab)
          console.log('Helper Tab ' + (index + 1) + ' restored: ' + url)
        }
      }, index * 400) // Slightly slower for restoration
    })
    
    setTimeout(() => {
      // Update session's last opened time
      session.lastOpened = new Date().toISOString()
      
      // Save updated session
      const existingSessions = JSON.parse(localStorage.getItem('optimando-sessions') || '[]')
      const sessionIndex = existingSessions.findIndex(s => s.id === session.id)
      if (sessionIndex !== -1) {
        existingSessions[sessionIndex] = session
        localStorage.setItem('optimando-sessions', JSON.stringify(existingSessions))
      }
      
      // Update current tab data
      currentTabData.sessionId = session.id
      currentTabData.sessionName = session.name
      currentTabData.helperTabs = session.agents || []
      saveTabDataToStorage()
      
      // Set as current session
      localStorage.setItem('optimando-current-session', session.id)
      
      // Show confirmation
      alert('✅ Helper Tabs Session wiederhergestellt!\\n\\n' +
            'Session: "' + session.name + '"\\n' +
            tabs.length + ' Helper Tabs wurden geöffnet:\\n' +
            urls.map((url, i) => '🔗 Tab ' + (i+1) + ': ' + new URL(url).hostname).join('\\n'))
      
      console.log('✅ Helper Tabs session restored successfully:', session.name)
    }, urls.length * 400 + 500)
  }
  
  // RENAME SESSION FUNCTION
  function renameSession(sessionId, parentOverlay) {
    // Get current session data
    const localSessions = JSON.parse(localStorage.getItem('optimando-sessions') || '[]')
    const browserSessions = JSON.parse(localStorage.getItem('optimando-browser-sessions') || '{}')
    
    let session = localSessions.find(s => s.id === sessionId)
    let isInBrowserStorage = false
    
    if (!session) {
      session = Object.values(browserSessions).find(s => s.id === sessionId)
      isInBrowserStorage = true
    }
    
    if (!session) {
      alert('❌ Session nicht gefunden!')
      return
    }
    
    // Create rename dialog
    const renameOverlay = document.createElement('div')
    renameOverlay.id = 'rename-session-overlay'
    renameOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.9); z-index: 2147483650;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(8px);
    `
    
    renameOverlay.innerHTML = `
      <div style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); border-radius: 16px; width: 90vw; max-width: 500px; color: white; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5); display: flex; flex-direction: column;">
        <div style="padding: 24px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 18px; font-weight: bold;">✏️ Session umbenennen</h2>
          <button id="close-rename-dialog" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 16px; font-weight: bold;">×</button>
        </div>
        
        <div style="padding: 24px;">
          <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; font-size: 14px; opacity: 0.9;">Aktueller Name:</label>
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 8px; font-size: 14px; border: 1px solid rgba(255,255,255,0.2);">
              ${session.name}
            </div>
          </div>
          
          <div style="margin-bottom: 24px;">
            <label style="display: block; margin-bottom: 8px; font-size: 14px; opacity: 0.9;">Neuer Name:</label>
            <input 
              type="text" 
              id="new-session-name" 
              value="${session.name}" 
              style="width: 100%; padding: 12px; background: rgba(255,255,255,0.15); border: 2px solid rgba(255,255,255,0.3); color: white; border-radius: 8px; font-size: 14px; box-sizing: border-box;"
              placeholder="Geben Sie einen neuen Namen ein..."
              autocomplete="off"
            />
          </div>
          
          <div style="display: flex; gap: 12px; justify-content: flex-end;">
            <button id="cancel-rename" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: all 0.2s ease;">
              Abbrechen
            </button>
            <button id="confirm-rename" style="background: rgba(255,255,255,0.9); border: none; color: #4CAF50; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: bold; transition: all 0.2s ease;">
              💾 Speichern
            </button>
          </div>
        </div>
      </div>
    `
    
    document.body.appendChild(renameOverlay)
    
    // Focus input and select all text
    const nameInput = document.getElementById('new-session-name')
    nameInput.focus()
    nameInput.select()
    
    // Event handlers
    document.getElementById('close-rename-dialog').onclick = () => renameOverlay.remove()
    document.getElementById('cancel-rename').onclick = () => renameOverlay.remove()
    
    document.getElementById('confirm-rename').onclick = function() {
      const newName = nameInput.value.trim()
      
      if (!newName) {
        alert('❌ Bitte geben Sie einen Namen ein!')
        nameInput.focus()
        return
      }
      
      if (newName === session.name) {
        renameOverlay.remove()
        return
      }
      
      // Update session name
      session.name = newName
      session.lastModified = new Date().toISOString()
      
      // Save to appropriate storage
      if (isInBrowserStorage) {
        // Update in browser storage
        browserSessions[sessionId] = session
        localStorage.setItem('optimando-browser-sessions', JSON.stringify(browserSessions))
        
        // Also save to chrome.storage.local if available
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({
            ['optimando-session-' + sessionId]: session
          }).catch(err => console.warn('Could not save to chrome.storage.local:', err))
        }
      } else {
        // Update in local sessions
        const sessionIndex = localSessions.findIndex(s => s.id === sessionId)
        if (sessionIndex !== -1) {
          localSessions[sessionIndex] = session
          localStorage.setItem('optimando-sessions', JSON.stringify(localSessions))
        }
      }
      
      // If this is the current session, update current tab data too
      const currentSessionId = localStorage.getItem('optimando-current-session')
      if (currentSessionId === sessionId) {
        currentTabData.sessionName = newName
        saveTabDataToStorage()
      }
      
      console.log('✅ Session renamed from "' + session.name + '" to "' + newName + '"')
      
      // Close rename dialog
      renameOverlay.remove()
      
      // Refresh the sessions history to show updated name
      parentOverlay.remove()
      setTimeout(() => {
        window.openSessionsHistoryLightbox()
      }, 100)
      
      // Show success message
      setTimeout(() => {
        alert('✅ Session erfolgreich umbenannt!')
      }, 200)
    }
    
    // Enter key to confirm
    nameInput.onkeydown = function(e) {
      if (e.key === 'Enter') {
        document.getElementById('confirm-rename').click()
      } else if (e.key === 'Escape') {
        renameOverlay.remove()
      }
    }
    
    // Close on overlay click
    renameOverlay.onclick = (e) => {
      if (e.target === renameOverlay) {
        renameOverlay.remove()
      }
    }
  }
  
  // LOAD SESSION FUNCTION
  window.loadSession = function(sessionId) {
    console.log('Loading session:', sessionId)
    
    // Get session data from localStorage
    const sessions = JSON.parse(localStorage.getItem('optimando-sessions') || '[]')
    const session = sessions.find(s => s.id === sessionId)
    
    if (!session) {
      alert('❌ Session nicht gefunden: ' + sessionId)
      return
    }
    
    if (session.type === 'chatgpt-grid' && session.agents && session.agents.length > 0) {
      // Restore ChatGPT agent session - this restores the helper grids
      restoreChatGPTSession(session)
    } else if (session.type === 'helper-tabs' && session.urls && session.urls.length > 0) {
      // Restore Helper Tabs session
      restoreHelperTabsSession(session)
    } else {
      // Regular session loading
      alert('Session wird geladen: ' + session.name)
      
      // Update current tab data for the MASTER tab
      currentTabData.sessionId = sessionId
      currentTabData.sessionName = session.name
      saveTabDataToStorage()
      
      // Set as active session
      localStorage.setItem('optimando-current-session', sessionId)
    }
    
    // IMPORTANT: Update the current (master) tab to show it's part of this session
    // This makes the current tab the "master tab" for the session
    currentTabData.sessionId = sessionId
    currentTabData.sessionName = session.name
    if (session.type === 'chatgpt-grid') {
      currentTabData.chatGPTAgents = session.agents
    }
    saveTabDataToStorage()
    
    console.log('✅ Session loaded. Current tab is now the master tab for session:', session.name)
  }
  
  // Restore ChatGPT Agent Session
  function restoreChatGPTSession(session) {
    console.log('Restoring ChatGPT session:', session.name)
    
    // Check if popups are allowed
    const testTab = window.open('', '_blank')
    if (!testTab) {
      alert('Popup blockiert! Bitte erlauben Sie Popups um die Session-Tabs zu öffnen.')
      return
    }
    testTab.close()
    
    // Reopen all agent tabs
    const reopenedTabs = []
    session.agents.forEach((agent, index) => {
      setTimeout(() => {
        const tab = window.open(agent.url, agent.tabId)
        if (tab) {
          reopenedTabs.push(tab)
          console.log('Agent ' + agent.number + ' (' + agent.name + ') Tab wiederhergestellt')
        }
      }, (index + 1) * 300) // 300ms delay between each tab
    })
    
    // Show confirmation and update session
    setTimeout(() => {
      if (reopenedTabs.length > 0) {
        // Update session with reopened timestamp
        session.lastOpened = new Date().toISOString()
        const sessions = JSON.parse(localStorage.getItem('optimando-sessions') || '[]')
        const sessionIndex = sessions.findIndex(s => s.id === session.id)
        if (sessionIndex !== -1) {
          sessions[sessionIndex] = session
          localStorage.setItem('optimando-sessions', JSON.stringify(sessions))
        }
        
        // Set as active session
        localStorage.setItem('optimando-current-session', session.id)
        
        // Update current tab data
        currentTabData.sessionId = session.id
        currentTabData.sessionName = session.name
        currentTabData.chatGPTAgents = session.agents
        saveTabDataToStorage()
        
        alert('✅ Session "' + session.name + '" wiederhergestellt!\\n\\n' + 
              reopenedTabs.length + ' Agent-Tabs geöffnet:\\n' +
              session.agents.map(a => a.emoji + ' Agent ' + a.number + ': ' + a.name).join('\\n'))
              
      } else {
        alert('❌ Keine Tabs konnten wiederhergestellt werden.')
      }
    }, session.agents.length * 300 + 500)
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

    // Save Session Button - Enhanced to save to browser storage
    document.getElementById('save-session-btn')?.addEventListener('click', () => {
      saveTabDataToStorage()
      
      // If current session has ChatGPT agents, save to browser storage
      if (currentTabData.sessionId && currentTabData.chatGPTAgents && currentTabData.chatGPTAgents.length > 0) {
        const sessionData = {
          id: currentTabData.sessionId,
          name: currentTabData.sessionName || ('Session - ' + new Date().toLocaleDateString()),
          type: 'chatgpt-grid',
          agents: currentTabData.chatGPTAgents,
          createdAt: new Date().toISOString(),
          tabs: currentTabData.chatGPTAgents.map(agent => ({
            agentId: agent.id,
            url: agent.url,
            tabName: agent.tabId,
            opened: new Date().toISOString()
          }))
        }
        
        saveSessionToBrowser(sessionData)
        alert('✅ Session inklusive ChatGPT-Agents in Browser gespeichert!\\n\\nDie Session wird beim nächsten Browser-Start automatisch wiederhergestellt.')
      } else {
        alert('✅ Normale Session gespeichert!')
      }
    })

    document.getElementById('qr-code-scanner-btn')?.addEventListener('click', () => {
      alert('QR Code Scanner activated!')
    })

    // Add Helpergrid Button
    document.getElementById('add-helpergrid-btn')?.addEventListener('click', () => {
      openHelperGridLightbox()
    })

    console.log('✅ All event listeners attached')
  }, 100)

  console.log('✅ Optimando AI Extension loaded successfully')
}

// Initialize extension if it was previously activated for this URL
if (isExtensionActive) {
  initializeExtension()
}