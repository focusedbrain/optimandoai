const el = document.getElementById('app')!;
el.innerHTML = `
  <div style='font:14px system-ui;padding:12px;min-width:280px'>
    <h3 style='margin:0 0 8px'>Optimando Helper</h3>
    <label>Port: <input id='port' placeholder='z.B. 51247' /></label><br/>
    <label>Token: <input id='token' placeholder='von Desktop-Konsole' /></label><br/>
    <button id='ping'>Connect & Ping</button>
    <pre id='log' style='white-space:pre-wrap;margin-top:8px'></pre>
  </div>
`;

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const logEl = document.getElementById('log')!;

document.getElementById('ping')!.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'PING_DESKTOP',
    port: $('#port').value,
    token: $('#token').value,
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOG') {
    logEl.textContent += `\n${msg.data}`;
  }
});
