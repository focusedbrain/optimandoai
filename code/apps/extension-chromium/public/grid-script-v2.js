// Grid functionality V2 for display grids - WITH AGENT BOX NUMBER DISPLAY
// Prevent script from running multiple times
if (window.gridScriptV2Loaded) {
} else {
  window.gridScriptV2Loaded = true;
  
  // Get data from global variables (set by grid-display-v2.html)
  var sessionId = window.gridSessionId || window.sessionId || 'unknown';
  var layout = window.gridLayout || window.layout || 'unknown';
  var parentSessionKey = window.sessionKey || (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || '';
  var nextBoxNumber = window.nextBoxNumber || 1;
  
  document.title = 'AI Grid V2 - ' + layout.toUpperCase();

  // Canonical provider identity constants (mirrors src/constants/providers.ts)
  var PROVIDER_IDS = { OLLAMA:'ollama', OPENAI:'openai', ANTHROPIC:'anthropic', GEMINI:'gemini', GROK:'grok', IMAGE_AI:'image_ai' };
  var LABEL_TO_PROVIDER_ID = { 'local ai':'ollama', 'openai':'openai', 'claude':'anthropic', 'gemini':'gemini', 'grok':'grok', 'image ai':'image_ai', 'ollama':'ollama', 'anthropic':'anthropic' };
  function toProviderIdV2(label) { if (!label) return ''; return LABEL_TO_PROVIDER_ID[label.trim().toLowerCase()] || ''; }
  function toProviderLabelV2(id) { var labels = { ollama:'Local AI', openai:'OpenAI', anthropic:'Claude', gemini:'Gemini', grok:'Grok', image_ai:'Image AI' }; return labels[id] || id; }
  
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
          callback(result.data || null);
        })
        .catch(function(err) {
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
    
    
    if (!currentSessionKey) {
      var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined') ? window.nextBoxNumber : 1;
      callback(fallbackNumber);
      return;
    }
    
    
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
              callback(next);
            } else {
              var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined' && window.nextBoxNumber > 1) ? window.nextBoxNumber : 1;
              callback(fallbackNumber);
            }
          });
          return;
        }
        
        if (!response || !response.success || !response.session) {
          // Fall back to direct HTTP API
          getSessionFromHttpApi(currentSessionKey, function(session) {
            if (session) {
              var max = findMaxBoxNumber(session);
              var next = max + 1;
              callback(next);
            } else {
              var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined' && window.nextBoxNumber > 1) ? window.nextBoxNumber : 1;
              callback(fallbackNumber);
            }
          });
          return;
        }
        
        var session = response.session;
        var max = findMaxBoxNumber(session);
        var next = max + 1;
        callback(next);
      });
    } else {
      // No chrome.runtime, try direct HTTP API
      getSessionFromHttpApi(currentSessionKey, function(session) {
        if (session) {
          var max = findMaxBoxNumber(session);
          var next = max + 1;
          callback(next);
        } else {
          var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined') ? window.nextBoxNumber : 1;
          callback(fallbackNumber);
        }
      });
    }
  }
  
  // Define openGridSlotEditor function immediately
  window.openGridSlotEditor = function(slotId) {
    const slot = document.querySelector('[data-slot-id="' + slotId + '"]');
    if (!slot) {
      console.error('❌ POPUP V2: No slot found with id:', slotId);
      return;
    }
    
    const configStr = slot.getAttribute('data-slot-config') || '{}';
    let cfg = {};
    try { 
      cfg = JSON.parse(configStr);
    } catch(e) { 
      console.error('❌ POPUP V2: Failed to parse config:', e);
      cfg = {};
    }
    
    // Check if this is an EXISTING box (editing) or a NEW box (creating)
    var existingBoxNumber = (typeof cfg.boxNumber === 'number') ? cfg.boxNumber : null;
    var isEditing = existingBoxNumber !== null;
    
    // CRITICAL DEBUG: Show current state
    var debugSessionKey = getCurrentSessionKey();
    
    if (!debugSessionKey) {
      alert('ERROR: No session key! Cannot calculate box number correctly.\n\nwindow.sessionKey: ' + window.sessionKey + '\nwindow.GRID_CONFIG: ' + JSON.stringify(window.GRID_CONFIG));
    }
    
    // For new boxes, calculate the next box number from SQLite
    if (!isEditing) {
      calculateNextBoxNumber(function(calculatedNumber) {
        nextBoxNumber = calculatedNumber;
        showV2Dialog(slotId, slot, cfg, calculatedNumber, false);
      });
    } else {
      showV2Dialog(slotId, slot, cfg, existingBoxNumber, true);
    }
  };
  
  // Helper function to show the dialog
  function showV2Dialog(slotId, slot, cfg, effectiveBoxNumber, isEditing) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:10px;max-width:520px;width:92%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-height:90vh;display:flex;flex-direction:column;';
    
    function modelOptionsStatic(p) {
      p = (p || '').toLowerCase();
      if (p === 'openai') return ['auto', 'gpt-4o-mini', 'gpt-4o'];
      if (p === 'claude') return ['auto', 'claude-3-5-sonnet', 'claude-3-opus'];
      if (p === 'gemini') return ['auto', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      if (p === 'grok') return ['auto', 'grok-2-mini', 'grok-2'];
      if (p === 'image ai') return ['Nano Banana Pro', 'DALL·E 3', 'DALL·E 2', 'Flux Schnell', 'Flux Dev', 'SDXL', 'SD3 Medium', 'Stable Diffusion XL'];
      return ['auto'];
    }
    function escOptV2(s) {
      return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function fetchLocalModelNamesV2(cb) {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        cb([], 'Extension runtime unavailable');
        return;
      }
      chrome.runtime.sendMessage({ type: 'ELECTRON_RPC', method: 'llm.status', timeout: 20000 }, function (result) {
        if (chrome.runtime.lastError) {
          cb([], chrome.runtime.lastError.message);
          return;
        }
        if (!result || !result.success) {
          cb([], (result && result.error) || 'LLM status failed');
          return;
        }
        var body = result.data;
        var status = body && body.data !== undefined ? body.data : body;
        if (!status || !status.installed || !status.running) {
          cb([], null);
          return;
        }
        var list = status.modelsInstalled || [];
        var names = list.map(function (m) { return m && m.name; }).filter(Boolean);
        cb(names, null);
      });
    }
    function fillModelSelectV2(modelSelect, provider, preferredModel) {
      var p = (provider || '').toLowerCase();
      if (p === 'local ai' || p === 'ollama') {
        modelSelect.innerHTML = '<option value="">Loading installed models…</option>';
        modelSelect.disabled = true;
        fetchLocalModelNamesV2(function (names, err) {
          modelSelect.disabled = false;
          if (err) {
            modelSelect.innerHTML = '<option value="">' + escOptV2('Error: ' + err) + '</option>';
            return;
          }
          if (!names.length) {
            modelSelect.innerHTML =
              '<option value="">No local models installed (use LLM Settings)</option>' +
              '<option value="auto">auto</option>';
            modelSelect.value = 'auto';
            return;
          }
          var opts = ['<option value="auto">auto</option>'].concat(
            names.map(function (n) {
              var e = escOptV2(n);
              return '<option value="' + e + '">' + e + '</option>';
            })
          );
          modelSelect.innerHTML = opts.join('');
          var pref = preferredModel && names.indexOf(preferredModel) >= 0 ? preferredModel : names[0];
          if (preferredModel === 'auto') modelSelect.value = 'auto';
          else modelSelect.value = pref;
        });
        return;
      }
      var models = modelOptionsStatic(provider);
      modelSelect.innerHTML = models
        .map(function (m) {
          var e = escOptV2(m);
          return '<option value="' + e + '">' + e + '</option>';
        })
        .join('');
      modelSelect.disabled = false;
      if (preferredModel && models.indexOf(preferredModel) >= 0) modelSelect.value = preferredModel;
      else modelSelect.value = models[0];
    }

    var providers = ['OpenAI', 'Claude', 'Gemini', 'Grok', 'Local AI', 'Image AI'];
    var storedProvider = cfg.provider || '';
    var currentProvider = toProviderLabelV2(storedProvider) !== storedProvider ? toProviderLabelV2(storedProvider) : storedProvider;
    var displayBoxNumber = String(effectiveBoxNumber).padStart(2, '0');
    var models = [];
    if (currentProvider) {
      if (currentProvider.toLowerCase() === 'local ai' || storedProvider === 'ollama') {
        models = ['__loading__'];
      } else {
        models = modelOptionsStatic(currentProvider);
      }
    }

    
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
            (models[0] === '__loading__'
              ? '<option value="">Loading installed models…</option>'
              : models.map(function(m) {
                  var esc = String(m).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                  return '<option value="' + esc + '"' + ((cfg.model || '') === m ? ' selected' : '') + '>' + esc + '</option>';
                }).join(''))
            : '<option selected disabled>Select provider first</option>') +
        '</select>' +
      '</div>' +
      '<div style="margin:4px 0 12px 0;">' +
        '<button id="gs-finetune" style="background:transparent;border:0;color:#2563eb;text-decoration:underline;cursor:pointer;padding:0;font-size:12px">Finetune Model</button>' +
        '<div id="gs-finetune-fb" style="display:none;margin-top:6px;background:#fee2e2;color:#b91c1c;padding:6px 8px;border-radius:6px;font-size:12px">Finetuning is not available for this Model</div>' +
      '</div>' +
      '<div style="margin-top:12px;margin-bottom:14px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">' +
        '<div id="gs-experts-header" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8fafc;cursor:pointer;user-select:none">' +
          '<span style="font-weight:600;color:#334155;font-size:13px">📚 WR Experts <span style="font-weight:400;color:#94a3b8;font-size:11px">(agent-level knowledge)</span></span>' +
          '<span id="gs-experts-toggle" style="font-size:11px;color:#64748b">▼</span>' +
        '</div>' +
        '<div id="gs-experts-body" style="display:none;padding:12px;border-top:1px solid #e2e8f0">' +
          '<div id="gs-experts-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px"></div>' +
          '<button id="gs-add-expert" style="background:#eff6ff;border:1px solid #93c5fd;color:#2563eb;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">+ Add WR Expert</button>' +
          '<div style="font-size:11px;color:#94a3b8;margin-top:6px">Text-only reusable expert knowledge attached to this agent.</div>' +
        '</div>' +
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
    
    
    // Add dialog to overlay and overlay to document
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // Set default agent number to match box number (if not already set)
    setTimeout(function() {
      var agentInput = document.getElementById('gs-agent');
      if (agentInput && !agentInput.value) {
        agentInput.value = String(nextBoxNumber);
      }
    }, 50);
    
    
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
      }
    }, 0);
    
    // Handle provider change to update models
    document.getElementById('gs-provider').onchange = function() {
      var provider = this.value;
      var modelSelect = document.getElementById('gs-model');
      fillModelSelectV2(modelSelect, provider, null);
    };
    setTimeout(function() {
      var ms = document.getElementById('gs-model');
      if (ms && currentProvider && (currentProvider.toLowerCase() === 'local ai' || storedProvider === 'ollama')) {
        fillModelSelectV2(ms, currentProvider, cfg.model || null);
      }
    }, 0);
    
    // Finetune feedback
    document.getElementById('gs-finetune').onclick = function(){
      var fb = document.getElementById('gs-finetune-fb');
      if (!fb) return; fb.style.display = 'block'; fb.style.opacity = '1';
      setTimeout(function(){ fb.style.opacity = '0'; setTimeout(function(){ fb.style.display = 'none' }, 300) }, 2000);
    };
    
    // Cancel button
    document.getElementById('gs-cancel').onclick = function() {
      overlay.remove();
    };
    
    // Delete button
    document.getElementById('gs-delete').onclick = function() {
      // Show confirmation dialog
      if (confirm('Are you sure you want to delete this agent box?')) {
        
        // IMPORTANT: Save the identifier BEFORE clearing the config
        var boxIdentifier = cfg.identifier || '';
        var boxGridSessionId = cfg.gridSessionId || window.gridSessionId || 'unknown';
        var boxGridLayout = cfg.gridLayout || window.gridLayout || layout;
        
        
        // Clear the slot's data attribute with empty config
        try {
          slot.setAttribute('data-slot-config', JSON.stringify({}));
          
          // Update visual display to empty state
          var abEl = slot.querySelector('span[style*="font-family: monospace"]');
          if (abEl) abEl.textContent = '';
          
          var dispEl = slot.querySelector('.slot-display-text');
          if (dispEl) dispEl.textContent = '';
          
        } catch (e) {
          console.error('❌ V2 Error updating slot display:', e);
        }
        
        // Close dialog IMMEDIATELY (don't wait for background response)
        overlay.remove();
        
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
          } else {
          }
        } catch (e) {
          console.error('❌ V2 Error sending delete message:', e);
        }
      }
    };
    
    // WR Experts toggle
    var expertsHeader = document.getElementById('gs-experts-header');
    var expertsBody = document.getElementById('gs-experts-body');
    var expertsToggle = document.getElementById('gs-experts-toggle');
    if (expertsHeader) {
      expertsHeader.onclick = function() {
        var isOpen = expertsBody.style.display !== 'none';
        expertsBody.style.display = isOpen ? 'none' : 'block';
        expertsToggle.textContent = isOpen ? '▼' : '▲';
      };
    }
    
    // WR Experts state
    var wrExperts = (cfg.wrExperts || []).slice();
    
    function renderExpertsList() {
      var list = document.getElementById('gs-experts-list');
      if (!list) return;
      list.innerHTML = '';
      wrExperts.forEach(function(expert, idx) {
        var row = document.createElement('div');
        row.style.cssText = 'padding:8px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:8px';
        row.innerHTML = '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:12px;color:#334155">' + (expert.name || 'Untitled') + '</div>' +
          (expert.description ? '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' + expert.description.substring(0, 60) + '</div>' : '') +
          '<div style="font-size:10px;color:#cbd5e1;margin-top:2px">' + (expert.content || '').length + ' chars</div></div>' +
          '<div style="display:flex;gap:4px;flex-shrink:0">' +
            '<button class="gs-edit-expert" data-idx="' + idx + '" style="background:#eff6ff;border:1px solid #93c5fd;color:#2563eb;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px">Edit</button>' +
            '<button class="gs-del-expert" data-idx="' + idx + '" style="background:#fef2f2;border:1px solid #fca5a5;color:#dc2626;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px">×</button>' +
          '</div>';
        list.appendChild(row);
      });
      list.querySelectorAll('.gs-edit-expert').forEach(function(btn) {
        btn.onclick = function() { openExpertEditor(parseInt(btn.dataset.idx)); };
      });
      list.querySelectorAll('.gs-del-expert').forEach(function(btn) {
        btn.onclick = function() { wrExperts.splice(parseInt(btn.dataset.idx), 1); renderExpertsList(); };
      });
    }
    
    function openExpertEditor(idx) {
      var isNew = idx === -1;
      var expert = isNew ? { id: 'expert-' + Date.now(), name: '', content: '', description: '' } : wrExperts[idx];
      var editorOverlay = document.createElement('div');
      editorOverlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:100001;display:flex;align-items:center;justify-content:center';
      editorOverlay.innerHTML = '<div style="background:#fff;border-radius:12px;width:90%;max-width:500px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 40px rgba(0,0,0,0.2)">' +
        '<h4 style="margin:0;padding:14px 16px;border-bottom:1px solid #eee;font-size:15px;color:#333">' + (isNew ? 'Add WR Expert' : 'Edit WR Expert') + '</h4>' +
        '<div style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px">' +
          '<div><label style="display:block;font-weight:600;font-size:12px;color:#444;margin-bottom:4px">Name</label>' +
            '<input id="gs-expert-name" type="text" value="' + (expert.name || '').replace(/"/g, '&quot;') + '" placeholder="e.g. Invoice Rules" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px"></div>' +
          '<div><label style="display:block;font-weight:600;font-size:12px;color:#444;margin-bottom:4px">Description (optional)</label>' +
            '<input id="gs-expert-desc" type="text" value="' + (expert.description || '').replace(/"/g, '&quot;') + '" placeholder="Brief description" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px"></div>' +
          '<div><label style="display:block;font-weight:600;font-size:12px;color:#444;margin-bottom:4px">Content (text only)</label>' +
            '<textarea id="gs-expert-content" placeholder="Enter expert knowledge as plain text..." style="width:100%;min-height:150px;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;resize:vertical">' + (expert.content || '').replace(/</g, '&lt;') + '</textarea></div>' +
        '</div>' +
        '<div style="padding:12px 16px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px">' +
          '<button id="gs-expert-cancel" style="padding:8px 16px;background:#f0f0f0;border:none;border-radius:6px;cursor:pointer;font-size:13px">Cancel</button>' +
          '<button id="gs-expert-ok" style="padding:8px 16px;background:#2196F3;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">Save Expert</button>' +
        '</div></div>';
      document.body.appendChild(editorOverlay);
      editorOverlay.querySelector('#gs-expert-cancel').onclick = function() { editorOverlay.remove(); };
      editorOverlay.querySelector('#gs-expert-ok').onclick = function() {
        var name = editorOverlay.querySelector('#gs-expert-name').value.trim();
        var content = editorOverlay.querySelector('#gs-expert-content').value.trim();
        if (!name) { alert('Name is required'); return; }
        if (!content) { alert('Content is required (text only)'); return; }
        var updated = { id: expert.id, name: name, content: content, description: editorOverlay.querySelector('#gs-expert-desc').value.trim(), updatedAt: new Date().toISOString() };
        if (!updated.createdAt) updated.createdAt = expert.createdAt || new Date().toISOString();
        if (isNew) { wrExperts.push(updated); } else { wrExperts[idx] = updated; }
        renderExpertsList();
        editorOverlay.remove();
      };
    }
    
    var addExpertBtn = document.getElementById('gs-add-expert');
    if (addExpertBtn) { addExpertBtn.onclick = function() { openExpertEditor(-1); }; }
    renderExpertsList();

    // Save with chrome.runtime.sendMessage to background script
    document.getElementById('gs-save').onclick = function() {
      var title = document.getElementById('gs-title').value || ('Display Port ' + slotId);
      var agentNum = document.getElementById('gs-agent').value;
      var providerRaw = document.getElementById('gs-provider').value;
      var provider = toProviderIdV2(providerRaw) || providerRaw;
      var model = document.getElementById('gs-model').value;
      
      var agent = agentNum ? ('agent' + agentNum) : '';
      
      // Use effectiveBoxNumber (existing for edits, new for creates)
      
      // Generate locationId and locationLabel for this slot
      var gridSessionId = window.gridSessionId || 'unknown';
      var gridLayout = window.gridLayout || 'unknown';
      var locationId = 'grid_' + gridSessionId + '_' + gridLayout + '_slot' + slotId;
      var locationLabel = gridLayout + ' Display Grid - Slot ' + slotId;
      
      // Include box number and location in config (use effectiveBoxNumber)
      var identifier = 'AB' + String(effectiveBoxNumber).padStart(2, '0') + (agentNum ? String(agentNum).padStart(2, '0') : '00');
      var newConfig = { 
        id: identifier,
        title: title, 
        agent: agent, 
        provider: provider, 
        model: model,
        boxNumber: effectiveBoxNumber,
        agentNumber: agentNum ? parseInt(agentNum) : 0,
        identifier: identifier,
        tools: (cfg.tools || []),
        wrExperts: wrExperts,
        locationId: locationId,
        locationLabel: locationLabel,
        gridSessionId: gridSessionId,
        gridLayout: gridLayout,
        slotId: slotId,
        source: 'display_grid'
      };
      
      // Create full agent box object for SQLite storage (id = identifier for grid boxes)
      var agentBox = {
        id: newConfig.identifier,
        identifier: newConfig.identifier,
        boxNumber: newConfig.boxNumber,
        title: newConfig.title,
        agentNumber: newConfig.agentNumber,
        provider: newConfig.provider || 'auto',
        model: newConfig.model || 'auto',
        tools: newConfig.tools || [],
        wrExperts: newConfig.wrExperts || [],
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
        parts.push(toProviderLabelV2(provider));
      }
      var disp = parts.join(' · ');
      var dispEl = slot.querySelector('.slot-display-text');
      if (dispEl) dispEl.textContent = disp;
      
      
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
      
      
      // 🆕 KEY FIX: Use SAVE_AGENT_BOX_TO_SQLITE instead of GRID_SAVE
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        // Get session key DYNAMICALLY (fixes timing issue)
        var saveSessionKey = getCurrentSessionKey();
        
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
            
            // Show success notification
            alert('✅ Grid configuration saved successfully!\n\nAgent Box: ' + newConfig.identifier);
            
            // Only increment nextBoxNumber for NEW boxes (not when editing existing ones)
            if (!isEditing) {
              window.nextBoxNumber++;
            } else {
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
    };
  }
  

  // Fullscreen functionality
  function toggleFullscreen() {
    
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
    }
  }
  
  window.toggleFullscreen = toggleFullscreen;

  // Minimal markdown-to-HTML renderer for agent box output
  function renderMarkdown(text) {
    var escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var lines = escaped.split('\n');
    var html = '';
    var inCodeBlock = false;
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          if (inList) { html += '</ul>'; inList = false; }
          html += '<pre style="background:rgba(0,0,0,.12);padding:8px;border-radius:4px;overflow-x:auto;font-size:12px;margin:6px 0"><code>';
          inCodeBlock = true;
        } else {
          html += '</code></pre>';
          inCodeBlock = false;
        }
        continue;
      }
      if (inCodeBlock) { html += line + '\n'; continue; }
      if (line.startsWith('### ')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h3 style="margin:10px 0 4px;font-size:14px;font-weight:700">' + line.slice(4) + '</h3>';
      } else if (line.startsWith('## ')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h2 style="margin:12px 0 4px;font-size:15px;font-weight:700">' + line.slice(3) + '</h2>';
      } else if (line.startsWith('# ')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<h1 style="margin:12px 0 6px;font-size:16px;font-weight:700">' + line.slice(2) + '</h1>';
      } else if (/^[-*] /.test(line)) {
        if (!inList) { html += '<ul style="margin:4px 0;padding-left:18px">'; inList = true; }
        html += '<li style="margin:2px 0">' + inlineMarkdown(line.slice(2)) + '</li>';
      } else if (/^\d+\. /.test(line)) {
        if (!inList) { html += '<ol style="margin:4px 0;padding-left:18px">'; inList = true; }
        html += '<li style="margin:2px 0">' + inlineMarkdown(line.replace(/^\d+\. /, '')) + '</li>';
      } else if (line.startsWith('---') || line.startsWith('***')) {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<hr style="border:none;border-top:1px solid rgba(0,0,0,.15);margin:8px 0">';
      } else if (line.trim() === '') {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<br>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p style="margin:3px 0;line-height:1.5">' + inlineMarkdown(line) + '</p>';
      }
    }
    if (inList) html += '</ul>';
    if (inCodeBlock) html += '</code></pre>';
    return html;
  }

  function inlineMarkdown(text) {
    return text
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,.1);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
  }

  function getGridSessionKeyForClearV2() {
    return window.sessionKey || (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || parentSessionKey || '';
  }

  function gridSlotEmptyPlaceholderHtmlV2(cfg) {
    var agent = cfg.agent || '';
    return '<div style="opacity: 0.6;">' + (agent ? 'Configured ✓' : 'Click ✏️ to configure') + '</div>';
  }

  document.addEventListener('click', function(ev) {
    var t = ev.target;
    if (!t || !t.classList || !t.classList.contains('clear-slot-output')) return;
    ev.preventDefault();
    ev.stopPropagation();
    var slot = t.closest && t.closest('[data-slot-config]');
    if (!slot) return;
    var cfgStr = slot.getAttribute('data-slot-config');
    if (!cfgStr) return;
    try {
      var cfg = JSON.parse(cfgStr);
      var boxId = cfg.id || cfg.identifier;
      if (!boxId) return;
      var sk = getGridSessionKeyForClearV2();
      if (!sk || typeof chrome === 'undefined' || !chrome.runtime) return;
      chrome.runtime.sendMessage({
        type: 'UPDATE_BOX_OUTPUT_SQLITE',
        sessionKey: sk,
        agentBoxId: boxId,
        output: ''
      }, function(response) {
        if (chrome.runtime.lastError || !response || !response.success) return;
        var contentDiv = slot.children[1];
        if (contentDiv) {
          contentDiv.style.alignItems = 'center';
          contentDiv.style.justifyContent = 'center';
          contentDiv.style.overflow = 'visible';
          contentDiv.innerHTML = gridSlotEmptyPlaceholderHtmlV2(cfg);
        }
      });
    } catch (e) {}
  });

  // Listen for live output updates from the runtime pipeline
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function(message) {
      if (message.type === 'UPDATE_AGENT_BOX_OUTPUT' && message.data) {
        var boxId = message.data.agentBoxId;
        var boxUuid = message.data.agentBoxUuid || boxId;
        var output = message.data.output;

        var slots = document.querySelectorAll('[data-slot-id]');
        slots.forEach(function(slot) {
          var configStr = slot.getAttribute('data-slot-config');
          if (!configStr) return;
          try {
            var cfg = JSON.parse(configStr);
            if (cfg.id === boxId || cfg.identifier === boxId || cfg.id === boxUuid || cfg.identifier === boxUuid) {
              var contentDiv = slot.children[1];
              if (contentDiv) {
                if (output === undefined || output === null || output === '') {
                  contentDiv.style.alignItems = 'center';
                  contentDiv.style.justifyContent = 'center';
                  contentDiv.style.overflow = 'visible';
                  contentDiv.innerHTML = gridSlotEmptyPlaceholderHtmlV2(cfg);
                } else {
                  contentDiv.style.alignItems = 'flex-start';
                  contentDiv.style.justifyContent = 'flex-start';
                  contentDiv.style.overflow = 'auto';
                  contentDiv.innerHTML = '<div style="word-break: break-word; width: 100%; font-size: 13px; line-height: 1.5;">' +
                    renderMarkdown(output) + '</div>';
                }
              }
            }
          } catch (e) {
            // Ignore JSON parse errors for unconfigured slots
          }
        });
      }
    });
  }
  
}



