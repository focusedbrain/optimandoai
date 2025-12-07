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
  var parentSessionKey = window.sessionKey || (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || '';
  var nextBoxNumber = window.nextBoxNumber || 1;
  
  console.log('✅ Grid V2 loaded successfully:', { layout, sessionId, parentSessionKey, nextBoxNumber });
  document.title = 'AI Grid V2 - ' + layout.toUpperCase();
  
  /**
   * Calculate max box number from session data
   */
  function findMaxBoxNumber(session) {
    var maxBoxNumber = 0;
    
    // Check all agent boxes
    if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
      session.agentBoxes.forEach(function(box) {
        var boxNum = box.boxNumber || box.number || 0;
        if (boxNum > maxBoxNumber) maxBoxNumber = boxNum;
      });
      console.log('  ✓ V2: Checked', session.agentBoxes.length, 'agent boxes, max:', maxBoxNumber);
    }
    
    // Check display grid slots
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
    
    return maxBoxNumber;
  }
  
  /**
   * Try to get session directly from HTTP API
   */
  function getSessionFromHttpApi(sessionKey, callback) {
    console.log('🔄 V2: Trying direct HTTP API for session:', sessionKey);
    
    var ports = [51248, 51249, 51250];
    var currentPortIndex = 0;
    
    function tryNextPort() {
      if (currentPortIndex >= ports.length) {
        console.error('❌ V2: All HTTP ports failed');
        callback(null);
        return;
      }
      
      var port = ports[currentPortIndex];
      var url = 'http://127.0.0.1:' + port + '/api/orchestrator/get?key=' + encodeURIComponent(sessionKey);
      
      fetch(url)
        .then(function(response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(function(result) {
          console.log('✅ V2: HTTP API success on port', port);
          callback(result.data || null);
        })
        .catch(function(err) {
          console.log('⚠️ V2: Port', port, 'failed:', err.message);
          currentPortIndex++;
          tryNextPort();
        });
    }
    
    tryNextPort();
  }
  
  /**
   * Get session key dynamically (script loads before DOMContentLoaded sets window.sessionKey)
   */
  function getCurrentSessionKey() {
    var key = window.sessionKey || 
              (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || 
              parentSessionKey || 
              '';
    return key;
  }
  
  /**
   * Calculate next box number from SQLite (single source of truth)
   */
  function calculateNextBoxNumber(callback) {
    // Get session key DYNAMICALLY each time - fixes timing issue where script loads before DOMContentLoaded
    var currentSessionKey = getCurrentSessionKey();
    
    console.log('🔍 V2: calculateNextBoxNumber called');
    console.log('🔍 V2: currentSessionKey (dynamic):', currentSessionKey);
    console.log('🔍 V2: parentSessionKey (captured at load):', parentSessionKey);
    console.log('🔍 V2: window.sessionKey:', window.sessionKey);
    console.log('🔍 V2: window.GRID_CONFIG:', JSON.stringify(window.GRID_CONFIG));
    
    if (!currentSessionKey) {
      var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined') ? window.nextBoxNumber : 1;
      console.log('⚠️ V2: No session key available, using fallback:', fallbackNumber);
      callback(fallbackNumber);
      return;
    }
    
    console.log('🔍 V2: Calculating next box number from SQLite with key:', currentSessionKey);
    
    // First try via background script
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'GET_SESSION_FROM_SQLITE',
        sessionKey: currentSessionKey
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('❌ V2: Background script error:', chrome.runtime.lastError.message);
          // Fall back to direct HTTP API
          getSessionFromHttpApi(currentSessionKey, function(session) {
            if (session) {
              var max = findMaxBoxNumber(session);
              var next = max + 1;
              console.log('✅ V2: From HTTP API: next box number =', next);
              callback(next);
            } else {
              var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined' && window.nextBoxNumber > 1) ? window.nextBoxNumber : 1;
              console.log('⚠️ V2: HTTP API failed, using fallback:', fallbackNumber);
              callback(fallbackNumber);
            }
          });
          return;
        }
        
        if (!response || !response.success || !response.session) {
          console.log('⚠️ V2: No session from background, trying HTTP API...');
          // Fall back to direct HTTP API
          getSessionFromHttpApi(currentSessionKey, function(session) {
            if (session) {
              var max = findMaxBoxNumber(session);
              var next = max + 1;
              console.log('✅ V2: From HTTP API: next box number =', next);
              callback(next);
            } else {
              var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined' && window.nextBoxNumber > 1) ? window.nextBoxNumber : 1;
              console.log('⚠️ V2: HTTP API failed, using fallback:', fallbackNumber);
              callback(fallbackNumber);
            }
          });
          return;
        }
        
        var session = response.session;
        console.log('🔍 V2: Session data from SQLite:', JSON.stringify(session, null, 2));
        console.log('🔍 V2: Session agentBoxes:', session?.agentBoxes);
        console.log('🔍 V2: Session agentBoxes count:', session?.agentBoxes?.length || 0);
        var max = findMaxBoxNumber(session);
        var next = max + 1;
        console.log('✅ V2: From background script: next box number =', next, 'from max:', max);
        callback(next);
      });
    } else {
      // No chrome.runtime, try direct HTTP API
      console.log('⚠️ V2: No chrome.runtime, trying HTTP API...');
      getSessionFromHttpApi(currentSessionKey, function(session) {
        if (session) {
          var max = findMaxBoxNumber(session);
          var next = max + 1;
          console.log('✅ V2: From HTTP API: next box number =', next);
          callback(next);
        } else {
          var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined') ? window.nextBoxNumber : 1;
          console.log('⚠️ V2: Using window fallback:', fallbackNumber);
          callback(fallbackNumber);
        }
      });
    }
  }
  
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
    
    // Check if this is an EXISTING box (editing) or a NEW box (creating)
    var existingBoxNumber = (typeof cfg.boxNumber === 'number') ? cfg.boxNumber : null;
    var isEditing = existingBoxNumber !== null;
    
    // CRITICAL DEBUG: Show current state
    var debugSessionKey = getCurrentSessionKey();
    console.log('========================================');
    console.log('🔍 DEBUG: openGridSlotEditor state:');
    console.log('  slotId:', slotId);
    console.log('  isEditing:', isEditing);
    console.log('  existingBoxNumber:', existingBoxNumber);
    console.log('  sessionKey:', debugSessionKey);
    console.log('  window.sessionKey:', window.sessionKey);
    console.log('  window.GRID_CONFIG:', window.GRID_CONFIG);
    console.log('  window.nextBoxNumber:', window.nextBoxNumber);
    console.log('========================================');
    
    if (!debugSessionKey) {
      alert('ERROR: No session key! Cannot calculate box number correctly.\n\nwindow.sessionKey: ' + window.sessionKey + '\nwindow.GRID_CONFIG: ' + JSON.stringify(window.GRID_CONFIG));
    }
    
    // For new boxes, calculate the next box number from SQLite
    if (!isEditing) {
      console.log('🆕 V2: CREATING new box - calculating next number from SQLite...');
      calculateNextBoxNumber(function(calculatedNumber) {
        console.log('🔢 V2: calculateNextBoxNumber returned:', calculatedNumber);
        nextBoxNumber = calculatedNumber;
        showV2Dialog(slotId, slot, cfg, calculatedNumber, false);
      });
    } else {
      console.log('📝 V2: EDITING existing box - using stored boxNumber:', existingBoxNumber);
      showV2Dialog(slotId, slot, cfg, existingBoxNumber, true);
    }
  };
  
  // Helper function to show the dialog
  function showV2Dialog(slotId, slot, cfg, effectiveBoxNumber, isEditing) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:10px;max-width:520px;width:92%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-height:90vh;display:flex;flex-direction:column;';
    
    function modelOptions(p) {
      p = (p || '').toLowerCase();
      if (p === 'openai') return ['auto', 'gpt-4o-mini', 'gpt-4o'];
      if (p === 'claude') return ['auto', 'claude-3-5-sonnet', 'claude-3-opus'];
      if (p === 'gemini') return ['auto', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      if (p === 'grok') return ['auto', 'grok-2-mini', 'grok-2'];
      if (p === 'local ai') return ['auto', 'tinyllama', 'tinydolphin', 'stablelm2:1.6b', 'stablelm-zephyr:3b', 'phi3:mini', 'gemma:2b', 'phi:2.7b', 'orca-mini', 'qwen2.5-coder:1.5b', 'deepseek-r1:1.5b', 'mistral:7b-instruct-q4_0', 'llama3.2', 'qwen2.5-coder:7b'];
      if (p === 'image ai') return ['Nano Banana Pro', 'DALL·E 3', 'DALL·E 2', 'Flux Schnell', 'Flux Dev', 'SDXL', 'SD3 Medium', 'Stable Diffusion XL'];
      return ['auto'];
    }
    
    console.log('📋 POPUP V2: Form will show:', {
      isEditing: isEditing,
      effectiveBoxNumber: effectiveBoxNumber,
      boxNumber: displayBoxNumber,
      title: cfg.title || ('Display Port ' + slotId),
      agent: cfg.agent ? String(cfg.agent).replace('agent', '') : '',
      provider: currentProvider,
      model: cfg.model || 'auto'
    });
    
    dialog.innerHTML = 
      '<h3 style="margin:0;padding:16px 20px;font-size:18px;font-weight:600;color:#333;border-bottom:1px solid #eee;flex-shrink:0;">Setup Agent Box #' + slotId + '</h3>' +
      '<div style="flex:1;overflow-y:auto;overflow-x:hidden;padding:16px 20px;">' +
      
      // 🆕 KEY FIX: Agent Box Number field
      '<div style="margin-bottom:14px;background:#f0f9ff;padding:12px;border-radius:8px;border:2px solid #3b82f6">' +
        '<label style="display:block;margin-bottom:8px;font-weight:700;color:#1e40af;font-size:14px">📦 Agent Box Number</label>' +
        '<input type="text" value="' + displayBoxNumber + '" readonly style="width:100%;padding:12px;border:2px solid #93c5fd;border-radius:8px;font-size:16px;font-weight:700;background:#dbeafe;color:#1e40af;text-align:center;letter-spacing:2px">' +
        '<div style="font-size:11px;color:#1e40af;margin-top:6px;font-weight:600">✨ Auto-incremented from last box in session</div>' +
      '</div>' +
      
      '<div style="margin-bottom:14px">' +
        '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">Title</label>' +
        '<input id="gs-title" type="text" placeholder="Enter a title for this agent box" value="' + (cfg.title || ('Display Port ' + slotId)).replace(/"/g, '&quot;') + '" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.2s">' +
      '</div>' +
      '<div style="margin:6px 0 8px 0;display:flex;align-items:center;gap:8px">' +
        '<button id="gs-add-tool" style="background:transparent;border:0;color:#2563eb;text-decoration:underline;cursor:pointer;padding:0;font-size:12px">+ Mini App</button>' +
        '<span style="font-size:12px;color:#64748b">(optional)</span>' +
      '</div>' +
      '<div id="gs-tools" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div>' +
          '<label style="display:block;margin-bottom:8px;font-weight:600;color:#444;font-size:14px">AI Agent</label>' +
          '<input id="gs-agent" type="number" min="1" max="99" placeholder="e.g. 1" value="' + (cfg.agentNumber ? cfg.agentNumber : (cfg.agent ? String(cfg.agent).replace('agent', '') : '')) + '" style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;transition:border-color 0.2s">' +
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
      '<div style="margin-top:8px;margin-bottom:14px;padding:12px;background:#f5f5f5;border-radius:8px;font-size:12px;color:#666">' +
        '<strong>Note:</strong> If no agent or LLM is selected, this box will use the global "Setup AI Agent" settings as fallback.' +
      '</div>' +
      '</div>' +
      '<div style="padding:16px 20px;border-top:1px solid #eee;flex-shrink:0;display:flex;justify-content:space-between;gap:10px">' +
        '<button id="gs-delete" style="padding:12px 24px;border:0;border-radius:8px;background:#f44336;color:#fff;cursor:pointer;font-weight:600;font-size:14px;transition:background 0.2s">Delete</button>' +
        '<div style="display:flex;gap:10px">' +
          '<button id="gs-cancel" style="padding:12px 24px;border:0;border-radius:8px;background:#f0f0f0;color:#333;cursor:pointer;font-size:14px;transition:background 0.2s">Cancel</button>' +
          '<button id="gs-save" style="padding:12px 24px;border:0;border-radius:8px;background:#2196F3;color:#fff;cursor:pointer;font-weight:600;font-size:14px;transition:background 0.2s">Save</button>' +
        '</div>' +
      '</div>';
    
    console.log('✅ POPUP V2: Form HTML created with box number:', displayBoxNumber);
    
    // Add dialog to overlay and overlay to document
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Set default agent number to match box number (if not already set)
    setTimeout(function() {
      var agentInput = document.getElementById('gs-agent');
      if (agentInput && !agentInput.value) {
        agentInput.value = String(nextBoxNumber);
        console.log('✅ V2: Set default agent number to match box number:', nextBoxNumber);
      }
    }, 50);
    
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
    
    // Delete button
    document.getElementById('gs-delete').onclick = function() {
      // Show confirmation dialog
      if (confirm('Are you sure you want to delete this agent box?')) {
        console.log('🗑️ POPUP V2: Deleting slot', slotId);
        
        // IMPORTANT: Save the identifier BEFORE clearing the config
        var boxIdentifier = cfg.identifier || '';
        var boxGridSessionId = cfg.gridSessionId || window.gridSessionId || 'unknown';
        var boxGridLayout = cfg.gridLayout || window.gridLayout || layout;
        
        console.log('🔍 POPUP V2: Box to delete:', {
          identifier: boxIdentifier,
          slotId: slotId,
          gridSessionId: boxGridSessionId,
          gridLayout: boxGridLayout
        });
        
        // Clear the slot's data attribute with empty config
        try {
          slot.setAttribute('data-slot-config', JSON.stringify({}));
          
          // Update visual display to empty state
          var abEl = slot.querySelector('span[style*="font-family: monospace"]');
          if (abEl) abEl.textContent = '';
          
          var dispEl = slot.querySelector('.slot-display-text');
          if (dispEl) dispEl.textContent = '';
          
          console.log('✅ POPUP V2: Slot display cleared');
        } catch (e) {
          console.error('❌ V2 Error updating slot display:', e);
        }
        
        // Close dialog IMMEDIATELY (don't wait for background response)
        overlay.remove();
        console.log('✅ POPUP V2: Dialog closed');
        
        // Get parent session key and send delete message (but don't wait for response)
        try {
          var parentSessionKey = (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || '';
          
          if (parentSessionKey && boxIdentifier) {
            // Send message to delete agent box from SQLite (fire and forget)
            chrome.runtime.sendMessage({
              type: 'DELETE_DISPLAY_GRID_AGENT_BOX',
              sessionKey: parentSessionKey,
              identifier: boxIdentifier,
              slotId: slotId,
              gridSessionId: boxGridSessionId,
              gridLayout: boxGridLayout
            });
            console.log('📤 V2 Delete message sent to background with identifier:', boxIdentifier);
          } else {
            console.log('⚠️ V2 No session key or identifier, skipping database deletion');
            console.log('   V2 parentSessionKey:', parentSessionKey, 'identifier:', boxIdentifier);
          }
        } catch (e) {
          console.error('❌ V2 Error sending delete message:', e);
        }
      }
    };
    
    // 🆕 KEY FIX: Save with chrome.runtime.sendMessage to background script
    document.getElementById('gs-save').onclick = function() {
      var title = document.getElementById('gs-title').value || ('Display Port ' + slotId);
      var agentNum = document.getElementById('gs-agent').value;
      var provider = document.getElementById('gs-provider').value;
      var model = document.getElementById('gs-model').value;
      
      var agent = agentNum ? ('agent' + agentNum) : '';
      
      // Use effectiveBoxNumber (existing for edits, new for creates)
      console.log('💾 POPUP V2: Saving slot config:', { title, agent, provider, model, boxNumber: effectiveBoxNumber, isEditing: isEditing });
      
      // Generate locationId and locationLabel for this slot
      var gridSessionId = window.gridSessionId || 'unknown';
      var gridLayout = window.gridLayout || 'unknown';
      var locationId = 'grid_' + gridSessionId + '_' + gridLayout + '_slot' + slotId;
      var locationLabel = gridLayout + ' Display Grid - Slot ' + slotId;
      
      // 🆕 Include box number and location in config (use effectiveBoxNumber)
      var newConfig = { 
        title: title, 
        agent: agent, 
        provider: provider, 
        model: model,
        boxNumber: effectiveBoxNumber,  // ← Use effectiveBoxNumber (preserves existing for edits)
        agentNumber: agentNum ? parseInt(agentNum) : 0,
        identifier: 'AB' + String(effectiveBoxNumber).padStart(2, '0') + (agentNum ? String(agentNum).padStart(2, '0') : '00'),
        tools: (cfg.tools || []),
        locationId: locationId,
        locationLabel: locationLabel,
        gridSessionId: gridSessionId,
        gridLayout: gridLayout,
        slotId: slotId,
        source: 'display_grid'
      };
      
      // 🆕 Create full agent box object for SQLite storage
      var agentBox = {
        identifier: newConfig.identifier,
        boxNumber: newConfig.boxNumber,
        title: newConfig.title,
        agentNumber: newConfig.agentNumber,
        provider: newConfig.provider || 'auto',
        model: newConfig.model || 'auto',
        tools: newConfig.tools || [],
        locationId: newConfig.locationId,
        locationLabel: newConfig.locationLabel,
        source: newConfig.source,
        gridLayout: newConfig.gridLayout,
        gridSessionId: newConfig.gridSessionId,
        slotId: newConfig.slotId,
        timestamp: new Date().toISOString()
      };
      
      slot.setAttribute('data-slot-config', JSON.stringify(newConfig));
      
      // Update visual display (use effectiveBoxNumber)
      var agentNumForAB = agent ? agent.replace('agent', '').padStart(2, '0') : '00';
      var ab = 'AB' + String(effectiveBoxNumber).padStart(2, '0') + agentNumForAB;
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
      console.log('📦 POPUP V2: Agent box:', agentBox);
      
      // 🆕 KEY FIX: Use SAVE_AGENT_BOX_TO_SQLITE instead of GRID_SAVE
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // Get session key DYNAMICALLY (fixes timing issue)
        var saveSessionKey = getCurrentSessionKey();
        console.log('📤 V2: Sending SAVE_AGENT_BOX_TO_SQLITE via chrome.runtime.sendMessage...');
        console.log('📤 V2: Using sessionKey:', saveSessionKey);
        
        chrome.runtime.sendMessage({
          type: 'SAVE_AGENT_BOX_TO_SQLITE',
          sessionKey: saveSessionKey,
          agentBox: agentBox,
          gridMetadata: {
            layout: window.gridLayout,
            sessionId: window.gridSessionId,
            config: payload,
            timestamp: new Date().toISOString()
          }
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('❌ V2: chrome.runtime.sendMessage failed:', chrome.runtime.lastError);
            alert('Failed to save grid configuration: ' + chrome.runtime.lastError.message);
          } else if (response && response.success) {
            console.log('✅ V2: Save successful via background script to SQLite!');
            console.log('📦 V2: Total boxes in session:', response.totalBoxes);
            
            // Show success notification
            alert('✅ Grid configuration saved successfully!\n\nAgent Box: ' + newConfig.identifier);
            
            // Only increment nextBoxNumber for NEW boxes (not when editing existing ones)
            if (!isEditing) {
              window.nextBoxNumber++;
              console.log('📦 V2: Incremented nextBoxNumber to:', window.nextBoxNumber, '(was new box)');
            } else {
              console.log('📝 V2: Not incrementing nextBoxNumber (was editing existing box)');
            }
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
  }
  
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



