// Grid functionality for display grids
// Prevent script from running multiple times
if (window.gridScriptLoaded) {
  console.log('⚠️ Grid script already loaded, skipping...');
} else {
  window.gridScriptLoaded = true;
  console.log('✅ Grid script loaded');
  console.log('🔧 Setting up grid functionality...');
  
  // Get sessionId and layout from script tag data attributes
  var scriptTag = document.getElementById('grid-script');
  var sessionId = scriptTag ? scriptTag.getAttribute('data-session-id') : 'unknown';
  var layout = scriptTag ? scriptTag.getAttribute('data-layout') : 'unknown';
  var parentSessionKey = scriptTag ? scriptTag.getAttribute('data-session-key') : '';
  
  // Store globally for other functions to use
  window.gridSessionId = sessionId;
  window.gridLayout = layout;
  window.sessionId = sessionId;
  window.layout = layout;
  
  console.log('✅ Grid loaded successfully:', layout, 'Session:', sessionId);
  console.log('🔧 Parent session key:', parentSessionKey);
  document.title = 'AI Grid - ' + layout.toUpperCase();
  
  // Define openGridSlotEditor function immediately
  window.openGridSlotEditor = function(slotId) {
    console.log('🔍 POPUP: openGridSlotEditor called with slotId:', slotId);
    const slot = document.querySelector('[data-slot-id="' + slotId + '"]');
    if (!slot) {
      console.error('❌ POPUP: No slot found with id:', slotId);
      return;
    }
    
    const configStr = slot.getAttribute('data-slot-config') || '{}';
    console.log('📋 POPUP: Slot config string:', configStr);
    let cfg = {};
    try { 
      cfg = JSON.parse(configStr);
      console.log('📋 POPUP: Parsed config:', cfg);
    } catch(e) { 
      console.error('❌ POPUP: Failed to parse config:', e);
      cfg = {};
    }
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;padding:20px;border-radius:10px;max-width:520px;width:92%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;';
    
    function modelOptions(p) {
      p = (p || '').toLowerCase();
      if (p === 'openai') return ['auto', 'gpt-4o-mini', 'gpt-4o'];
      if (p === 'claude') return ['auto', 'claude-3-5-sonnet', 'claude-3-opus'];
      if (p === 'gemini') return ['auto', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      if (p === 'grok') return ['auto', 'grok-2-mini', 'grok-2'];
      return ['auto'];
    }
    
    const providers = ['OpenAI', 'Claude', 'Gemini', 'Grok'];
    const currentProvider = cfg.provider || 'OpenAI';
    const models = modelOptions(currentProvider);
    
    console.log('📋 POPUP: Form will show:', {
      title: cfg.title || ('Display Port ' + slotId),
      agent: cfg.agent ? String(cfg.agent).replace('agent', '') : '',
      provider: currentProvider,
      model: cfg.model || 'auto'
    });
    
    dialog.innerHTML = 
      '<h3 style="margin:0 0 20px 0;font-size:18px;font-weight:600;color:#333">Setup Agent Box #' + slotId + '</h3>' +
      '<div style="margin-bottom:16px">' +
        '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">Title</label>' +
        '<input id="gs-title" type="text" placeholder="Enter a title for this agent box" value="' + (cfg.title || ('Display Port ' + slotId)).replace(/"/g, '&quot;') + '" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.2s">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
        '<div>' +
          '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">AI Agent</label>' +
          '<input id="gs-agent" type="number" min="1" max="99" placeholder="e.g. 1" value="' + (cfg.agent ? String(cfg.agent).replace('agent', '') : '') + '" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.2s">' +
        '</div>' +
        '<div>' +
          '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">LLM Provider</label>' +
          '<select id="gs-provider" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;cursor:pointer;transition:border-color 0.2s">' +
            providers.map(function(p) { return '<option' + (p === currentProvider ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:20px">' +
        '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">LLM Model</label>' +
        '<select id="gs-model" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;cursor:pointer;transition:border-color 0.2s">' +
          models.map(function(m) { return '<option' + ((cfg.model || '') === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div style="margin-top:8px;margin-bottom:20px;padding:12px;background:#f5f5f5;border-radius:8px;font-size:12px;color:#666">' +
        '<strong>Note:</strong> If no agent or LLM is selected, this box will use the global "Setup AI Agent" settings as fallback.' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #eee;padding-top:20px">' +
        '<button id="gs-cancel" style="padding:12px 24px;border:0;border-radius:8px;background:#f0f0f0;color:#333;cursor:pointer;font-size:14px;transition:background 0.2s">Cancel</button>' +
        '<button id="gs-save" style="padding:12px 24px;border:0;border-radius:8px;background:#2196F3;color:#fff;cursor:pointer;font-weight:600;font-size:14px;transition:background 0.2s">Save</button>' +
      '</div>';
    
    console.log('✅ POPUP: Form HTML created');
    
    // Add dialog to overlay and overlay to document
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    console.log('✅ POPUP: Added to DOM');
    
    // Focus the title input
    setTimeout(function() {
      var titleInput = document.getElementById('gs-title');
      if (titleInput) {
        titleInput.focus();
        console.log('✅ POPUP: Title input focused');
      }
    }, 0);
    
    // Handle provider change to update models
    document.getElementById('gs-provider').onchange = function() {
      var provider = this.value;
      var modelSelect = document.getElementById('gs-model');
      var newModels = modelOptions(provider);
      modelSelect.innerHTML = newModels.map(function(m) { 
        return '<option>' + m + '</option>'; 
      }).join('');
      console.log('🔄 POPUP: Updated models for provider:', provider);
    };
    
    // Cancel button
    document.getElementById('gs-cancel').onclick = function() {
      console.log('❌ POPUP: Cancelled');
      overlay.remove();
    };
    
    // Save button
    document.getElementById('gs-save').onclick = function() {
      var title = document.getElementById('gs-title').value || ('Display Port ' + slotId);
      var agentNum = document.getElementById('gs-agent').value;
      var provider = document.getElementById('gs-provider').value;
      var model = document.getElementById('gs-model').value;
      
      var agent = agentNum ? ('agent' + agentNum) : '';
      
      console.log('💾 POPUP: Saving slot config:', { title, agent, provider, model });
      
      // Update slot data attribute
      var newConfig = { title: title, agent: agent, provider: provider, model: model };
      slot.setAttribute('data-slot-config', JSON.stringify(newConfig));
      
      // Update visual display
      var agentNumForAB = agent ? agent.replace('agent', '').padStart(2, '0') : '';
      var ab = 'AB' + String(slotId).padStart(2, '0') + agentNumForAB;
      var abEl = slot.querySelector('span[style*="font-family: monospace"]');
      if (abEl) abEl.textContent = ab;
      
      var parts = [title];
      if (model && model !== 'auto') {
        parts.push(model);
      } else if (provider) {
        parts.push(provider);
      }
      var disp = parts.join(' · ');
      var dispEl = slot.querySelector('.slot-display-text');
      if (dispEl) dispEl.textContent = disp;
      
      console.log('✅ POPUP: Updated slot display for slot', slotId);
      
      // Save the entire grid configuration
      var payload = {
        layout: window.gridLayout,
        sessionId: window.gridSessionId,
        slots: {}
      };
      
      document.querySelectorAll('[data-slot-id]').forEach(function(s) {
        const id = s.getAttribute('data-slot-id');
        const c = s.getAttribute('data-slot-config');
        try { 
          payload.slots[id] = JSON.parse(c || '{}');
        } catch { 
          payload.slots[id] = {};
        }
      });
      
      // Save directly to chrome.storage.local (works across all extension contexts)
      var storageKey = 'optimando_grid_config_' + window.gridLayout;
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [storageKey]: payload }, function() {
          console.log('✅ Grid config saved to chrome.storage.local:', storageKey);
          
          // Also save a signal for the parent to detect
          chrome.storage.local.set({ 'optimando_last_grid_save': {
            key: storageKey,
            data: payload,
            timestamp: Date.now()
          }}, function() {
            console.log('✅ Grid save signal sent to parent');
          });
        });
      } else {
        console.log('❌ chrome.storage.local not available');
      }
      
      // Show success notification
      var notification = document.getElementById('success-notification');
      if (notification) {
        notification.style.display = 'block';
        notification.style.opacity = '1';
        setTimeout(function() {
          notification.style.opacity = '0';
          setTimeout(function() {
            notification.style.display = 'none';
          }, 300);
        }, 2000);
      }
      
      overlay.remove();
      console.log('✅ POPUP: Closed after save');
    };
  };
  
  console.log('✅ openGridSlotEditor function defined and available globally');

  // Load saved configurations from session
  setTimeout(function() {
    console.log('🔍 Checking for saved configurations...');
    
    // Check if we have a parent session key to load from
    if (parentSessionKey && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      console.log('🔍 Loading from session:', parentSessionKey, 'for layout:', layout);
      
      chrome.storage.local.get([parentSessionKey], function(sessionResult) {
        if (sessionResult[parentSessionKey] && sessionResult[parentSessionKey].displayGrids) {
          var sessionData = sessionResult[parentSessionKey];
          console.log('📊 Session has', sessionData.displayGrids.length, 'display grids');
          
          var gridEntry = sessionData.displayGrids.find(function(g) { 
            return g.layout === layout; 
          });
          
          if (gridEntry && gridEntry.config && gridEntry.config.slots) {
            console.log('🎯 SUCCESS: Found grid config in session for', layout);
            console.log('📂 Config has', Object.keys(gridEntry.config.slots).length, 'slots configured');
            
            // Apply the configuration
            Object.keys(gridEntry.config.slots).forEach(function(slotId) {
              var slot = document.querySelector('[data-slot-id="' + slotId + '"]');
              if (slot && gridEntry.config.slots[slotId]) {
                var slotConfig = gridEntry.config.slots[slotId];
                
                // Update the data attribute
                slot.setAttribute('data-slot-config', JSON.stringify(slotConfig));
                
                // Update the display
                var agentNum = slotConfig.agent ? slotConfig.agent.replace('agent', '') : '';
                var ab = 'AB' + String(slotId).padStart(2, '0') + (agentNum ? agentNum.padStart(2, '0') : '');
                var abEl = slot.querySelector('span[style*="font-family: monospace"]');
                if (abEl) abEl.textContent = ab;
                
                var parts = [slotConfig.title || ('Display Port ' + slotId)];
                if (slotConfig.model && slotConfig.model !== 'auto') {
                  parts.push(slotConfig.model);
                } else if (slotConfig.provider) {
                  parts.push(slotConfig.provider);
                }
                var disp = parts.join(' · ');
                var dispEl = slot.querySelector('.slot-display-text');
                if (dispEl) dispEl.textContent = disp;
                
                console.log('✅ Applied config to slot', slotId, ':', slotConfig);
              }
            });
          } else {
            console.log('❌ No grid config found for layout:', layout);
          }
        } else {
          console.log('❌ No session data or displayGrids found');
        }
      });
    } else {
      console.log('❌ No parent session key or chrome.storage not available');
    }
  }, 100);

  // Fullscreen functionality
  function toggleFullscreen() {
    console.log('🖥️ Fullscreen toggle clicked');
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.mozFullScreenElement && !document.msFullscreenElement) {
      // Enter fullscreen
      var elem = document.documentElement;
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      } else if (elem.mozRequestFullScreen) {
        elem.mozRequestFullScreen();
      } else if (elem.msRequestFullscreen) {
        elem.msRequestFullscreen();
      }
      console.log('✅ Entering fullscreen mode');
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
      console.log('✅ Exiting fullscreen mode');
    }
  }
  
  // Make toggleFullscreen globally available
  window.toggleFullscreen = toggleFullscreen;
  
  console.log('✅ All grid functions loaded and available');
}
