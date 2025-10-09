// Grid Display Script - Handles grid rendering and initialization

console.log('🚀 Grid Display Script loaded');

// Wrap in IIFE to avoid global scope pollution
(function() {
    // Get URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const layout = urlParams.get('layout') || '4-slot';
    const sessionId = urlParams.get('session') || 'default';
    const theme = urlParams.get('theme') || 'default';
    const sessionKey = urlParams.get('sessionKey') || '';
    const nextBoxNumber = parseInt(urlParams.get('nextBoxNumber') || '1', 10);

    console.log('🎯 Grid Display starting:', { layout, sessionId, theme, sessionKey, nextBoxNumber });

    // Store globals for grid-script.js to read (set BEFORE grid-script.js executes)
    window.GRID_CONFIG = {
        layout: layout,
        sessionId: sessionId,
        theme: theme,
        sessionKey: sessionKey,
        nextBoxNumber: nextBoxNumber
    };
    
    console.log('✅ Set GRID_CONFIG for grid-script.js:', window.GRID_CONFIG);

// Layout configurations
const layouts = {
    '2-slot': { slots: 2 },
    '3-slot': { slots: 3 },
    '4-slot': { slots: 4 },
    '5-slot': { slots: 5 },
    '6-slot': { slots: 6 },
    '7-slot': { slots: 7 },
    '8-slot': { slots: 8 },
    '9-slot': { slots: 9 },
    '10-slot': { slots: 10 }
};

const config = layouts[layout] || layouts['4-slot'];

// Theme configuration
let bodyBg = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
let bodyText = '#ffffff';
let headerColor = '#667eea';
let textColor = 'white';
let slotBg = 'white';

if (theme === 'dark') {
    bodyBg = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    bodyText = '#e5e7eb';
    headerColor = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    textColor = '#e5e7eb';
    slotBg = 'rgba(255,255,255,0.06)';
} else if (theme === 'professional') {
    bodyBg = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)';
    bodyText = '#333333';
    headerColor = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)';
    textColor = '#1e293b';
    slotBg = 'white';
}

// Apply theme to body
document.body.style.background = bodyBg;
document.body.style.color = bodyText;

// Create grid container
const container = document.getElementById('grid-root');
const gridDiv = document.createElement('div');
gridDiv.className = 'grid-container layout-' + layout;

// ✅ AUTO-LOAD: Load configurations FIRST by locationId, then create slots with data
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local && sessionKey) {
    chrome.storage.local.get([sessionKey], function(result) {
        console.log('📦 AUTO-LOAD: Loaded session from storage:', result);
        const session = result[sessionKey] || {};
        
        // Build savedSlots object by locationId matching this grid
        const savedSlotsByLocation = {};
        
        if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
            console.log('🔍 AUTO-LOAD: Found', session.agentBoxes.length, 'agent boxes in session');
            
            // Filter boxes that belong to this grid by locationId
            session.agentBoxes.forEach(box => {
                if (box.locationId && box.locationId.startsWith('grid_' + sessionId + '_' + layout)) {
                    // Extract slot ID from locationId (e.g., "grid_123_3-slot_slot7" -> "7")
                    const match = box.locationId.match(/_slot(\d+)$/)
                    if (match) {
                        const slotId = match[1]
                        savedSlotsByLocation[slotId] = box
                        console.log('✅ AUTO-LOAD: Mapped slot', slotId, 'to config:', box.title)
                    }
                }
            })
        }
        
        console.log('📋 AUTO-LOAD: Saved slots by location:', savedSlotsByLocation)
        
        // Now create slots WITH the saved data
        createSlots(config.slots, savedSlotsByLocation)
    });
} else {
    // No storage available, create empty slots
    createSlots(config.slots, {});
}

    function createSlots(slotCount, savedSlots) {
    console.log('🎨 Creating slots:', slotCount);
    
    for (let i = 1; i <= slotCount; i++) {
        const slotNum = i + 5; // Start from #6
        
        // Get saved config for this slot
        const saved = savedSlots[String(slotNum)] || {};
        const savedTitle = saved.title || 'Display Port ' + slotNum;
        const savedAgent = saved.agent || '';
        const savedProvider = saved.provider || '';
        const savedModel = saved.model || '';
        const savedBoxNumber = saved.boxNumber || '';
        const savedAgentNumber = saved.agentNumber || '';
        
        // Calculate AB code
        const agentNumForAB = savedAgent ? savedAgent.replace('agent', '').padStart(2, '0') : '00';
        const boxNumForAB = savedBoxNumber ? String(savedBoxNumber).padStart(2, '0') : String(slotNum).padStart(2, '0');
        const abCode = 'AB' + boxNumForAB + agentNumForAB;
        
        // Build display text
        let displayParts = [savedTitle];
        if (savedModel && savedModel !== 'auto') {
            displayParts.push(savedModel);
        } else if (savedProvider) {
            displayParts.push(savedProvider);
        }
        const displayText = displayParts.join(' · ');
        
        // Determine if this slot should span rows (for 5-slot and 7-slot layouts)
        let gridRowStyle = '';
        if ((layout === '5-slot' || layout === '7-slot') && i === 1) {
            gridRowStyle = 'grid-row: span 2;';
        }
        
        const slot = document.createElement('div');
        slot.style.cssText = `
            background: ${slotBg} !important;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            ${gridRowStyle}
        `;
        slot.setAttribute('data-slot-id', slotNum);
        
        // ✅ CRITICAL: Preserve ALL saved config fields including locationId, tools, etc.
        const fullConfig = Object.keys(saved).length > 0 ? saved : {
            title: savedTitle,
            agent: savedAgent,
            provider: savedProvider,
            model: savedModel,
            boxNumber: savedBoxNumber,
            agentNumber: savedAgentNumber
        };
        
        slot.setAttribute('data-slot-config', JSON.stringify(fullConfig));
        console.log('📝 Created slot', slotNum, 'with full config:', fullConfig);
        
        // Create header div
        const header = document.createElement('div');
        header.style.cssText = `
            background: ${headerColor}; 
            padding: 6px 8px; 
            font-size: 11px; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            border-radius: 8px 8px 0 0; 
            min-height: 32px; 
            flex-shrink: 0;
        `;
        
        header.innerHTML = `
            <div style="display: flex; align-items: center; color: ${textColor}; font-weight: bold; min-width: 0; flex: 1;">
                <span style="margin-right: 4px; white-space: nowrap; font-family: monospace; font-size: 10px;">${abCode}</span>
                <span style="margin-right: 4px;">🖥️</span>
                <span class="slot-display-text" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px;">${displayText}</span>
            </div>
            <div style="display: flex; align-items: center; flex-shrink: 0; gap: 4px;">
                <button class="edit-slot" data-slot-id="${slotNum}" style="background: ${theme === 'professional' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'}; border: none; color: ${textColor}; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;">✏️</button>
            </div>
        `;
        
        // Store slotNum for later use by grid-script.js
        const editBtn = header.querySelector('.edit-slot');
        editBtn.setAttribute('data-slot-num', slotNum);
        
        // Create content div
        const content = document.createElement('div');
        const contentColor = theme === 'dark' ? '#e5e7eb' : (theme === 'professional' ? '#1e293b' : '#333');
        content.style.cssText = `
            flex: 1; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            font-size: 14px; 
            color: ${contentColor}; 
            text-align: center; 
            padding: 16px; 
            background: ${slotBg} !important; 
            min-height: 0;
        `;
        content.innerHTML = `<div style="opacity: 0.6;">${savedAgent ? 'Configured ✓' : 'Click ✏️ to configure'}</div>`;
        
        slot.appendChild(header);
        slot.appendChild(content);
        gridDiv.appendChild(slot);
        console.log('✅ Added slot:', slotNum);
    }
    
    container.appendChild(gridDiv);
    console.log('✅ Grid appended to container');
    console.log('✅ Grid created successfully:', layout, 'with', slotCount, 'slots');
    
    // Update document title
    document.title = 'AI Grid - ' + layout.toUpperCase();
    }

    function updateSlotDisplay(slotElement, slotId, config) {
    console.log('🔄 Updating slot', slotId, 'with config:', config);
    
    const savedAgent = config.agent || '';
    const savedProvider = config.provider || '';
    const savedModel = config.model || '';
    const savedBoxNumber = config.boxNumber || '';
    
    // Calculate AB code
    const agentNumForAB = savedAgent ? savedAgent.replace('agent', '').padStart(2, '0') : '00';
    const boxNumForAB = savedBoxNumber ? String(savedBoxNumber).padStart(2, '0') : String(slotId).padStart(2, '0');
    const abCode = 'AB' + boxNumForAB + agentNumForAB;
    
    // Build display text
    let displayParts = [config.title || 'Display Port ' + slotId];
    if (savedModel && savedModel !== 'auto') {
        displayParts.push(savedModel);
    } else if (savedProvider) {
        displayParts.push(savedProvider);
    }
    const displayText = displayParts.join(' · ');
    
    // Update slot data attribute
    slotElement.setAttribute('data-slot-config', JSON.stringify(config));
    
    // Update AB code display
    const abCodeElement = slotElement.querySelector('[style*="monospace"]');
    if (abCodeElement) abCodeElement.textContent = abCode;
    
    // Update display text
    const displayTextElement = slotElement.querySelector('.slot-display-text');
    if (displayTextElement) displayTextElement.textContent = displayText;
    
    // Update status in content area
    const contentArea = slotElement.querySelector('[style*="flex: 1"]');
    if (contentArea) {
        contentArea.innerHTML = `<div style="opacity: 0.6;">${savedAgent ? 'Configured ✓' : 'Click ✏️ to configure'}</div>`;
    }
    }

    // Add fullscreen button
    function addFullscreenButton() {
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.id = 'fullscreen-btn';
        fullscreenBtn.title = 'Toggle Fullscreen';
        fullscreenBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: rgba(255,255,255,0.9);
            border: 2px solid rgba(0,0,0,0.1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            cursor: pointer;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            transition: all 0.2s ease;
        `;
        fullscreenBtn.innerHTML = '⛶';
        
        fullscreenBtn.addEventListener('mouseenter', function() {
            fullscreenBtn.style.transform = 'scale(1.1)';
            fullscreenBtn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
        });
        
        fullscreenBtn.addEventListener('mouseleave', function() {
            fullscreenBtn.style.transform = 'scale(1)';
            fullscreenBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });
        
        fullscreenBtn.addEventListener('click', function() {
            console.log('🖥️ Fullscreen button clicked');
            
            // Wait for toggleFullscreen to be available if not yet loaded
            const attemptToggle = function() {
                if (typeof window.toggleFullscreen === 'function') {
                    console.log('✅ Calling toggleFullscreen');
                    window.toggleFullscreen();
                } else {
                    console.warn('⚠️ toggleFullscreen not available yet, retrying...');
                    setTimeout(attemptToggle, 100);
                }
            };
            
            attemptToggle();
        });
        
        document.body.appendChild(fullscreenBtn);
        console.log('✅ Fullscreen button added');
    }

    // Add fullscreen button after DOM is ready
    window.addEventListener('DOMContentLoaded', function() {
        addFullscreenButton();
    });

})(); // End of IIFE

