const { app, BrowserWindow } = require('electron')
const path = require('path')
const WebSocket = require('ws')

let win = null
let wss = null

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  win.loadFile('index.html')
  
  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools()
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
        message: 'Verbunden mit Optimando Desktop App',
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
      win.setTitle(`Optimando Desktop App - WebSocket Server läuft auf Port ${port}`)
    }
    
  } catch (error) {
    console.log(`❌ Fehler beim Starten des WebSocket-Servers:`, error)
  }
}

app.whenReady().then(() => {
  createWindow()
  
  // Start WebSocket server after a short delay to ensure window is ready
  setTimeout(() => {
    startWebSocketServer()
  }, 1000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
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
