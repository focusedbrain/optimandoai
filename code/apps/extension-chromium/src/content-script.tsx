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
  document.body.style.marginTop = ''
  
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
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 10px;">
      <h2 style="margin: 0; font-size: 18px; display: flex; align-items: center; gap: 10px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
          <!-- Giraffe Body -->
          <path d="M12 16C12 16 10 16 10 18C10 20 12 20 12 20C12 20 14 20 14 18C14 16 12 16 12 16Z" fill="currentColor" opacity="0.8"/>
          <!-- Giraffe Neck -->
          <path d="M12 8C12 8 11 8 11 12C11 16 12 16 12 16C12 16 13 16 13 12C13 8 12 8 12 8Z" fill="currentColor" opacity="0.9"/>
          <!-- Giraffe Head -->
          <ellipse cx="12" cy="6" rx="2.5" ry="2" fill="currentColor"/>
          <!-- Giraffe Spots -->
          <circle cx="11" cy="5.5" r="0.3" fill="currentColor" opacity="0.4"/>
          <circle cx="13" cy="6.5" r="0.3" fill="currentColor" opacity="0.4"/>
          <circle cx="11.5" cy="10" r="0.4" fill="currentColor" opacity="0.4"/>
          <circle cx="12.5" cy="12" r="0.4" fill="currentColor" opacity="0.4"/>
          <circle cx="11.5" cy="14" r="0.4" fill="currentColor" opacity="0.4"/>
          <!-- Giraffe Ears -->
          <circle cx="10.5" cy="4.5" r="0.5" fill="currentColor" opacity="0.7"/>
          <circle cx="13.5" cy="4.5" r="0.5" fill="currentColor" opacity="0.7"/>
          <!-- Giraffe Legs -->
          <rect x="10.5" y="18" width="0.8" height="3" fill="currentColor" opacity="0.8"/>
          <rect x="12.7" y="18" width="0.8" height="3" fill="currentColor" opacity="0.8"/>
        </svg>
        OpenGiraffe
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
      <h2 style="margin: 0; font-size: 18px;">⚙️ AI Orchestrator</h2>
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
            <span style="font-size: 12px; font-weight: bold; color: white;">🧠 Reasoning</span>
            <button id="expand-btn" style="background: transparent; border: none; color: white; font-size: 12px; transition: transform 0.3s ease;">⌄</button>
          </div>
          <button id="agents-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">🤖 Agents</button>
          <button id="whitelist-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">🛡️ Whitelist</button>
          <button id="settings-lightbox-btn" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; color: white; border-radius: 3px; cursor: pointer; font-size: 10px;">⚙️ Settings</button>
        </div>
        
        <!-- Session Name + Lock -->
        <div style="display: flex; align-items: center; gap: 10px;">
          <input id="session-name-input" type="text" value="${currentTabData.tabName}" 
                 style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3); color: white; 
                        padding: 4px 8px; border-radius: 3px; font-size: 11px; width: 140px; 
                        ${currentTabData.isLocked ? 'opacity: 0.6; pointer-events: none;' : ''}"
                 ${currentTabData.isLocked ? 'disabled' : ''}
                 placeholder="Session Name">
          <button id="lock-btn" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 24px; height: 24px; border-radius: 3px; cursor: pointer; font-size: 10px; ${currentTabData.isLocked ? 'background: rgba(255,215,0,0.3);' : ''}">${currentTabData.isLocked ? '🔒' : '🔓'}</button>
        </div>
      </div>

      <!-- Expandable Content - 3 Column Reasoning Display -->
      <div id="expandable-content" style="display: none; margin-top: 15px; height: ${expandedHeight - 60}px; overflow-y: auto;">
        
        <!-- 3-Column Layout -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; height: 100%;">
            
          <!-- Intent Detection Column -->
            <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px;">
              <h4 style="margin: 0 0 10px 0; font-size: 12px; color: #FFD700;">🎯 Intent Detection</h4>
              <div style="font-size: 10px;">
                <div style="margin-bottom: 8px;"><strong>Current:</strong> ${currentTabData.userIntentDetection.detected}</div>
                <div style="margin-bottom: 8px;"><strong>Confidence:</strong> ${currentTabData.userIntentDetection.confidence}%</div>
                <div><strong>Updated:</strong> ${currentTabData.userIntentDetection.lastUpdate}</div>
              </div>
            </div>

          <!-- Goals Column -->
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

          <!-- Reasoning Column -->
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

  // Add all sidebars to page
  sidebarsDiv.appendChild(leftSidebar)
  sidebarsDiv.appendChild(rightSidebar)
  sidebarsDiv.appendChild(bottomSidebar)
  document.body.appendChild(sidebarsDiv)
  
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
    document.getElementById('whitelist-lightbox-btn')?.addEventListener('click', openWhitelistLightbox)
    document.getElementById('settings-lightbox-btn')?.addEventListener('click', openSettingsLightbox)
    
    // Left sidebar quick expand button
    document.getElementById('quick-expand-btn')?.addEventListener('click', () => {
      const currentWidth = currentTabData.uiConfig.leftSidebarWidth
      const maxWidth = window.innerWidth * 0.35 // 35% of screen width
      const newWidth = currentWidth === 250 ? maxWidth : 250
      
      currentTabData.uiConfig.leftSidebarWidth = newWidth
      leftSidebar.style.width = newWidth + 'px'
      document.body.style.marginLeft = newWidth + 'px'
      bottomSidebar.style.left = newWidth + 'px'
      
      saveTabDataToStorage()
      console.log('🔄 Left sidebar toggled to width:', newWidth)
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
    
    console.log('✅ Event handlers attached for reasoning section')
  }, 100)

}

// Initialize extension if active
if (isExtensionActive) {
  initializeExtension()
}
