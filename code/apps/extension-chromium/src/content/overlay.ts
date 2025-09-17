/* eslint-disable @typescript-eslint/no-explicit-any */

type Layout = { leftW: number; rightW: number; topH: number; bottomH: number }
const DEFAULT_LAYOUT: Layout = { leftW: 280, rightW: 360, topH: 56, bottomH: 40 }

const STORAGE_KEY_LAYOUT = (host: string) => `og_overlay_layout:${host}`
const STORAGE_KEY_DISABLED = 'og_overlay_disabled_hosts'

declare global {
  interface Window { __ogOverlayInjected?: boolean }
}

function readLayout(host: string): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAYOUT(host))
    if (!raw) return { ...DEFAULT_LAYOUT }
    const parsed = JSON.parse(raw)
    return {
      leftW: typeof parsed.leftW === 'number' ? parsed.leftW : DEFAULT_LAYOUT.leftW,
      rightW: typeof parsed.rightW === 'number' ? parsed.rightW : DEFAULT_LAYOUT.rightW,
      topH: typeof parsed.topH === 'number' ? parsed.topH : DEFAULT_LAYOUT.topH,
      bottomH: typeof parsed.bottomH === 'number' ? parsed.bottomH : DEFAULT_LAYOUT.bottomH,
    }
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

function saveLayout(host: string, layout: Layout) {
  try { localStorage.setItem(STORAGE_KEY_LAYOUT(host), JSON.stringify(layout)) } catch {}
}

async function isDisabled(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get([STORAGE_KEY_DISABLED], (res) => {
        const arr = Array.isArray(res?.[STORAGE_KEY_DISABLED]) ? (res[STORAGE_KEY_DISABLED] as string[]) : []
        resolve(arr.includes(host))
      })
    } catch {
      resolve(false)
    }
  })
}

async function toggleDisabled(host: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get([STORAGE_KEY_DISABLED], (res) => {
        const arr = Array.isArray(res?.[STORAGE_KEY_DISABLED]) ? (res[STORAGE_KEY_DISABLED] as string[]) : []
        const idx = arr.indexOf(host)
        if (idx >= 0) {
          arr.splice(idx, 1)
        } else {
          arr.push(host)
        }
        chrome.storage.sync.set({ [STORAGE_KEY_DISABLED]: arr }, () => resolve())
      })
    } catch {
      resolve()
    }
  })
}

function makeStyle(css: string) {
  const s = document.createElement('style')
  s.textContent = css
  return s
}

function mountOverlay(): () => void {
  const host = location.host
  let layout: Layout = readLayout(host)

  const root = document.createElement('div')
  root.id = 'og-overlay-root'
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '2147483646', pointerEvents: 'none' as const,
    contain: 'layout paint style'
  })
  const shadow = root.attachShadow({ mode: 'open' })

  const base = /* css */ `
    :host, .layer { position: fixed; inset: 0; }
    *, *::before, *::after { box-sizing: border-box; }
    .panel { pointer-events: auto; position: fixed; background: rgba(20,22,25,.94); color:#fff; font:13px/1.3 system-ui,sans-serif; }
    .top { left:0; right:0; top:0; height: var(--topH); display:flex; align-items:center; gap:8px; padding:6px 10px; }
    .left { left:0; top: var(--topH); bottom: var(--bottomH); width: var(--leftW); }
    .right { right:0; top: var(--topH); bottom: var(--bottomH); width: var(--rightW); }
    .bottom { left: var(--leftW); right: var(--rightW); bottom:0; height: var(--bottomH); display:flex; align-items:center; padding:4px 8px; }
    .resizer { position:absolute; top:0; bottom:0; width:6px; cursor: ew-resize; }
    .resizer-h { position:absolute; left:0; right:0; height:6px; cursor: ns-resize; }
    .left .resizer { right:0; }
    .right .resizer { left:0; }
    .top .resizer-h { bottom:0; }
    .bottom .resizer-h { top:0; }
    .gear { margin-left:auto; opacity:.8; cursor:pointer; padding:4px 8px; border-radius:4px; border:1px solid rgba(255,255,255,.12); }
    .gear:hover { opacity:1; background: rgba(255,255,255,.06) }
    .frame { position:fixed; pointer-events:none; }
    .frame.inner { left: var(--leftW); right: var(--rightW); top: var(--topH); bottom: var(--bottomH); }
    .frame .line { position:absolute; background: rgba(255,255,255,.18); }
    .frame .line.h { height:1px; left:0; right:0; }
    .frame .line.v { width:1px; top:0; bottom:0; }
    /* Ensure no element can cover the center by accident */
    .guard-center { position: fixed; left: var(--leftW); right: var(--rightW); top: var(--topH); bottom: var(--bottomH); pointer-events: none; background: transparent; }
  `
  shadow.append(makeStyle(base))

  const dyn = document.createElement('style')
  dyn.id = 'dyn'
  shadow.append(dyn)

  function applyLayout(l: Layout) {
    dyn.textContent = `:host{ --leftW:${l.leftW}px; --rightW:${l.rightW}px; --topH:${l.topH}px; --bottomH:${l.bottomH}px; }`
  }
  applyLayout(layout)

  // Panels
  const top = document.createElement('div')
  top.className = 'panel top'
  top.innerHTML = `<div>Overlay</div><div class="gear" title="Toggle overlay for ${host}">⚙</div>`
  const left = document.createElement('div')
  left.className = 'panel left'
  const right = document.createElement('div')
  right.className = 'panel right'
  const bottom = document.createElement('div')
  bottom.className = 'panel bottom'

  const resL = document.createElement('div'); resL.className = 'resizer'
  const resR = document.createElement('div'); resR.className = 'resizer'
  const resT = document.createElement('div'); resT.className = 'resizer-h'
  const resB = document.createElement('div'); resB.className = 'resizer-h'
  left.appendChild(resL); right.appendChild(resR); top.appendChild(resT); bottom.appendChild(resB)

  // Frame borders (purely visual)
  const frame = document.createElement('div')
  frame.className = 'frame inner'
  frame.innerHTML = `
    <div class="line h" style="top:0"></div>
    <div class="line h" style="bottom:0"></div>
    <div class="line v" style="left:0"></div>
    <div class="line v" style="right:0"></div>
  `

  // Invisible guard to ensure center stays pass-through (defensive)
  const guard = document.createElement('div')
  guard.className = 'guard-center'

  shadow.append(top, left, right, bottom, frame, guard)

  // Resize behavior
  function onDrag(startX: number, startY: number, onMove: (dx: number, dy: number) => void) {
    const mm = (e: MouseEvent) => { onMove(e.clientX - startX, e.clientY - startY) }
    const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); saveDebounced() }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
  }

  resL.addEventListener('mousedown', (e) => {
    e.preventDefault(); const startX = e.clientX; const start = layout.leftW
    onDrag(startX, 0, (dx) => { layout.leftW = Math.max(120, Math.min(window.innerWidth - layout.rightW - 160, start + dx)); applyLayout(layout) })
  })
  resR.addEventListener('mousedown', (e) => {
    e.preventDefault(); const startX = e.clientX; const start = layout.rightW
    onDrag(startX, 0, (dx) => { layout.rightW = Math.max(120, Math.min(window.innerWidth - layout.leftW - 160, start - dx)); applyLayout(layout) })
  })
  resT.addEventListener('mousedown', (e) => {
    e.preventDefault(); const startY = e.clientY; const start = layout.topH
    onDrag(0, startY, (_dx, dy) => { layout.topH = Math.max(40, Math.min(window.innerHeight - layout.bottomH - 120, start + dy)); applyLayout(layout) })
  })
  resB.addEventListener('mousedown', (e) => {
    e.preventDefault(); const startY = e.clientY; const start = layout.bottomH
    onDrag(0, startY, (_dx, dy) => { layout.bottomH = Math.max(32, Math.min(window.innerHeight - layout.topH - 120, start - dy)); applyLayout(layout) })
  })

  // Persist layout (debounced)
  let saveT: number | undefined
  function saveDebounced() {
    if (saveT) window.clearTimeout(saveT)
    saveT = window.setTimeout(() => saveLayout(host, layout), 250)
  }

  // Fullscreen handling
  function onFullscreen() {
    if (document.fullscreenElement) root.style.display = 'none'
    else root.style.display = ''
  }
  document.addEventListener('fullscreenchange', onFullscreen)

  // Resize/visibility observers
  const updateLayout = () => applyLayout(layout)
  window.addEventListener('resize', updateLayout)
  document.addEventListener('visibilitychange', updateLayout)

  // Gear toggle
  top.querySelector('.gear')?.addEventListener('click', async () => {
    await toggleDisabled(host)
    cleanup()
  })

  document.documentElement.appendChild(root)

  function cleanup() {
    try { document.removeEventListener('fullscreenchange', onFullscreen) } catch {}
    try { window.removeEventListener('resize', updateLayout) } catch {}
    try { document.removeEventListener('visibilitychange', updateLayout) } catch {}
    if (root.parentNode) root.parentNode.removeChild(root)
  }

  return cleanup
}

async function bootstrap() {
  if ((window as any).__ogOverlayInjected) return
  (window as any).__ogOverlayInjected = true

  const host = location.host
  if (await isDisabled(host)) return

  let cleanup: (() => void) | null = null
  try {
    cleanup = mountOverlay()
  } catch (err) {
    console.error('[Overlay] Mount failed; disabling for domain', host, err)
    try { await toggleDisabled(host) } catch {}
    return
  }

  // Message toggle from background
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (!msg || !msg.type) return
    if (msg.type === 'OG_TOGGLE_OVERLAY') {
      ;(async () => {
        await toggleDisabled(host)
        if (cleanup) { cleanup(); cleanup = null } else { cleanup = mountOverlay() }
      })()
    }
  })
}

try { bootstrap() } catch {}


