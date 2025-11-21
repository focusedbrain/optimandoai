// Copy and paste this into the browser console to debug session data
// This will show what's in currentTabData and what would be saved

console.log('=== SESSION DEBUG INFO ===');
console.log('');

// Check if extension is active
const extensionActive = localStorage.getItem('optimando-extension-active');
console.log('Extension Active:', extensionActive);
console.log('');

// Check current session key
const sessionKeys = Object.keys(localStorage).filter(k => k.startsWith('currentSessionKey'));
console.log('Current Session Keys in localStorage:', sessionKeys);
sessionKeys.forEach(key => {
  console.log(`  ${key}:`, localStorage.getItem(key));
});
console.log('');

// Check for agent configurations in localStorage
const agentModelKeys = Object.keys(localStorage).filter(k => k.startsWith('agent_model_v2_'));
console.log('Agent Model Keys Found:', agentModelKeys.length);
agentModelKeys.forEach(key => {
  const agentName = key.replace('agent_model_v2_', '');
  console.log(`  Agent: ${agentName}`);
  try {
    const model = JSON.parse(localStorage.getItem(key));
    console.log(`    Model:`, model);
  } catch (e) {
    console.log(`    Model: (parse error)`);
  }
});
console.log('');

// Check Chrome Storage for sessions
chrome.storage.local.get(null, (items) => {
  const sessionKeys = Object.keys(items).filter(k => k.startsWith('session_'));
  console.log('Sessions in Chrome Storage:', sessionKeys.length);
  
  sessionKeys.forEach(key => {
    const session = items[key];
    console.log(`  ${key}:`);
    console.log(`    - Name: ${session.tabName}`);
    console.log(`    - Agent Boxes: ${session.agentBoxes?.length || 0}`);
    console.log(`    - Agents: ${session.agents?.length || 0}`);
    console.log(`    - Timestamp: ${session.timestamp}`);
    console.log(`    - Has helperTabs: ${!!session.helperTabs}`);
    console.log(`    - Has displayGrids: ${!!session.displayGrids}`);
  });
  
  console.log('');
  console.log('=== END DEBUG INFO ===');
});











