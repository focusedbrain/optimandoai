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
if (ddTags) ddTags.onchange = ()=>{ 
  const idx=parseInt(ddTags.value||'-1',10); 
  if(!isNaN(idx)&&idx>=0){ 
    // Check if it's an Electron trigger or extension trigger
    try{
      const key='optimando-tagged-triggers'
      chrome.storage?.local?.get([key], (data)=>{
        const list = Array.isArray(data?.[key]) ? data[key] : []
        const trigger = list[idx]
        if (!trigger) return
        // If has displayId, it's an Electron trigger - send to Electron for execution
        if (trigger.displayId !== undefined) {
          console.log('Executing Electron trigger:', trigger)
          chrome.runtime?.sendMessage({ 
            type: 'ELECTRON_EXECUTE_TRIGGER', 
            trigger 
          })
        } else {
          // Extension trigger - use existing flow
          chrome.runtime?.sendMessage({ type:'OG_CAPTURE_SAVED_TAG', index: idx })
        }
      })
    }catch{}
  } 
  ddTags.value='' 
}

// Image lightbox for enlarging screenshots
function createImageLightbox(imgSrc){
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px'
  const img = document.createElement('img')
  img.src = imgSrc
  img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,0.8)'
  overlay.appendChild(img)
  overlay.onclick = ()=> overlay.remove()
  document.body.appendChild(overlay)
}

// Append incoming captures (image/video) from the content script to the popup chat
try {
  chrome.runtime?.onMessage.addListener((msg)=>{
    try{
      if (!msg || !msg.type) return
      if (msg.type === 'COMMAND_POPUP_APPEND'){
        const row = document.createElement('div'); row.className='row user'
        const bub = document.createElement('div'); bub.className='bubble user'
        if (msg.kind === 'image'){
          const img = document.createElement('img')
          img.src = msg.url
          img.style.cssText = 'width:100%;height:auto;max-width:450px;border-radius:8px;cursor:zoom-in;display:block'
          img.title='Click to view full size'
          img.onclick = ()=> createImageLightbox(msg.url)
          bub.appendChild(img)
        } else if (msg.kind === 'video'){
          const v = document.createElement('video'); v.src = msg.url; v.controls = true; v.style.maxWidth='450px'; v.style.width='100%'; v.style.borderRadius='8px'; bub.appendChild(v)
        }
        row.appendChild(bub); msgs.appendChild(row); msgs.scrollTop = 1e9
        try{ cancelBtn && (cancelBtn.style.display='none') }catch{}
      } else if (msg.type === 'SHOW_TRIGGER_PROMPT'){
        // Show trigger name input UI below composer
        console.log('📝 Showing trigger prompt in popup:', msg)
        showTriggerPromptUI(msg.mode, msg.rect, msg.displayId, msg.imageUrl, msg.videoUrl)
      }
    }catch{}
  })
}catch{}

// Show trigger name input UI
function showTriggerPromptUI(mode, rect, displayId, imageUrl, videoUrl){
  try{
    const wrap = document.querySelector('.wrap')
    if (!wrap) return
    // Remove existing prompt if any
    const existing = document.getElementById('og-trigger-savebar')
    if (existing) existing.remove()
    // Create trigger save bar (insert before messages)
    const bar = document.createElement('div')
    bar.id = 'og-trigger-savebar'
    bar.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:10px; background:rgba(37,99,235,0.08); color:#e5e7eb; border:1px solid rgba(37,99,235,0.3); border-radius:6px; margin:0 0 8px 0;'
    
    const header = document.createElement('div')
    header.style.cssText = 'display:flex; align-items:center; gap:6px; font-size:13px; font-weight:500;'
    header.innerHTML = (mode === 'screenshot' ? '📸' : '🎥') + ' Save Tagged Trigger'
    
    const inputRow = document.createElement('div')
    inputRow.style.cssText = 'display:flex; align-items:center; gap:8px;'
    
    const nameIn = document.createElement('input')
    nameIn.type = 'text'
    nameIn.placeholder = 'Enter trigger name...'
    nameIn.style.cssText = 'flex:1; padding:6px 10px; border:1px solid rgba(255,255,255,0.2); border-radius:6px; font-size:13px; background:rgba(11,18,32,0.6); color:#e5e7eb; outline:none;'
    nameIn.addEventListener('focus', () => { nameIn.style.borderColor = 'rgba(37,99,235,0.5)' })
    nameIn.addEventListener('blur', () => { nameIn.style.borderColor = 'rgba(255,255,255,0.2)' })
    
    const save = document.createElement('button')
    save.textContent = 'Save'
    save.style.cssText = 'background:#2563eb;border:0;color:white;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;white-space:nowrap;'
    save.addEventListener('mouseenter', () => { save.style.background = '#1d4ed8' })
    save.addEventListener('mouseleave', () => { save.style.background = '#2563eb' })
    
    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'
    cancel.style.cssText = 'background:rgba(255,255,255,0.08);border:0;color:#e5e7eb;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap;'
    cancel.addEventListener('mouseenter', () => { cancel.style.background = 'rgba(255,255,255,0.15)' })
    cancel.addEventListener('mouseleave', () => { cancel.style.background = 'rgba(255,255,255,0.08)' })
    
    inputRow.append(nameIn, save, cancel)
    bar.append(header, inputRow)
    
    // Insert after toolkit, before messages
    const toolkit = wrap.querySelector('.toolkit')
    const messages = wrap.querySelector('.messages')
    if (toolkit && messages) {
      wrap.insertBefore(bar, messages)
    } else {
      wrap.insertBefore(bar, wrap.firstChild)
    }
    
    nameIn.focus()
    
    cancel.onclick = () => bar.remove()
    
    const saveTrigger = () => {
      const name = (nameIn.value || '').trim() || ('Trigger ' + new Date().toLocaleString())
      // Save to chrome.storage for extension dropdown
      try{
        const key='optimando-tagged-triggers'
        chrome.storage?.local?.get([key], (data)=>{
          const prev = Array.isArray(data?.[key]) ? data[key] : []
          prev.push({ name, at: Date.now(), rect, mode, displayId })
          chrome.storage?.local?.set({ [key]: prev }, ()=>{
            refreshTags()
          })
        })
      }catch{}
      // Send trigger back to Electron via WebSocket
      try{
        chrome.runtime?.sendMessage({
          type: 'ELECTRON_SAVE_TRIGGER',
          name,
          mode,
          rect,
          displayId,
          imageUrl,
          videoUrl
        })
      }catch{}
      bar.remove()
    }
    
    save.onclick = saveTrigger
    nameIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && nameIn.value.trim()) saveTrigger()
      else if (e.key === 'Escape') bar.remove()
    })
  }catch(err){
    console.log('Error showing trigger prompt:', err)
  }
}

// Allow cancel from the popup (×) to stop selection in Electron/content



