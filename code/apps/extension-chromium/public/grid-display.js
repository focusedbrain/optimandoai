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

// Normalise theme aliases
const resolvedTheme = (theme === 'default' || theme === 'pro') ? 'pro'
    : (theme === 'professional') ? 'standard'
    : theme; // 'standard' | 'dark'

// Theme configuration
let bodyBg, bodyText, headerColor, textColor, slotBg;

if (resolvedTheme === 'dark') {
    bodyBg = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    bodyText = '#e5e7eb';
    headerColor = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    textColor = '#e5e7eb';
    slotBg = 'rgba(255,255,255,0.06)';
} else if (resolvedTheme === 'pro') {
    bodyBg = 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)';
    bodyText = '#ffffff';
    headerColor = 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)';
    textColor = 'white';
    slotBg = 'rgba(255,255,255,0.12)';
} else {
    // standard (default)
    bodyBg = 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)';
    bodyText = '#0f172a';
    headerColor = 'linear-gradient(135deg, #e0e7ef 0%, #cbd5e1 100%)';
    textColor = '#0f172a';
    slotBg = 'white';
}

// Apply theme to body
document.body.style.background = bodyBg;
document.body.style.color = bodyText;

// Listen for theme changes from settings
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function(changes, namespace) {
        if (namespace === 'local' && changes['optimando-ui-theme']) {
            const newTheme = changes['optimando-ui-theme'].newValue;
            console.log('🎨 Theme changed to:', newTheme);
            // Reload the page with new theme
            const url = new URL(window.location.href);
            url.searchParams.set('theme', newTheme);
            window.location.href = url.toString();
        }
    });
}

// Create grid container
const container = document.getElementById('grid-root');
const gridDiv = document.createElement('div');
gridDiv.className = 'grid-container layout-' + layout;

/**
 * Load saved configurations from SQLite via background script
 * Uses locationId pattern: grid_{sessionId}_{layout}_slot{N}
 */
if (typeof chrome !== 'undefined' && chrome.runtime && sessionKey) {
    console.log('📥 Loading grid configurations from SQLite for session:', sessionKey);
    
    // Request session from SQLite via background script (same as grid-script.js does)
    chrome.runtime.sendMessage({
        type: 'GET_SESSION_FROM_SQLITE',
        sessionKey: sessionKey
    }, function(response) {
        if (chrome.runtime.lastError) {
            console.error('❌ Error loading session from SQLite:', chrome.runtime.lastError.message);
            console.error('❌ SQLite is required - check Electron app!');
            // Create empty slots on error
            createSlots(config.slots, {});
            return;
        }
        
        if (!response || !response.success || !response.session) {
            console.log('⚠️ No session data found in SQLite, creating empty slots');
            createSlots(config.slots, {});
            return;
        }
        
        const session = response.session;
        const savedSlotsByLocation = {};
        
        // 🔍 DEBUG: Log what we received
        console.log('📥 Received session from SQLite:', {
            hasAgentBoxes: !!session.agentBoxes,
            agentBoxesCount: session.agentBoxes?.length || 0,
            sessionKey: sessionKey,
            gridSessionId: sessionId,
            gridLayout: layout
        });
        
        // Map agent boxes to slots by locationId
        if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
            const gridPrefix = 'grid_' + sessionId + '_' + layout;
            
            console.log('🔍 GRID LOAD: Searching for boxes with prefix:', gridPrefix);
            console.log('🔍 GRID LOAD: This grid sessionId:', sessionId);
            console.log('🔍 GRID LOAD: This grid layout:', layout);
            console.log('📦 Total agentBoxes in session:', session.agentBoxes.length);
            
            // 🔍 DEBUG: Log all agentBoxes to see what we have
            session.agentBoxes.forEach((box, index) => {
                console.log(`  [${index}] ${box.identifier}: locationId="${box.locationId || 'MISSING'}", source="${box.source || 'none'}"`);
            });
            
            session.agentBoxes.forEach(box => {
                if (box.locationId && box.locationId.startsWith(gridPrefix)) {
                    const match = box.locationId.match(/_slot(\d+)$/)
                    if (match) {
                        savedSlotsByLocation[match[1]] = box
                        console.log('✅ Found saved config for slot', match[1], ':', box.identifier);
                    }
                }
            })
            
            const configuredCount = Object.keys(savedSlotsByLocation).length;
            if (configuredCount > 0) {
                console.log('✅ Loaded', configuredCount, 'slot configuration(s) from SQLite');
            } else {
                console.log('⚠️ No matching slot configurations found for this grid');
            }
        } else {
            console.log('⚠️ Session has no agentBoxes array');
        }
        
        createSlots(config.slots, savedSlotsByLocation)
    });
} else {
    console.log('⚠️ Chrome runtime not available or no sessionKey, creating empty slots');
    // No storage available, create empty slots
    createSlots(config.slots, {});
}

/**
 * Create and render display grid slots
 * @param {number} slotCount - Number of slots to create
 * @param {Object} savedSlots - Map of slot IDs to saved configurations
 */
function createSlots(slotCount, savedSlots) {
    // Slots are numbered starting from 6 (agent boxes 1-5 are reserved for master tabs)
    const SLOT_NUMBER_OFFSET = 5;
    
    for (let i = 1; i <= slotCount; i++) {
        const slotNum = i + SLOT_NUMBER_OFFSET;
        
        // Get saved config for this slot (if exists)
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
        const slotBorder = resolvedTheme === 'standard' ? '1px solid #cbd5e1' : '1px solid rgba(255,255,255,0.14)';
        slot.style.cssText = `
            background: ${slotBg} !important;
            border: ${slotBorder};
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            ${gridRowStyle}
        `;
        slot.setAttribute('data-slot-id', slotNum);
        
        // Preserve full saved config (including locationId, tools, etc.) or use defaults
        const fullConfig = Object.keys(saved).length > 0 ? saved : {
            title: savedTitle,
            agent: savedAgent,
            provider: savedProvider,
            model: savedModel,
            boxNumber: savedBoxNumber,
            agentNumber: savedAgentNumber
        };
        
        slot.setAttribute('data-slot-config', JSON.stringify(fullConfig));
        
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
            <div style="display: flex; align-items: center; flex-shrink: 0; gap: 6px;">
                <label class="slot-toggle" data-slot-id="${slotNum}" style="position: relative; display: inline-block; width: 32px; height: 18px; cursor: pointer;" title="Toggle agent on/off">
                    <input type="checkbox" checked style="opacity: 0; width: 0; height: 0;">
                    <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #4CAF50; border-radius: 18px; transition: 0.3s;"></span>
                    <span style="position: absolute; content: ''; height: 12px; width: 12px; left: 17px; bottom: 3px; background-color: white; border-radius: 50%; transition: 0.3s; box-shadow: 0 1px 2px rgba(0,0,0,0.3);"></span>
                </label>
                <button class="edit-slot" data-slot-id="${slotNum}" style="background: ${resolvedTheme === 'standard' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'}; border: none; color: ${textColor}; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;">✏️</button>
            </div>
        `;
        
        // Store slotNum for later use by grid-script.js
        const editBtn = header.querySelector('.edit-slot');
        editBtn.setAttribute('data-slot-num', slotNum);
        
        // Create content div
        const content = document.createElement('div');
        const contentColor = resolvedTheme === 'dark' ? '#e5e7eb' : (resolvedTheme === 'standard' ? '#1e293b' : '#ffffff');
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
    }
    
    container.appendChild(gridDiv);
    
    // Update document title
    document.title = 'AI Grid - ' + layout.toUpperCase();
}

/**
 * Add fullscreen toggle button to the grid display
 */
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
        // Wait for toggleFullscreen to be available if not yet loaded
        const attemptToggle = function() {
            if (typeof window.toggleFullscreen === 'function') {
                window.toggleFullscreen();
            } else {
                setTimeout(attemptToggle, 100);
            }
        };
        
        attemptToggle();
    });
    
    document.body.appendChild(fullscreenBtn);
}

/**
 * Add master grid toggle next to fullscreen button
 */
function addMasterGridToggle() {
    const masterToggle = document.createElement('label');
    masterToggle.id = 'master-grid-toggle';
    masterToggle.title = 'Toggle all agents in this grid';
    masterToggle.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 80px;
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
        transition: all 0.2s ease;
    `;
    
    masterToggle.innerHTML = `
        <input type="checkbox" checked style="opacity: 0; width: 0; height: 0; position: absolute;">
        <div style="position: relative; display: inline-block; width: 36px; height: 20px;">
            <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: #4CAF50; border-radius: 20px; transition: 0.3s;"></span>
            <span style="position: absolute; content: ''; height: 16px; width: 16px; left: 18px; bottom: 2px; background-color: white; border-radius: 50%; transition: 0.3s; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></span>
        </div>
    `;
    
    masterToggle.addEventListener('mouseenter', function() {
        masterToggle.style.transform = 'scale(1.1)';
        masterToggle.style.boxShadow = '0 6px 16px rgba(0,0,0,0.2)';
    });
    
    masterToggle.addEventListener('mouseleave', function() {
        masterToggle.style.transform = 'scale(1)';
        masterToggle.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    });
    
    document.body.appendChild(masterToggle);
}

// Add fullscreen button and master toggle after DOM is ready
window.addEventListener('DOMContentLoaded', function() {
    addFullscreenButton();
    addMasterGridToggle();
});

})(); // End of IIFE

