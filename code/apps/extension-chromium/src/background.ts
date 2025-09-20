let ws: WebSocket | null = null;
let isConnecting = false;
let autoConnectInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
// Feature flag to completely disable WebSocket auto-connection
const WS_ENABLED = false;
// Track sidebar visibility per tab
const tabSidebarStatus = new Map<number, boolean>();

// Connect to external WebSocket server (not the desktop app)
function connectToWebSocketServer() {
  if (!WS_ENABLED) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (isConnecting) return;

  isConnecting = true;

  // Connect to external WebSocket server (you can change this URL)
  const wsUrl = 'ws://localhost:51247/';

  try {
    console.log(`🔗 Verbinde mit WebSocket-Server: ${wsUrl}`);

    ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      isConnecting = false;
      console.log('✅ WebSocket-Verbindung geöffnet');

      // Send initial message
      ws?.send(JSON.stringify({ type: 'ping', from: 'extension' }));

      // Start heartbeat to keep connection alive
      startHeartbeat();

      // Update extension badge
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#00FF00' });
    });

    ws.addEventListener('message', (e) => {
      console.log(`📨 Nachricht erhalten: ${String(e.data)}`);
      
      // Handle pong responses
      try {
        const data = JSON.parse(String(e.data));
        if (data.type === 'pong') {
          console.log('🏓 Pong erhalten - Verbindung ist aktiv');
        }
      } catch (error) {
        // Ignore parsing errors
      }
    });

    ws.addEventListener('error', (error) => {
      console.log(`❌ WebSocket-Fehler: ${error}`);
      isConnecting = false;

      // Update extension badge
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    });

    ws.addEventListener('close', (event) => {
      console.log(`🔌 WebSocket-Verbindung geschlossen (Code: ${event.code}, Reason: ${event.reason})`);
      ws = null;
      isConnecting = false;
      
      // Stop heartbeat
      stopHeartbeat();

      // Update extension badge
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      
      // Try to reconnect after a short delay
      setTimeout(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          console.log('🔄 Versuche automatische Wiederverbindung...');
          connectToWebSocketServer();
        }
      }, 2000);
    });

  } catch (error) {
    console.log(`❌ Fehler beim Verbinden: ${error}`);
    isConnecting = false;

    // Update extension badge
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  }
}

// Start heartbeat to keep connection alive
function startHeartbeat() {
  if (!WS_ENABLED) return;
  stopHeartbeat(); // Clear any existing heartbeat
  
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('🏓 Sende Ping...');
      ws.send(JSON.stringify({ type: 'ping', from: 'extension', timestamp: Date.now() }));
    } else {
      console.log('🔌 WebSocket nicht verbunden - stoppe Heartbeat');
      stopHeartbeat();
    }
  }, 30000); // Send ping every 30 seconds
}

// Stop heartbeat
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Start automatic connection
function startAutoConnect() {
  if (!WS_ENABLED) return;
  console.log('🚀 Starte automatische WebSocket-Verbindung...');

  // Try to connect immediately
  connectToWebSocketServer();

  // Then retry every 10 seconds
  if (autoConnectInterval) {
    clearInterval(autoConnectInterval);
  }

  autoConnectInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('🔄 Versuche erneute Verbindung...');
      connectToWebSocketServer();
    }
  }, 10000); // 10 seconds
}

// Toggle sidebars visibility for current tab
function toggleSidebars() {
  // Get current active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0 || !tabs[0].id) return;
    
    const tabId = tabs[0].id;
    const currentStatus = tabSidebarStatus.get(tabId) || false;
    const newStatus = !currentStatus;
    
    // Update status for this tab
    tabSidebarStatus.set(tabId, newStatus);
    
    console.log(`🔄 Tab ${tabId}: Sidebars ${newStatus ? 'einblenden' : 'ausblenden'}`);
    
    // Send message to this specific tab
    try {
      chrome.tabs.sendMessage(tabId, { 
        type: 'TOGGLE_SIDEBARS', 
        visible: newStatus 
      });
    } catch (err) {
      console.warn('⚠️ Failed to send message to tab, it may have closed:', err)
    }

    // Update badge to show status for current tab
    chrome.action.setBadgeText({ text: newStatus ? 'ON' : 'OFF' });
    chrome.action.setBadgeBackgroundColor({
      color: newStatus ? '#00FF00' : '#FF0000'
    });
  });
}

// Start connection when extension loads
chrome.runtime.onStartup.addListener(() => {
  console.log('🚀 Extension gestartet');
  // WebSocket disabled
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('📦 Extension installiert');
  // WebSocket disabled
});

// Handle extension icon click: launch desktop headlessly via deep-link in a tiny hidden window
chrome.action.onClicked.addListener(async () => {
  try {
    const url = chrome.runtime.getURL('silent-launch.html')
    // Create the smallest possible popup off-screen; it will immediately close itself.
    const opts: chrome.windows.CreateData = {
      url,
      type: 'popup',
      width: 10,
      height: 10,
      focused: false
    }
    await chrome.windows.create(opts)
  } catch (e) {
    console.error('Failed to trigger headless launch:', e)
  }
});

// Handle keyboard command Alt+O to toggle overlay per domain
chrome.commands?.onCommand.addListener((command) => {
  if (command === 'toggle-overlay') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) return
      chrome.tabs.sendMessage(tab.id, { type: 'OG_TOGGLE_OVERLAY' })
    })
  }
})

// Update badge when switching tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo.tabId;
  const isActive = tabSidebarStatus.get(tabId) || false;
  
  chrome.action.setBadgeText({ text: isActive ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({
    color: isActive ? '#00FF00' : '#FF0000'
  });
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return true;

  console.log(`📨 Nachricht erhalten: ${msg.type}`);

  switch (msg.type) {
    case 'TEST_CONNECTION':
      connectToWebSocketServer();
      sendResponse({ success: true, message: 'Verbindung wird getestet' });
      break;

    case 'CONNECT':
      connectToWebSocketServer();
      sendResponse({ success: true, message: 'Verbindung wird hergestellt' });
      break;

    case 'DISCONNECT':
      if (ws) {
        ws.close();
        ws = null;
      }
      sendResponse({ success: true, message: 'Verbindung getrennt' });
      break;

    case 'GET_STATUS':
      const status = {
        isConnected: ws && ws.readyState === WebSocket.OPEN,
        readyState: ws ? ws.readyState : null
      };
      
      sendResponse({ success: true, data: status });
      chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', data: status });
      break;

    case 'SAVE_GRID_CONFIG':
      console.log('📥 SAVE_GRID_CONFIG received');
      sendResponse({ success: true, message: 'Config received' });
      break;
    case 'OG_TOGGLE_OVERLAY':
      // Forwarded from UI (gear icon) to broadcast or simply acknowledge
      sendResponse({ success: true })
      break;

    case 'OPEN_COMMAND_CENTER_POPUP': {
      const themeHint = typeof msg.theme === 'string' ? msg.theme : null
      const createPopup = (bounds: chrome.system.display.Bounds | null) => {
        const url = chrome.runtime.getURL('popup.html' + (themeHint ? ('?t=' + encodeURIComponent(themeHint)) : ''))
        const opts: chrome.windows.CreateData = {
          url,
          type: 'popup',
          width: 520,
          height: 720
        }
        if (bounds) {
          opts.left = Math.max(0, bounds.left + 40)
          opts.top = Math.max(0, bounds.top + 40)
        }
        chrome.windows.create(opts, () => sendResponse({ success: true }))
      }

      if (chrome.system?.display) {
        chrome.system.display.getInfo((displays) => {
          const primary = displays.find(d => d.isPrimary)
          const secondary = displays.find(d => !d.isPrimary)
          createPopup((secondary?.workArea || primary?.workArea) || null)
        })
      } else {
        createPopup(null)
      }
      break
    }

    case 'LAUNCH_LMGTFY': {
      try {
        const mode = (typeof msg.mode === 'string' && (msg.mode === 'screenshot' || msg.mode === 'stream')) ? msg.mode : 'stream'
        const url = chrome.runtime.getURL('silent-launch.html?mode=' + encodeURIComponent(mode))
        const opts: chrome.windows.CreateData = { url, type: 'popup', width: 300, height: 120, focused: false }
        chrome.windows.create(opts, () => sendResponse({ success: true }))
      } catch (e) { try { sendResponse({ success: false, error: String(e) }) } catch {}
      }
      break
    }
  }
  return true;
});
