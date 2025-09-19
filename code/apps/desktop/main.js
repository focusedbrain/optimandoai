const { app, BrowserWindow, Tray, Menu } = require('electron')
const path = require('path')
const WebSocket = require('ws')

let win = null
let wss = null
let tray = null

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    show: !process.argv.includes('--headless') // Hide window if --headless flag is used
  })

  win.loadFile('index.html')
  
  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools()
  }
  
  // If headless mode, minimize to system tray
  if (process.argv.includes('--headless')) {
    win.minimize()
    win.hide()
  }
}

function startWebSocketServer() {
  const port = 51247
  
  try {
    console.log(`🚀 Starte WebSocket-Server auf Port ${port}...`)
    
    wss = new WebSocket.Server({ port })
    
    wss.on('connection', (ws) => {
      console.log('🔗 Neue WebSocket-Verbindung hergestellt')
      
      // Send welcome message
      ws.send(JSON.stringify({ 
        type: 'welcome', 
        message: 'Verbunden mit OpenGiraffe Desktop App',
        timestamp: new Date().toISOString()
      }))
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString())
          console.log('📨 Nachricht erhalten:', message)
          
          // Handle ping messages
          if (message.type === 'ping') {
            ws.send(JSON.stringify({
              type: 'pong',
              message: 'Pong von Desktop App',
              timestamp: new Date().toISOString(),
              from: message.from
            }))
          }
          
          // Handle grid config save messages
          if (message.type === 'SAVE_GRID_CONFIG') {
            console.log('💾 Grid config received from:', message.from)
            console.log('💾 Config:', message.config)
            
            // Forward to Chrome extension via localStorage bridge
            const fs = require('fs')
            const path = require('path')
            const os = require('os')
            
            const configDir = path.join(os.homedir(), '.optimando')
            const configFile = path.join(configDir, 'grid-config.json')
            
            // Ensure directory exists
            if (!fs.existsSync(configDir)) {
              fs.mkdirSync(configDir, { recursive: true })
            }
            
            // Write config to file
            const configData = {
              ...message.config,
              timestamp: new Date().toISOString(),
              from: 'electron-app'
            }
            
            fs.writeFileSync(configFile, JSON.stringify(configData, null, 2))
            console.log('✅ Grid config saved to file:', configFile)
            
            // Create a bridge file that the Chrome extension can read
            const bridgeFile = path.join(configDir, 'extension-bridge.json')
            const bridgeData = {
              type: 'GRID_CONFIG_SAVED',
              config: configData,
              timestamp: new Date().toISOString(),
              target: 'chrome-extension'
            }
            
            fs.writeFileSync(bridgeFile, JSON.stringify(bridgeData, null, 2))
            console.log('✅ Bridge file created for Chrome extension:', bridgeFile)
            
            // Also create a simple flag file to trigger extension polling
            const triggerFile = path.join(configDir, 'extension-trigger.flag')
            fs.writeFileSync(triggerFile, JSON.stringify({
              timestamp: new Date().toISOString(),
              action: 'grid_config_saved'
            }))
            console.log('✅ Trigger file created:', triggerFile)
            
            // Send confirmation back to grid window
            ws.send(JSON.stringify({
              type: 'GRID_CONFIG_SAVED',
              message: 'Grid configuration saved successfully',
              timestamp: new Date().toISOString(),
              config: message.config
            }))
          }
        } catch (error) {
          console.log('❌ Fehler beim Verarbeiten der Nachricht:', error)
        }
      })
      
      ws.on('close', () => {
        console.log('🔌 WebSocket-Verbindung geschlossen')
      })
      
      ws.on('error', (error) => {
        console.log('❌ WebSocket-Fehler:', error)
      })
    })
    
    console.log(`✅ WebSocket-Server läuft erfolgreich auf Port ${port}`)
    
    // Update window title to show server status
    if (win) {
      win.setTitle(`OpenGiraffe Desktop App - WebSocket Server läuft auf Port ${port}`)
    }
    
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.log(`❌ Port ${port} ist bereits in Verwendung. Versuche Port ${port + 1}...`)
      startWebSocketServer(port + 1)
    } else {
      console.log(`❌ Fehler beim Starten des WebSocket-Servers:`, error)
    }
  }
}

function createTray() {
  // System tray functionality disabled for now
  // The app will run in the background without system tray
  console.log('ℹ️ System tray disabled, app running in background')
}

app.whenReady().then(() => {
  // Ensure the app starts on login (installed users)
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--headless'] })
    }
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.opengiraffe.desktop')
    }
  } catch {}

  createWindow()
  
  // Create system tray
  createTray()
  
  // Start WebSocket server after a short delay to ensure window is ready
  setTimeout(() => {
    startWebSocketServer()
  }, 1000)
})

app.on('window-all-closed', () => {
  // Don't quit the app when all windows are closed
  // Keep the WebSocket server running
  console.log('🪟 All windows closed, but keeping app running for WebSocket server')
  win = null
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Cleanup WebSocket server when app quits
app.on('before-quit', () => {
  if (wss) {
    wss.close()
    console.log('🔌 WebSocket-Server beendet')
  }
})
