// Grid Content Script - Injected into grid tabs for storage communication
console.log('🔍 GRID CONTENT SCRIPT DEBUG: ========== SCRIPT LOADED ==========');
console.log('🔍 GRID CONTENT SCRIPT DEBUG: Current URL:', window.location.href);
console.log('🔍 GRID CONTENT SCRIPT DEBUG: Document title:', document.title);
console.log('🔍 GRID CONTENT SCRIPT DEBUG: Document readyState:', document.readyState);

// Check if chrome extension APIs are available
console.log('🔍 GRID CONTENT SCRIPT DEBUG: chrome object:', chrome);
console.log('🔍 GRID CONTENT SCRIPT DEBUG: chrome.runtime:', chrome?.runtime);

// Wait a moment for the page script to set the global variable
setTimeout(() => {
  console.log('🔍 GRID CONTENT SCRIPT DEBUG: Checking for grid info...');
  console.log('🔍 GRID CONTENT SCRIPT DEBUG: window.OPTIMANDO_GRID_INFO:', (window as any).OPTIMANDO_GRID_INFO);
  
  const gridInfo = (window as any).OPTIMANDO_GRID_INFO;
  
  if (gridInfo && gridInfo.isGridTab && gridInfo.sessionId && gridInfo.layout) {
    console.log('✅ GRID CONTENT SCRIPT DEBUG: Grid tab detected via global variable');
    console.log('  - sessionId:', gridInfo.sessionId);
    console.log('  - layout:', gridInfo.layout);
    
    // Store globally for use in functions
    (window as any).gridSessionId = gridInfo.sessionId;
    (window as any).gridLayout = gridInfo.layout;
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      console.log('🔍 GRID CONTENT SCRIPT DEBUG: DOM still loading, adding DOMContentLoaded listener');
      document.addEventListener('DOMContentLoaded', initGridContentScript);
    } else {
      console.log('🔍 GRID CONTENT SCRIPT DEBUG: DOM ready, initializing immediately');
      initGridContentScript();
    }
  } else {
    console.log('⚠️ GRID CONTENT SCRIPT DEBUG: Not a grid tab - no OPTIMANDO_GRID_INFO found');
    console.log('  - This script will not initialize further');
    
    // Also check URL parameters as fallback
    const urlParams = new URLSearchParams(window.location.search);
    const urlSessionId = urlParams.get('sessionId');
    const urlLayout = urlParams.get('layout');
    
    console.log('🔍 GRID CONTENT SCRIPT DEBUG: URL Fallback check:');
    console.log('  - URL sessionId:', urlSessionId);
    console.log('  - URL layout:', urlLayout);
    
    if (urlSessionId && urlLayout) {
      console.log('✅ GRID CONTENT SCRIPT DEBUG: Grid tab detected via URL parameters');
      (window as any).gridSessionId = urlSessionId;
      (window as any).gridLayout = urlLayout;
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGridContentScript);
      } else {
        initGridContentScript();
      }
    }
  }
}, 100); // Wait 100ms for page script to run

function initGridContentScript() {
  console.log('🔍 INIT DEBUG: ========== INITIALIZING GRID CONTENT SCRIPT ==========');
  
  // Check DOM elements
  const saveBtn = document.getElementById('save-grid-btn');
  const slots = document.querySelectorAll('[data-slot-id]');
  const notification = document.getElementById('success-notification');
  
  console.log('🔍 INIT DEBUG: DOM Elements:');
  console.log('  - Save button found:', saveBtn ? 'YES' : 'NO');
  console.log('  - Save button element:', saveBtn);
  console.log('  - Slot elements found:', slots.length);
  console.log('  - Notification element found:', notification ? 'YES' : 'NO');
  
  // Add save functionality to the save button
  if (saveBtn) {
    saveBtn.addEventListener('click', saveGridConfiguration);
    console.log('✅ INIT DEBUG: Save button listener attached');
    
    // Test button by adding a simple click handler
    saveBtn.addEventListener('click', () => {
      console.log('🔍 INIT DEBUG: Save button clicked - simple test handler');
    });
  } else {
    console.error('❌ INIT DEBUG: Save button not found!');
    console.log('🔍 INIT DEBUG: Searching for buttons...');
    const allButtons = document.querySelectorAll('button');
    console.log('🔍 INIT DEBUG: All buttons found:', allButtons.length);
    allButtons.forEach((btn, index) => {
      console.log(`  - Button ${index + 1}: id="${btn.id}", text="${btn.textContent}"`);
    });
  }
  
  // Load existing configuration
  console.log('🔍 INIT DEBUG: Loading existing configuration...');
  loadGridConfiguration();
}

function saveGridConfiguration() {
  console.log('🔍 SAVE GRID DEBUG: ========== SAVE BUTTON CLICKED ==========');
  console.log('🔍 SAVE GRID DEBUG: Current URL:', window.location.href);
  
  const sessionId = (window as any).gridSessionId;
  const layout = (window as any).gridLayout;
  
  console.log('🔍 SAVE GRID DEBUG: sessionId:', sessionId);
  console.log('🔍 SAVE GRID DEBUG: layout:', layout);
  
  // Check if chrome.runtime is available
  if (!chrome || !chrome.runtime) {
    console.error('❌ SAVE GRID DEBUG: chrome.runtime not available!');
    console.error('❌ SAVE GRID DEBUG: chrome object:', chrome);
    showErrorNotification('Chrome extension API not available');
    return;
  }
  
  console.log('✅ SAVE GRID DEBUG: chrome.runtime available');
  
  const config: { layout: string; sessionId: string; timestamp: string; slots: Record<string, { title: string; agent: string }> } = {
    layout: layout,
    sessionId: sessionId,
    timestamp: new Date().toISOString(),
    slots: {}
  };
  
  // Collect all slot data with detailed logging
  const slotElements = document.querySelectorAll('[data-slot-id]');
  console.log('🔍 SAVE GRID DEBUG: Found slot elements:', slotElements.length);
  
  slotElements.forEach((slotDiv, index) => {
    const slotId = slotDiv.getAttribute('data-slot-id');
    const titleInput = slotDiv.querySelector('.slot-title') as HTMLInputElement;
    const agentSelect = slotDiv.querySelector('.slot-agent') as HTMLSelectElement;
    
    console.log(`🔍 SAVE GRID DEBUG: Slot ${index + 1} (ID: ${slotId}):`);
    console.log(`  - Title input found:`, titleInput ? 'YES' : 'NO');
    console.log(`  - Title value:`, titleInput ? titleInput.value : 'N/A');
    console.log(`  - Agent select found:`, agentSelect ? 'YES' : 'NO');
    console.log(`  - Agent value:`, agentSelect ? agentSelect.value : 'N/A');
    
    if (slotId) {
      config.slots[slotId] = {
        title: titleInput ? titleInput.value : '',
        agent: agentSelect ? agentSelect.value : ''
      };
    }
  });
  
  console.log('🔍 SAVE GRID DEBUG: Final config object:', JSON.stringify(config, null, 2));
  
  // Test chrome.runtime.sendMessage availability
  try {
    console.log('🔍 SAVE GRID DEBUG: Attempting to send message to service worker...');
    
    const message = {
      type: 'SAVE_GRID_CONFIG',
      data: config
    };
    
    console.log('🔍 SAVE GRID DEBUG: Message to send:', JSON.stringify(message, null, 2));
    
    chrome.runtime.sendMessage(message, (response) => {
      console.log('🔍 SAVE GRID DEBUG: ========== RESPONSE RECEIVED ==========');
      console.log('🔍 SAVE GRID DEBUG: chrome.runtime.lastError:', chrome.runtime.lastError);
      console.log('🔍 SAVE GRID DEBUG: Response object:', response);
      console.log('🔍 SAVE GRID DEBUG: Response type:', typeof response);
      console.log('🔍 SAVE GRID DEBUG: Response JSON:', JSON.stringify(response, null, 2));
      
      if (chrome.runtime.lastError) {
        console.error('❌ SAVE GRID DEBUG: Runtime error details:');
        console.error('  - Message:', chrome.runtime.lastError.message);
        console.error('  - Full error:', chrome.runtime.lastError);
        showErrorNotification('Runtime error: ' + chrome.runtime.lastError.message);
      } else if (response && response.success) {
        console.log('✅ SAVE GRID DEBUG: Save successful!');
        showSuccessNotification();
      } else {
        console.error('❌ SAVE GRID DEBUG: Save failed with response:');
        console.error('  - Response success:', response?.success);
        console.error('  - Response error:', response?.error);
        console.error('  - Response message:', response?.message);
        showErrorNotification('Save failed: ' + (response?.error || response?.message || 'Unknown error'));
      }
    });
    
    console.log('🔍 SAVE GRID DEBUG: Message sent, waiting for response...');
    
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error('❌ SAVE GRID DEBUG: Exception during sendMessage:');
    console.error('  - Error message:', err.message);
    console.error('  - Error stack:', err.stack);
    console.error('  - Full error:', error);
    showErrorNotification('Exception: ' + err.message);
  }
}

function loadGridConfiguration() {
  console.log('🎯 ISSUE 2: Loading grid configuration');
  
  const sessionId = (window as any).gridSessionId;
  const layout = (window as any).gridLayout;
  
  if (!sessionId || !layout) {
    console.error('❌ LOAD CONFIG: Missing sessionId or layout');
    return;
  }
  
  chrome.runtime.sendMessage({
    type: 'LOAD_GRID_CONFIG',
    sessionId: sessionId,
    layout: layout
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('❌ ISSUE 2: Error loading config:', chrome.runtime.lastError);
    } else if (response && response.success && response.config) {
      console.log('📚 ISSUE 2: Applying loaded config:', response.config);
      applyConfiguration(response.config);
    } else {
      console.log('📚 ISSUE 2: No saved config found');
    }
  });
}

function applyConfiguration(config: any) {
  if (!config.slots) return;
  
  Object.keys(config.slots).forEach(slotId => {
    const slotData = config.slots[slotId];
    const slotDiv = document.querySelector(`[data-slot-id="${slotId}"]`);
    
    if (slotDiv) {
      const titleInput = slotDiv.querySelector('.slot-title') as HTMLInputElement;
      const agentSelect = slotDiv.querySelector('.slot-agent') as HTMLSelectElement;
      
      if (titleInput && slotData.title) titleInput.value = slotData.title;
      if (agentSelect && slotData.agent) agentSelect.value = slotData.agent;
    }
  });
}

function showSuccessNotification() {
  const notification = document.getElementById('success-notification');
  if (notification) {
    notification.innerHTML = '✅ Grid saved to session!';
    notification.style.background = '#4CAF50';
    notification.style.display = 'block';
    notification.style.opacity = '1';
    
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        notification.style.display = 'none';
      }, 300);
    }, 2000);
  }
}

function showErrorNotification(message: string) {
  const notification = document.getElementById('success-notification');
  if (notification) {
    notification.innerHTML = '❌ ' + message;
    notification.style.background = '#f44336';
    notification.style.display = 'block';
    notification.style.opacity = '1';
    
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        notification.style.display = 'none';
      }, 300);
    }, 3000);
  }
}
