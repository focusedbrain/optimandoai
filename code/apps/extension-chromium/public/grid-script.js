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
    const currentProvider = cfg.provider || '';
    const models = currentProvider ? modelOptions(currentProvider) : [];
    
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
      '<div style="margin:6px 0 8px 0;display:flex;align-items:center;gap:8px">' +
        '<button id="gs-add-tool" style="background:transparent;border:0;color:#2563eb;text-decoration:underline;cursor:pointer;padding:0;font-size:12px">+ Tool</button>' +
        '<span style="font-size:12px;color:#64748b">(optional)</span>' +
      '</div>' +
      '<div id="gs-tools" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
        '<div>' +
          '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">AI Agent</label>' +
          '<input id="gs-agent" type="number" min="1" max="99" placeholder="e.g. 1" value="' + (cfg.agent ? String(cfg.agent).replace('agent', '') : '') + '" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.2s">' +
        '</div>' +
        '<div>' +
          '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">Provider</label>' +
          '<select id="gs-provider" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;cursor:pointer;transition:border-color 0.2s">' +
            '<option value=""' + (currentProvider ? '' : ' selected') + ' disabled>Select LLM</option>' +
            providers.map(function(p) { return '<option value="'+p+'"' + (p === currentProvider ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div style="margin-bottom:8px">' +
        '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">Model</label>' +
        '<select id="gs-model" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;cursor:pointer;transition:border-color 0.2s">' +
          (currentProvider ?
            models.map(function(m) { return '<option' + ((cfg.model || '') === m ? ' selected' : '') + '>' + m + '</option>'; }).join('')
            : '<option selected disabled>Select provider first</option>') +
        '</select>' +
      '</div>' +
      '<div style="margin:4px 0 12px 0;">' +
        '<button id="gs-finetune" style="background:transparent;border:0;color:#2563eb;text-decoration:underline;cursor:pointer;padding:0;font-size:12px">Finetune Model</button>' +
        '<div id="gs-finetune-fb" style="display:none;margin-top:6px;background:#fee2e2;color:#b91c1c;padding:6px 8px;border-radius:6px;font-size:12px">Finetuning is not available for this Model</div>' +
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
    
    // Tools render & handlers (integrated)
    cfg.tools = Array.isArray(cfg.tools) ? cfg.tools : [];
    function renderTools(){
      var wrap = dialog.querySelector('#gs-tools'); if (!wrap) return;
      wrap.innerHTML = (cfg.tools || []).map(function(name, idx){
        return '<span data-idx="'+idx+'" style="display:inline-flex;align-items:center;gap:6px;background:#eef2ff;color:#1e3a8a;border:1px solid #c7d2fe;padding:4px 8px;border-radius:999px;font-size:12px">'+
               name + '<button class="gs-tool-rm" data-idx="'+idx+'" style="background:transparent;border:0;color:#1e3a8a;cursor:pointer;font-weight:700">×</button></span>'
      }).join('');
      (wrap.querySelectorAll('.gs-tool-rm') || []).forEach(function(btn){
        btn.addEventListener('click', function(){
          var i = parseInt(btn.getAttribute('data-idx') || '0', 10);
          cfg.tools.splice(i,1);
          renderTools();
        });
      });
    }
    renderTools();

    dialog.querySelector('#gs-add-tool').addEventListener('click', function(){
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483647;display:flex;align-items:center;justify-content:center';
      ov.onclick = function(e){ if (e.target === ov) ov.remove() };
      var p = document.createElement('div');
      p.style.cssText = 'width:560px;max-width:92vw;max-height:60vh;overflow:auto;background:#0b1220;color:#e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4)';
      p.innerHTML = ''+
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08)">'+
          '<div style="font-weight:700">Tool Catalog</div>'+
          '<button id="gc-close" style="padding:6px 10px;background:#475569;border:none;color:#e2e8f0;border-radius:6px;cursor:pointer">Close</button>'+
        '</div>'+
        '<div style="padding:10px 12px;display:flex;gap:8px;align-items:center">'+
          '<input id="gc-search" placeholder="Search tools..." style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#0f172a;color:#e2e8f0" />'+
          '<button id="gc-add" disabled style="padding:8px 12px;background:#22c55e;border:none;color:#07210f;border-radius:8px;cursor:pointer;font-weight:700">Add</button>'+
        '</div>'+
        '<div style="padding:0 12px 12px 12px;opacity:.7;font-size:12px">No tools yet. Use search and click Add to attach a tool.</div>';
      ov.appendChild(p); document.body.appendChild(ov);
      var s = p.querySelector('#gc-search'); var add = p.querySelector('#gc-add');
      s.oninput = function(){ add.disabled = !s.value.trim() };
      p.querySelector('#gc-close').onclick = function(){ ov.remove() };
      add.onclick = function(){ var name = (s.value || '').trim(); if (!name) return; if (!cfg.tools.includes(name)) cfg.tools.push(name); renderTools(); add.textContent='Added'; add.disabled=true; setTimeout(function(){ ov.remove() }, 400); };
    });

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

    // Finetune feedback
    document.getElementById('gs-finetune').onclick = function(){
      var fb = document.getElementById('gs-finetune-fb');
      if (!fb) return; fb.style.display = 'block'; fb.style.opacity = '1';
      setTimeout(function(){ fb.style.opacity = '0'; setTimeout(function(){ fb.style.display = 'none' }, 300) }, 2000);
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
      var newConfig = { title: title, agent: agent, provider: provider, model: model, tools: (cfg.tools || []) };
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

  // --- Tools catalog integration ---
  function parseSlotConfig(slotEl){
    try { return JSON.parse(slotEl.getAttribute('data-slot-config') || '{}') } catch { return {} }
  }
  function writeSlotConfig(slotEl, cfg){
    try { slotEl.setAttribute('data-slot-config', JSON.stringify(cfg)) } catch {}
  }
  function openToolCatalog(slotId){
    var slot = document.querySelector('[data-slot-id="' + slotId + '"]');
    if (!slot){ console.error('❌ TOOL: slot not found', slotId); return }
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:2147483647;display:flex;align-items:center;justify-content:center';
    overlay.onclick = function(e){ if (e.target === overlay) overlay.remove() };

    var panel = document.createElement('div');
    panel.style.cssText = 'width:620px;max-width:92vw;max-height:70vh;overflow:auto;background:#0b1220;color:#e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4)';
    panel.innerHTML = ''+
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)">' +
        '<div style="font-weight:700">Tool Catalog</div>' +
        '<button id="tc-close" style="padding:6px 10px;background:#475569;border:none;color:#e2e8f0;border-radius:6px;cursor:pointer">Close</button>' +
      '</div>' +
      '<div style="padding:12px 14px;display:flex;gap:10px;align-items:center">' +
        '<input id="tc-search" placeholder="Search tools..." style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#0f172a;color:#e2e8f0" />' +
        '<button id="tc-add" disabled style="padding:8px 12px;background:#22c55e;border:none;color:#07210f;border-radius:8px;cursor:pointer;font-weight:700">Add</button>' +
      '</div>' +
      '<div id="tc-empty" style="padding:0 14px 14px 14px;opacity:.7;font-size:12px">No tools yet. Type a name and click Add to attach a tool to this agent box.</div>';

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    var search = panel.querySelector('#tc-search');
    var addBtn = panel.querySelector('#tc-add');
    search.oninput = function(){ addBtn.disabled = !search.value.trim() };
    panel.querySelector('#tc-close').onclick = function(){ overlay.remove() };
    addBtn.onclick = function(){
      var name = (search.value || '').trim();
      if (!name) return;
      var cfg = parseSlotConfig(slot);
      if (!cfg.tools) cfg.tools = [];
      if (!cfg.tools.includes(name)) cfg.tools.push(name);
      writeSlotConfig(slot, cfg);
      addBtn.textContent = 'Added';
      addBtn.disabled = true;
      setTimeout(function(){ overlay.remove() }, 500);
    };
  }

  // Delegate clicks for "+ Tool" links inside the grid tab
  document.addEventListener('click', function(e){
    var t = e.target;
    if (t && t.classList && t.classList.contains('slot-add-tool')){
      e.preventDefault();
      var sid = t.getAttribute('data-slot-id');
      openToolCatalog(sid);
    }
  }, true);

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
