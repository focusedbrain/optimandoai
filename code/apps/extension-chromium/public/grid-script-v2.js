// Grid functionality V2 for display grids - WITH AGENT BOX NUMBER DISPLAY
// Prevent script from running multiple times
if (window.gridScriptV2Loaded) {
  console.log('⚠️ Grid script V2 already loaded, skipping...');
} else {
  window.gridScriptV2Loaded = true;
  console.log('✅ Grid script V2 loaded');
  console.log('🔧 Setting up grid V2 functionality...');
  
  // Get data from global variables (set by grid-display-v2.html)
  var sessionId = window.gridSessionId || window.sessionId || 'unknown';
  var layout = window.gridLayout || window.layout || 'unknown';
  var sessionKey = window.sessionKey || '';
  var nextBoxNumber = window.nextBoxNumber || 1;
  
  console.log('✅ Grid V2 loaded successfully:', { layout, sessionId, sessionKey, nextBoxNumber });
  document.title = 'AI Grid V2 - ' + layout.toUpperCase();
  
  // Define openGridSlotEditor function immediately
  window.openGridSlotEditor = function(slotId) {
    console.log('🔍 POPUP V2: openGridSlotEditor called with slotId:', slotId);
    const slot = document.querySelector('[data-slot-id="' + slotId + '"]');
    if (!slot) {
      console.error('❌ POPUP V2: No slot found with id:', slotId);
      return;
    }
    
    const configStr = slot.getAttribute('data-slot-config') || '{}';
    console.log('📋 POPUP V2: Slot config string:', configStr);
    let cfg = {};
    try { 
      cfg = JSON.parse(configStr);
      console.log('📋 POPUP V2: Parsed config:', cfg);
    } catch(e) { 
      console.error('❌ POPUP V2: Failed to parse config:', e);
      cfg = {};
    }
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;padding:20px;border-radius:10px;max-width:520px;width:92%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-height:90vh;overflow-y:auto;';
    
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
    
    // Display next box number (will be assigned on save)
    const displayBoxNumber = String(nextBoxNumber).padStart(2, '0');
    
    console.log('📋 POPUP V2: Form will show:', {
      boxNumber: nextBoxNumber,
      title: cfg.title || ('Display Port ' + slotId),
      agent: cfg.agent ? String(cfg.agent).replace('agent', '') : '',
      provider: currentProvider,
      model: cfg.model || 'auto'
    });
    
    dialog.innerHTML = 
      '<h3 style="margin:0 0 20px 0;font-size:18px;font-weight:600;color:#333">Setup Agent Box #' + slotId + '</h3>' +
      
      // 🆕 KEY FIX: Agent Box Number field
      '<div style="margin-bottom:16px;background:#f0f9ff;padding:12px;border-radius:8px;border:2px solid #3b82f6">' +
        '<label style="display:block;margin-bottom:8px;font-weight:700;color:#1e40af;font-size:14px">📦 Agent Box Number</label>' +
        '<input type="text" value="' + displayBoxNumber + '" readonly style="width:100%;padding:12px;border:2px solid #93c5fd;border-radius:8px;font-size:16px;font-weight:700;background:#dbeafe;color:#1e40af;text-align:center;letter-spacing:2px">' +
        '<div style="font-size:11px;color:#1e40af;margin-top:6px;font-weight:600">✨ Auto-incremented from last box in session</div>' +
      '</div>' +
      
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
    
    console.log('✅ POPUP V2: Form HTML created with box number:', displayBoxNumber);
    
    // Add dialog to overlay and overlay to document
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    console.log('✅ POPUP V2: Added to DOM');
    
    // Tools render & handlers
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
        console.log('✅ POPUP V2: Title input focused');
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
      console.log('🔄 POPUP V2: Updated models for provider:', provider);
    };

    // Finetune feedback
    document.getElementById('gs-finetune').onclick = function(){
      var fb = document.getElementById('gs-finetune-fb');
      if (!fb) return; fb.style.display = 'block'; fb.style.opacity = '1';
      setTimeout(function(){ fb.style.opacity = '0'; setTimeout(function(){ fb.style.display = 'none' }, 300) }, 2000);
    };
    
    // Cancel button
    document.getElementById('gs-cancel').onclick = function() {
      console.log('❌ POPUP V2: Cancelled');
      overlay.remove();
    };
    
    // 🆕 KEY FIX: Save with chrome.runtime.sendMessage to background script
    document.getElementById('gs-save').onclick = function() {
      var title = document.getElementById('gs-title').value || ('Display Port ' + slotId);
      var agentNum = document.getElementById('gs-agent').value;
      var provider = document.getElementById('gs-provider').value;
      var model = document.getElementById('gs-model').value;
      
      var agent = agentNum ? ('agent' + agentNum) : '';
      
      console.log('💾 POPUP V2: Saving slot config:', { title, agent, provider, model, boxNumber: nextBoxNumber });
      
      // 🆕 Include box number in config
      var newConfig = { 
        title: title, 
        agent: agent, 
        provider: provider, 
        model: model, 
        boxNumber: nextBoxNumber,  // ← KEY FIX: Store the box number
        agentNumber: agentNum ? parseInt(agentNum) : 0,
        identifier: 'AB' + String(nextBoxNumber).padStart(2, '0') + (agentNum ? String(agentNum).padStart(2, '0') : '00'),
        tools: (cfg.tools || []) 
      };
      
      slot.setAttribute('data-slot-config', JSON.stringify(newConfig));
      
      // Update visual display
      var agentNumForAB = agent ? agent.replace('agent', '').padStart(2, '0') : '00';
      var ab = 'AB' + String(nextBoxNumber).padStart(2, '0') + agentNumForAB;
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
      
      console.log('✅ POPUP V2: Updated slot display for slot', slotId, 'with identifier:', newConfig.identifier);
      
      // Collect all slot configurations
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
      
      console.log('📦 POPUP V2: Full payload:', payload);
      
      // 🆕 KEY FIX: Use chrome.runtime.sendMessage to background script
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        console.log('📤 V2: Sending GRID_SAVE via chrome.runtime.sendMessage...');
        
        chrome.runtime.sendMessage({
          type: 'GRID_SAVE',
          payload: payload,
          sessionKey: sessionKey,
          timestamp: Date.now()
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('❌ V2: chrome.runtime.sendMessage failed:', chrome.runtime.lastError);
            alert('Failed to save grid configuration: ' + chrome.runtime.lastError.message);
          } else if (response && response.success) {
            console.log('✅ V2: Save successful via background script!');
            
            // Show success notification
            alert('✅ Grid configuration saved successfully!\n\nAgent Box: ' + newConfig.identifier);
            
            // Increment nextBoxNumber for next save
            window.nextBoxNumber++;
          } else {
            console.error('❌ V2: Save failed:', response);
            alert('Failed to save grid configuration. Please try again.');
          }
        });
      } else {
        console.error('❌ V2: chrome.runtime not available!');
        alert('Chrome extension APIs not available. Cannot save configuration.');
      }
      
      overlay.remove();
      console.log('✅ POPUP V2: Dialog closed');
    };
  };
  
  console.log('✅ openGridSlotEditor V2 function defined and available globally');

  // Fullscreen functionality
  function toggleFullscreen() {
    console.log('🖥️ V2: Fullscreen toggle clicked');
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.mozFullScreenElement && !document.msFullscreenElement) {
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
      console.log('✅ V2: Entering fullscreen mode');
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
      console.log('✅ V2: Exiting fullscreen mode');
    }
  }
  
  window.toggleFullscreen = toggleFullscreen;
  
  console.log('✅ All grid V2 functions loaded and available');
}

