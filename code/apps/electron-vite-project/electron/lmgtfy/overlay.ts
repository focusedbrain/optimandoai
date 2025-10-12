import { BrowserWindow, screen } from 'electron'

export interface Selection {
  displayId: number
  x: number
  y: number
  w: number
  h: number
  dpr: number
}

let activeState: { overlays: BrowserWindow[]; finished: boolean; resolve: ((v: Selection | null) => void) | null } | null = null

export function cancelActiveSelection(): void {
  try {
    if (!activeState || activeState.finished) return
    activeState.finished = true
    const overlays = activeState.overlays || []
    overlays.forEach(w => { try { w.removeAllListeners('close'); w.close() } catch {} })
    const res = activeState.resolve
    activeState.resolve = null
    if (res) { try { res(null) } catch {} }
  } catch {}
}

// Module-level storage for active overlays so they can be closed from main.ts
let activeOverlays: BrowserWindow[] = []

export function closeAllOverlays() {
  activeOverlays.forEach(w => { try { w.removeAllListeners('close'); w.close() } catch {} })
  activeOverlays = []
}

// Fire-and-forget interactive overlay that stays open until closed or stopped (for popup parity)
export function beginOverlay(_expectedMode?: 'screenshot' | 'stream'): void {
  try {
    const displays = screen.getAllDisplays()
    const overlays: BrowserWindow[] = []
    let finished = false

    function closeAll(){ overlays.forEach(w => { try { w.removeAllListeners('close'); w.close() } catch {} }); activeOverlays = [] }

    function wire(win: BrowserWindow){
      win.webContents.on('ipc-message', (_e, channel, data) => {
        if (channel !== 'overlay-selection' || finished) return
          if (data?.cancel) { finished = true; closeAll() }
      })
      win.on('close', () => { /* noop */ })
    }

    for (const d of displays){
      const overlay = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        hasShadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: true,
        acceptFirstMouse: true,
        backgroundColor: '#00000000',
        titleBarStyle: 'hidden',
        fullscreenable: false,
        webPreferences: { 
          nodeIntegration: true, 
          contextIsolation: false, 
          backgroundThrottling: false,
          webSecurity: false,
          allowRunningInsecureContent: true,
          enableBlinkFeatures: 'GetUserMedia'
        }
      })
      overlays.push(overlay)
      activeOverlays.push(overlay)  // Track globally for main.ts to close
      overlay.setAlwaysOnTop(true, 'pop-up-menu')
      overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      try { overlay.setIgnoreMouseEvents(false, { forward: false } as any) } catch { try { overlay.setIgnoreMouseEvents(false) } catch {} }
      overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"/>
      <style>
        html,body{margin:0;height:100%;cursor:crosshair;-webkit-user-select:none;user-select:none}
        #lay{position:fixed;inset:0;touch-action:none}
        #box{position:fixed;border:2px dashed #0ea5e9;background:rgba(14,165,233,0.08);pointer-events:none;display:none}
        .tb{position:fixed;display:none;gap:8px;background:rgba(17,24,39,0.95);color:#fff;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);font-size:12px;pointer-events:auto;z-index:2147483648}
        .btn{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer}
        .btn.primary{background:#10b981;border-color:#10b981}
        .btn.stream{background:#3b82f6;border-color:#3b82f6}
        .btn.danger{background:#ef4444;border-color:#ef4444}
        .icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:4px}
        .icon.rec{background:#ef4444;color:#fff;font-weight:700}
        .icon.stop{background:#991b1b;color:#fff;font-weight:700}
      </style></head>
      <body>
        <div id="lay"></div>
        <div id="box"></div>
        <div id="tb" class="tb" role="toolbar" aria-label="Capture controls">
          <button id="shot" class="btn primary" aria-label="Screenshot">📸 Screenshot</button>
          <button id="stream" class="btn stream" aria-label="Start Recording">🎥 Stream</button>
          <button id="stop" class="btn danger" aria-label="Stop Recording" style="display:none">⬛ STOP</button>
          <label style="display:inline-flex;align-items:center;gap:6px;color:#fff;user-select:none"><input id="cbTrig" type="checkbox"/> <span>Create Trigger</span></label>
          <label style="display:inline-flex;align-items:center;gap:6px;color:#fff;user-select:none"><input id="cbCommand" type="checkbox"/> <span>Add Command</span></label>
          <button id="close" class="btn" aria-label="Close">✕</button>
        </div>
        <script>
          const DISPLAY_ID = ${d.id};
          const { ipcRenderer, desktopCapturer } = require('electron');
          const lay=document.getElementById('lay');
          const box=document.getElementById('box');
          let sx=0,sy=0,ex=0,ey=0,drag=false,locked=false,tbX=0,tbY=0
          const tb=document.getElementById('tb');
          const btnShot=document.getElementById('shot');
          const btnStream=document.getElementById('stream');
          const btnStop=document.getElementById('stop');
          const btnClose=document.getElementById('close');
          const timer=document.createElement('span');
          timer.style.cssText='color:#e5e7eb;opacity:.9;font-variant-numeric:tabular-nums;display:none;align-self:center';
          timer.id='og-timer';
          timer.textContent='00:00';
          try { tb.insertBefore(timer, btnStop.nextSibling) } catch { try { tb.insertBefore(timer, btnClose) } catch {} }
          const cbTrig=document.getElementById('cbTrig');
          const cbCommand=document.getElementById('cbCommand');
          function placeToolbar(){
            if (locked) { tb.style.left=tbX+'px'; tb.style.top=tbY+'px'; tb.style.display='flex'; return }
            const x=Math.min(sx,ex), y=Math.min(sy,ey);
            const left=Math.max(8, Math.min(window.innerWidth-300, x));
            const top=Math.max(8, y-36);
            tbX = left; tbY = top;
            tb.style.left=left+'px';
            tb.style.top=top+'px';
            tb.style.display='flex'
          }
          function onDown(e){ try{ e.preventDefault(); e.stopPropagation() }catch{}; try{ if (tb && (e.target && tb.contains(e.target))) return }catch{}; if (locked) return; drag=true; sx=e.clientX; sy=e.clientY; ex=sx; ey=sy; box.style.left=sx+'px'; box.style.top=sy+'px'; box.style.width='0px'; box.style.height='0px'; box.style.display='block'; try{ document.body.style.cursor='crosshair' }catch{} }
          function onMove(e){ if(!drag) return; try{ e.preventDefault(); e.stopPropagation() }catch{}; ex=e.clientX; ey=e.clientY; const x=Math.min(sx,ex), y=Math.min(sy,ey), w=Math.abs(ex-sx), h=Math.abs(ey-sy); box.style.left=x+'px'; box.style.top=y+'px'; box.style.width=w+'px'; box.style.height=h+'px' }
          function onUp(e){ try{ e.preventDefault(); e.stopPropagation() }catch{}; drag=false; ex=e.clientX; ey=e.clientY; placeToolbar(); locked=true; try{ document.body.style.cursor='default' }catch{} }
          window.addEventListener('mousedown', onDown, true)
          window.addEventListener('mousemove', onMove, true)
          window.addEventListener('mouseup', onUp, true)
          function confirmRect(){ const boxRect = box.getBoundingClientRect(); return {x:Math.round(boxRect.left),y:Math.round(boxRect.top),w:Math.round(boxRect.width),h:Math.round(boxRect.height)} }
          btnShot.addEventListener('click',(e)=>{ try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation() }catch{}; if(locked){ tb.style.left=tbX+'px'; tb.style.top=tbY+'px' } const r=confirmRect(); const createTrig=!!cbTrig.checked; const addCommand=!!cbCommand.checked; ipcRenderer.send('overlay-cmd',{ action:'shot', rect:r, displayId: DISPLAY_ID, createTrigger: createTrig, addCommand: addCommand, closeOverlay: true }) })
          btnStream.addEventListener('click',(e)=>{ 
            try{ e.preventDefault(); e.stopPropagation() }catch{}
            if(locked){ tb.style.left=tbX+'px'; tb.style.top=tbY+'px' }
            const r=confirmRect()
            const createTrig=!!cbTrig.checked
            const addCommand=!!cbCommand.checked
            // Send stream-start command to main process (main handles ALL recording)
            ipcRenderer.send('overlay-cmd',{ action:'stream-start', rect:r, displayId: DISPLAY_ID, createTrigger: createTrig, addCommand: addCommand })
            // Update UI
            btnStream.style.display='none'
            btnShot.style.display='none'
            btnStop.style.display='inline-block'
            timer.style.display='inline-block'
            timer.textContent='00:00'
            tb.style.display='flex'
            try{ startTimer() }catch{}
          })
          btnStop.addEventListener('click',(e)=>{ 
            try{ e.preventDefault(); e.stopPropagation() }catch{}
            if(locked){ tb.style.left=tbX+'px'; tb.style.top=tbY+'px' }
            // Send stream-stop command to main process (main will stop, post video, and close overlay)
            ipcRenderer.send('overlay-cmd',{ action:'stream-stop' })
          })
          try{ ipcRenderer.on('overlay-close', ()=>{ try{ window.close() }catch{} }) }catch{}
          let t0=0, tid=null; function startTimer(){ try{ t0=Date.now(); if(tid){clearInterval(tid)}; tid=setInterval(()=>{ try{ const s=Math.max(0, Math.floor((Date.now()-t0)/1000)); const m=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); timer.textContent=m+':'+ss }catch{} }, 1000) }catch{} }
          lay.addEventListener('pointerdown', (e)=>{ try{ e.preventDefault(); e.stopPropagation(); lay.setPointerCapture(e.pointerId) }catch{}; onDown(e) }, true)
          lay.addEventListener('pointermove', (e)=>{ onMove(e) }, true)
          lay.addEventListener('pointerup', (e)=>{ try{ lay.releasePointerCapture(e.pointerId) }catch{}; onUp(e) }, true)
          window.addEventListener('contextmenu', e=>{ try{ e.preventDefault(); e.stopPropagation() }catch{} })
          window.addEventListener('keydown',e=>{if(e.key==='Escape'){ipcRenderer.send('overlay-selection',{cancel:true})}})
          document.getElementById('close').addEventListener('click',()=>{ipcRenderer.send('overlay-selection',{cancel:true})})
        </script>
      </body></html>
      `))
      wire(overlay)
      try { overlay.once('ready-to-show', () => { try{ overlay.show(); overlay.focus() }catch{} }) } catch {}
      try { overlay.show(); overlay.focus() } catch {}
    }

    activeState = { overlays, finished: false, resolve: null }
  } catch {}
}

// Show pre-positioned overlay for stream trigger execution (visible recording)
export function showStreamTriggerOverlay(displayId: number, rect: { x: number, y: number, w: number, h: number }): void {
  try {
    const displays = screen.getAllDisplays()
    const display = displays.find(d => d.id === displayId) || displays[0]
    if (!display) return

    const overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      acceptFirstMouse: true,
      backgroundColor: '#00000000',
      titleBarStyle: 'hidden',
      fullscreenable: false,
      webPreferences: { 
        nodeIntegration: true, 
        contextIsolation: false, 
        backgroundThrottling: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        enableBlinkFeatures: 'GetUserMedia'
      }
    })
    
    activeOverlays.push(overlay)
    overlay.setAlwaysOnTop(true, 'pop-up-menu')
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    try { overlay.setIgnoreMouseEvents(false, { forward: false } as any) } catch { try { overlay.setIgnoreMouseEvents(false) } catch {} }
    
    overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"/>
    <style>
      html,body{margin:0;height:100%;-webkit-user-select:none;user-select:none;background:transparent}
      #box{position:fixed;border:2px dashed #ef4444;background:rgba(239,68,68,0.1);box-shadow:0 0 0 9999px rgba(0,0,0,0.3)}
      .tb{position:fixed;display:flex;gap:8px;background:rgba(17,24,39,0.95);color:#fff;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);font-size:12px;pointer-events:auto;z-index:2147483648}
      .btn{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.25);color:#fff;padding:4px 8px;border-radius:6px;cursor:pointer}
      .btn.danger{background:#ef4444;border-color:#ef4444}
    </style></head>
    <body>
      <div id="box" style="left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px"></div>
      <div id="tb" class="tb" style="left:${Math.max(8, rect.x)}px;top:${Math.max(8, rect.y - 36)}px" role="toolbar" aria-label="Recording controls">
        <span id="timer" style="color:#e5e7eb;opacity:.9;font-variant-numeric:tabular-nums">00:00</span>
        <button id="stop" class="btn danger" aria-label="Stop Recording">⬛ STOP</button>
        <button id="close" class="btn" aria-label="Close">✕</button>
      </div>
      <script>
        const { ipcRenderer } = require('electron');
        const timer = document.getElementById('timer');
        const btnStop = document.getElementById('stop');
        const btnClose = document.getElementById('close');
        
        // Start timer immediately
        let t0 = Date.now();
        const tid = setInterval(() => {
          try {
            const s = Math.max(0, Math.floor((Date.now() - t0) / 1000));
            const m = String(Math.floor(s / 60)).padStart(2, '0');
            const ss = String(s % 60).padStart(2, '0');
            timer.textContent = m + ':' + ss;
          } catch {}
        }, 1000);
        
        btnStop.addEventListener('click', (e) => {
          try { e.preventDefault(); e.stopPropagation() } catch {}
          clearInterval(tid);
          ipcRenderer.send('overlay-cmd', { action: 'stream-stop' });
        });
        
        btnClose.addEventListener('click', () => {
          clearInterval(tid);
          ipcRenderer.send('overlay-selection', { cancel: true });
        });
        
        window.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            clearInterval(tid);
            ipcRenderer.send('overlay-selection', { cancel: true });
          }
        });
        
        try { ipcRenderer.on('overlay-close', () => { try { clearInterval(tid); window.close() } catch {} }) } catch {}
      </script>
    </body></html>
    `))
    
    overlay.on('close', () => {
      activeOverlays = activeOverlays.filter(w => w !== overlay)
    })
    
    try { overlay.once('ready-to-show', () => { try { overlay.show(); overlay.focus() } catch {} }) } catch {}
    try { overlay.show(); overlay.focus() } catch {}
  } catch (err) {
    console.log('[OVERLAY] Error showing stream trigger overlay:', err)
  }
}


