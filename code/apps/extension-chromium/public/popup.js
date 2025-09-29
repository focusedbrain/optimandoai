// Robust theme init with Chrome storage fallback
(async () => {
  try {
    const qp = new URLSearchParams(location.search)
    let t = qp.get('t')
    if (!t && chrome?.storage?.local) {
      const store = await new Promise(res => chrome.storage.local.get('optimando-ui-theme', res))
      t = store && store['optimando-ui-theme']
    }
    if (!t) {
      try { t = localStorage.getItem('optimando-ui-theme') } catch {}
    }
    t = t || 'default'
    document.body.className = (t === 'professional') ? 'theme-professional' : (t === 'dark' ? 'theme-dark' : 'theme-default')
  } catch { document.body.className = 'theme-default' }
})()

const msgs = document.getElementById('msgs')
const ta = document.getElementById('ta')
const file = document.getElementById('file')
const up = document.getElementById('up')
const mic = document.getElementById('mic')
const send = document.getElementById('send')
const bucketBtn = document.getElementById('tk-bucket')
const pencilBtn = document.getElementById('tk-pencil')
const ddTags = document.getElementById('tk-tags')
const cancelBtn = null

function row(role, text){
  const r = document.createElement('div'); r.className = 'row ' + (role === 'user' ? 'user' : 'assistant');
  const b = document.createElement('div'); b.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant'); b.textContent = text; r.appendChild(b);
  msgs.appendChild(r); msgs.scrollTop = msgs.scrollHeight;
}

function sendNow(){
  const text = (ta.value || '').trim(); if(!text) return; row('user', text); ta.value='';
  setTimeout(()=>row('assistant','Acknowledged: '+text), 250);
}
send.onclick = sendNow;
ta.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendNow(); }});

up.onclick = () => file.click();
file.addEventListener('change', ()=>{ const n=(file.files||[]).length; if(n) row('user', 'Uploaded '+n+' file(s).'); });
['dragenter','dragover'].forEach(evt=> document.addEventListener(evt, e=>{ e.preventDefault(); }));
['dragleave','drop'].forEach(evt=> document.addEventListener(evt, e=>{ e.preventDefault(); }));
document.addEventListener('drop', e=>{ const n = (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) || 0; if(n) row('user', 'Dropped '+n+' file(s).'); });

// Voice input (optional)
let recognizing = false; let recognition;
try {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      ta.value = transcript.trim();
    };
    recognition.onend = () => { recognizing = false; mic.disabled = false; };
  } else {
    mic.disabled = true; mic.title = 'Voice not supported in this browser';
  }
} catch {
  mic.disabled = true; mic.title = 'Voice not supported in this browser';
}
mic.addEventListener('click', () => {
  if (!recognition || recognizing) return; recognizing = true; mic.disabled = true; try { recognition.start(); } catch {}
});

// Context Bucket + Pencil wiring (CSP-safe)
function refreshTags(){
  try{
    const key='optimando-tagged-triggers'
    chrome.storage?.local?.get([key], (data)=>{
      try{
        const list = Array.isArray(data?.[key]) ? data[key] : []
        while (ddTags.options && ddTags.options.length>1) ddTags.remove(1)
        list.forEach((t,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=t.name||('Trigger '+(i+1)); ddTags.appendChild(o) })
      }catch{}
    })
  }catch{}
}
refreshTags()
try{ chrome.runtime?.onMessage.addListener((msg)=>{ if(msg?.type==='TRIGGERS_UPDATED') refreshTags() }) }catch{}

if (bucketBtn) bucketBtn.onclick = (e)=>{ try{ e.preventDefault() }catch{}; try{ file && file.click() }catch{} }
if (pencilBtn) pencilBtn.onclick = (e)=>{
  try{ e.preventDefault() }catch{}
  // Trigger Electron overlay selection via background WS bridge; keep chat open
  try{ chrome.runtime?.sendMessage({ type:'ELECTRON_START_SELECTION', source:'popup' }) }catch{}
}
if (ddTags) ddTags.onchange = ()=>{ const idx=parseInt(ddTags.value||'-1',10); if(!isNaN(idx)&&idx>=0){ try{ chrome.runtime?.sendMessage({ type:'OG_CAPTURE_SAVED_TAG', index: idx }) }catch{} } ddTags.value='' }

// Append incoming captures (image/video) from the content script to the popup chat
try {
  chrome.runtime?.onMessage.addListener((msg)=>{
    try{
      if (!msg || !msg.type) return
      if (msg.type === 'COMMAND_POPUP_APPEND'){
        const row = document.createElement('div'); row.className='row user'
        const bub = document.createElement('div'); bub.className='bubble user'
        if (msg.kind === 'image'){
          const img = document.createElement('img'); img.src = msg.url; img.style.maxWidth='260px'; img.style.borderRadius='8px'; bub.appendChild(img)
        } else if (msg.kind === 'video'){
          const v = document.createElement('video'); v.src = msg.url; v.controls = true; v.style.maxWidth='260px'; v.style.borderRadius='8px'; bub.appendChild(v)
        }
        row.appendChild(bub); msgs.appendChild(row); msgs.scrollTop = 1e9
        try{ cancelBtn && (cancelBtn.style.display='none') }catch{}
      }
    }catch{}
  })
}catch{}

// Allow cancel from the popup (×) to stop selection in Electron/content



