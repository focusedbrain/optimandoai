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

  // Canonical provider identity constants (mirrors src/constants/providers.ts)
  var PROVIDER_IDS = { OLLAMA:'ollama', OPENAI:'openai', ANTHROPIC:'anthropic', GEMINI:'gemini', GROK:'grok', IMAGE_AI:'image_ai' };
  var LABEL_TO_PROVIDER_ID = { 'local ai':'ollama', 'openai':'openai', 'claude':'anthropic', 'gemini':'gemini', 'grok':'grok', 'image ai':'image_ai', 'ollama':'ollama', 'anthropic':'anthropic' };
  function toProviderIdGS(label) { if (!label) return ''; return LABEL_TO_PROVIDER_ID[label.trim().toLowerCase()] || ''; }
  function toProviderLabelGS(id) { var labels = { ollama:'Local AI', openai:'OpenAI', anthropic:'Claude', gemini:'Gemini', grok:'Grok', image_ai:'Image AI' }; return labels[id] || id; }
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

    function escOpt(s) {
      return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /** Same source as WR Chat: ELECTRON_RPC llm.status → installed Ollama models */
    function fetchLocalModelNames(cb) {
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

    function fillModelSelect(modelSelect, provider, preferredModel) {
      var p = (provider || '').toLowerCase();
      if (p === 'local ai' || p === 'ollama') {
        modelSelect.innerHTML = '<option value="">Loading installed models…</option>';
        modelSelect.disabled = true;
        fetchLocalModelNames(function (names, err) {
          modelSelect.disabled = false;
          if (err) {
            modelSelect.innerHTML = '<option value="">' + escOpt('Error: ' + err) + '</option>';
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
              var e = escOpt(n);
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
          var e = escOpt(m);
          return '<option value="' + e + '">' + e + '</option>';
        })
        .join('');
      modelSelect.disabled = false;
      if (preferredModel && models.indexOf(preferredModel) >= 0) modelSelect.value = preferredModel;
      else modelSelect.value = models[0];
    }
    
    const providers = ['OpenAI', 'Claude', 'Gemini', 'Grok', 'Local AI', 'Image AI'];
    var storedProvider = cfg.provider || '';
    const currentProvider = toProviderLabelGS(storedProvider) !== storedProvider ? toProviderLabelGS(storedProvider) : storedProvider;
    var models = [];
    if (currentProvider) {
      if (currentProvider.toLowerCase() === 'local ai' || storedProvider === 'ollama') {
        models = ['__loading__'];
      } else {
        models = modelOptionsStatic(currentProvider);
      }
    }
    
    // Defensive check: ensure providers array exists
    if (!providers || !Array.isArray(providers) || providers.length === 0) {
      console.error('❌ POPUP: Providers array is invalid!', providers);
    }
    
    console.log('📋 POPUP: Providers:', providers, '| Current:', currentProvider, '| Models:', models);
    
    console.log('📋 POPUP: Form will show:', {
      title: cfg.title || ('Display Port ' + slotId),
      agent: cfg.agent ? String(cfg.agent).replace('agent', '') : '',
      provider: currentProvider,
      model: cfg.model || 'auto'
    });
    
    // Get parent session key from global config
    var parentSessionKey = (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || '';
    
    /**
     * Calculate next box number from session storage
     * This ensures chronological numbering regardless of where boxes are created
     * Checks:
     * 1. session.agentBoxes[] - All agent boxes (master tab + display grid)
     * 2. session.displayGrids[].config.slots - Backup check for display grid slots
     * Returns: The next box number (max + 1), or 1 if none exist
     */
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
        console.log('  ✓ Checked', session.agentBoxes.length, 'agent boxes, max:', maxBoxNumber);
      }
      
      // Check all display grid slots (backup check)
      if (session.displayGrids && Array.isArray(session.displayGrids)) {
        session.displayGrids.forEach(function(grid) {
          if (grid.config && grid.config.slots) {
            Object.values(grid.config.slots).forEach(function(slot) {
              var boxNum = slot.boxNumber || 0;
              if (boxNum > maxBoxNumber) maxBoxNumber = boxNum;
            });
          }
        });
        console.log('  ✓ Checked', session.displayGrids.length, 'display grids');
      }
      
      return maxBoxNumber;
    }
    
    /**
     * Try to get session directly from HTTP API (bypass background script)
     */
    function getSessionFromHttpApi(sessionKey, callback) {
      console.log('🔄 Trying direct HTTP API for session:', sessionKey);
      
      // Try multiple ports in case of port conflicts
      var ports = [51248, 51249, 51250];
      var currentPortIndex = 0;
      
      function tryNextPort() {
        if (currentPortIndex >= ports.length) {
          console.error('❌ All HTTP ports failed');
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
            console.log('✅ HTTP API success on port', port);
            callback(result.data || null);
          })
          .catch(function(err) {
            console.log('⚠️ Port', port, 'failed:', err.message);
            currentPortIndex++;
            tryNextPort();
          });
      }
      
      tryNextPort();
    }
    
    function calculateNextBoxNumber(callback) {
      console.log('🔍 calculateNextBoxNumber called, sessionKey:', parentSessionKey);
      
      if (!parentSessionKey) {
        var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined') ? window.nextBoxNumber : 1;
        console.log('⚠️ No session key, using fallback:', fallbackNumber);
        callback(fallbackNumber);
        return;
      }
      
      console.log('🔍 Calculating next box number from SQLite...');
      
      // First try via background script
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'GET_SESSION_FROM_SQLITE',
          sessionKey: parentSessionKey
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('❌ Background script error:', chrome.runtime.lastError.message);
            // Fall back to direct HTTP API
            getSessionFromHttpApi(parentSessionKey, function(session) {
              if (session) {
                var max = findMaxBoxNumber(session);
                var next = max + 1;
                console.log('✅ From HTTP API: next box number =', next);
                callback(next);
              } else {
                var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined' && window.nextBoxNumber > 1) ? window.nextBoxNumber : 1;
                console.log('⚠️ HTTP API failed, using fallback:', fallbackNumber);
                callback(fallbackNumber);
              }
            });
            return;
          }
          
          if (!response || !response.success || !response.session) {
            console.log('⚠️ No session from background, trying HTTP API...');
            // Fall back to direct HTTP API
            getSessionFromHttpApi(parentSessionKey, function(session) {
              if (session) {
                var max = findMaxBoxNumber(session);
                var next = max + 1;
                console.log('✅ From HTTP API: next box number =', next);
                callback(next);
              } else {
                var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined' && window.nextBoxNumber > 1) ? window.nextBoxNumber : 1;
                console.log('⚠️ HTTP API failed, using fallback:', fallbackNumber);
                callback(fallbackNumber);
              }
            });
            return;
          }
          
          var session = response.session;
          var max = findMaxBoxNumber(session);
          var next = max + 1;
          console.log('✅ From background script: next box number =', next, 'from max:', max);
          callback(next);
        });
      } else {
        // No chrome.runtime, try direct HTTP API
        console.log('⚠️ No chrome.runtime, trying HTTP API...');
        getSessionFromHttpApi(parentSessionKey, function(session) {
          if (session) {
            var max = findMaxBoxNumber(session);
            var next = max + 1;
            console.log('✅ From HTTP API: next box number =', next);
            callback(next);
          } else {
            var fallbackNumber = (typeof window.nextBoxNumber !== 'undefined') ? window.nextBoxNumber : 1;
            console.log('⚠️ Using window fallback:', fallbackNumber);
            callback(fallbackNumber);
          }
        });
      }
    }
    
    // Check if this is an EXISTING box (editing) or a NEW box (creating)
    // If editing, use the existing boxNumber; if creating, calculate the next one
    var existingBoxNumber = (typeof cfg.boxNumber === 'number') ? cfg.boxNumber : null;
    var isEditing = existingBoxNumber !== null;
    
    // Initialize nextBoxNumber and displayBoxNumber
    var nextBoxNumber = existingBoxNumber !== null ? existingBoxNumber : 1;
    var displayBoxNumber = existingBoxNumber !== null ? String(existingBoxNumber).padStart(2, '0') : '...';
    
    console.log('📋 POPUP: Dialog opening:', {
      isEditing: isEditing,
      existingBoxNumber: existingBoxNumber,
      displayBoxNumber: displayBoxNumber,
      cfgBoxNumber: cfg.boxNumber,
      cfgBoxNumberType: typeof cfg.boxNumber
    });
    
    dialog.innerHTML = 
      '<h3 style="margin:0;padding:16px 20px;font-size:18px;font-weight:600;color:#333;border-bottom:1px solid #eee;flex-shrink:0;">Setup Agent Box #' + slotId + '</h3>' +
      '<div style="flex:1;overflow-y:auto;overflow-x:hidden;padding:16px 20px;">' +
      
      // 🆕 Agent Box Number field
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
    
    console.log('✅ POPUP: Form HTML created');
    
    // Add dialog to overlay and overlay to document
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    console.log('✅ POPUP: Added to DOM');
    
    // Verify selects exist and recreate if missing
    setTimeout(function() {
      var providerSelect = document.getElementById('gs-provider');
      var modelSelect = document.getElementById('gs-model');
      
      if (!providerSelect || providerSelect.tagName !== 'SELECT') {
        console.error('❌ POPUP: Provider select missing or wrong type! Found:', providerSelect);
        // Try to recreate it
        var providerLabel = dialog.querySelector('label[for="gs-provider"], label:has(+ #gs-provider)');
        if (providerLabel && providerLabel.nextElementSibling) {
          var providerDiv = providerLabel.parentElement;
          var newSelect = document.createElement('select');
          newSelect.id = 'gs-provider';
          newSelect.style.cssText = 'width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;cursor:pointer;transition:border-color 0.2s';
          newSelect.innerHTML = '<option value=""' + (currentProvider ? '' : ' selected') + ' disabled>Select LLM</option>' +
            providers.map(function(p) { return '<option value="'+p+'"' + (p === currentProvider ? ' selected' : '') + '>' + p + '</option>'; }).join('');
          if (providerLabel.nextElementSibling) {
            providerLabel.nextElementSibling.replaceWith(newSelect);
          } else {
            providerLabel.parentElement.appendChild(newSelect);
          }
          console.log('✅ POPUP: Recreated provider select');
        }
      }
      
      if (!modelSelect || modelSelect.tagName !== 'SELECT') {
        console.error('❌ POPUP: Model select missing or wrong type! Found:', modelSelect);
        // Try to recreate it
        var modelLabel = dialog.querySelector('label[for="gs-model"], label:has(+ #gs-model)');
        if (modelLabel && modelLabel.nextElementSibling) {
          var modelDiv = modelLabel.parentElement;
          var newSelect = document.createElement('select');
          newSelect.id = 'gs-model';
          newSelect.style.cssText = 'width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:14px;cursor:pointer;transition:border-color 0.2s';
          if (currentProvider) {
            if (currentProvider.toLowerCase() === 'local ai' || storedProvider === 'ollama') {
              newSelect.innerHTML = '<option value="">Loading installed models…</option>';
            } else {
              var modelOpts = modelOptionsStatic(currentProvider);
              newSelect.innerHTML = modelOpts.map(function(m) {
                var esc = String(m).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                return '<option value="' + esc + '"' + ((cfg.model || '') === m ? ' selected' : '') + '>' + esc + '</option>';
              }).join('');
            }
          } else {
            newSelect.innerHTML = '<option selected disabled>Select provider first</option>';
            newSelect.disabled = true;
          }
          if (modelLabel.nextElementSibling) {
            modelLabel.nextElementSibling.replaceWith(newSelect);
          } else {
            modelLabel.parentElement.appendChild(newSelect);
          }
          console.log('✅ POPUP: Recreated model select');
        }
      } else {
        console.log('✅ POPUP: Both selects verified:', providerSelect.tagName, modelSelect.tagName);
      }
      
      // Attach provider change handler (works with original or recreated selects)
      var finalProviderSelect = document.getElementById('gs-provider');
      var finalModelSelect = document.getElementById('gs-model');
      if (finalProviderSelect) {
        finalProviderSelect.onchange = function() {
          var provider = this.value;
          var modelSelect = document.getElementById('gs-model');
          if (modelSelect) {
            fillModelSelect(modelSelect, provider, null);
            console.log('🔄 POPUP: Updated models for provider:', provider);
          }
        };
        console.log('✅ POPUP: Provider change handler attached');
      }
      if (finalModelSelect && currentProvider && (currentProvider.toLowerCase() === 'local ai' || storedProvider === 'ollama')) {
        fillModelSelect(finalModelSelect, currentProvider, cfg.model || null);
      }
      
      }, 100);
    
    // Only calculate next box number for NEW boxes (not when editing existing ones)
    if (!isEditing) {
      console.log('🆕 CREATING new box - calculating next number from SQLite...');
      calculateNextBoxNumber(function(calculatedNumber) {
        nextBoxNumber = calculatedNumber;
        displayBoxNumber = String(nextBoxNumber).padStart(2, '0');
        
        var boxNumberInput = dialog.querySelector('input[readonly]');
        if (boxNumberInput) {
          boxNumberInput.value = displayBoxNumber;
          console.log('✅ Updated box number display:', displayBoxNumber);
        }
        
        // Also update the agent number field to match box number (if not already set)
        var agentInput = document.getElementById('gs-agent');
        if (agentInput && !agentInput.value) {
          agentInput.value = String(nextBoxNumber);
          console.log('✅ Set default agent number to match box number:', nextBoxNumber);
        }
      });
    } else {
      console.log('📝 EDITING existing box - using stored boxNumber:', existingBoxNumber);
    }
    
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
          '<div style="font-weight:700">Mini App Catalog</div>'+
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
    
    // Provider change handler is now attached in the verification timeout (line ~280)

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
    
    // Delete button
    document.getElementById('gs-delete').onclick = function() {
      // Show confirmation dialog
      if (confirm('Are you sure you want to delete this agent box?')) {
        console.log('🗑️ POPUP: Deleting slot', slotId);
        
        // IMPORTANT: Save the identifier BEFORE clearing the config
        var boxIdentifier = cfg.identifier || '';
        var boxGridSessionId = cfg.gridSessionId || window.gridSessionId || 'unknown';
        var boxGridLayout = cfg.gridLayout || window.gridLayout || layout;
        
        console.log('🔍 POPUP: Box to delete:', {
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
          
          console.log('✅ POPUP: Slot display cleared');
        } catch (e) {
          console.error('❌ Error updating slot display:', e);
        }
        
        // Close dialog IMMEDIATELY (don't wait for background response)
        overlay.remove();
        console.log('✅ POPUP: Dialog closed');
        
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
            console.log('📤 Delete message sent to background with identifier:', boxIdentifier);
          } else {
            console.log('⚠️ No session key or identifier, skipping database deletion');
            console.log('   parentSessionKey:', parentSessionKey, 'identifier:', boxIdentifier);
          }
        } catch (e) {
          console.error('❌ Error sending delete message:', e);
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

    // Save button
    document.getElementById('gs-save').onclick = function() {
      var title = document.getElementById('gs-title').value || ('Display Port ' + slotId);
      var agentNum = document.getElementById('gs-agent').value;
      var providerRaw = document.getElementById('gs-provider').value;
      var provider = toProviderIdGS(providerRaw) || providerRaw;
      var model = document.getElementById('gs-model').value;
      
      var agent = agentNum ? ('agent' + agentNum) : '';
      var agentNumParsed = agent ? parseInt(agent.replace('agent', '')) : 0;
      
      // Generate locationId and locationLabel for this slot
      var gridSessionId = window.gridSessionId || 'unknown';
      var gridLayout = window.gridLayout || layout;
      var locationId = 'grid_' + gridSessionId + '_' + gridLayout + '_slot' + slotId;
      var locationLabel = gridLayout + ' Display Grid - Slot ' + slotId;
      
      // Use existingBoxNumber for edits, or nextBoxNumber for new boxes
      var effectiveBoxNumber = (existingBoxNumber !== null) ? existingBoxNumber : nextBoxNumber;
      
      console.log('💾 POPUP: Saving with boxNumber:', effectiveBoxNumber, '(isEditing:', isEditing, ')');
      
      // Build complete configuration object with all metadata
      var identifier = 'AB' + String(effectiveBoxNumber).padStart(2, '0') + String(agentNumParsed).padStart(2, '0');
      var newConfig = { 
        id: identifier,
        title: title, 
        agent: agent, 
        provider: provider, 
        model: model,
        boxNumber: effectiveBoxNumber,
        agentNumber: agentNumParsed,
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
      
      // Update slot's data attribute with complete config
      slot.setAttribute('data-slot-config', JSON.stringify(newConfig));
      
      // Update visual display (use effectiveBoxNumber)
      var agentNumForAB = agent ? agent.replace('agent', '').padStart(2, '0') : '00';
      var ab = 'AB' + String(effectiveBoxNumber).padStart(2, '0') + agentNumForAB;
      var abEl = slot.querySelector('span[style*="font-family: monospace"]');
      if (abEl) abEl.textContent = ab;
      
      var displayParts = [title];
      if (model && model !== 'auto') {
        displayParts.push(model);
      } else if (provider) {
        displayParts.push(toProviderLabelGS(provider));
      }
      var displayText = displayParts.join(' · ');
      var dispEl = slot.querySelector('.slot-display-text');
      if (dispEl) dispEl.textContent = displayText;
      
      // Get parent session key from global config
      var parentSessionKey = (window.GRID_CONFIG && window.GRID_CONFIG.sessionKey) || '';
      
      if (!parentSessionKey) {
        alert('❌ No session key found! Cannot save.');
        overlay.remove();
        return;
      }
      
      // Save agent box to SQLite (id = identifier for grid boxes, bridges the sidepanel/grid identity gap)
      var agentBox = {
        id: newConfig.identifier,
        identifier: newConfig.identifier,
        boxNumber: newConfig.boxNumber,
        agentNumber: newConfig.agentNumber,
        title: newConfig.title,
        provider: newConfig.provider,
        model: newConfig.model,
        tools: newConfig.tools || [],
        wrExperts: newConfig.wrExperts || [],
        locationId: newConfig.locationId,
        locationLabel: newConfig.locationLabel,
        source: 'display_grid',
        gridSessionId: newConfig.gridSessionId,
        gridLayout: newConfig.gridLayout,
        slotId: newConfig.slotId,
        timestamp: new Date().toISOString()
      };
      
      // Field validation
      if (!agentBox.boxNumber) {
        console.error('❌ VALIDATION ERROR: boxNumber is missing!');
        alert('❌ Error: Box number is missing. Cannot save agent box.');
        overlay.remove();
        return;
      }
      
      if (!agentBox.identifier) {
        console.error('❌ VALIDATION ERROR: identifier is missing!');
        alert('❌ Error: Identifier is missing. Cannot save agent box.');
        overlay.remove();
        return;
      }
      
      console.log('📦 DIRECT SAVE: Agent box to save:', JSON.stringify(agentBox, null, 2));
      console.log('✅ Field validation passed:', {
        hasBoxNumber: !!agentBox.boxNumber,
        hasIdentifier: !!agentBox.identifier,
        hasTitle: !!agentBox.title,
        hasSource: agentBox.source === 'display_grid',
        hasGridInfo: !!agentBox.gridSessionId && !!agentBox.gridLayout
      });
      
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
      
      // Save via background script to SQLite
      console.log('💾 Saving via background script to SQLite...');
      chrome.runtime.sendMessage({
        type: 'SAVE_AGENT_BOX_TO_SQLITE',
        sessionKey: parentSessionKey,
        agentBox: agentBox,
        gridMetadata: {
          layout: window.gridLayout,
          sessionId: window.gridSessionId,
          config: payload,
          timestamp: new Date().toISOString()
        }
      }, function(response) {
        if (chrome.runtime.lastError) {
          console.error('❌ SQLITE SAVE: Chrome runtime error:', chrome.runtime.lastError.message);
          // Don't show popup - just log and close dialog
          overlay.remove();
          return;
        }
        
        if (!response || !response.success) {
          console.error('❌ SQLITE SAVE: Failed:', response ? response.error : 'No response');
          // Don't show popup - just log and close dialog
          overlay.remove();
          return;
        }
        
        console.log('✅ SQLITE SAVE: Success! Agent box saved to SQLite.');
        console.log('📦 Saved agent box:', agentBox.identifier, '| Total boxes in session:', response.totalBoxes);
        
        // ✅ Only increment nextBoxNumber for NEW boxes (not when editing)
        if (!isEditing) {
          window.nextBoxNumber++;
          console.log('📦 Incremented nextBoxNumber to:', window.nextBoxNumber, '(was new box)');
        } else {
          console.log('📝 Not incrementing nextBoxNumber (was editing existing box)');
        }
        
        // Close dialog silently (no popup needed)
        overlay.remove();
      });
      
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
            
            // ✅ Only increment nextBoxNumber for NEW boxes (not when editing)
            if (!isEditing) {
              window.nextBoxNumber++;
              console.log('📦 Incremented nextBoxNumber to:', window.nextBoxNumber, '(was new box)');
            } else {
              console.log('📝 Not incrementing nextBoxNumber (was editing existing box)');
            }
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
              
              // ✅ Only increment nextBoxNumber for NEW boxes (not when editing)
              if (!isEditing) {
                window.nextBoxNumber++;
                console.log('📦 Incremented nextBoxNumber to:', window.nextBoxNumber, '(was new box)');
              } else {
                console.log('📝 Not incrementing nextBoxNumber (was editing existing box)');
              }
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
                
                // ✅ Only increment nextBoxNumber for NEW boxes (not when editing)
                if (!isEditing) {
                  window.nextBoxNumber++;
                  console.log('📦 Incremented nextBoxNumber to:', window.nextBoxNumber, '(was new box)');
                } else {
                  console.log('📝 Not incrementing nextBoxNumber (was editing existing box)');
                }
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
        '<div style="font-weight:700">Mini App Catalog</div>' +
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
      
      if (!slotId) {
        console.warn('⚠️ Edit button found without slot ID');
        return;
      }
      
      // Add click listener directly
      btn.addEventListener('click', function(e) {
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
    attachToggleListeners();
  }, 200);
  
  // Also expose the function globally in case we need to reattach
  window.attachEditButtonListeners = attachEditButtonListeners;
  
  // Function to attach toggle listeners
  function attachToggleListeners() {
    console.log('🔄 Attaching toggle listeners...');
    
    // Master toggle for entire grid
    var masterToggle = document.getElementById('master-grid-toggle');
    if (masterToggle) {
      var masterCheckbox = masterToggle.querySelector('input[type="checkbox"]');
      var masterSlider = masterToggle.querySelectorAll('span')[0];
      var masterKnob = masterToggle.querySelectorAll('span')[1];
      
      masterToggle.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        masterCheckbox.checked = !masterCheckbox.checked;
        var isEnabled = masterCheckbox.checked;
        
        // Update visual state
        masterSlider.style.backgroundColor = isEnabled ? '#4CAF50' : '#ccc';
        masterKnob.style.left = isEnabled ? '23px' : '3px';
        
        // Toggle all slot toggles
        document.querySelectorAll('.slot-toggle').forEach(function(toggle) {
          var checkbox = toggle.querySelector('input[type="checkbox"]');
          var slider = toggle.querySelectorAll('span')[0];
          var knob = toggle.querySelectorAll('span')[1];
          var slotId = toggle.getAttribute('data-slot-id');
          
          checkbox.checked = isEnabled;
          slider.style.backgroundColor = isEnabled ? '#4CAF50' : '#ccc';
          knob.style.left = isEnabled ? '17px' : '3px';
          
          // Update slot visual state
          var slot = document.querySelector('[data-slot-id="' + slotId + '"]');
          if (slot) {
            var content = slot.querySelector('.slot-content-area');
            if (content) {
              content.style.opacity = isEnabled ? '1' : '0.5';
              content.style.pointerEvents = isEnabled ? 'auto' : 'none';
            }
          }
        });
        
        console.log('✅ Master toggle: All slots ' + (isEnabled ? 'enabled' : 'disabled'));
      });
    }
    
    // Individual slot toggles
    document.querySelectorAll('.slot-toggle').forEach(function(toggle) {
      var checkbox = toggle.querySelector('input[type="checkbox"]');
      var slider = toggle.querySelectorAll('span')[0];
      var knob = toggle.querySelectorAll('span')[1];
      var slotId = toggle.getAttribute('data-slot-id');
      
      if (!slotId) {
        console.warn('⚠️ Toggle found without slot ID');
        return;
      }
      
      toggle.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        checkbox.checked = !checkbox.checked;
        var isEnabled = checkbox.checked;
        
        // Update visual state
        slider.style.backgroundColor = isEnabled ? '#4CAF50' : '#ccc';
        knob.style.left = isEnabled ? '17px' : '3px';
        
        // Update slot content visual state
        var slot = document.querySelector('[data-slot-id="' + slotId + '"]');
        if (slot) {
          var content = slot.querySelector('.slot-content-area');
          if (content) {
            content.style.opacity = isEnabled ? '1' : '0.5';
            content.style.pointerEvents = isEnabled ? 'auto' : 'none';
          }
        }
        
        console.log('✅ Slot ' + slotId + ' toggle: ' + (isEnabled ? 'enabled' : 'disabled'));
      });
    });
    
    console.log('✅ Toggle listeners attached');
  }
  
  window.attachToggleListeners = attachToggleListeners;

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

  // Listen for live output updates from the runtime pipeline
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function(message) {
      if (message.type === 'UPDATE_AGENT_BOX_OUTPUT' && message.data) {
        var boxId = message.data.agentBoxId;
        var output = message.data.output;
        console.log('[GridScript] Received UPDATE_AGENT_BOX_OUTPUT for:', boxId);

        // Find the matching grid slot by checking each slot's config
        var slots = document.querySelectorAll('[data-slot-id]');
        slots.forEach(function(slot) {
          var configStr = slot.getAttribute('data-slot-config');
          if (!configStr) return;
          try {
            var cfg = JSON.parse(configStr);
            if (cfg.id === boxId || cfg.identifier === boxId) {
              // Found the target slot - update its content area
              var contentDiv = slot.children[1]; // second child is the content div
              if (contentDiv) {
                contentDiv.style.alignItems = 'flex-start';
                contentDiv.style.justifyContent = 'flex-start';
                contentDiv.style.overflow = 'auto';
                contentDiv.innerHTML = '<div style="word-break: break-word; width: 100%; font-size: 13px; line-height: 1.5;">' +
                  renderMarkdown(output) + '</div>';
                console.log('[GridScript] Updated output in slot', slot.getAttribute('data-slot-id'));
              }
            }
          } catch (e) {
            // Ignore JSON parse errors for unconfigured slots
          }
        });
      }
    });
    console.log('✅ Grid output listener registered');
  }
  
  console.log('✅ All grid functions loaded and available');
}
