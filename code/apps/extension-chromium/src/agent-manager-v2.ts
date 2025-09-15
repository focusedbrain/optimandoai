/// <reference types="chrome-types"/>

// Agent Manager V2 - clean, isolated, minimal dependencies
// - Coexists with legacy code without touching it
// - Persists to active session in chrome.storage.local

type AgentV2 = {
  id: string
  name: string
  icon: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

type AgentEvent = {
  id: string
  type: 'add' | 'delete' | 'update'
  at: string
  payload?: any
}

function getCurrentSessionKey(): string | null {
  try {
    const k = sessionStorage.getItem('optimando-current-session-key')
    if (k) return k
  } catch {}
  try {
    const g = localStorage.getItem('optimando-global-active-session')
    if (g) {
      try { sessionStorage.setItem('optimando-current-session-key', g) } catch {}
      return g
    }
  } catch {}
  return null
}

function setCurrentSessionKey(key: string) {
  try {
    sessionStorage.setItem('optimando-current-session-key', key)
    localStorage.setItem('optimando-global-active-session', key)
    localStorage.setItem('optimando-global-active-session-time', Date.now().toString())
  } catch {}
}

function ensureActiveSession(cb: (key: string, session: any) => void) {
  try {
    const existing = getCurrentSessionKey()
    if (existing) {
      chrome.storage.local.get([existing], (all: any) => {
        const session = (all && all[existing]) || {}
        if (!Array.isArray(session.agentsV2)) session.agentsV2 = []
        if (!Array.isArray(session.agentEvents)) session.agentEvents = []
        if (!session.tabName) session.tabName = document.title || 'Unnamed Session'
        if (!session.url) session.url = location.href
        if (!session.timestamp) session.timestamp = new Date().toISOString()
        cb(existing, session)
      })
      return
    }
  } catch {}

  const newKey = `session_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  setCurrentSessionKey(newKey)
  const session: any = {
    tabName: document.title || 'Unnamed Session',
    url: location.href,
    timestamp: new Date().toISOString(),
    agentsV2: [],
    agentEvents: []
  }
  chrome.storage.local.set({ [newKey]: session }, () => cb(newKey, session))
}

function persistSession(key: string, session: any, cb?: () => void) {
  session.timestamp = new Date().toISOString()
  try {
    chrome.storage.local.set({ [key]: session }, () => cb && cb())
  } catch {
    cb && cb()
  }
}

function addAgent(name: string, icon: string, cb?: (list: AgentV2[]) => void) {
  ensureActiveSession((key, session) => {
    const now = new Date().toISOString()
    const id = `ag_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    const agent: AgentV2 = { id, name: name || 'Agent', icon: icon || '🤖', enabled: true, createdAt: now, updatedAt: now }
    session.agentsV2 = Array.isArray(session.agentsV2) ? session.agentsV2 : []
    session.agentsV2.push(agent)
    session.agentEvents = Array.isArray(session.agentEvents) ? session.agentEvents : []
    session.agentEvents.push({ id, type: 'add', at: now, payload: { name, icon } } as AgentEvent)
    persistSession(key, session, () => cb && cb(session.agentsV2))
  })
}

function removeAgent(id: string, cb?: (list: AgentV2[]) => void) {
  ensureActiveSession((key, session) => {
    const now = new Date().toISOString()
    const list: AgentV2[] = Array.isArray(session.agentsV2) ? session.agentsV2 : []
    const toDelete = list.find(a => a.id === id)
    session.agentsV2 = list.filter(a => a.id !== id)
    session.agentEvents = Array.isArray(session.agentEvents) ? session.agentEvents : []
    session.agentEvents.push({ id, type: 'delete', at: now, payload: toDelete ? { name: toDelete.name, icon: toDelete.icon } : undefined } as AgentEvent)
    persistSession(key, session, () => cb && cb(session.agentsV2))
  })
}

function toggleAgent(id: string, cb?: (list: AgentV2[]) => void) {
  ensureActiveSession((key, session) => {
    const now = new Date().toISOString()
    const list: AgentV2[] = Array.isArray(session.agentsV2) ? session.agentsV2 : []
    session.agentsV2 = list.map(a => a.id === id ? { ...a, enabled: !a.enabled, updatedAt: now } : a)
    session.agentEvents = Array.isArray(session.agentEvents) ? session.agentEvents : []
    session.agentEvents.push({ id, type: 'update', at: now } as AgentEvent)
    persistSession(key, session, () => cb && cb(session.agentsV2))
  })
}

function ensureUI(){
  if (document.getElementById('om2-agents-btn')) return
  const btn = document.createElement('button')
  btn.id = 'om2-agents-btn'
  btn.textContent = '🤖 Agents'
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;padding:10px 12px;background:#1f2937;color:#fff;border:none;border-radius:18px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25)'
  btn.onclick = openOverlay
  document.body.appendChild(btn)
}

function openOverlay(){
  let overlay = document.getElementById('om2-overlay') as HTMLElement | null
  if (overlay) overlay.remove()
  overlay = document.createElement('div')
  overlay.id = 'om2-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);z-index:2147483647;display:flex;align-items:center;justify-content:center'
  overlay.onclick = (e:any)=>{ if (e.target === overlay) overlay?.remove() }

  const panel = document.createElement('div')
  panel.style.cssText = 'width:720px;max-width:92vw;max-height:82vh;overflow:auto;background:#0b1220;color:#e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4)'
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)">
      <div style="font-weight:700">Agent Manager</div>
      <div>
        <button id="om2-add" style="padding:8px 10px;background:#22c55e;border:none;color:#07210f;border-radius:6px;cursor:pointer;font-weight:700">Add</button>
        <button id="om2-close" style="margin-left:8px;padding:8px 10px;background:#475569;border:none;color:#e2e8f0;border-radius:6px;cursor:pointer">Close</button>
      </div>
    </div>
    <div id="om2-list" style="padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px"></div>
  `
  overlay.appendChild(panel)
  document.body.appendChild(overlay)

  const closeBtn = panel.querySelector('#om2-close') as HTMLButtonElement
  closeBtn.onclick = () => overlay?.remove()
  const addBtn = panel.querySelector('#om2-add') as HTMLButtonElement
  addBtn.onclick = () => {
    const name = prompt('Agent name', 'New Agent') || ''
    if (!name.trim()) return
    const icon = prompt('Agent icon (emoji)', '🤖') || '🤖'
    addAgent(name.trim(), icon.trim(), ()=> renderList(panel.querySelector('#om2-list') as HTMLElement))
  }

  renderList(panel.querySelector('#om2-list') as HTMLElement)
}

function renderList(container: HTMLElement){
  if (!container) return
  ensureActiveSession((_key, session)=>{
    const agents: AgentV2[] = Array.isArray(session.agentsV2) ? session.agentsV2 : []
    container.innerHTML = ''
    if (agents.length === 0) {
      const empty = document.createElement('div')
      empty.style.cssText = 'opacity:.8;font-size:12px;padding:20px;background:#0b1220;border:1px dashed rgba(255,255,255,.12);border-radius:8px'
      empty.textContent = 'No agents yet. Click Add to create your first agent.'
      container.appendChild(empty)
      return
    }
    agents.forEach(a => {
      const card = document.createElement('div')
      card.style.cssText = 'background:#0b1220;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px;display:flex;gap:10px;align-items:center;justify-content:space-between'
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <div style="font-size:22px">${a.icon}</div>
          <div>
            <div style="font-weight:700">${a.name}</div>
            <div style="opacity:.6;font-size:11px">${a.enabled ? 'Enabled' : 'Disabled'}</div>
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button data-id="${a.id}" class="om2-toggle" style="padding:6px 8px;border:none;border-radius:6px;cursor:pointer;background:${a.enabled ? '#334155' : '#22c55e'};color:#fff">${a.enabled ? 'Disable' : 'Enable'}</button>
          <button data-id="${a.id}" class="om2-del" style="padding:6px 8px;border:none;border-radius:6px;cursor:pointer;background:#ef4444;color:#fff">Delete</button>
        </div>
      `
      container.appendChild(card)
    })
    container.querySelectorAll('.om2-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).getAttribute('data-id') || ''
        toggleAgent(id, () => renderList(container))
      })
    })
    container.querySelectorAll('.om2-del').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).getAttribute('data-id') || ''
        if (!confirm('Delete this agent?')) return
        removeAgent(id, () => renderList(container))
      })
    })
  })
}

function boot(){
  try {
    // visible proof of load (auto-removes)
    try {
      const badge = document.createElement('div')
      badge.textContent = 'Agents v2 active'
      badge.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:#16a34a;color:#fff;font:12px/1.2 system-ui;padding:6px 8px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25)'
      document.body.appendChild(badge)
      setTimeout(()=> badge.remove(), 4000)
      ;(window as any).__OM2_LOADED = true
      console.log('[OM2] Agent Manager v2 booted')
    } catch {}
    ensureUI()
    window.addEventListener('keydown', (e:any)=>{
      if (e.altKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) openOverlay()
    })
  } catch (e){ /* ignore */ }
}

setTimeout(boot, 800)

export {}


