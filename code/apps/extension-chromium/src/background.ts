let ws: WebSocket | null = null;
let isConnecting = false;
let autoConnectInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
// Feature flag to completely disable WebSocket auto-connection
const WS_ENABLED = true;
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
      try {
        const payload = String(e.data)
        console.log(`[BG] ===== WEBSOCKET MESSAGE RECEIVED FROM ELECTRON =====`)
        console.log(`[BG] 📨 Raw payload: ${payload}`)
        const data = JSON.parse(payload)
        console.log(`[BG] Parsed data:`, JSON.stringify(data, null, 2))
        
        // Check if this is a vault RPC response
        if (data.id && globalThis.vaultRpcCallbacks && globalThis.vaultRpcCallbacks.has(data.id)) {
          console.log('[BG] Vault RPC response received for ID:', data.id)
          const callback = globalThis.vaultRpcCallbacks.get(data.id)
          globalThis.vaultRpcCallbacks.delete(data.id)
          callback(data) // Send response back to content script
          return
        }
        
        if (data && data.type) {
          console.log(`[BG] Message type: ${data.type}`);
          if (data.type === 'pong') {
            console.log('[BG] 🏓 Pong erhalten - Verbindung ist aktiv')
            // Forward pong to UI for diagnostic test
            try { chrome.runtime.sendMessage({ type: 'pong' }) } catch (forwardErr) {
              console.error('[BG] Error forwarding pong:', forwardErr)
            }
          } else if (data.type === 'ELECTRON_LOG') {
            // Forward Electron logs to console and UI for debugging
            console.log('[BG] 📋 Electron Log:', data.message, data.rawMessage || data.parsedMessage || '')
            try { chrome.runtime.sendMessage({ type: 'ELECTRON_LOG', data }) } catch {}
          } else if (data.type === 'SELECTION_RESULT' || data.type === 'SELECTION_RESULT_IMAGE' || data.type === 'SELECTION_RESULT_VIDEO') {
            const kind = data.kind || (data.type.includes('VIDEO') ? 'video' : 'image')
            const dataUrl = data.dataUrl || data.url || null
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const tabId = tabs[0]?.id
              if (!tabId) return
              try { chrome.tabs.sendMessage(tabId, { type: 'ELECTRON_SELECTION_RESULT', kind, dataUrl }) } catch {}
            })
            // Forward to popup chat as well so it appends immediately
            try { chrome.runtime.sendMessage({ type: 'COMMAND_POPUP_APPEND', kind, url: dataUrl }) } catch {}
            // Also send to sidepanel if it's open
            try { chrome.runtime.sendMessage({ type: 'ELECTRON_SELECTION_RESULT', kind, dataUrl }) } catch {}
          } else if (data.type === 'TRIGGERS_UPDATED') {
            try { chrome.runtime.sendMessage({ type: 'TRIGGERS_UPDATED' }) } catch {}
          } else if (data.type === 'SHOW_TRIGGER_PROMPT') {
            // Forward trigger prompt request to content script and sidepanel
            // Include the tab URL so they can decide whether to show modal or inline
            console.log('📝 Received SHOW_TRIGGER_PROMPT from Electron:', data)
            // Get active tab info
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const tabId = tabs[0]?.id
              const tabUrl = tabs[0]?.url || ''
              if (!tabId) return
              
              const message = { 
                type: 'SHOW_TRIGGER_PROMPT', 
                mode: data.mode, 
                rect: data.rect, 
                displayId: data.displayId, 
                imageUrl: data.imageUrl, 
                videoUrl: data.videoUrl,
                createTrigger: data.createTrigger,
                addCommand: data.addCommand,
                tabUrl: tabUrl // Include tab URL for restricted page detection
              }
              
              // Send to content script
              try { 
                chrome.tabs.sendMessage(tabId, message) 
              } catch (e) {
                console.log('❌ Failed to send SHOW_TRIGGER_PROMPT to content script:', e)
              }
              
              // Send to sidepanel/popup
              try { chrome.runtime.sendMessage(message) } catch {}
            })
          }
        }
      } catch (error) {
        // ignore
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
  if (WS_ENABLED) {
    try { connectToWebSocketServer() } catch {}
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('📦 Extension installiert');
  if (WS_ENABLED) {
    try { connectToWebSocketServer() } catch {}
  }
});

// Track if display grids are active per tab
const tabDisplayGridsActive = new Map<number, boolean>();

// Remove sidepanel disabling - we'll show minimal UI instead

// Handle extension icon click: open the side panel
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Check if display grids are active for this tab
    if (tab.id && tabDisplayGridsActive.get(tab.id)) {
      console.log('🚫 Side panel blocked - display grids are active');
      return;
    }
    
    // Open side panel for the current tab
    if (tab.id && chrome.sidePanel) {
      await chrome.sidePanel.open({ tabId: tab.id })
      console.log('✅ Side panel opened')
    }
  } catch (e) {
    console.error('Failed to open side panel:', e)
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
  // Check if this is a vault RPC message (has type: 'VAULT_RPC')
  if (msg && msg.type === 'VAULT_RPC') {
    console.log('[BG] Received VAULT_RPC:', msg.method)
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[BG] WebSocket not connected for vault RPC')
      sendResponse({ success: false, error: 'Not connected to Electron app' })
      return true
    }
    
    // Forward the RPC call to Electron via WebSocket
    try {
      const rpcMessage = {
        id: msg.id,
        method: msg.method,
        params: msg.params || {}
      }
      
      console.log('[BG] Forwarding to WebSocket:', rpcMessage)
      ws.send(JSON.stringify(rpcMessage))
      
      // Store the sendResponse callback to call it when response arrives
      if (!globalThis.vaultRpcCallbacks) {
        globalThis.vaultRpcCallbacks = new Map()
      }
      globalThis.vaultRpcCallbacks.set(msg.id, sendResponse)
      
      return true // Keep channel open for async response
    } catch (error: any) {
      console.error('[BG] Error sending vault RPC:', error)
      sendResponse({ success: false, error: error.message })
      return true
    }
  }
  
  if (!msg || !msg.type) return true;

  console.log(`📨 Nachricht erhalten: ${msg.type}`);

  switch (msg.type) {
    case 'VAULT_HTTP_API': {
      // Relay vault HTTP API calls from content scripts (bypasses CSP)
      const { endpoint, body } = msg
      console.log('[BG] Relaying vault HTTP API call:', endpoint)
      console.log('[BG] Request body:', body)
      
      const VAULT_API_URL = 'http://127.0.0.1:51248/api/vault'
      const fullUrl = `${VAULT_API_URL}${endpoint}`
      
      // Retry function with exponential backoff
      const retryFetch = async (url: string, options: RequestInit, retries = 3, delay = 500): Promise<Response> => {
        for (let i = 0; i < retries; i++) {
          try {
            console.log(`[BG] Fetch attempt ${i + 1}/${retries}:`, url)
            const response = await fetch(url, options)
            // If successful, return immediately
            if (response.ok || i === retries - 1) {
              return response
            }
            // If not ok and not last retry, wait and retry
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)))
            }
          } catch (error: any) {
            console.error(`[BG] Fetch attempt ${i + 1} failed:`, error.name, error.message)
            // Only retry network errors (TypeError, AbortError)
            if ((error.name === 'TypeError' || error.name === 'AbortError') && i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)))
              continue
            }
            // For other errors or last retry, throw
            throw error
          }
        }
        throw new Error('Max retries exceeded')
      }
      
      // Determine HTTP method based on endpoint
      // Only /health uses GET, all others use POST
      const isGetRequest = endpoint === '/health'
      const method = isGetRequest ? 'GET' : 'POST'
      
      console.log('[BG] Fetching:', fullUrl, 'Method:', method)
      
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout
      
      const fetchOptions: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }
      
      if (body !== undefined && body !== null && method === 'POST') {
        fetchOptions.body = JSON.stringify(body)
      }
      
      // Use retry logic
      retryFetch(fullUrl, fetchOptions)
        .then(response => {
          clearTimeout(timeoutId) // Clear timeout on successful response
          console.log('[BG] Vault API response status:', response.status, response.statusText)
          if (!response.ok) {
            return response.text().then(text => {
              console.error('[BG] Vault API error response:', text)
              throw new Error(`HTTP ${response.status}: ${text}`)
            })
          }
          return response.json()
        })
        .then(data => {
          console.log('[BG] Vault API response data:', data)
          // Check if sendResponse is still valid (service worker might have suspended)
          try {
            // Store response in chrome.storage as fallback
            chrome.storage.local.set({ [`vault_response_${Date.now()}`]: data }).catch(() => {})
            sendResponse(data)
          } catch (e: any) {
            console.error('[BG] Error sending response (service worker may have suspended):', e)
            // If sendResponse fails, try to notify via storage event
            chrome.storage.local.set({ 
              vault_last_error: { 
                error: 'Service worker suspended', 
                endpoint,
                timestamp: Date.now()
              }
            }).catch(() => {})
            // Try one more time
            try {
              sendResponse({ success: false, error: 'Service worker suspended - please retry', endpoint })
            } catch {}
          }
        })
        .catch(error => {
          clearTimeout(timeoutId) // Clear timeout on error
          console.error('[BG] Vault API fetch error after retries:', error)
          console.error('[BG] Error name:', error.name)
          console.error('[BG] Error message:', error.message)
          
          // Check if it's a network error
          if (error.name === 'TypeError' || error.message.includes('Failed to fetch') || error.name === 'AbortError') {
            console.error('[BG] Network error - server may not be running on port 51248')
            // Update connection state
            chrome.storage.local.set({ 
              vault_connection_state: { 
                connected: false, 
                last_error: error.message,
                timestamp: Date.now()
              }
            }).catch(() => {})
          }
          
          try {
            sendResponse({ 
              success: false, 
              error: error.name === 'AbortError' ? 'Request timeout - server may not be responding' : (error.message || String(error)),
              errorType: error.name,
              details: error.stack
            })
          } catch (e) {
            console.error('[BG] Error sending error response:', e)
            // Last resort: store in chrome.storage
            chrome.storage.local.set({ 
              vault_last_error: { 
                success: false,
                error: error.message || String(error),
                endpoint,
                timestamp: Date.now()
              }
            }).catch(() => {})
          }
        })
      
      return true // Keep channel open for async response
    }
    
    case 'CAPTURE_VISIBLE_TAB': {
      try {
        chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
          try { sendResponse({ success: true, dataUrl }) } catch {}
        })
      } catch(e) { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'ELECTRON_START_SELECTION': {
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'START_SELECTION',
            source: msg.source || 'browser',
            mode: msg.mode || 'area',
            options: msg.options || {}
          }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          // Try to connect on-demand to 127.0.0.1:53247 and retry
          try {
            const url = 'ws://localhost:51247/'
            const temp = new WebSocket(url)
            temp.addEventListener('open', () => {
              try { ws = temp as any } catch {}
              try { ws?.send(JSON.stringify({ type: 'START_SELECTION', source: msg.source || 'browser', mode: msg.mode || 'area', options: msg.options || {} })) } catch {}
              try { sendResponse({ success: true }) } catch {}
            })
            temp.addEventListener('error', () => { try { sendResponse({ success:false, error:'WS not connected' }) } catch {} })
          } catch { try { sendResponse({ success:false, error:'WS not connected' }) } catch {} }
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'ELECTRON_CANCEL_SELECTION': {
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = { type: 'CANCEL_SELECTION', source: msg.source || 'browser' }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          try { sendResponse({ success: false, error: 'WS not connected' }) } catch {}
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'ELECTRON_SAVE_TRIGGER': {
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'SAVE_TRIGGER',
            name: msg.name,
            mode: msg.mode,
            rect: msg.rect,
            displayId: msg.displayId,
            imageUrl: msg.imageUrl,
            videoUrl: msg.videoUrl
          }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          try { sendResponse({ success: false, error: 'WS not connected' }) } catch {}
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'EXTENSION_SAVE_TRIGGER': {
      // Extension-native trigger (no displayId) - forward to Electron
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'SAVE_TRIGGER',
            name: msg.name,
            mode: msg.mode,
            rect: msg.rect,
            displayId: undefined, // Extension trigger has no displayId
            imageUrl: msg.imageUrl,
            videoUrl: msg.videoUrl
          }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          try { sendResponse({ success: false, error: 'WS not connected' }) } catch {}
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'ELECTRON_EXECUTE_TRIGGER': {
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'EXECUTE_TRIGGER',
            trigger: msg.trigger
          }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          try { sendResponse({ success: false, error: 'WS not connected' }) } catch {}
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'REQUEST_START_SELECTION_POPUP': {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id
          const winId = tabs[0]?.windowId
          if (!tabId) { try { sendResponse({ success:false }) } catch {}; return }
          try { if (typeof winId === 'number') chrome.windows.update(winId, { focused: true }) } catch {}
          try { chrome.tabs.highlight({ tabs: tabs[0].index }, () => {}) } catch {}
          setTimeout(() => {
            try { chrome.tabs.sendMessage(tabId, { type: 'OG_BEGIN_SELECTION_FOR_POPUP' }, ()=>{ try { sendResponse({ success:true }) } catch {} }) } catch { try { sendResponse({ success:false }) } catch {} }
          }, 50)
        })
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
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

    case 'DISPLAY_GRIDS_OPENED': {
      // Display grids were opened - minimize sidepanel (only on display grid tabs, not master tabs)
      if (sender.tab?.id && sender.tab?.url) {
        const tabId = sender.tab.id;
        
        // Check if this is a master tab (has hybrid_master_id in URL)
        try {
          const url = new URL(sender.tab.url);
          const hybridMasterId = url.searchParams.get('hybrid_master_id');
          
          if (hybridMasterId !== null) {
            // This is a master tab - DO NOT disable sidepanel
            console.log(`🖥️ Master tab detected (ID: ${hybridMasterId}) - keeping sidepanel enabled`);
            try { sendResponse({ success: true, isMasterTab: true }) } catch {}
            break;
          }
        } catch (e) {
          console.error('Error checking if tab is master tab:', e);
        }
        
        // This is a display grid tab - just track it (sidepanel controls its own width now)
        tabDisplayGridsActive.set(tabId, true);
        console.log(`📱 Display grid tab ${tabId} - sidepanel will adjust width to 0`);
      }
      try { sendResponse({ success: true }) } catch {}
      break;
    }
    case 'DISPLAY_GRIDS_CLOSED': {
      // Display grids were closed - sidepanel will auto-adjust width
      if (sender.tab?.id) {
        const tabId = sender.tab.id;
        tabDisplayGridsActive.set(tabId, false);
        console.log(`✅ Display grids closed for tab ${tabId} - sidepanel will adjust width`);
      }
      try { sendResponse({ success: true }) } catch {}
      break;
    }
    case 'REOPEN_SIDEPANEL': {
      // Expand sidepanel (sidepanel will adjust width automatically)
      if (sender.tab?.id) {
        const tabId = sender.tab.id;
        console.log(`🔓 Expanding sidepanel for tab ${tabId} - width will auto-adjust`);
        tabDisplayGridsActive.set(tabId, false);
        try { sendResponse({ success: true }) } catch {}
      } else {
        try { sendResponse({ success: false, error: 'No tab ID' }) } catch {}
      }
      break;
    }
    case 'LAUNCH_DBEAVER': {
      // Forward to Electron app to launch DBeaver via WebSocket
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'LAUNCH_DBEAVER' }));
          // Wait for response
          const responseHandler = (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'LAUNCH_DBEAVER_RESULT') {
                ws.removeEventListener('message', responseHandler);
                try { sendResponse({ success: data.ok, message: data.message }) } catch {}
              }
            } catch {}
          };
          ws.addEventListener('message', responseHandler);
          // Timeout after 5 seconds
          setTimeout(() => {
            ws.removeEventListener('message', responseHandler);
            try { sendResponse({ success: false, error: 'Timeout waiting for response' }) } catch {}
          }, 5000);
        } catch (err) {
          console.error('Failed to send LAUNCH_DBEAVER message:', err);
          try { sendResponse({ success: false, error: 'WebSocket not connected' }) } catch {}
        }
      } else {
        // WebSocket not available - show helpful message
        try { sendResponse({ success: false, error: 'Electron app not connected. Please start the desktop app first.' }) } catch {}
      }
      return true; // Keep channel open for async response
    }

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
        // Prevent duplicates: if a popup already exists, focus instead of opening any new one
        try {
          chrome.windows.getAll({ populate: false, windowTypes: ['popup', 'normal'] }, (wins) => {
            const existing = wins && wins.find(w => (w.type === 'popup' && typeof w.id === 'number'))
            if (existing && existing.id) {
              chrome.windows.update(existing.id, { focused: true })
              sendResponse({ success: true })
            } else {
              chrome.windows.create(opts, () => sendResponse({ success: true }))
            }
          })
        } catch {
          chrome.windows.create(opts, () => sendResponse({ success: true }))
        }
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

    case 'COMMAND_POPUP_APPEND': {
      try {
        // Forward to popup page to append media
        chrome.runtime.sendMessage({ type: 'COMMAND_POPUP_APPEND', kind: msg.kind, url: msg.url })
      } catch {}
      try { sendResponse({ success: true }) } catch {}
      break
    }

    case 'LAUNCH_LMGTFY': {
      // Disable silent popup launcher to avoid extra UI
      try { sendResponse({ success: true }) } catch {}
      break
    }
    case 'OG_CAPTURE_SAVED_TAG': {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id
          if (!tabId) { try { sendResponse({ success:false }) } catch {}; return }
          try { chrome.tabs.sendMessage(tabId, { type: 'OG_CAPTURE_SAVED_TAG', index: msg.index }, ()=>{ try { sendResponse({ success:true }) } catch {} }) } catch { try { sendResponse({ success:false }) } catch {} }
        })
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    
    case 'PING': {
      // Simple ping-pong to wake up service worker
      console.log('🏓 BG: Received PING')
      try { sendResponse({ success: true }) } catch {}
      return true
    }
    
    // Removed DB_WEBSOCKET_MESSAGE handler - database operations now use HTTP API directly
    
    case 'GRID_SAVE': {
      console.log('📥 BG: Received GRID_SAVE message:', msg)
      const { payload } = msg
      
      console.log('📦 BG: Payload:', JSON.stringify(payload, null, 2))
      console.log('🔑 BG: Session key:', payload.sessionKey)
      
      if (!payload.sessionKey) {
        console.error('❌ BG: No sessionKey provided')
        try { sendResponse({ success: false, error: 'No session key' }) } catch {}
        break
      }
      
      // Load current session using storage wrapper
      import('./storage/storageWrapper').then(({ storageGet, storageSet }) => {
        storageGet([payload.sessionKey], (result: any) => {
        const session = result[payload.sessionKey] || {}
        
        console.log('📋 BG: Loaded session:', JSON.stringify(session, null, 2))
        
        // Initialize arrays if needed
        if (!session.displayGrids) {
          console.log('🆕 BG: Initializing displayGrids array')
          session.displayGrids = []
        }
        if (!session.agentBoxes) {
          console.log('🆕 BG: Initializing agentBoxes array')
          session.agentBoxes = []
        }
        
        // Find or create grid entry
        let gridEntry = session.displayGrids.find((g: any) => g.sessionId === payload.sessionId)
        if (!gridEntry) {
          console.log('🆕 BG: Creating new grid entry for sessionId:', payload.sessionId)
          gridEntry = {
            layout: payload.layout,
            sessionId: payload.sessionId,
            config: payload.config || { slots: {} },
            agentBoxes: payload.agentBoxes || []
          }
          session.displayGrids.push(gridEntry)
        } else {
          console.log('♻️ BG: Updating existing grid entry for sessionId:', payload.sessionId)
          gridEntry.config = payload.config || gridEntry.config
          gridEntry.agentBoxes = payload.agentBoxes || []
        }
        
        // Merge agent boxes into session (deduplicating by identifier)
        if (payload.agentBoxes && payload.agentBoxes.length > 0) {
          console.log('📦 BG: Merging', payload.agentBoxes.length, 'agent boxes into session')
          
          payload.agentBoxes.forEach((newBox: any) => {
            const existingIndex = session.agentBoxes.findIndex(
              (b: any) => b.identifier === newBox.identifier
            )
            if (existingIndex !== -1) {
              // Update existing
              session.agentBoxes[existingIndex] = newBox
              console.log('♻️ BG: Updated existing agent box:', newBox.identifier)
            } else {
              // Add new
              session.agentBoxes.push(newBox)
              console.log('🆕 BG: Added new agent box:', newBox.identifier)
            }
          })
        }
        
        console.log('💾 BG: Saving session with', session.agentBoxes.length, 'total agent boxes')
        console.log('📊 BG: Full grid entry:', JSON.stringify(gridEntry, null, 2))
        
        // Save updated session using storage wrapper
        storageSet({ [payload.sessionKey]: session }, () => {
          console.log('✅ BG: Session saved with grid config and agent boxes!')
          console.log('✅ BG: Total agent boxes in session:', session.agentBoxes.length)
          try { sendResponse({ success: true }) } catch {}
        })
      });
      });
      
      return true  // Keep message channel open for async response
    }
  }
  
  return true;
});
