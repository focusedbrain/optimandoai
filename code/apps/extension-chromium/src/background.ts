let ws: WebSocket | null = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'PING_DESKTOP') return;

  const port = String(msg.port || '').trim();
  const token = String(msg.token || '').trim();
  const url = new URL(`ws://127.0.0.1:${port}/`);
  if (token) url.searchParams.set('token', token);

  // Falls schon verbunden: wiederverwenden
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping', from: 'extension-reuse' }));
    return;
  }

  // Neue Verbindung aufbauen
  ws = new WebSocket(url);

  ws.onopen = () => {
    ws?.send(JSON.stringify({ type: 'ping', from: 'extension' }));
    console.log('[EXT] WebSocket geöffnet & Ping gesendet');
  };

  ws.onmessage = (e) => {
    console.log('[EXT] Nachricht empfangen:', e.data);
    chrome.runtime.sendMessage({ type: 'LOG', data: e.data });
  };

  ws.onerror = (err) => {
    console.warn('[EXT] WebSocket Fehler', err);
    ws = null; // beim Fehler zurücksetzen
  };

  ws.onclose = () => {
    console.log('[EXT] WebSocket geschlossen');
    ws = null;
  };
});
