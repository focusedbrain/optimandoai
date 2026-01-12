// =============================================================================
// HANDSHAKE STATE - MUST BE FIRST
// =============================================================================
// All handshake-related globals declared at very top to avoid hoisting issues
var HANDSHAKE_FINGERPRINT = '';
var HS_INITIALIZED = false;
var HANDSHAKE_MESSAGE_TEMPLATE = 'Dear [Recipient Name],\n\nI am writing to request the establishment of a BEAP™ (Bidirectional Email Automation Protocol) handshake between our systems.\n\nUpon successful completion, this handshake will enable:\n\n• Cryptographically verified BEAP™ package exchange\n• Policy-bound, trusted automation workflows\n• End-to-end encrypted, integrity-validated bidirectional communication\n\nThe handshake serves as the trust anchor for future interactions and ensures that all exchanged BEAP™ packages are processed in accordance with verified identity, declared execution policies, and local enforcement rules.\n\n**Handshake Fingerprint:** [FINGERPRINT]\n\nPlease verify this fingerprint matches what you expect before accepting.\n\nPlease confirm acceptance of this request to complete the handshake initialization.\n\nKind regards,\n[Your Name]\n[Organization]\n[Role / Function, if applicable]';

(function() {
  var chars = '0123456789ABCDEF';
  for (var i = 0; i < 64; i++) {
    HANDSHAKE_FINGERPRINT += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  console.log('[Popup] FINGERPRINT generated at top:', HANDSHAKE_FINGERPRINT);
})();

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
    t = t || 'standard'
    document.body.className = (t === 'standard') ? 'theme-standard' : (t === 'pro' ? 'theme-pro' : (t === 'dark' ? 'theme-dark' : 'theme-standard'))
  } catch { document.body.className = 'theme-standard' }
})()

const msgs = document.getElementById('msgs')
const ta = document.getElementById('ta')
const file = document.getElementById('file')
const up = document.getElementById('up')
const send = document.getElementById('send')
const sendDropdownBtn = document.getElementById('send-dropdown-btn')
const sendDropdown = document.getElementById('send-dropdown')
const modelList = document.getElementById('model-list')
const modelLabel = document.getElementById('model-label')
const bucketBtn = document.getElementById('tk-bucket')
const pencilBtn = document.getElementById('tk-pencil')
const ddTags = document.getElementById('tk-tags')
const cancelBtn = null

// LLM state
let availableModels = []
let activeModel = ''
let isModelDropdownOpen = false

// Fetch available models from Electron backend
async function fetchAvailableModels() {
  try {
    const baseUrl = 'http://127.0.0.1:51248'
    const response = await fetch(`${baseUrl}/api/llm/status`)
    const result = await response.json()
    
    if (result.ok && result.data?.modelsInstalled?.length > 0) {
      availableModels = result.data.modelsInstalled
      
      // Only set model if not already set OR if current selection no longer exists
      const modelStillExists = availableModels.some(m => m.name === activeModel)
      if (!activeModel || !modelStillExists) {
        activeModel = availableModels[0].name
        console.log('[Popup] Auto-selected model:', activeModel)
      }
      
      renderModelList()
      updateModelLabel()
      updateSendButtonState()
    }
  } catch (err) {
    console.log('[Popup] Failed to fetch models:', err)
  }
}

// Update send button appearance based on state
function updateSendButtonState() {
  if (!send) return
  
  const hasModel = activeModel && availableModels.length > 0
  const hasText = (ta?.value || '').trim().length > 0
  
  // Remove all state classes
  send.classList.remove('ready', 'no-model')
  
  if (hasModel && hasText) {
    send.classList.add('ready')
  } else if (!hasModel) {
    send.classList.add('no-model')
  }
}

// Get short model name for display
function getShortModelName(name) {
  if (!name) return 'Local'
  const baseName = name.split(':')[0]
  return baseName.length > 10 ? baseName.slice(0, 10) + '…' : baseName
}

// Update the model label on the send button
function updateModelLabel() {
  if (modelLabel) {
    modelLabel.textContent = availableModels.length > 0 ? getShortModelName(activeModel) : 'Local'
  }
}

// Render the model dropdown list
function renderModelList() {
  if (!modelList) return
  modelList.innerHTML = ''
  
  if (availableModels.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'send-dropdown-item'
    empty.innerHTML = '<span class="check"></span><span class="name" style="opacity:0.6">No models available</span>'
    modelList.appendChild(empty)
    return
  }
  
  availableModels.forEach(model => {
    const item = document.createElement('div')
    item.className = 'send-dropdown-item' + (model.name === activeModel ? ' active' : '')
    
    const check = document.createElement('span')
    check.className = 'check'
    check.textContent = model.name === activeModel ? '✓' : ''
    
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = model.name
    
    item.append(check, name)
    
    if (model.size) {
      const size = document.createElement('span')
      size.className = 'size'
      size.textContent = model.size
      item.appendChild(size)
    }
    
    item.onclick = (e) => {
      e.stopPropagation()
      activeModel = model.name
      isModelDropdownOpen = false
      sendDropdown.classList.remove('open')
      renderModelList()
      updateModelLabel()
      console.log('[Popup] Model selected:', activeModel)
    }
    
    modelList.appendChild(item)
  })
}

// Toggle model dropdown
if (sendDropdownBtn) {
  sendDropdownBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    isModelDropdownOpen = !isModelDropdownOpen
    sendDropdown.classList.toggle('open', isModelDropdownOpen)
  }
}

// Also prevent dropdown from closing when clicking inside it
if (sendDropdown) {
  sendDropdown.onclick = (e) => {
    e.stopPropagation()
  }
}

// Close dropdown when clicking outside
document.addEventListener('click', () => {
  if (isModelDropdownOpen) {
    isModelDropdownOpen = false
    sendDropdown?.classList.remove('open')
  }
})

// Initial fetch of models
fetchAvailableModels()

// Periodic refresh of models (every 10 seconds)
setInterval(fetchAvailableModels, 10000)

// Workspace and submode selectors
const workspaceSelect = document.getElementById('workspace-select')
const submodeSelect = document.getElementById('submode-select')

// Views
const chatView = document.getElementById('chat-view')
const overlayView = document.getElementById('overlay-view')
const mailguardView = document.getElementById('mailguard-view')
const p2pChatView = document.getElementById('p2p-chat-view')
const p2pStreamView = document.getElementById('p2p-stream-view')
const groupStreamView = document.getElementById('group-stream-view')
const handshakeView = document.getElementById('handshake-view')
const chatControls = document.getElementById('chat-controls')

// MailGuard elements
const mgTo = document.getElementById('mg-to')
const mgSubject = document.getElementById('mg-subject')
const mgBody = document.getElementById('mg-body')
const mgFile = document.getElementById('mg-file')
const mgAddPdf = document.getElementById('mg-add-pdf')
const mgAttachments = document.getElementById('mg-attachments')
const mgDiscard = document.getElementById('mg-discard')
const mgSend = document.getElementById('mg-send')
const mgHint = document.getElementById('mg-hint')

// MailGuard state
let mgAttachmentsList = []

// Hide all views
function hideAllViews() {
  chatView?.classList.add('hidden')
  overlayView?.classList.remove('active')
  mailguardView?.classList.remove('active')
  if (p2pChatView) p2pChatView.style.display = 'none'
  if (p2pStreamView) p2pStreamView.style.display = 'none'
  if (groupStreamView) groupStreamView.style.display = 'none'
  if (handshakeView) handshakeView.style.display = 'none'
  if (chatControls) chatControls.style.display = 'none'
}

// Update view based on workspace and submode
function updateView() {
  const workspace = workspaceSelect?.value || 'wr-chat'
  const submode = submodeSelect?.value || 'command'
  
  hideAllViews()
  
  // Show/hide submode selector based on workspace
  if (submodeSelect) {
    submodeSelect.style.display = workspace === 'wr-chat' ? '' : 'none'
  }
  
  if (workspace === 'wr-chat') {
    // Show controls for all modes except handshake
    if (chatControls) chatControls.style.display = submode !== 'handshake' ? 'flex' : 'none'
    
    switch (submode) {
      case 'command':
        chatView?.classList.remove('hidden')
        break
      case 'p2p-chat':
        if (p2pChatView) p2pChatView.style.display = 'flex'
        break
      case 'p2p-stream':
        if (p2pStreamView) p2pStreamView.style.display = 'flex'
        break
      case 'group-stream':
        if (groupStreamView) groupStreamView.style.display = 'flex'
        break
      case 'handshake':
        if (handshakeView) {
          handshakeView.style.display = 'flex'
          // Use setTimeout to ensure DOM is ready
          setTimeout(() => initHandshakeView(), 0)
        }
        break
    }
  } else if (workspace === 'augmented-overlay') {
    overlayView?.classList.add('active')
    if (chatControls) chatControls.style.display = 'none'
  } else if (workspace === 'mailguard') {
    mailguardView?.classList.add('active')
    updateMgHint()
    updateMgSendBtn()
  }
}

// Workspace change
if (workspaceSelect) {
  workspaceSelect.addEventListener('change', updateView)
}

// Submode change
if (submodeSelect) {
  submodeSelect.addEventListener('change', updateView)
}

// MailGuard hint visibility
function updateMgHint() {
  if (!mgHint) return
  const hasContent = (mgTo?.value || '').trim() || (mgSubject?.value || '').trim() || (mgBody?.value || '').trim() || mgAttachmentsList.length > 0
  mgHint.style.display = hasContent ? 'none' : 'flex'
}

// MailGuard send button state
function updateMgSendBtn() {
  if (!mgSend) return
  const canSend = (mgTo?.value || '').trim() && (mgSubject?.value || '').trim() && mgAttachmentsList.length > 0
  mgSend.disabled = !canSend
}

// MailGuard input listeners
if (mgTo) mgTo.addEventListener('input', () => { updateMgHint(); updateMgSendBtn() })
if (mgSubject) mgSubject.addEventListener('input', () => { updateMgHint(); updateMgSendBtn() })
if (mgBody) mgBody.addEventListener('input', updateMgHint)

// MailGuard attachments
function renderMgAttachments() {
  if (!mgAttachments) return
  if (mgAttachmentsList.length === 0) {
    mgAttachments.innerHTML = ''
    return
  }
  mgAttachments.innerHTML = mgAttachmentsList.map((att, idx) => `
    <div class="mg-att-chip">
      <span>📄</span>
      <span class="mg-att-name">${att.name}</span>
      <span class="mg-att-size">(${Math.round(att.size/1024)} KB)</span>
      <button class="mg-att-remove" data-idx="${idx}">×</button>
    </div>
  `).join('')
  mgAttachments.querySelectorAll('.mg-att-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-idx'))
      mgAttachmentsList = mgAttachmentsList.filter((_, i) => i !== idx)
      renderMgAttachments()
      updateMgHint()
      updateMgSendBtn()
    })
  })
}

if (mgAddPdf && mgFile) {
  mgAddPdf.addEventListener('click', () => mgFile.click())
  mgFile.addEventListener('change', () => {
    const files = Array.from(mgFile.files || [])
    const pdfFiles = files.filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    if (pdfFiles.length !== files.length) {
      alert('Only PDF files are allowed')
    }
    if (pdfFiles.length > 0) {
      mgAttachmentsList = [...mgAttachmentsList, ...pdfFiles.map(f => ({ name: f.name, size: f.size }))]
      renderMgAttachments()
      updateMgHint()
      updateMgSendBtn()
    }
    mgFile.value = ''
  })
}

// MailGuard discard
if (mgDiscard) {
  mgDiscard.addEventListener('click', () => {
    if (mgTo) mgTo.value = ''
    if (mgSubject) mgSubject.value = ''
    if (mgBody) mgBody.value = ''
    mgAttachmentsList = []
    renderMgAttachments()
    updateMgHint()
    updateMgSendBtn()
  })
}

// MailGuard send
if (mgSend) {
  mgSend.addEventListener('click', () => {
    const to = (mgTo?.value || '').trim()
    const subject = (mgSubject?.value || '').trim()
    const body = (mgBody?.value || '').trim()
    if (!to) { alert('Please enter a recipient'); return }
    if (!subject) { alert('Please enter a subject'); return }
    if (mgAttachmentsList.length === 0) { alert('Please attach at least one WR stamped PDF'); return }
    console.log('[WR MailGuard] Sending:', { to, subject, body, attachments: mgAttachmentsList.map(a => a.name) })
    alert('Protected email queued!')
    if (mgTo) mgTo.value = ''
    if (mgSubject) mgSubject.value = ''
    if (mgBody) mgBody.value = ''
    mgAttachmentsList = []
    renderMgAttachments()
    updateMgHint()
    updateMgSendBtn()
  })
}


function row(role, text){
  const r = document.createElement('div'); r.className = 'row ' + (role === 'user' ? 'user' : 'assistant');
  const b = document.createElement('div'); b.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant'); b.textContent = text; r.appendChild(b);
  msgs.appendChild(r); msgs.scrollTop = msgs.scrollHeight;
}

let isLoading = false

async function sendNow(){
  const text = (ta.value || '').trim()
  
  // If empty input, show helpful hint
  if (!text) {
    if (isLoading) return
    row('assistant', '💡 How to use WR Chat:\n\n• Ask questions about the orchestrator or your workflow\n• Trigger automations using #tagname (e.g., "#summarize")\n• Use the 📸 button to capture screenshots\n• Attach files with 📎 for context\n\nTry: "What can you help me with?" or "#help"')
    return
  }
  
  if (isLoading) return
  
  row('user', text)
  ta.value = ''
  updateSendButtonState()
  
  // If no model available, show placeholder response
  if (!activeModel || availableModels.length === 0) {
    setTimeout(() => row('assistant', '⚠️ No LLM model available. Please install a model in LLM Settings.'), 250)
    return
  }
  
  // Show loading state
  isLoading = true
  send.disabled = true
  send.classList.add('loading')
  const sendText = send.querySelector('.send-text')
  const originalText = sendText?.textContent || 'Send'
  if (sendText) sendText.textContent = '⏳ Thinking'
  
  try {
    const baseUrl = 'http://127.0.0.1:51248'
    const response = await fetch(`${baseUrl}/api/llm/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: activeModel,
        messages: [{ role: 'user', content: text }],
        stream: false
      })
    })
    
    const result = await response.json()
    
    if (result.ok && result.data?.message?.content) {
      row('assistant', result.data.message.content)
    } else {
      row('assistant', '⚠️ Error: ' + (result.error || 'Failed to get response'))
    }
  } catch (err) {
    console.error('[Popup] LLM error:', err)
    row('assistant', '⚠️ Failed to connect to LLM. Make sure Ollama is running.')
  } finally {
    isLoading = false
    send.disabled = false
    send.classList.remove('loading')
    if (sendText) sendText.textContent = originalText
  }
}
send.onclick = sendNow;
ta.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendNow(); }});
ta.addEventListener('input', updateSendButtonState);

up.onclick = () => file.click();
file.addEventListener('change', ()=>{ const n=(file.files||[]).length; if(n) row('user', 'Uploaded '+n+' file(s).'); });
['dragenter','dragover'].forEach(evt=> document.addEventListener(evt, e=>{ e.preventDefault(); }));
['dragleave','drop'].forEach(evt=> document.addEventListener(evt, e=>{ e.preventDefault(); }));
document.addEventListener('drop', e=>{ const n = (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) || 0; if(n) row('user', 'Dropped '+n+' file(s).'); });

// Voice input (optional)
const mic = document.getElementById('mic')
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
    recognition.onend = () => { recognizing = false; if (mic) mic.disabled = false; };
  } else {
    if (mic) { mic.disabled = true; mic.title = 'Voice not supported in this browser'; }
  }
} catch {
  if (mic) { mic.disabled = true; mic.title = 'Voice not supported in this browser'; }
}
if (mic) {
  mic.addEventListener('click', () => {
    if (!recognition || recognizing) return; recognizing = true; mic.disabled = true; try { recognition.start(); } catch {}
  });
}

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
      nameIn.style.cssText = 'width:100%; padding:6px 8px; border:1px solid rgba(255,255,255,0.2); border-radius:4px; font-size:12px; background:rgba(255,255,255,0.98); color:#000000; outline:none; box-sizing:border-box;'
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
      commandIn.placeholder = 'Quickly enhance the agent\'s default behaviour...'
      commandIn.style.cssText = 'width:100%; min-height:60px; padding:6px 8px; border:1px solid rgba(255,255,255,0.2); border-radius:4px; font-size:12px; background:rgba(255,255,255,0.98); color:#000000; resize:vertical; box-sizing:border-box; line-height:1.4; font-family:inherit; outline:none;'
      commandIn.addEventListener('focus', () => { commandIn.style.borderColor = 'rgba(37,99,235,0.5)' })
      commandIn.addEventListener('blur', () => { commandIn.style.borderColor = 'rgba(255,255,255,0.2)' })
      
      commandRow.append(commandLabel, commandIn)
      bar.appendChild(commandRow)
    }
    
    // Buttons
    const buttonRow = document.createElement('div')
    buttonRow.style.cssText = 'display:flex; gap:6px;'
    
    // Detect theme for Save button styling
    let btnTheme = 'default'
    try {
      const t = document.body.className
      if (t.includes('standard')) btnTheme = 'standard'
      else if (t.includes('dark')) btnTheme = 'dark'
    } catch {}
    const saveBtnColor = btnTheme === 'standard' ? '#9333ea' : '#10b981'
    const saveBtnHoverColor = btnTheme === 'standard' ? '#7c3aed' : '#059669'
    
    const save = document.createElement('button')
    save.textContent = '💾 Save'
    save.style.cssText = `flex:1; background:${saveBtnColor};border:0;color:white;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;`
    save.addEventListener('mouseenter', () => { save.style.background = saveBtnHoverColor })
    save.addEventListener('mouseleave', () => { save.style.background = saveBtnColor })
    
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
      
      // Post command to chat if addCommand is checked (regardless of createTrigger)
      if (addCommand && command) {
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

// ===== EMAIL ACCOUNTS SECTION =====
const mgConnectEmail = document.getElementById('mg-connect-email')
const mgAccountsList = document.getElementById('mg-accounts-list')
const mgAccountsLoading = document.getElementById('mg-accounts-loading')
const mgAccountsEmpty = document.getElementById('mg-accounts-empty')
const mgAccountsContent = document.getElementById('mg-accounts-content')
const mgAccountsActive = document.getElementById('mg-accounts-active')
const mgEmailWizard = document.getElementById('mg-email-wizard')
const mgWizardClose = document.getElementById('mg-wizard-close')
const mgConnectGmail = document.getElementById('mg-connect-gmail')

let emailAccounts = []

// Load email accounts from Electron
async function loadEmailAccounts() {
  if (mgAccountsLoading) mgAccountsLoading.style.display = 'block'
  if (mgAccountsEmpty) mgAccountsEmpty.style.display = 'none'
  if (mgAccountsContent) mgAccountsContent.style.display = 'none'
  if (mgAccountsActive) mgAccountsActive.style.display = 'none'
  
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime?.sendMessage({ type: 'EMAIL_LIST_ACCOUNTS' }, resolve)
    })
    
    if (response?.ok && response?.data) {
      emailAccounts = response.data
    } else {
      emailAccounts = []
    }
  } catch (err) {
    console.log('[Popup] Failed to load email accounts:', err)
    emailAccounts = []
  }
  
  renderEmailAccounts()
}

// Render email accounts list
function renderEmailAccounts() {
  if (mgAccountsLoading) mgAccountsLoading.style.display = 'none'
  
  if (emailAccounts.length === 0) {
    if (mgAccountsEmpty) mgAccountsEmpty.style.display = 'block'
    if (mgAccountsContent) mgAccountsContent.style.display = 'none'
    if (mgAccountsActive) mgAccountsActive.style.display = 'none'
  } else {
    if (mgAccountsEmpty) mgAccountsEmpty.style.display = 'none'
    if (mgAccountsContent) {
      mgAccountsContent.style.display = 'flex'
      mgAccountsContent.innerHTML = emailAccounts.map(account => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:rgba(255,255,255,0.08); border-radius:8px; border:1px solid ${account.status === 'active' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'};">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="font-size:18px;">${account.provider === 'gmail' ? '📧' : '✉️'}</span>
            <div>
              <div style="font-size:13px; font-weight:500;">${account.email || account.displayName || 'Account'}</div>
              <div style="font-size:10px; display:flex; align-items:center; gap:6px; margin-top:2px;">
                <span style="width:6px; height:6px; border-radius:50%; background:${account.status === 'active' ? '#22c55e' : '#ef4444'};"></span>
                <span style="opacity:0.6;">${account.status === 'active' ? 'Connected' : (account.lastError || 'Error')}</span>
              </div>
            </div>
          </div>
          <button onclick="disconnectEmailAccount('${account.id}')" style="background:transparent; border:none; opacity:0.5; cursor:pointer; font-size:14px; color:var(--text);">✕</button>
        </div>
      `).join('')
    }
    if (mgAccountsActive) mgAccountsActive.style.display = 'flex'
  }
}

// Wizard elements
const mgWizardProvider = document.getElementById('mg-wizard-provider')
const mgWizardImap = document.getElementById('mg-wizard-imap')
const mgWizardConnecting = document.getElementById('mg-wizard-connecting')
const mgConnectOutlook = document.getElementById('mg-connect-outlook')
const mgConnectImapBtn = document.getElementById('mg-connect-imap-btn')
const mgImapBack = document.getElementById('mg-imap-back')
const mgImapPreset = document.getElementById('mg-imap-preset')
const mgImapEmail = document.getElementById('mg-imap-email')
const mgImapHost = document.getElementById('mg-imap-host')
const mgImapPort = document.getElementById('mg-imap-port')
const mgImapUsername = document.getElementById('mg-imap-username')
const mgImapPassword = document.getElementById('mg-imap-password')
const mgImapConnect = document.getElementById('mg-imap-connect')

// IMAP presets storage
let imapPresets = {}

// Show wizard step
function showWizardStep(step) {
  if (mgWizardProvider) mgWizardProvider.style.display = step === 'provider' ? 'block' : 'none'
  if (mgWizardImap) mgWizardImap.style.display = step === 'imap' ? 'block' : 'none'
  if (mgWizardConnecting) mgWizardConnecting.style.display = step === 'connecting' ? 'block' : 'none'
}

// Reset wizard to initial state
function resetWizard() {
  showWizardStep('provider')
  if (mgImapEmail) mgImapEmail.value = ''
  if (mgImapHost) mgImapHost.value = ''
  if (mgImapPort) mgImapPort.value = '993'
  if (mgImapUsername) mgImapUsername.value = ''
  if (mgImapPassword) mgImapPassword.value = ''
  if (mgImapPreset) mgImapPreset.value = ''
}

// Load IMAP presets
async function loadImapPresets() {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime?.sendMessage({ type: 'EMAIL_GET_PRESETS' }, resolve)
    })
    
    if (response?.ok && response?.data) {
      imapPresets = response.data
      populatePresetDropdown()
    }
  } catch (err) {
    console.log('[Popup] Failed to load IMAP presets:', err)
  }
}

// Populate preset dropdown
function populatePresetDropdown() {
  if (!mgImapPreset) return
  
  // Clear existing options except first
  while (mgImapPreset.options.length > 1) {
    mgImapPreset.remove(1)
  }
  
  // Add preset options
  for (const [key, preset] of Object.entries(imapPresets)) {
    if (key !== 'custom') {
      const option = document.createElement('option')
      option.value = key
      option.textContent = preset.name
      mgImapPreset.appendChild(option)
    }
  }
  
  // Add custom option at the end
  const customOption = document.createElement('option')
  customOption.value = 'custom'
  customOption.textContent = 'Custom IMAP Server'
  mgImapPreset.appendChild(customOption)
}

// Apply IMAP preset
function applyImapPreset(presetKey) {
  const preset = imapPresets[presetKey]
  if (preset) {
    if (mgImapHost) mgImapHost.value = preset.host || ''
    if (mgImapPort) mgImapPort.value = preset.port || 993
  }
}

// Connect Gmail account
async function connectGmailAccount() {
  try {
    showWizardStep('connecting')
    
    const response = await new Promise((resolve) => {
      chrome.runtime?.sendMessage({ type: 'EMAIL_CONNECT_GMAIL' }, resolve)
    })
    
    if (response?.ok) {
      if (mgEmailWizard) mgEmailWizard.style.display = 'none'
      resetWizard()
      setTimeout(loadEmailAccounts, 1000)
    } else {
      console.log('[Popup] Gmail connection failed:', response?.error)
      alert(response?.error || 'Failed to connect Gmail')
      showWizardStep('provider')
    }
  } catch (err) {
    console.log('[Popup] Failed to connect Gmail:', err)
    alert('Failed to connect Gmail: ' + err.message)
    showWizardStep('provider')
  }
}

// Connect Outlook account
async function connectOutlookAccount() {
  try {
    showWizardStep('connecting')
    
    const response = await new Promise((resolve) => {
      chrome.runtime?.sendMessage({ type: 'EMAIL_CONNECT_OUTLOOK' }, resolve)
    })
    
    if (response?.ok) {
      if (mgEmailWizard) mgEmailWizard.style.display = 'none'
      resetWizard()
      setTimeout(loadEmailAccounts, 1000)
    } else {
      console.log('[Popup] Outlook connection failed:', response?.error)
      alert(response?.error || 'Failed to connect Outlook')
      showWizardStep('provider')
    }
  } catch (err) {
    console.log('[Popup] Failed to connect Outlook:', err)
    alert('Failed to connect Outlook: ' + err.message)
    showWizardStep('provider')
  }
}

// Connect IMAP account
async function connectImapAccount() {
  const email = mgImapEmail?.value?.trim()
  const host = mgImapHost?.value?.trim()
  const port = parseInt(mgImapPort?.value) || 993
  const username = mgImapUsername?.value?.trim() || email
  const password = mgImapPassword?.value
  
  if (!email || !host || !password) {
    alert('Please fill in all required fields')
    return
  }
  
  try {
    showWizardStep('connecting')
    
    const response = await new Promise((resolve) => {
      chrome.runtime?.sendMessage({
        type: 'EMAIL_CONNECT_IMAP',
        displayName: email,
        email,
        host,
        port,
        username,
        password,
        security: 'ssl'
      }, resolve)
    })
    
    if (response?.ok) {
      if (mgEmailWizard) mgEmailWizard.style.display = 'none'
      resetWizard()
      setTimeout(loadEmailAccounts, 1000)
    } else {
      console.log('[Popup] IMAP connection failed:', response?.error)
      alert(response?.error || 'Failed to connect email')
      showWizardStep('imap')
    }
  } catch (err) {
    console.log('[Popup] Failed to connect IMAP:', err)
    alert('Failed to connect: ' + err.message)
    showWizardStep('imap')
  }
}

// Disconnect email account (make it global for onclick)
window.disconnectEmailAccount = async function(accountId) {
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime?.sendMessage({ type: 'EMAIL_DELETE_ACCOUNT', accountId }, resolve)
    })
    
    if (response?.ok) {
      loadEmailAccounts()
    }
  } catch (err) {
    console.log('[Popup] Failed to disconnect account:', err)
  }
}

// Email wizard event listeners
if (mgConnectEmail) {
  mgConnectEmail.onclick = () => {
    if (mgEmailWizard) {
      resetWizard()
      mgEmailWizard.style.display = 'flex'
    }
  }
}

if (mgWizardClose) {
  mgWizardClose.onclick = () => {
    if (mgEmailWizard) mgEmailWizard.style.display = 'none'
    resetWizard()
  }
}

if (mgConnectGmail) {
  mgConnectGmail.onclick = connectGmailAccount
}

if (mgConnectOutlook) {
  mgConnectOutlook.onclick = connectOutlookAccount
}

if (mgConnectImapBtn) {
  mgConnectImapBtn.onclick = () => {
    loadImapPresets()
    showWizardStep('imap')
  }
}

if (mgImapBack) {
  mgImapBack.onclick = () => {
    showWizardStep('provider')
  }
}

if (mgImapPreset) {
  mgImapPreset.onchange = (e) => {
    applyImapPreset(e.target.value)
  }
}

if (mgImapEmail) {
  mgImapEmail.oninput = (e) => {
    // Auto-fill username with email
    if (mgImapUsername && !mgImapUsername.value) {
      mgImapUsername.value = e.target.value
    }
  }
}

if (mgImapConnect) {
  mgImapConnect.onclick = connectImapAccount
}

// Load accounts when switching to mailguard mode
if (modeSelect) {
  modeSelect.addEventListener('change', () => {
    if (modeSelect.value === 'mailguard') {
      loadEmailAccounts()
    }
  })
}

// Listen for account updates from Electron
try {
  chrome.runtime?.onMessage.addListener((msg) => {
    if (msg?.type === 'EMAIL_ACCOUNTS_UPDATED') {
      loadEmailAccounts()
    }
  })
} catch {}

// =============================================================================
// HANDSHAKE REQUEST FUNCTIONALITY
// =============================================================================

// Generate a mock fingerprint (64 hex chars)
function generateMockFingerprint() {
  const chars = '0123456789ABCDEF'
  let result = ''
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Format fingerprint for display with grouping
function formatFingerprintGrouped(fp) {
  if (!fp) return ''
  const groups = []
  for (let i = 0; i < fp.length; i += 4) {
    groups.push(fp.slice(i, i + 4))
  }
  return groups.join(' ')
}

// Format short fingerprint
function formatFingerprintShort(fp) {
  if (!fp || fp.length < 16) return fp || ''
  return fp.slice(0, 8) + '…' + fp.slice(-8)
}

// Handshake state - uses globals from top of file:
// - HANDSHAKE_FINGERPRINT
// - HS_INITIALIZED  
// - HANDSHAKE_MESSAGE_TEMPLATE

// Initialize handshake view
function initHandshakeView() {
  console.log('[Popup] initHandshakeView called - v2025.01')
  
  try {
    // Fingerprint is already generated at page load
    console.log('[Popup] Using fingerprint:', HANDSHAKE_FINGERPRINT)
    
    // Display fingerprint
    const fpFullEl = document.getElementById('hs-fingerprint-full')
    const fpShortEl = document.getElementById('hs-fingerprint-short')
    console.log('[Popup] Fingerprint elements:', { fpFullEl: !!fpFullEl, fpShortEl: !!fpShortEl })
    if (fpFullEl) fpFullEl.textContent = formatFingerprintGrouped(HANDSHAKE_FINGERPRINT)
    if (fpShortEl) fpShortEl.textContent = formatFingerprintShort(HANDSHAKE_FINGERPRINT)
    
    // Set default message with fingerprint
    const msgEl = document.getElementById('hs-message')
    console.log('[Popup] Message element found:', !!msgEl, 'tagName:', msgEl?.tagName)
    if (msgEl) {
      // Always set the message on first initialization, or if empty
      const currentValue = msgEl.value
      console.log('[Popup] Current message value length:', currentValue?.length || 0)
      
      if (!HS_INITIALIZED || !currentValue || currentValue.trim() === '') {
        const newValue = HANDSHAKE_MESSAGE_TEMPLATE.replace('[FINGERPRINT]', HANDSHAKE_FINGERPRINT)
        console.log('[Popup] Setting message, template length:', HANDSHAKE_MESSAGE_TEMPLATE.length)
        console.log('[Popup] New value length:', newValue.length)
        msgEl.value = newValue
        // Verify it was set
        console.log('[Popup] ✅ After setting, msgEl.value length:', msgEl.value.length)
        console.log('[Popup] First 100 chars:', msgEl.value.substring(0, 100))
      } else {
        console.log('[Popup] Message already has custom value, preserving')
      }
    } else {
      console.error('[Popup] ❌ hs-message element not found!')
    }
  } catch (err) {
    console.error('[Popup] Error in initHandshakeView:', err)
  }
  
  // Mark as initialized after first successful run
  if (!HS_INITIALIZED) {
    HS_INITIALIZED = true
  }
  
  // Copy fingerprint button
  const copyBtn = document.getElementById('hs-copy-fp')
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(HANDSHAKE_FINGERPRINT)
        copyBtn.textContent = '✓ Copied'
        setTimeout(() => { copyBtn.textContent = '📋 Copy' }, 2000)
      } catch (err) {
        console.error('Failed to copy:', err)
      }
    }
  }
  
  // Delivery method change
  const deliveryEl = document.getElementById('hs-delivery')
  const emailFieldsEl = document.getElementById('hs-email-fields')
  const sendIcon = document.getElementById('hs-send-icon')
  const sendText = document.getElementById('hs-send-text')
  
  // Function to update UI based on delivery method
  const updateDeliveryUI = () => {
    const method = deliveryEl?.value || 'email'
    console.log('[Popup] Updating delivery UI for method:', method)
    if (emailFieldsEl) {
      emailFieldsEl.style.display = method === 'email' ? 'flex' : 'none'
    }
    if (sendIcon && sendText) {
      if (method === 'email') {
        sendIcon.textContent = '📧'
        sendText.textContent = 'Send'
      } else if (method === 'messenger') {
        sendIcon.textContent = '💬'
        sendText.textContent = 'Insert'
      } else {
        sendIcon.textContent = '💾'
        sendText.textContent = 'Download'
      }
    }
  }
  
  if (deliveryEl) {
    deliveryEl.onchange = updateDeliveryUI
    // Trigger initial UI update
    updateDeliveryUI()
  }
  
  // Cancel button
  const cancelBtn = document.getElementById('hs-cancel')
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (submodeSelect) {
        submodeSelect.value = 'command'
        updateView()
      }
    }
  }
  
  // Send button
  const sendBtn = document.getElementById('hs-send')
  if (sendBtn) {
    sendBtn.onclick = () => {
      const method = deliveryEl?.value || 'email'
      const toEl = document.getElementById('hs-to')
      
      if (method === 'email' && (!toEl?.value || !toEl.value.trim())) {
        alert('Please enter a recipient email address')
        return
      }
      
      // TODO: Implement actual send/download logic
      const actionWord = method === 'download' ? 'downloaded' : 'sent'
      alert(`Handshake request ${actionWord} successfully!`)
      
      // Return to command view
      if (submodeSelect) {
        submodeSelect.value = 'command'
        updateView()
      }
    }
  }
}

// Initial view update on page load
updateView()
console.log('[Popup] Initial view updated, submode:', submodeSelect?.value)

// Pre-populate handshake elements immediately (even if not visible yet)
// This ensures the message is set before user switches to handshake view
setTimeout(() => {
  const msgEl = document.getElementById('hs-message')
  const fpFullEl = document.getElementById('hs-fingerprint-full')
  const fpShortEl = document.getElementById('hs-fingerprint-short')
  
  if (msgEl && (!msgEl.value || msgEl.value.trim() === '')) {
    const newValue = HANDSHAKE_MESSAGE_TEMPLATE.replace('[FINGERPRINT]', HANDSHAKE_FINGERPRINT)
    msgEl.value = newValue
    console.log('[Popup] Pre-populated message on page load, length:', newValue.length)
  }
  
  if (fpFullEl && !fpFullEl.textContent) {
    fpFullEl.textContent = formatFingerprintGrouped(HANDSHAKE_FINGERPRINT)
    console.log('[Popup] Pre-populated fingerprint full on page load')
  }
  
  if (fpShortEl && !fpShortEl.textContent) {
    fpShortEl.textContent = formatFingerprintShort(HANDSHAKE_FINGERPRINT)
    console.log('[Popup] Pre-populated fingerprint short on page load')
  }
}, 100)

