// Grid functionality for display grids
// Prevent script from running multiple times
if (window.gridScriptLoaded) {
  console.log('⚠️ Grid script already loaded, skipping...');
  return;
}
window.gridScriptLoaded = true;
console.log('✅ Grid script loaded');

// Global variables - check if already declared to prevent redeclaration errors
if (typeof isFullscreen === 'undefined') {
  var isFullscreen = false;
}
if (typeof currentSlideIndex === 'undefined') {
  var currentSlideIndex = 0;
}
if (typeof isSlideMode === 'undefined') {
  var isSlideMode = false;
}
if (typeof totalSlots === 'undefined') {
  var totalSlots = 0;
}

// Save grid configuration
function saveGridConfig() {
  const slotDivs = document.querySelectorAll('[data-slot-id]');
  const slots = {};
  
  slotDivs.forEach(div => {
    const id = div.getAttribute('data-slot-id') || ''
    const title = div.querySelector('.slot-title')?.value || ''
    const agent = div.querySelector('.slot-agent')?.value || ''
    slots[id] = { title, agent }
  })
  
  const config = {
    layout: window.gridLayout || 'unknown',
    sessionId: window.gridSessionId || 'unknown',
    slots: slots
  }
  
  // Try to send to Electron app via WebSocket first
  let messageSent = false;
  
  // Method 1: Try to send to Electron app via WebSocket
  try {
    if (window.gridWebSocket && window.gridWebSocket.readyState === WebSocket.OPEN) {
      window.gridWebSocket.send(JSON.stringify({
        type: 'SAVE_GRID_CONFIG',
        config: config,
        from: 'grid-window'
      }));
      console.log('✅ Message sent to Electron app via WebSocket');
      messageSent = true;
    } else {
      console.log('ℹ️ WebSocket not connected, trying to connect...');
      // Try to connect to Electron app
      const ws = new WebSocket('ws://localhost:51247');
      
      ws.onopen = () => {
        console.log('🔗 Connected to Electron app WebSocket');
        ws.send(JSON.stringify({
          type: 'SAVE_GRID_CONFIG',
          config: config,
          from: 'grid-window'
        }));
        console.log('✅ Message sent to Electron app via WebSocket');
        messageSent = true;
        window.gridWebSocket = ws; // Store for future use
        
        // Set up reconnection on close
        ws.onclose = () => {
          console.log('🔌 WebSocket connection closed, will reconnect on next save');
          window.gridWebSocket = null;
        };
      };
      
      ws.onerror = (error) => {
        console.log('❌ WebSocket connection failed:', error);
        window.gridWebSocket = null;
        // Try next port if current one fails
        if (port < 51250) {
          console.log(`🔄 Trying next port ${port + 1}...`);
          setTimeout(() => initializeWebSocket(port + 1), 2000);
        }
      };
      
      ws.onmessage = (event) => {
        try {
          const response = JSON.parse(event.data);
          if (response.type === 'GRID_CONFIG_SAVED') {
            console.log('✅ Grid config saved successfully via Electron app');
            // Also try to send directly to parent window as backup
            if (window.opener) {
              window.opener.postMessage({
                type: 'OPTIMANDO_SAVE_GRID',
                payload: config
              }, '*');
              console.log('✅ Backup message sent to parent window');
            }
          }
        } catch (error) {
          console.log('ℹ️ Received non-JSON message from WebSocket');
        }
      };
    }
  } catch (error) {
    console.log('ℹ️ Electron app WebSocket not available:', error.message);
  }
  
  // Method 2: Try to send to parent window
  if (!messageSent && window.opener) {
    try {
      window.opener.postMessage({
        type: 'SAVE_GRID_CONFIG',
        config: config
      }, '*');
      console.log('✅ Message sent to parent window');
      messageSent = true;
    } catch (error) {
      console.error('❌ Error sending to parent window:', error);
    }
  }
  
  // Method 3: Try to send to Chrome extension directly
  if (!messageSent && typeof chrome !== 'undefined' && chrome.runtime) {
    try {
      chrome.runtime.sendMessage({
        type: 'SAVE_GRID_CONFIG',
        config: config
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Chrome extension error:', chrome.runtime.lastError);
        } else {
          console.log('✅ Message sent to Chrome extension');
        }
      });
      messageSent = true;
    } catch (error) {
      console.error('❌ Error sending to Chrome extension:', error);
    }
  }
  
  if (!messageSent) {
    console.warn('⚠️ No communication method available');
  }
  
  // Show success notification
  const notification = document.getElementById('success-notification');
  if (notification) {
    notification.classList.add('show');
    setTimeout(() => {
      notification.classList.remove('show');
    }, 2000);
  }
  
  console.log('💾 Grid config saved:', config);
}

// Load grid configuration
function loadGridConfig() {
  const saveKey = `grid-config-${window.gridLayout || 'unknown'}-${window.gridSessionId || 'unknown'}`;
  const saved = localStorage.getItem(saveKey);
  
  if (saved) {
    try {
      const config = JSON.parse(saved);
      console.log('📂 Loading saved config:', config);
      
      Object.keys(config.slots || {}).forEach(slotId => {
        const slotDiv = document.querySelector(`[data-slot-id="${slotId}"]`);
        if (slotDiv) {
          const titleInput = slotDiv.querySelector('.slot-title');
          const agentSelect = slotDiv.querySelector('.slot-agent');
          
          if (titleInput && config.slots[slotId].title) {
            titleInput.value = config.slots[slotId].title;
          }
          if (agentSelect && config.slots[slotId].agent) {
            agentSelect.value = config.slots[slotId].agent;
          }
        }
      });
    } catch (error) {
      console.log('❌ Error loading config:', error);
    }
  } else {
    console.log('📂 No saved config found for:', saveKey);
  }
}

// Fullscreen functionality
function toggleFullscreen() {
  try {
    if (!isFullscreen) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen({ navigationUI: "hide" });
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
      } else if (document.documentElement.mozRequestFullScreen) {
        document.documentElement.mozRequestFullScreen();
      } else if (document.documentElement.msRequestFullscreen) {
        document.documentElement.msRequestFullscreen();
      } else {
        console.log('Fullscreen not supported, using fallback');
        // Fallback: make the grid take full viewport
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.querySelector('.grid').style.width = '100vw';
        document.querySelector('.grid').style.height = '100vh';
        isFullscreen = true;
        updateFullscreenButton();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      } else {
        // Fallback: restore normal view
        document.body.style.margin = '';
        document.body.style.padding = '';
        document.querySelector('.grid').style.width = '';
        document.querySelector('.grid').style.height = '';
        isFullscreen = false;
        updateFullscreenButton();
      }
    }
  } catch (error) {
    console.log('Fullscreen error:', error);
    // Fallback: toggle manual fullscreen
    if (!isFullscreen) {
      document.body.style.margin = '0';
      document.body.style.padding = '0';
      document.querySelector('.grid').style.width = '100vw';
      document.querySelector('.grid').style.height = '100vh';
      isFullscreen = true;
    } else {
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.querySelector('.grid').style.width = '';
      document.querySelector('.grid').style.height = '';
      isFullscreen = false;
    }
    updateFullscreenButton();
  }
}

function updateFullscreenButton() {
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  if (!fullscreenBtn) return;
  
  const svg = fullscreenBtn.querySelector('svg');
  if (!svg) return;
  
  if (isFullscreen) {
    fullscreenBtn.title = 'Exit Fullscreen';
    svg.innerHTML = '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';
  } else {
    fullscreenBtn.title = 'Fullscreen';
    svg.innerHTML = '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
  }
}

// Slide mode functionality
function toggleSlideMode() {
  const grid = document.querySelector('.grid');
  const navArrows = document.getElementById('nav-arrows');
  const slots = document.querySelectorAll('[data-slot-id]');
  
  // Check if required elements exist
  if (!grid) {
    console.log('❌ Grid element not found');
    return;
  }
  
  if (!navArrows) {
    console.log('❌ Navigation arrows element not found');
    return;
  }
  
  isSlideMode = !isSlideMode;
  totalSlots = slots.length;
  
  if (isSlideMode && totalSlots > 1) {
    grid.classList.add('slide-mode');
    navArrows.classList.add('show');
    
    // Show first slide
    slots.forEach((slot, index) => {
      slot.classList.remove('active', 'prev');
      if (index === 0) {
        slot.classList.add('active');
      }
    });
    currentSlideIndex = 0;
  } else {
    grid.classList.remove('slide-mode');
    navArrows.classList.remove('show');
    
    // Reset all slides
    slots.forEach(slot => {
      slot.classList.remove('active', 'prev');
    });
  }
}

function showSlide(index) {
  if (!isSlideMode || totalSlots <= 1) return;
  
  if (index < 0) index = totalSlots - 1;
  if (index >= totalSlots) index = 0;
  
  const slots = document.querySelectorAll('[data-slot-id]');
  slots.forEach((slot, i) => {
    slot.classList.remove('active', 'prev');
    if (i === index) {
      slot.classList.add('active');
    } else if (i < index) {
      slot.classList.add('prev');
    }
  });
  
  currentSlideIndex = index;
}

function nextSlide() {
  showSlide(currentSlideIndex + 1);
}

function prevSlide() {
  showSlide(currentSlideIndex - 1);
}

function handleKeydown(e) {
  if (isSlideMode && totalSlots > 1) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      nextSlide();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prevSlide();
    }
  }
}

// Fullscreen event listeners
document.addEventListener('fullscreenchange', () => {
  isFullscreen = !!document.fullscreenElement;
  document.body.classList.toggle('is-fullscreen', isFullscreen);
  updateFullscreenButton();
});

document.addEventListener('webkitfullscreenchange', () => {
  isFullscreen = !!document.webkitFullscreenElement;
  document.body.classList.toggle('is-fullscreen', isFullscreen);
  updateFullscreenButton();
});

document.addEventListener('mozfullscreenchange', () => {
  isFullscreen = !!document.mozFullScreenElement;
  document.body.classList.toggle('is-fullscreen', isFullscreen);
  updateFullscreenButton();
});

document.addEventListener('msfullscreenchange', () => {
  isFullscreen = !!document.msFullscreenElement;
  document.body.classList.toggle('is-fullscreen', isFullscreen);
  updateFullscreenButton();
});

// Initialize with retry mechanism
function init() {
  console.log('Initializing grid functionality...');
  
  const saveBtn = document.getElementById('save-grid-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const prevBtn = document.getElementById('prev-slide');
  const nextBtn = document.getElementById('next-slide');
  
  console.log('Found elements:', {
    saveBtn: !!saveBtn,
    fullscreenBtn: !!fullscreenBtn,
    prevBtn: !!prevBtn,
    nextBtn: !!nextBtn
  });
  
  if (saveBtn) {
    saveBtn.addEventListener('click', saveGridConfig);
    console.log('✅ Save button listener attached');
  }
  
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('Fullscreen button clicked, current state:', isFullscreen);
      toggleFullscreen();
    });
    console.log('✅ Fullscreen button listener attached');
  } else {
    console.log('❌ Fullscreen button not found');
  }
  
  if (prevBtn) {
    prevBtn.addEventListener('click', prevSlide);
    console.log('✅ Prev button listener attached');
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', nextSlide);
    console.log('✅ Next button listener attached');
  }
  
  // Keyboard navigation
  document.addEventListener('keydown', handleKeydown);
  console.log('✅ Keyboard navigation attached');
  
  // Auto-enable slide mode if multiple slots
  const slots = document.querySelectorAll('[data-slot-id]');
  console.log('Found slots:', slots.length);
  if (slots.length > 1) {
    toggleSlideMode();
    console.log('✅ Slide mode enabled');
  }
  
  // Load existing config
  loadGridConfig();
  console.log('✅ Grid config loaded');
}

// Try to initialize immediately and with retries
function tryInit() {
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  if (fullscreenBtn) {
    init();
  } else {
    console.log('Elements not ready, retrying in 100ms...');
    setTimeout(tryInit, 100);
  }
}

// Initialize WebSocket connection to Electron app
function initializeWebSocket(port = 51247) {
  try {
    console.log(`🔗 Attempting to connect to Electron app WebSocket on port ${port}...`);
    const ws = new WebSocket(`ws://localhost:${port}`);
    
    ws.onopen = () => {
      console.log('✅ Connected to Electron app WebSocket');
      window.gridWebSocket = ws;
      
      // Send ping to test connection
      ws.send(JSON.stringify({
        type: 'ping',
        from: 'grid-window',
        timestamp: new Date().toISOString()
      }));
      
      // Set up heartbeat to keep connection alive
      window.gridHeartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'ping',
            from: 'grid-window',
            timestamp: new Date().toISOString()
          }));
        }
      }, 30000); // Send ping every 30 seconds
    };
    
    ws.onclose = (event) => {
      console.log('🔌 WebSocket connection closed:', event.code, event.reason);
      window.gridWebSocket = null;
      
      // Clear heartbeat
      if (window.gridHeartbeat) {
        clearInterval(window.gridHeartbeat);
        window.gridHeartbeat = null;
      }
      
      // Only retry if it wasn't a normal closure
      if (event.code !== 1000) {
        console.log('🔄 Will retry connection in 10 seconds...');
        setTimeout(initializeWebSocket, 10000);
      }
    };
    
    ws.onerror = (error) => {
      console.log('❌ WebSocket connection failed:', error);
      window.gridWebSocket = null;
      // Try next port if current one fails
      if (port < 51250) {
        console.log(`🔄 Trying next port ${port + 1}...`);
        setTimeout(() => initializeWebSocket(port + 1), 2000);
      } else {
        console.log('❌ All ports failed, retrying from 51247 in 10 seconds...');
        setTimeout(() => initializeWebSocket(51247), 10000);
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const response = JSON.parse(event.data);
        if (response.type === 'pong') {
          console.log('🏓 Received pong from Electron app');
        } else if (response.type === 'GRID_CONFIG_SAVED') {
          console.log('✅ Grid config saved successfully via Electron app');
        }
      } catch (error) {
        console.log('ℹ️ Received non-JSON message from WebSocket');
      }
    };
  } catch (error) {
    console.log('ℹ️ WebSocket not available:', error.message);
    // Retry after 5 seconds
    setTimeout(() => initializeWebSocket(51247), 5000);
  }
}

// Initialize WebSocket connection
initializeWebSocket(51247);

// Start trying to initialize
tryInit();
