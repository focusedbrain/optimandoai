let ws: WebSocket | null = null;
let isConnecting = false;
let autoConnectInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
// Track sidebar visibility per tab
const tabSidebarStatus = new Map<number, boolean>();

// Connect to external WebSocket server (not the desktop app)
function connectToWebSocketServer() {
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
    chrome.tabs.sendMessage(tabId, { 
      type: 'TOGGLE_SIDEBARS', 
      visible: newStatus 
    });

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
  startAutoConnect();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('📦 Extension installiert');
  startAutoConnect();
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  console.log('🖱️ Extension-Icon geklickt - Toggle Sidebars');
  toggleSidebars();
});

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
  }
  return true;
});
