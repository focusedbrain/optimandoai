// Run this in Chrome DevTools Console (on the page with the extension)
// This will show what's stored in Chrome Storage

console.log('=== Checking Chrome Storage ===');

chrome.storage.local.get(null, (items) => {
  const allKeys = Object.keys(items);
  
  console.log(`\nTotal keys in Chrome Storage: ${allKeys.length}`);
  
  // Filter session keys
  const sessionKeys = allKeys.filter(key => key.startsWith('session_'));
  
  if (sessionKeys.length > 0) {
    console.log(`\n⚠️ Found ${sessionKeys.length} session(s) in Chrome Storage:`);
    sessionKeys.forEach(key => {
      const session = items[key];
      console.log(`  📦 ${key}`);
      console.log(`    - Name: ${session.tabName}`);
      console.log(`    - Timestamp: ${session.timestamp}`);
      console.log(`    - Agent boxes: ${session.agentBoxes?.length || 0}`);
      console.log(`    - Agents: ${session.agents?.length || 0}`);
    });
    console.log(`\n❌ Sessions are still in Chrome Storage (not migrated to SQLite yet!)`);
  } else {
    console.log(`\n✅ No session_* keys found in Chrome Storage (successfully migrated!)`);
  }
  
  // Show all keys for reference
  console.log(`\nAll keys in Chrome Storage:`);
  allKeys.forEach(key => {
    console.log(`  - ${key}`);
  });
});











