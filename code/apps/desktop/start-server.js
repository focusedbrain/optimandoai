#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting OpenGiraffe Desktop App in background...');

// Start the Electron app in headless mode
const electronProcess = spawn('npx', ['electron', 'main.js', '--headless'], {
  cwd: __dirname,
  detached: true,
  stdio: 'ignore'
});

// Detach the process so it continues running even if this script exits
electronProcess.unref();

console.log('✅ OpenGiraffe Desktop App started in background');
console.log('📡 WebSocket server should be running on port 51247');
console.log('💡 To stop the app, use: pkill -f "electron main.js"');

// Exit this script immediately
process.exit(0);
