// Content script with real 3-sidebar layout like Microsoft Copilot
console.log('🚀 Optimando Content Script lädt...')

// Create a simple test element
const testDiv = document.createElement('div')
testDiv.id = 'optimando-test'
testDiv.style.cssText = `
  position: fixed;
  top: 50px;
  right: 50px;
  background: red;
  color: white;
  padding: 20px;
  z-index: 999999;
  font-size: 18px;
  font-weight: bold;
  border: 5px solid white;
  border-radius: 10px;
`
testDiv.textContent = '🔴 OPTIMANDO TEST'

// Add to page immediately
document.body.appendChild(testDiv)
console.log('✅ Test div hinzugefügt')

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

// Add left sidebar
const leftSidebar = document.createElement('div')
leftSidebar.id = 'left-sidebar'
leftSidebar.style.cssText = `
  position: absolute;
  left: 0;
  top: 0;
  width: 280px;
  height: 100vh;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
  color: white;
  padding: 20px;
  font-family: Arial, sans-serif;
  box-shadow: 2px 0 10px rgba(0,0,0,0.3);
  transition: width 0.3s ease;
  pointer-events: auto;
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
  adjustBrowserContent()
}

// Add resize handle to left sidebar
const leftResizeHandle = document.createElement('div')
leftResizeHandle.style.cssText = `
  position: absolute;
  right: 0;
  top: 0;
  width: 8px;
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
    adjustBrowserContent()
  }
})
document.addEventListener('mouseup', () => {
  isResizingLeft = false
})

leftSidebar.innerHTML = '<h2>Left Sidebar</h2><p>Tab Status, Input Stream, Cost, Audit Log</p>'
leftSidebar.appendChild(leftCloseBtn)
leftSidebar.appendChild(leftResizeHandle)

// Add right sidebar
const rightSidebar = document.createElement('div')
rightSidebar.id = 'right-sidebar'
rightSidebar.style.cssText = `
  position: absolute;
  right: 0;
  top: 0;
  width: 280px;
  height: 100vh;
  background: linear-gradient(135deg, rgba(118, 75, 162, 0.95) 0%, rgba(102, 126, 234, 0.95) 100%);
  color: white;
  padding: 20px;
  font-family: Arial, sans-serif;
  box-shadow: -2px 0 10px rgba(0,0,0,0.3);
  transition: width 0.3s ease;
  pointer-events: auto;
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
  adjustBrowserContent()
}

// Add resize handle to right sidebar
const rightResizeHandle = document.createElement('div')
rightResizeHandle.style.cssText = `
  position: absolute;
  left: 0;
  top: 0;
  width: 8px;
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
    adjustBrowserContent()
  }
})
document.addEventListener('mouseup', () => {
  isResizingRight = false
})

rightSidebar.innerHTML = '<h2>Right Sidebar</h2><p>WRScan, QR Code, Mode, Agents, Settings</p>'
rightSidebar.appendChild(rightCloseBtn)
rightSidebar.appendChild(rightResizeHandle)

// Add bottom sidebar
const bottomSidebar = document.createElement('div')
bottomSidebar.id = 'bottom-sidebar'
bottomSidebar.style.cssText = `
  position: absolute;
  left: 280px;
  right: 280px;
  bottom: 0;
  height: 200px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 100%);
  color: white;
  padding: 20px;
  font-family: Arial, sans-serif;
  box-shadow: 0 -2px 10px rgba(0,0,0,0.3);
  transition: height 0.3s ease;
  pointer-events: auto;
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
  adjustBrowserContent()
}

// Add resize handle to bottom sidebar
const bottomResizeHandle = document.createElement('div')
bottomResizeHandle.style.cssText = `
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 8px;
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
    const newHeight = Math.max(100, Math.min(400, window.innerHeight - e.clientY))
    bottomSidebar.style.height = newHeight + 'px'
    adjustBrowserContent()
  }
})
document.addEventListener('mouseup', () => {
  isResizingBottom = false
})

bottomSidebar.innerHTML = '<h2>Bottom Sidebar</h2><p>Helper Tab/Master, Content Area, Logs/Live Stream/Metrics</p>'
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
    const leftWidth = leftSidebar.style.width === '0px' ? 0 : parseInt(leftSidebar.style.width) || 280
    const rightWidth = rightSidebar.style.width === '0px' ? 0 : parseInt(rightSidebar.style.width) || 280
    const bottomHeight = bottomSidebar.style.height === '0px' ? 0 : parseInt(bottomSidebar.style.height) || 200
    
    // Apply margins to body to push content away from sidebars
    document.body.style.marginLeft = leftWidth + 'px'
    document.body.style.marginRight = rightWidth + 'px'
    document.body.style.marginBottom = bottomHeight + 'px'
    
    // Add padding-bottom to body so content is visible above bottom sidebar
    document.body.style.paddingBottom = bottomHeight + 'px'
    
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
        leftSidebar.style.width = '280px'
        rightSidebar.style.width = '280px'
        bottomSidebar.style.height = '200px'
        leftCloseBtn.style.display = 'block'
        rightCloseBtn.style.display = 'block'
        bottomCloseBtn.style.display = 'block'
        leftResizeHandle.style.display = 'block'
        rightResizeHandle.style.display = 'block'
        bottomResizeHandle.style.display = 'block'
        leftSidebar.style.overflow = 'visible'
        rightSidebar.style.overflow = 'visible'
        bottomSidebar.style.overflow = 'visible'
        leftSidebar.style.padding = '20px'
        rightSidebar.style.padding = '20px'
        bottomSidebar.style.padding = '20px'
      }
      
      adjustBrowserContent()
    }
    
    // Update test element
    if (testDiv) {
      testDiv.style.background = message.visible ? 'green' : 'red'
      testDiv.textContent = message.visible ? '🟢 SIDEBARS EIN' : '🔴 SIDEBARS AUS'
      console.log('Test div aktualisiert')
    }
    
    sendResponse({ success: true })
  }
  
  return true
})

console.log('✅ Message listener hinzugefügt')
console.log('✅ Optimando Content Script vollständig geladen!')

// Test: Try to show sidebars immediately
setTimeout(() => {
  console.log('🧪 Test: Zeige Sidebars nach 2 Sekunden')
  sidebarsDiv.style.display = 'block'
  testDiv.style.background = 'green'
  testDiv.textContent = '🟢 TEST SIDEBARS'
  adjustBrowserContent()
}, 2000)
