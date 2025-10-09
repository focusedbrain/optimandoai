// Grid functionality for display grids
// Prevent script from running multiple times
if (window.gridScriptLoaded) {
  console.log('⚠️ Grid script already loaded, skipping...');
} else {
  window.gridScriptLoaded = true;
  console.log('✅ Grid script loaded');
  console.log('🔧 Setting up grid functionality...');
  
  // Get config from window.GRID_CONFIG (set by grid-display.js)
  var config = window.GRID_CONFIG || {};
  var sessionId = config.sessionId || 'unknown';
  var layout = config.layout || 'unknown';
  var parentSessionKey = config.sessionKey || '';
  var nextBoxNumberFromConfig = config.nextBoxNumber || 1;
  
  // Store globally for other functions to use
  window.gridSessionId = sessionId;
  window.gridLayout = layout;
  window.sessionId = sessionId;
  window.layout = layout;
  window.nextBoxNumber = nextBoxNumberFromConfig;
  
  console.log('✅ Grid loaded successfully:', layout, 'Session:', sessionId);
  console.log('🔧 Parent session key:', parentSessionKey);
  console.log('📦 Next box number:', window.nextBoxNumber);
  
  if (layout && layout !== 'unknown') {
    document.title = 'AI Grid - ' + layout.toUpperCase();
  }
  
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
    
    // Get parent session key from global config
    var parentSessionKey = (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || '';
    
    // Function to calculate next box number from session
    function calculateNextBoxNumber(callback) {
      if (!parentSessionKey || typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined') ? window.nextBoxNumber : 1;
        callback(fallbackNumber);
        return;
      }
      
      chrome.storage.local.get([parentSessionKey], function(result) {
        var session = result[parentSessionKey] || {};
        var maxBoxNumber = 0;
        
        // Check all agent boxes
        if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
          session.agentBoxes.forEach(function(box) {
            var boxNum = box.boxNumber || box.number || 0;
            if (boxNum > maxBoxNumber) maxBoxNumber = boxNum;
          });
        }
        
        // Check all display grid slots
        if (session.displayGrids && Array.isArray(session.displayGrids)) {
          session.displayGrids.forEach(function(grid) {
            if (grid.config && grid.config.slots) {
              Object.values(grid.config.slots).forEach(function(slot) {
                var boxNum = slot.boxNumber || 0;
                if (boxNum > maxBoxNumber) maxBoxNumber = boxNum;
              });
            }
          });
        }
        
        var nextNum = maxBoxNumber + 1;
        console.log('📦 Calculated next box number:', nextNum, 'from max:', maxBoxNumber);
        callback(nextNum);
      });
    }
    
    // Show loading dialog first
    var nextBoxNumber = 1;
    var displayBoxNumber = '...';
    
    dialog.innerHTML = 
      '<h3 style="margin:0 0 20px 0;font-size:18px;font-weight:600;color:#333">Setup Agent Box #' + slotId + '</h3>' +
      
      // 🆕 Agent Box Number field
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
    
    console.log('✅ POPUP: Form HTML created');
    
    // Add dialog to overlay and overlay to document
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    console.log('✅ POPUP: Added to DOM');
    
    // Calculate and update the box number field
    calculateNextBoxNumber(function(calculatedNumber) {
      nextBoxNumber = calculatedNumber;
      displayBoxNumber = String(nextBoxNumber).padStart(2, '0');
      
      var boxNumberInput = dialog.querySelector('input[readonly]');
      if (boxNumberInput) {
        boxNumberInput.value = displayBoxNumber;
        console.log('✅ Updated box number display:', displayBoxNumber);
      }
    });
    
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
      
      console.log('💾 POPUP: Saving slot config:', { title, agent, provider, model, boxNumber: nextBoxNumber });
      
      // Update slot data attribute - include boxNumber AND locationId
      var agentNum = agent ? parseInt(agent.replace('agent', '')) : 0;
      
      // ✅ Generate locationId and locationLabel for this slot
      var gridSessionId = window.gridSessionId || 'unknown';
      var gridLayout = window.gridLayout || layout;
      var locationId = 'grid_' + gridSessionId + '_' + gridLayout + '_slot' + slotId;
      var locationLabel = gridLayout + ' Display Grid - Slot ' + slotId;
      
      var newConfig = { 
        title: title, 
        agent: agent, 
        provider: provider, 
        model: model, 
        boxNumber: nextBoxNumber,
        agentNumber: agentNum,
        identifier: 'AB' + String(nextBoxNumber).padStart(2, '0') + String(agentNum).padStart(2, '0'),
        tools: (cfg.tools || []),
        locationId: locationId,
        locationLabel: locationLabel,
        gridSessionId: gridSessionId,
        gridLayout: gridLayout,
        slotId: slotId,
        source: 'display_grid'
      };
      slot.setAttribute('data-slot-config', JSON.stringify(newConfig));
      
      // Update visual display with correct box number
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
      
      console.log('✅ POPUP: Updated slot display for slot', slotId);
      
      // ✅ CRITICAL: Save newConfig to the slot's data attribute BEFORE collecting all slots!
      slot.setAttribute('data-slot-config', JSON.stringify(newConfig));
      console.log('✅ POPUP: Saved newConfig to slot data attribute:', newConfig);
      console.log('🔍 POPUP: Slot element after save:', slot);
      console.log('🔍 POPUP: data-slot-config value:', slot.getAttribute('data-slot-config'));
      
      // Get parent session key from global config
      var parentSessionKey = (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || '';
      
      console.log('🔑 Parent session key:', parentSessionKey);
      
      if (!parentSessionKey) {
        alert('❌ No session key found! Cannot save.');
        overlay.remove();
        return;
      }
      
      // ✅ NEW APPROACH: Write directly to chrome.storage.local
      console.log('💾 DIRECT SAVE: Writing agent box directly to session storage...');
      
      // Create the agent box entry with ALL fields from newConfig
      var agentBox = {
        identifier: newConfig.identifier,
        boxNumber: newConfig.boxNumber,
        agentNumber: newConfig.agentNumber,
        title: newConfig.title,
        provider: newConfig.provider,
        model: newConfig.model,
        tools: newConfig.tools || [],
        locationId: newConfig.locationId,
        locationLabel: newConfig.locationLabel,
        source: 'display_grid',
        gridSessionId: newConfig.gridSessionId,
        gridLayout: newConfig.gridLayout,
        slotId: newConfig.slotId,
        timestamp: new Date().toISOString()
      };
      
      console.log('📦 DIRECT SAVE: Agent box to save:', agentBox);
      
      // Load session, add agent box, save back
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([parentSessionKey], function(result) {
          var session = result[parentSessionKey] || {};
          
          console.log('📋 DIRECT SAVE: Loaded session:', session);
          
          // Initialize arrays
          if (!session.agentBoxes) session.agentBoxes = [];
          if (!session.displayGrids) session.displayGrids = [];
          
          // Add or update agent box
          var existingIndex = session.agentBoxes.findIndex(function(b) {
            return b.identifier === agentBox.identifier;
          });
          
          if (existingIndex !== -1) {
            session.agentBoxes[existingIndex] = agentBox;
            console.log('♻️ DIRECT SAVE: Updated existing agent box at index', existingIndex);
          } else {
            session.agentBoxes.push(agentBox);
            console.log('🆕 DIRECT SAVE: Added new agent box, total now:', session.agentBoxes.length);
          }
          
          // Collect all slot configurations for grid metadata
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
      
          // Update or add grid metadata
          var gridIndex = session.displayGrids.findIndex(function(g) {
            return g.sessionId === window.gridSessionId;
          });
          
          if (gridIndex !== -1) {
            session.displayGrids[gridIndex].config = payload;
            session.displayGrids[gridIndex].timestamp = new Date().toISOString();
            console.log('♻️ DIRECT SAVE: Updated existing grid metadata');
          } else {
            session.displayGrids.push({
              layout: window.gridLayout,
              sessionId: window.gridSessionId,
              config: payload,
              timestamp: new Date().toISOString()
            });
            console.log('🆕 DIRECT SAVE: Added new grid metadata');
          }
          
          console.log('💾 DIRECT SAVE: Saving session with', session.agentBoxes.length, 'agent boxes');
          
          // Save back to storage
          var saveData = {};
          saveData[parentSessionKey] = session;
          
          chrome.storage.local.set(saveData, function() {
            if (chrome.runtime.lastError) {
              console.error('❌ DIRECT SAVE: Failed:', chrome.runtime.lastError);
              alert('❌ Save failed: ' + chrome.runtime.lastError.message);
            } else {
              console.log('✅ DIRECT SAVE: Success! Agent box saved to session.');
              console.log('📦 Saved agent box:', agentBox.identifier, '| Total boxes in session:', session.agentBoxes.length);
              
              // ✅ INCREMENT nextBoxNumber for next save
              window.nextBoxNumber++;
              console.log('📦 Incremented nextBoxNumber to:', window.nextBoxNumber);
              
              // Close dialog silently (no popup needed)
              overlay.remove();
            }
          });
        });
      } else {
        console.error('❌ chrome.storage.local not available!');
        alert('❌ Cannot save: Chrome storage API not available');
      }
      
      // Old code removed - we're using direct storage access now
      return;
      
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
      
      console.log('📦 Full payload to save:', payload);
      
      // Get parent session key from global config
      var parentSessionKey = (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || '';
      
      console.log('🔑 Parent session key:', parentSessionKey);
      
      // Try chrome.runtime.sendMessage first (if available)
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage && parentSessionKey) {
        console.log('📤 Sending GRID_SAVE via chrome.runtime.sendMessage...');
        
        chrome.runtime.sendMessage({
          type: 'GRID_SAVE',
          payload: payload,
          sessionKey: parentSessionKey,
          timestamp: Date.now()
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('❌ chrome.runtime.sendMessage failed:', chrome.runtime.lastError);
            // Try window.opener fallback
            tryOpenerSave();
          } else if (response && response.success) {
            console.log('✅ Save successful via background script!');
            
            // ✅ INCREMENT nextBoxNumber for next save
            window.nextBoxNumber++;
            console.log('📦 Incremented nextBoxNumber to:', window.nextBoxNumber);
            console.log('📦 Saved agent box:', newConfig.identifier);
            
            // Close dialog silently
            overlay.remove();
          } else {
            console.error('❌ Save failed:', response);
            tryOpenerSave();
          }
        });
      } else {
        // Chrome runtime not available, try window.opener
        tryOpenerSave();
      }
      
      function tryOpenerSave() {
        console.log('🔄 Trying window.opener relay...');
        console.log('🔍 window.opener exists?', !!window.opener);
        console.log('🔍 window.opener type:', typeof window.opener);
        
        if (window.opener) {
          console.log('🔍 window.opener.optimandoSaveGridConfig type:', typeof window.opener.optimandoSaveGridConfig);
          console.log('🔍 Available functions on window.opener:', Object.keys(window.opener).filter(k => typeof window.opener[k] === 'function').slice(0, 20));
        }
        
        // Try direct function call on parent window
        if (window.opener && typeof window.opener.optimandoSaveGridConfig === 'function') {
          console.log('📤 Calling window.opener.optimandoSaveGridConfig directly...');
          
          window.opener.optimandoSaveGridConfig(payload, parentSessionKey)
            .then(function(response) {
              console.log('✅ Save successful via window.opener function!');
              
              // ✅ INCREMENT nextBoxNumber for next save
              window.nextBoxNumber++;
              console.log('📦 Incremented nextBoxNumber to:', window.nextBoxNumber);
              console.log('📦 Saved agent box:', newConfig.identifier);
              
              // Close dialog silently
              overlay.remove();
            })
            .catch(function(error) {
              console.error('❌ Opener function call failed:', error);
              alert('Failed to save: ' + (error.message || 'Unknown error'));
            });
        } else {
          console.error('❌ No window.opener.optimandoSaveGridConfig function available!');
          console.log('🔧 Attempting to call via postMessage as last resort...');
          
          // Last resort: Try postMessage
          if (window.opener) {
            // Listen for response from parent
            var responseHandler = function(event) {
              if (event.data && event.data.type === 'OPTIMANDO_GRID_SAVE_SUCCESS') {
                console.log('✅ Grid: Save successful via postMessage!');
                window.removeEventListener('message', responseHandler);
                
                // ✅ INCREMENT nextBoxNumber for next save
                window.nextBoxNumber++;
                console.log('📦 Incremented nextBoxNumber to:', window.nextBoxNumber);
                console.log('📦 Saved agent box:', event.data.identifier || newConfig.identifier);
                
                // Close dialog silently
                overlay.remove();
              } else if (event.data && event.data.type === 'OPTIMANDO_GRID_SAVE_ERROR') {
                console.error('❌ Grid: Save failed via postMessage');
                window.removeEventListener('message', responseHandler);
                alert('Failed to save: ' + (event.data.error || 'Unknown error'));
              }
            };
            
            window.addEventListener('message', responseHandler);
            
            window.opener.postMessage({
              type: 'OPTIMANDO_GRID_SAVE',
              payload: payload,
              sessionKey: parentSessionKey,
              timestamp: Date.now()
            }, '*');
            console.log('📤 Sent postMessage to opener');
            
            // Set timeout to remove listener if no response
        setTimeout(function() {
              window.removeEventListener('message', responseHandler);
            }, 5000);
          } else {
            alert('Cannot save: Extension APIs not accessible.');
          }
        }
      }
      
      overlay.remove();
      console.log('✅ POPUP: Dialog closed');
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

  // ✅ REMOVED: Old loading system that conflicted with locationId-based loading in grid-display.js
  // Config loading is now handled in grid-display.js using locationId from session.agentBoxes

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
  
  // Attach event listeners to all edit buttons
  function attachEditButtonListeners() {
    const editButtons = document.querySelectorAll('.edit-slot');
    console.log('🔧 Found', editButtons.length, 'edit buttons to attach listeners to');
    
    editButtons.forEach(function(btn) {
      const slotId = btn.getAttribute('data-slot-id') || btn.getAttribute('data-slot-num');
      
      // Remove any existing listener to avoid duplicates
      btn.replaceWith(btn.cloneNode(true));
      
      // Get the new button reference
      const newBtn = document.querySelector('[data-slot-id="' + slotId + '"]');
      if (!newBtn) return;
      
      newBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('✏️ Edit button clicked for slot:', slotId);
        
        if (typeof window.openGridSlotEditor === 'function') {
          window.openGridSlotEditor(slotId);
        } else {
          console.error('❌ openGridSlotEditor not available');
        }
      });
      
      console.log('✅ Attached listener to slot:', slotId);
    });
  }
  
  // Attach listeners after a short delay to ensure DOM is ready
  setTimeout(function() {
    attachEditButtonListeners();
  }, 200);
  
  // Also expose the function globally in case we need to reattach
  window.attachEditButtonListeners = attachEditButtonListeners;
  
  console.log('✅ All grid functions loaded and available');
}
