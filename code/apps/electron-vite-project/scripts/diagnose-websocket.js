#!/usr/bin/env node

/**
 * WebSocket Connection Diagnostic Script
 * 
 * Automatically checks:
 * 1. Electron process and WebSocket server status
 * 2. WebSocket connection and ping/pong
 * 3. Message flow (DB_TEST_CONNECTION)
 * 4. Direct database connection
 * 
 * Usage:
 *   node scripts/diagnose-websocket.js
 *   node scripts/diagnose-websocket.js --host localhost --port 5432 --database postgres --user postgres --password YOUR_PASSWORD
 */

import WebSocket from 'ws';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to import pg, but make it optional
let Pool = null;
async function loadPgModule() {
  try {
    const pgModule = await import('pg');
    return pgModule.Pool;
  } catch (error) {
    console.warn('Warning: pg module not available. Database direct test will be skipped.');
    return null;
  }
}

// Configuration
const WEBSOCKET_PORT = 51247;
const WEBSOCKET_URL = `ws://127.0.0.1:${WEBSOCKET_PORT}`;
const DEFAULT_TIMEOUT = 10000; // 10 seconds

// Results object
const results = {
  timestamp: new Date().toISOString(),
  electronRunning: false,
  websocketServerListening: false,
  websocketConnection: false,
  pingPongTest: false,
  messageFlowTest: false,
  databaseDirectTest: false,
  errors: [],
  details: {}
};

/**
 * Check if port is listening
 */
function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 2000;
    
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

/**
 * Check 1: Electron Process and WebSocket Server
 */
async function checkElectronProcess() {
  console.log('\n[1/5] Checking Electron process and WebSocket server...');
  
  try {
    const isListening = await checkPort(WEBSOCKET_PORT);
    results.websocketServerListening = isListening;
    results.electronRunning = isListening; // If port is listening, Electron is likely running
    
    if (isListening) {
      console.log(`  ✓ Port ${WEBSOCKET_PORT} is listening`);
      results.details.portCheck = { status: 'listening', port: WEBSOCKET_PORT };
    } else {
      console.log(`  ✗ Port ${WEBSOCKET_PORT} is NOT listening`);
      results.details.portCheck = { status: 'not_listening', port: WEBSOCKET_PORT };
      results.errors.push('WebSocket server is not listening on port 51247. Make sure Electron app is running.');
    }
  } catch (error) {
    console.log(`  ✗ Error checking port: ${error.message}`);
    results.errors.push(`Port check error: ${error.message}`);
  }
}

/**
 * Check 2: WebSocket Connection Test
 */
async function testWebSocketConnection() {
  console.log('\n[2/5] Testing WebSocket connection...');
  
  if (!results.websocketServerListening) {
    console.log('  ⚠ Skipping - WebSocket server not listening');
    return;
  }
  
  return new Promise((resolve) => {
    let ws = null;
    let pingReceived = false;
    const startTime = Date.now();
    
    try {
      ws = new WebSocket(WEBSOCKET_URL);
      
      const timeout = setTimeout(() => {
        if (ws) {
          ws.close();
        }
        if (!pingReceived) {
          console.log('  ✗ Connection timeout');
          results.errors.push('WebSocket connection timeout');
          results.details.websocketTest = { status: 'timeout', duration: Date.now() - startTime };
        }
        resolve();
      }, DEFAULT_TIMEOUT);
      
      ws.on('open', () => {
        console.log('  ✓ WebSocket connection established');
        results.websocketConnection = true;
        results.details.websocketTest = { status: 'connected', duration: Date.now() - startTime };
        
        // Send ping
        ws.send(JSON.stringify({ type: 'ping', from: 'diagnostic-script' }));
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'pong') {
            pingReceived = true;
            clearTimeout(timeout);
            const latency = Date.now() - startTime;
            console.log(`  ✓ Ping/Pong test successful (latency: ${latency}ms)`);
            results.pingPongTest = true;
            results.details.pingPongTest = { status: 'success', latency };
            ws.close();
            resolve();
          }
        } catch (error) {
          console.log(`  ⚠ Received non-JSON message: ${data.toString()}`);
        }
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log(`  ✗ WebSocket error: ${error.message}`);
        results.errors.push(`WebSocket error: ${error.message}`);
        results.details.websocketTest = { status: 'error', error: error.message };
        resolve();
      });
      
      ws.on('close', () => {
        clearTimeout(timeout);
        if (!pingReceived && results.websocketConnection) {
          console.log('  ✗ Connection closed before pong received');
          results.errors.push('WebSocket closed before pong response');
        }
        resolve();
      });
    } catch (error) {
      console.log(`  ✗ Error creating WebSocket: ${error.message}`);
      results.errors.push(`WebSocket creation error: ${error.message}`);
      resolve();
    }
  });
}

/**
 * Check 3: Message Flow Test
 */
async function testMessageFlow(dbConfig = null) {
  console.log('\n[3/5] Testing message flow (DB_TEST_CONNECTION)...');
  
  if (!results.websocketConnection) {
    console.log('  ⚠ Skipping - WebSocket not connected');
    return;
  }
  
  return new Promise((resolve) => {
    let ws = null;
    let responseReceived = false;
    const startTime = Date.now();
    
    // Use provided config or default test config
    const testConfig = dbConfig || {
      host: '127.0.0.1',
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: '',
      ssl: false,
      schema: 'public'
    };
    
    try {
      ws = new WebSocket(WEBSOCKET_URL);
      
      const timeout = setTimeout(() => {
        if (ws) {
          ws.close();
        }
        if (!responseReceived) {
          console.log('  ✗ Message flow test timeout (no response received)');
          results.errors.push('DB_TEST_CONNECTION message timeout - Electron not responding');
          results.details.messageFlowTest = {
            status: 'timeout',
            duration: Date.now() - startTime,
            message: 'No DB_TEST_CONNECTION_RESULT received'
          };
        }
        resolve();
      }, DEFAULT_TIMEOUT);
      
      ws.on('open', () => {
        console.log('  ✓ Sending DB_TEST_CONNECTION message...');
        const message = {
          type: 'DB_TEST_CONNECTION',
          config: testConfig
        };
        ws.send(JSON.stringify(message));
        results.details.messageFlowTest = {
          status: 'sent',
          message: { ...message, config: { ...message.config, password: '***REDACTED***' } }
        };
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'DB_TEST_CONNECTION_RESULT') {
            responseReceived = true;
            clearTimeout(timeout);
            const duration = Date.now() - startTime;
            
            if (message.ok) {
              console.log(`  ✓ Message flow test successful (duration: ${duration}ms)`);
              console.log(`    Response: ${message.message}`);
              results.messageFlowTest = true;
              results.details.messageFlowTest = {
                status: 'success',
                duration,
                response: message
              };
            } else {
              console.log(`  ✗ Message flow test failed: ${message.message}`);
              results.errors.push(`DB_TEST_CONNECTION failed: ${message.message}`);
              results.details.messageFlowTest = {
                status: 'failed',
                duration,
                response: message
              };
            }
            ws.close();
            resolve();
          }
        } catch (error) {
          console.log(`  ⚠ Received non-JSON message: ${data.toString()}`);
        }
      });
      
      ws.on('error', (error) => {
        clearTimeout(timeout);
        console.log(`  ✗ WebSocket error: ${error.message}`);
        results.errors.push(`Message flow WebSocket error: ${error.message}`);
        resolve();
      });
      
      ws.on('close', () => {
        clearTimeout(timeout);
        if (!responseReceived) {
          console.log('  ✗ Connection closed before response received');
        }
        resolve();
      });
    } catch (error) {
      console.log(`  ✗ Error in message flow test: ${error.message}`);
      results.errors.push(`Message flow test error: ${error.message}`);
      resolve();
    }
  });
}

/**
 * Check 4: Direct Database Connection Test
 */
async function testDatabaseDirect(dbConfig, PoolClass) {
  console.log('\n[4/5] Testing direct database connection...');
  
  if (!PoolClass) {
    console.log('  ⚠ Skipping - pg module not available');
    console.log('    Install pg module: npm install pg');
    return;
  }
  
  if (!dbConfig) {
    console.log('  ⚠ Skipping - No database config provided');
    console.log('    Use --host --port --database --user --password to test database');
    return;
  }
  
  const pool = new PoolClass({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    ssl: dbConfig.ssl || false,
    connectionTimeoutMillis: 5000
  });
  
  const startTime = Date.now();
  
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      const duration = Date.now() - startTime;
      console.log(`  ✓ Direct database connection successful (duration: ${duration}ms)`);
      results.databaseDirectTest = true;
      results.details.databaseTest = {
        status: 'success',
        duration,
        config: {
          host: dbConfig.host,
          port: dbConfig.port,
          database: dbConfig.database,
          user: dbConfig.user,
          ssl: dbConfig.ssl
        }
      };
    } finally {
      client.release();
    }
    await pool.end();
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`  ✗ Direct database connection failed: ${error.message}`);
    results.errors.push(`Database connection error: ${error.message}`);
    results.details.databaseTest = {
      status: 'failed',
      duration,
      error: error.message,
      code: error.code
    };
  }
}

/**
 * Generate and print report
 */
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('WebSocket Connection Diagnostic Report');
  console.log('='.repeat(60));
  console.log(`Timestamp: ${results.timestamp}\n`);
  
  // Status checks
  console.log('Status Checks:');
  console.log(`  [${results.electronRunning ? '✓' : '✗'}] Electron process is running`);
  console.log(`  [${results.websocketServerListening ? '✓' : '✗'}] WebSocket server listening on port ${WEBSOCKET_PORT}`);
  console.log(`  [${results.websocketConnection ? '✓' : '✗'}] WebSocket connection established`);
  console.log(`  [${results.pingPongTest ? '✓' : '✗'}] Ping/Pong test successful`);
  console.log(`  [${results.messageFlowTest ? '✓' : '✗'}] Message flow test successful`);
  console.log(`  [${results.databaseDirectTest ? '✓' : '✗'}] Direct database connection successful`);
  
  // Summary
  console.log('\nSummary:');
  const allPassed = results.electronRunning && 
                    results.websocketServerListening && 
                    results.websocketConnection && 
                    results.pingPongTest && 
                    results.messageFlowTest;
  
  console.log(`  - Electron app: ${results.electronRunning ? 'RUNNING' : 'NOT RUNNING'}`);
  console.log(`  - WebSocket server: ${results.websocketServerListening ? 'LISTENING' : 'NOT LISTENING'}`);
  console.log(`  - WebSocket connection: ${results.websocketConnection ? 'CONNECTED' : 'NOT CONNECTED'}`);
  console.log(`  - Message flow: ${results.messageFlowTest ? 'WORKING' : 'FAILED'}`);
  if (results.details.databaseTest) {
    console.log(`  - Database: ${results.databaseDirectTest ? 'ACCESSIBLE' : 'NOT ACCESSIBLE'}`);
  }
  
  // Errors
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach((error, index) => {
      console.log(`  ${index + 1}. ${error}`);
    });
  }
  
  // Recommendations
  console.log('\nRecommendations:');
  if (!results.electronRunning) {
    console.log('  1. Start Electron app: cd apps/electron-vite-project && npm run dev');
  }
  if (results.electronRunning && !results.websocketServerListening) {
    console.log('  1. Check Electron console for WebSocket server startup errors');
    console.log('  2. Verify port 51247 is not blocked by firewall');
  }
  if (results.websocketConnection && !results.pingPongTest) {
    console.log('  1. Check Electron console for ping/pong handler');
  }
  if (results.pingPongTest && !results.messageFlowTest) {
    console.log('  1. Check Electron console for DB_TEST_CONNECTION handler');
    console.log('  2. Verify message is being processed: look for [MAIN] ===== DB_TEST_CONNECTION HANDLER STARTED =====');
    console.log('  3. Check if response is being sent: look for [MAIN] ===== DB_TEST_CONNECTION_RESULT SENT SUCCESSFULLY =====');
  }
  if (results.messageFlowTest && results.details.messageFlowTest?.response?.ok === false) {
    console.log('  1. Database connection failed - check database credentials');
    console.log('  2. Verify PostgreSQL is running');
    console.log('  3. Check database name, user, and password are correct');
  }
  if (allPassed) {
    console.log('  ✓ All checks passed! WebSocket connection is working correctly.');
  }
  
  console.log('\n' + '='.repeat(60));
  
  // Save JSON report
  const reportPath = path.join(path.dirname(__dirname), 'websocket-diagnostic-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host' && args[i + 1]) {
      config.host = args[i + 1];
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      config.port = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--database' && args[i + 1]) {
      config.database = args[i + 1];
      i++;
    } else if (args[i] === '--user' && args[i + 1]) {
      config.user = args[i + 1];
      i++;
    } else if (args[i] === '--password' && args[i + 1]) {
      config.password = args[i + 1];
      i++;
    } else if (args[i] === '--ssl') {
      config.ssl = true;
    } else if (args[i] === '--schema' && args[i + 1]) {
      config.schema = args[i + 1];
      i++;
    }
  }
  
  return Object.keys(config).length > 0 ? config : null;
}

/**
 * Main function
 */
async function runDiagnostics() {
  console.log('WebSocket Connection Diagnostic Tool');
  console.log('====================================\n');
  
  // Load pg module if available
  const PoolClass = await loadPgModule();
  
  const dbConfig = parseArgs();
  if (dbConfig) {
    console.log('Database config provided via command line arguments');
    console.log(`  Host: ${dbConfig.host}`);
    console.log(`  Port: ${dbConfig.port}`);
    console.log(`  Database: ${dbConfig.database}`);
    console.log(`  User: ${dbConfig.user}`);
    console.log(`  SSL: ${dbConfig.ssl || false}\n`);
  } else {
    console.log('No database config provided - database test will be skipped');
    console.log('Usage: node scripts/diagnose-websocket.js --host localhost --port 5432 --database postgres --user postgres --password YOUR_PASSWORD\n');
  }
  
  // Run checks sequentially
  await checkElectronProcess();
  await testWebSocketConnection();
  await testMessageFlow(dbConfig);
  await testDatabaseDirect(dbConfig, PoolClass);
  
  // Generate report
  generateReport();
  
  // Exit with appropriate code
  const hasErrors = results.errors.length > 0 || !results.messageFlowTest;
  process.exit(hasErrors ? 1 : 0);
}

// Run diagnostics
runDiagnostics().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

