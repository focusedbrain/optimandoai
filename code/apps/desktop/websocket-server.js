const WebSocket = require('ws');

// Create WebSocket server on port 51247
const wss = new WebSocket.Server({ port: 51247 });

console.log('🚀 WebSocket-Server läuft auf Port 51247');

wss.on('connection', (ws) => {
  console.log('🔗 Neue WebSocket-Verbindung hergestellt');
  
  // Send welcome message
  ws.send(JSON.stringify({ 
    type: 'welcome', 
    message: 'Verbunden mit Optimando WebSocket Server',
    timestamp: new Date().toISOString()
  }));
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📨 Nachricht erhalten:', message);
      
      // Handle ping messages
      if (message.type === 'ping') {
        const response = {
          type: 'pong',
          message: 'Pong von WebSocket Server',
          timestamp: new Date().toISOString(),
          from: message.from
        };
        ws.send(JSON.stringify(response));
        console.log('📤 Pong gesendet:', response);
      }
    } catch (error) {
      console.log('❌ Fehler beim Verarbeiten der Nachricht:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket-Verbindung geschlossen');
  });
  
  ws.on('error', (error) => {
    console.log('❌ WebSocket-Fehler:', error);
  });
});

wss.on('error', (error) => {
  console.log('❌ WebSocket-Server Fehler:', error);
});

console.log('✅ WebSocket-Server bereit für Verbindungen');
