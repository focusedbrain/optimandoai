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
const ddTagsBtn = document.getElementById('tk-tags')
const ddTagsDropdown = document.getElementById('tk-tags-dropdown')
let isDropdownOpen = false

function refreshTags(){
  try{
    const key='optimando-tagged-triggers'
    chrome.storage?.local?.get([key], (data)=>{
      try{
        const list = Array.isArray(data?.[key]) ? data[key] : []
        ddTagsDropdown.innerHTML = ''
        
        if (list.length === 0) {
          const empty = document.createElement('div')
          empty.style.cssText = 'padding:8px 12px;font-size:11px;color:var(--muted);text-align:center;'
          empty.textContent = 'No saved triggers'
          ddTagsDropdown.appendChild(empty)
          return
        }
        
        list.forEach((t,i)=>{
          const item = document.createElement('div')
          item.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 8px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--border);'
          item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.1)')
          item.addEventListener('mouseleave', () => item.style.background = 'transparent')
          
          const name = document.createElement('span')
          name.textContent = t.name||('Trigger '+(i+1))
          name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
          
          const deleteBtn = document.createElement('button')
          deleteBtn.textContent = '×'
          deleteBtn.style.cssText = 'width:20px;height:20px;border:none;background:rgba(239,68,68,0.2);color:#ef4444;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;padding:0;margin-left:8px;flex-shrink:0;'
          deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.background = 'rgba(239,68,68,0.4)')
          deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.background = 'rgba(239,68,68,0.2)')
          deleteBtn.onclick = (e) => {
            e.stopPropagation()
            if (confirm(`Delete trigger "${t.name||('Trigger '+(i+1))}"?`)) {
              const key='optimando-tagged-triggers'
              chrome.storage?.local?.get([key], (data)=>{
                const list = Array.isArray(data?.[key]) ? data[key] : []
                list.splice(i, 1)
                chrome.storage?.local?.set({ [key]: list }, ()=>{
                  refreshTags()
                  try{ chrome.runtime?.sendMessage({ type:'TRIGGERS_UPDATED' }) }catch{}
                })
              })
            }
          }
          
          item.onclick = () => {
            isDropdownOpen = false
            ddTagsDropdown.style.display = 'none'
            console.log('[POPUP] Trigger selected from dropdown, index:', i)
            try{
              chrome.runtime?.sendMessage({ 
                type: 'ELECTRON_EXECUTE_TRIGGER', 
                trigger: t 
              })
            }catch(err){
              console.log('[POPUP] Error executing trigger:', err)
            }
          }
          
          item.append(name, deleteBtn)
          ddTagsDropdown.appendChild(item)
        })
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

// Toggle dropdown
if (ddTagsBtn) {
  ddTagsBtn.onclick = (e) => {
    e.stopPropagation()
    isDropdownOpen = !isDropdownOpen
    ddTagsDropdown.style.display = isDropdownOpen ? 'block' : 'none'
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', () => {
  if (isDropdownOpen) {
    isDropdownOpen = false
    ddTagsDropdown.style.display = 'none'
  }
})

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
        showTriggerPromptUI(msg.mode, msg.rect, msg.displayId, msg.imageUrl, msg.videoUrl, msg.createTrigger, msg.addCommand)
      }
    }catch{}
  })
}catch{}

// Show trigger name input UI
function showTriggerPromptUI(mode, rect, displayId, imageUrl, videoUrl, createTrigger = false, addCommand = false){
  try{
    console.log('[POPUP] showTriggerPromptUI called:', { mode, rect, displayId, createTrigger, addCommand })
    
    // If neither is checked, don't show anything
    if (!createTrigger && !addCommand) return
    
    const wrap = document.querySelector('.wrap')
    if (!wrap) return
    // Remove existing prompt if any
    const existing = document.getElementById('og-trigger-savebar')
    if (existing) existing.remove()
    // Create trigger save bar (insert before messages) - compact design
    const bar = document.createElement('div')
    bar.id = 'og-trigger-savebar'
    bar.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:10px; background:rgba(37,99,235,0.08); color:#e5e7eb; border:1px solid rgba(37,99,235,0.3); border-radius:6px; margin:0 0 8px 0; width:100%; box-sizing:border-box;'
    
    // Header with title only (no checkboxes)
    const header = document.createElement('div')
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between;'
    
    const title = document.createElement('div')
    title.style.cssText = 'font-size:12px; font-weight:600;'
    title.textContent = (mode === 'screenshot' ? '📸 Screenshot' : '🎥 Stream')
    
    header.append(title)
    bar.appendChild(header)
    
    // Trigger name input (shown if createTrigger is true)
    let nameIn = null
    if (createTrigger) {
      const triggerRow = document.createElement('div')
      triggerRow.id = 'trigger-row'
      triggerRow.style.cssText = 'display:flex; flex-direction:column; gap:4px;'
      
      const triggerLabel = document.createElement('span')
      triggerLabel.textContent = 'Trigger Name'
      triggerLabel.style.cssText = 'font-size:11px; font-weight:600; opacity:0.8;'
      
      nameIn = document.createElement('input')
      nameIn.type = 'text'
      nameIn.placeholder = 'Enter trigger name...'
      nameIn.style.cssText = 'width:100%; padding:6px 8px; border:1px solid rgba(255,255,255,0.2); border-radius:4px; font-size:12px; background:rgba(11,18,32,0.6); color:#e5e7eb; outline:none; box-sizing:border-box;'
      nameIn.addEventListener('focus', () => { nameIn.style.borderColor = 'rgba(37,99,235,0.5)' })
      nameIn.addEventListener('blur', () => { nameIn.style.borderColor = 'rgba(255,255,255,0.2)' })
      
      triggerRow.append(triggerLabel, nameIn)
      bar.appendChild(triggerRow)
    }
    
    // Command textarea (shown if addCommand is true)
    let commandIn = null
    if (addCommand) {
      const commandRow = document.createElement('div')
      commandRow.id = 'command-row'
      commandRow.style.cssText = 'display:flex; flex-direction:column; gap:4px;'
      
      const commandLabel = document.createElement('span')
      commandLabel.textContent = 'Command'
      commandLabel.style.cssText = 'font-size:11px; font-weight:600; opacity:0.8;'
      
      commandIn = document.createElement('textarea')
      commandIn.placeholder = 'Enter command or instructions...'
      commandIn.style.cssText = 'width:100%; min-height:60px; padding:6px 8px; border:1px solid rgba(255,255,255,0.2); border-radius:4px; font-size:12px; background:rgba(11,18,32,0.6); color:#e5e7eb; resize:vertical; box-sizing:border-box; line-height:1.4; font-family:inherit; outline:none;'
      commandIn.addEventListener('focus', () => { commandIn.style.borderColor = 'rgba(37,99,235,0.5)' })
      commandIn.addEventListener('blur', () => { commandIn.style.borderColor = 'rgba(255,255,255,0.2)' })
      
      commandRow.append(commandLabel, commandIn)
      bar.appendChild(commandRow)
    }
    
    // Buttons
    const buttonRow = document.createElement('div')
    buttonRow.style.cssText = 'display:flex; gap:6px;'
    
    const save = document.createElement('button')
    save.textContent = '💾 Save'
    save.style.cssText = 'flex:1; background:#2563eb;border:0;color:white;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;'
    save.addEventListener('mouseenter', () => { save.style.background = '#1d4ed8' })
    save.addEventListener('mouseleave', () => { save.style.background = '#2563eb' })
    
    const cancel = document.createElement('button')
    cancel.textContent = '✕ Cancel'
    cancel.style.cssText = 'flex:1; background:rgba(255,255,255,0.08);border:0;color:#e5e7eb;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:11px;'
    cancel.addEventListener('mouseenter', () => { cancel.style.background = 'rgba(255,255,255,0.15)' })
    cancel.addEventListener('mouseleave', () => { cancel.style.background = 'rgba(255,255,255,0.08)' })
    
    buttonRow.append(cancel, save)
    bar.appendChild(buttonRow)
    
    // Insert after toolkit, before messages
    const toolkit = wrap.querySelector('.toolkit')
    const messages = wrap.querySelector('.messages')
    if (toolkit && messages) {
      wrap.insertBefore(bar, messages)
    } else {
      wrap.insertBefore(bar, wrap.firstChild)
    }
    
    if (nameIn) nameIn.focus()
    else if (commandIn) commandIn.focus()
    
    cancel.onclick = () => bar.remove()
    
    const saveTrigger = () => {
      const name = nameIn ? ((nameIn.value || '').trim() || ('Trigger ' + new Date().toLocaleString())) : ''
      const command = commandIn ? (commandIn.value || '').trim() : ''
      
      // Save trigger if createTrigger is true
      if (createTrigger) {
        // Save to chrome.storage for extension dropdown
        try{
          const key='optimando-tagged-triggers'
          chrome.storage?.local?.get([key], (data)=>{
            const prev = Array.isArray(data?.[key]) ? data[key] : []
            prev.push({ name, at: Date.now(), rect, mode, displayId, command: command || undefined })
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
            videoUrl,
            command: command || undefined
          })
        }catch{}
      }
      
      // If only command is checked (no trigger), send command to chat
      if (addCommand && command && !createTrigger) {
        row('user', `📝 Command: ${command}`)
      }
      bar.remove()
    }
    
    save.onclick = saveTrigger
    if (nameIn) {
      nameIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && nameIn.value.trim()) saveTrigger()
        else if (e.key === 'Escape') bar.remove()
      })
    }
  }catch(err){
    console.log('Error showing trigger prompt:', err)
  }
}

// Allow cancel from the popup (×) to stop selection in Electron/content



