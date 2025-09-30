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

export async function selectRegion(_expectedMode?: 'screenshot' | 'stream'): Promise<Selection | null> {
  return new Promise(resolve => {
    const displays = screen.getAllDisplays()
    const overlays: BrowserWindow[] = []
    let finished = false

    function closeAll(){
      overlays.forEach(w => { try { w.removeAllListeners('close'); w.close() } catch {} })
    }

    function wire(win: BrowserWindow, displayId: number, scaleFactor: number){
      win.webContents.on('ipc-message', (_e, channel, data) => {
        if (channel !== 'overlay-selection' || finished) return
        finished = true
        closeAll()
        if (data?.cancel) return resolve(null)
        resolve({ displayId, x: Math.round(data.x/scaleFactor), y: Math.round(data.y/scaleFactor), w: Math.round(data.w/scaleFactor), h: Math.round(data.h/scaleFactor), dpr: scaleFactor })
      })
      win.on('close', () => { if (!finished) { /* ignore */ } })
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
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
      })
      overlays.push(overlay)
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
          <button id="shot" class="btn primary" aria-label="Screenshot">Screenshot</button>
          <button id="stream" class="btn stream" aria-label="Stream">Stream</button>
          <button id="rec" class="btn danger" aria-label="Record" style="display:none">⏺</button>
          <button id="stop" class="btn danger" aria-label="Stop" style="display:none">⏹</button>
          <label style="display:inline-flex;align-items:center;gap:6px;color:#fff;user-select:none"><input id="cbTrig" type="checkbox"/> <span>Create Tagged Trigger</span></label>
          <button id="close" class="btn" aria-label="Close">×</button>
        </div>
        <script>
          const DISPLAY_ID = ${d.id};
          const { ipcRenderer, desktopCapturer, screen } = require('electron');
          const lay=document.getElementById('lay');
          const box=document.getElementById('box');
          let sx=0,sy=0,ex=0,ey=0,drag=false,locked=false,tbX=0,tbY=0
          const tb=document.getElementById('tb');
          const btnShot=document.getElementById('shot');
          const btnStream=document.getElementById('stream');
          const btnRec=document.getElementById('rec');
          const btnStop=document.getElementById('stop');
          try{ btnRec.innerHTML='<span class="icon rec">●</span>'; btnStop.innerHTML='<span class="icon stop">■</span>' }catch{}
          const btnClose=document.getElementById('close');
          const timer=document.createElement('span');
          timer.style.cssText='color:#e5e7eb;opacity:.9;font-variant-numeric:tabular-nums;display:none;align-self:center';
          timer.id='og-timer';
          timer.textContent='00:00';
          try { tb.insertBefore(timer, btnStop.nextSibling) } catch { try { tb.insertBefore(timer, btnClose) } catch {} }
          const cbTrig=document.getElementById('cbTrig');
          // Recording state (canvas-cropped stream)
          let recChunks=[]; let rec: any=null; let rafId=0; let srcStream: any=null; let videoEl: any=null; let cropCanvas: any=null; let cropCtx: any=null; let isRecording=false
          function getRect(){ const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy); const dpr=Math.max(1,(window.devicePixelRatio||1)); return { x: Math.round(x*dpr), y: Math.round(y*dpr), w: Math.round(w*dpr), h: Math.round(h*dpr) } }
          async function startRecording(){
            if (isRecording) return; isRecording=true; recChunks=[]
            const r = getRect()
            try{
              const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{width:1,height:1} })
              let src = sources.find((s:any)=> String(s.display_id||s.id) === String(DISPLAY_ID)) || null
              if (!src) {
                const idx = Math.max(0, sources.findIndex((s:any)=> (s.display_id||'')!==''))
                src = sources[idx] || sources[0]
              }
              const stream = await (navigator.mediaDevices as any).getUserMedia({
                audio: false,
                video: { mandatory: { chromeMediaSource:'desktop', chromeMediaSourceId: src.id } }
              })
              srcStream = stream
              videoEl = document.createElement('video'); videoEl.muted=true; videoEl.srcObject=stream; await videoEl.play()
              cropCanvas = document.createElement('canvas'); cropCanvas.width = Math.max(2, r.w); cropCanvas.height = Math.max(2, r.h)
              cropCtx = cropCanvas.getContext('2d')
              const draw = ()=>{ try{ cropCtx.drawImage(videoEl, r.x, r.y, r.w, r.h, 0, 0, cropCanvas.width, cropCanvas.height) }catch{}; rafId = requestAnimationFrame(draw) }
              rafId = requestAnimationFrame(draw)
              const outStream: MediaStream = (cropCanvas as any).captureStream(30)
              const opts: any = { mimeType: 'video/webm;codecs=vp9' }
              rec = new MediaRecorder(outStream, opts)
              rec.ondataavailable = (e:any)=>{ if(e && e.data && e.data.size) recChunks.push(e.data) }
              rec.onstop = async ()=>{
                try{ cancelAnimationFrame(rafId) }catch{}; rafId=0
                try{ (srcStream.getTracks()||[]).forEach((t:any)=> t.stop()) }catch{}
                try{ videoEl && videoEl.remove() }catch{}
                let dataUrl=''; try{ const blob = new Blob(recChunks, { type: 'video/webm' }); const fr = new FileReader(); dataUrl = await new Promise<string>((resolve)=>{ fr.onload=()=>resolve(String(fr.result||'')); fr.readAsDataURL(blob) }) }catch{}
                ipcRenderer.send('overlay-cmd', { action:'stream-post', dataUrl })
                isRecording=false
              }
              rec.start(250)
              try{ startTimer() }catch{}
            }catch{ isRecording=false }
          }
          function stopRecording(){ try{ if(rec && rec.state!=='inactive') rec.stop() }catch{}; try{ if(rafId) cancelAnimationFrame(rafId) }catch{}; try{ if(srcStream) (srcStream.getTracks()||[]).forEach((t:any)=> t.stop()) }catch{}; try{ isRecording=false }catch{} }
          function placeToolbar(){
            if (locked) { tb.style.left=tbX+'px'; tb.style.top=tbY+'px'; tb.style.display='flex'; return }
            const x=Math.min(sx,ex), y=Math.min(sy,ey);
            const left=Math.max(8, Math.min(window.innerWidth-300, x));
            const top=Math.max(8, y-36);
            tbX = left; tbY = top;
            tb.style.left=left+'px';
            tb.style.top=top+'px';
            tb.style.display='flex';
          }
          function onDown(e){
            try{ e.preventDefault(); e.stopPropagation() }catch{}
            // Ignore presses on the toolbar so the rectangle sticks while using controls
            try{ if (tb && (e.target && tb.contains(e.target))) return }catch{}
            if (locked) return
            drag=true; sx=e.clientX; sy=e.clientY; ex=sx; ey=sy;
            box.style.left=sx+'px'; box.style.top=sy+'px'; box.style.width='0px'; box.style.height='0px'; box.style.display='block'
            try{ document.body.style.cursor='crosshair' }catch{}
          }
          function onMove(e){ if(!drag) return; try{ e.preventDefault(); e.stopPropagation() }catch{}; ex=e.clientX; ey=e.clientY; const x=Math.min(sx,ex), y=Math.min(sy,ey), w=Math.abs(ex-sx), h=Math.abs(ey-sy); box.style.left=x+'px'; box.style.top=y+'px'; box.style.width=w+'px'; box.style.height=h+'px' }
          function onUp(e){ try{ e.preventDefault(); e.stopPropagation() }catch{}; drag=false; ex=e.clientX; ey=e.clientY; placeToolbar(); locked=true; try{ document.body.style.cursor='default' }catch{} }
          // Mouse events (fallback)
          window.addEventListener('mousedown', onDown, true)
          window.addEventListener('mousemove', onMove, true)
          window.addEventListener('mouseup', onUp, true)
          // After selection is confirmed, restore transparency
          function confirmRect(){
            const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy);
            const dpr = Math.max(1, (window.devicePixelRatio||1));
            return {x:Math.round(x*dpr),y:Math.round(y*dpr),w:Math.round(w*dpr),h:Math.round(h*dpr)}
          }
          btnShot.addEventListener('click',(e)=>{
            try{ e.preventDefault(); e.stopPropagation() }catch{}
            const r=confirmRect();
            ipcRenderer.send('overlay-cmd',{ action:'shot', rect:r, displayId: DISPLAY_ID, createTrigger: !!cbTrig.checked });
            // Do not close here; main will close only after posting is done
          })
          btnStream.addEventListener('click',(e)=>{ try{ e.preventDefault(); e.stopPropagation() }catch{}; btnRec.style.display='inline-block'; btnStop.style.display='inline-block'; timer.style.display='inline-block'; timer.textContent='00:00'; tb.style.display='flex' })
          btnRec.addEventListener('click', async (e)=>{ try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation() }catch{}; try{ tb.style.display='flex' }catch{}; await startRecording() })
          btnStop.addEventListener('click',(e)=>{ try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation() }catch{}; stopRecording() })
          try{ cbTrig.addEventListener('click', (e)=>{ try{ e.stopPropagation() }catch{} }) }catch{}
          // Allow main to close the overlay when done (after posting)
          try{ ipcRenderer.on('overlay-close', ()=>{ try{ window.close() }catch{} }) }catch{}
          // Timer helpers
          let t0=0, tid=null; function startTimer(){ try{ t0=Date.now(); if(tid){clearInterval(tid)}; tid=setInterval(()=>{ try{ const s=Math.max(0, Math.floor((Date.now()-t0)/1000)); const m=String(Math.floor(s/60)).padStart(2,'0'); const ss=String(s%60).padStart(2,'0'); timer.textContent=m+':'+ss }catch{} }, 1000) }catch{} }
          lay.addEventListener('pointerdown', (e)=>{ try{ e.preventDefault(); e.stopPropagation(); lay.setPointerCapture(e.pointerId) }catch{}; onDown(e) }, true)
          lay.addEventListener('pointermove', (e)=>{ onMove(e) }, true)
          lay.addEventListener('pointerup', (e)=>{ try{ lay.releasePointerCapture(e.pointerId) }catch{}; onUp(e) }, true)
          window.addEventListener('contextmenu', e=>{ try{ e.preventDefault(); e.stopPropagation() }catch{} })
          window.addEventListener('keydown',e=>{if(e.key==='Escape'){ipcRenderer.send('overlay-selection',{cancel:true})}})
          btnClose.addEventListener('click',()=>{ipcRenderer.send('overlay-selection',{cancel:true})})
          // Legacy overlay-selection actions disabled to keep rectangle until posting completes
          try{ cbTrig.addEventListener('click',(e)=>{ try{ e.stopPropagation() }catch{} }) }catch{}
        </script>
      </body></html>
    `))
      wire(overlay, d.id, d.scaleFactor)
      try {
        overlay.once('ready-to-show', () => { try{ overlay.show(); overlay.focus() }catch{} })
        overlay.show(); overlay.focus()
      } catch {}
    }

    // Track active selection so it can be cancelled externally
    activeState = { overlays, finished: false, resolve: (v) => { try { resolve(v) } catch {} } }
  })
}


// Fire-and-forget interactive overlay that stays open until closed or stopped (for popup parity)
export function beginOverlay(_expectedMode?: 'screenshot' | 'stream'): void {
  try {
    const displays = screen.getAllDisplays()
    const overlays: BrowserWindow[] = []
    let finished = false

    function closeAll(){ overlays.forEach(w => { try { w.removeAllListeners('close'); w.close() } catch {} }) }

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
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
      })
      overlays.push(overlay)
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
          <button id="shot" class="btn primary" aria-label="Screenshot">Screenshot</button>
          <button id="stream" class="btn stream" aria-label="Stream">Stream</button>
          <button id="rec" class="btn danger" aria-label="Record" style="display:none">⏺</button>
          <button id="stop" class="btn danger" aria-label="Stop" style="display:none">⏹</button>
          <label style="display:inline-flex;align-items:center;gap:6px;color:#fff;user-select:none"><input id="cbTrig" type="checkbox"/> <span>Create Tagged Trigger</span></label>
          <button id="close" class="btn" aria-label="Close">×</button>
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
          const btnRec=document.getElementById('rec');
          const btnStop=document.getElementById('stop');
          try{ btnRec.innerHTML='<span class="icon rec">●</span>'; btnStop.innerHTML='<span class="icon stop">■</span>' }catch{}
          const btnClose=document.getElementById('close');
          const timer=document.createElement('span');
          timer.style.cssText='color:#e5e7eb;opacity:.9;font-variant-numeric:tabular-nums;display:none;align-self:center';
          timer.id='og-timer';
          timer.textContent='00:00';
          try { tb.insertBefore(timer, btnStop.nextSibling) } catch { try { tb.insertBefore(timer, btnClose) } catch {} }
          const cbTrig=document.getElementById('cbTrig');
          // In-renderer recording (cropped to selected rect) so Stop can post immediately
          let recChunks=[]; let rec=null; let rafId=0; let srcStream=null; let videoEl=null; let cropCanvas=null; let cropCtx=null; let isRecording=false
          function getRect(){ const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy); const dpr=Math.max(1,(window.devicePixelRatio||1)); return { x: Math.round(x*dpr), y: Math.round(y*dpr), w: Math.round(w*dpr), h: Math.round(h*dpr) } }
          async function startRecording(){
            if (isRecording) return; isRecording=true; recChunks=[]
            const r = getRect()
            try{
              const sources = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{width:1,height:1} })
              let src = sources.find((s)=> String((s).display_id||(s).id) === String(DISPLAY_ID)) || null
              if (!src) src = sources[0]
              const stream = await (navigator.mediaDevices).getUserMedia({ audio:false, video:{ mandatory:{ chromeMediaSource:'desktop', chromeMediaSourceId: (src).id } } })
              srcStream = stream
              videoEl = document.createElement('video'); (videoEl).muted=true; (videoEl).srcObject=stream; await (videoEl).play()
              cropCanvas = document.createElement('canvas'); (cropCanvas).width=Math.max(2,r.w); (cropCanvas).height=Math.max(2,r.h)
              cropCtx = (cropCanvas).getContext('2d')
              const draw=()=>{ try{ cropCtx.drawImage(videoEl, r.x, r.y, r.w, r.h, 0, 0, (cropCanvas).width, (cropCanvas).height) }catch{}; rafId=requestAnimationFrame(draw) }
              rafId=requestAnimationFrame(draw)
              const outStream = (cropCanvas).captureStream(30)
              const opts = { mimeType: 'video/webm;codecs=vp9' }
              rec = new (window).MediaRecorder(outStream, opts)
              ;(rec).ondataavailable=(e)=>{ if(e && e.data && e.data.size) recChunks.push(e.data) }
              ;(rec).onstop=async ()=>{
                try{ cancelAnimationFrame(rafId) }catch{}; rafId=0
                try{ (srcStream)?.getTracks?.().forEach((t)=> t.stop()) }catch{}
                try{ (videoEl)?.remove?.() }catch{}
                let dataUrl=''; try{ const blob = new Blob(recChunks, { type: 'video/webm' }); const fr = new FileReader(); dataUrl = await new Promise((resolve)=>{ fr.onload=()=>resolve(String(fr.result||'')); fr.readAsDataURL(blob) }) }catch{}
                ipcRenderer.send('overlay-cmd', { action:'stream-post', dataUrl })
                isRecording=false
              }
              ;(rec).start(250)
              try{ startTimer() }catch{}
            }catch{ isRecording=false }
          }
          function stopRecording(){ try{ (rec) && (rec).state!=='inactive' && (rec).stop() }catch{}; try{ if(rafId) cancelAnimationFrame(rafId) }catch{}; try{ (srcStream)?.getTracks?.().forEach((t)=> t.stop()) }catch{}; isRecording=false }
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
          function confirmRect(){ const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy); const dpr=Math.max(1,(window.devicePixelRatio||1)); return {x:Math.round(x*dpr),y:Math.round(y*dpr),w:Math.round(w*dpr),h:Math.round(h*dpr)} }
          btnShot.addEventListener('click',(e)=>{ try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation() }catch{}; if(locked){ tb.style.left=tbX+'px'; tb.style.top=tbY+'px' } const r=confirmRect(); const createTrig=!!cbTrig.checked; let triggerName=''; if(createTrig){ try{ triggerName = window.prompt('Trigger name?')||'' }catch{} } ipcRenderer.send('overlay-cmd',{ action:'shot', rect:r, displayId: DISPLAY_ID, createTrigger: createTrig, triggerName }) })
          btnStream.addEventListener('click',(e)=>{ try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation() }catch{}; if(locked){ tb.style.left=tbX+'px'; tb.style.top=tbY+'px' } btnRec.style.display='inline-block'; btnStop.style.display='inline-block'; timer.style.display='inline-block'; timer.textContent='00:00'; tb.style.display='flex' })
          btnRec.addEventListener('click',(e)=>{ try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation() }catch{}; if(locked){ tb.style.left=tbX+'px'; tb.style.top=tbY+'px' } const r=confirmRect(); const createTrig=!!cbTrig.checked; let triggerName=''; if(createTrig){ try{ triggerName = window.prompt('Trigger name?')||'' }catch{} } ipcRenderer.send('overlay-cmd',{ action:'stream-start', rect:r, displayId: DISPLAY_ID, createTrigger: createTrig, triggerName }); try{ startTimer(); tb.style.display='flex' }catch{} })
          btnStop.addEventListener('click',(e)=>{ try{ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation() }catch{}; if(locked){ tb.style.left=tbX+'px'; tb.style.top=tbY+'px' } ipcRenderer.send('overlay-cmd',{ action:'stream-stop' }) })
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


