import { BrowserWindow, screen } from 'electron'

export interface Selection {
  displayId: number
  x: number
  y: number
  w: number
  h: number
  dpr: number
}

export async function selectRegion(): Promise<Selection | null> {
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
        fullscreenable: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
      })
      overlays.push(overlay)
      overlay.setIgnoreMouseEvents(false)
      overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"/>
      <style>
        html,body{margin:0;height:100%;cursor:crosshair}
        canvas{width:100%;height:100%;display:block}
      </style></head>
      <body>
        <canvas id="c"></canvas>
        <script>
          const { ipcRenderer } = require('electron');
          const c=document.getElementById('c');
          const ctx=c.getContext('2d');
          function resize(){c.width=window.innerWidth*devicePixelRatio;c.height=window.innerHeight*devicePixelRatio;draw()}
          window.addEventListener('resize',resize);resize();
          let sx=0,sy=0,ex=0,ey=0,drag=false
          function draw(){ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='rgba(0,0,0,0.25)';ctx.fillRect(0,0,c.width,c.height);if(drag){const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy);ctx.clearRect(x,y,w,h);ctx.strokeStyle='rgba(255,255,255,0.9)';ctx.lineWidth=2*devicePixelRatio;ctx.setLineDash([6*devicePixelRatio,4*devicePixelRatio]);ctx.strokeRect(x,y,w,h)}}
          window.addEventListener('mousedown',e=>{drag=true;sx=e.clientX*devicePixelRatio;sy=e.clientY*devicePixelRatio;ex=sx;ey=sy;draw()})
          window.addEventListener('mousemove',e=>{if(!drag)return;ex=e.clientX*devicePixelRatio;ey=e.clientY*devicePixelRatio;draw()})
          window.addEventListener('mouseup',e=>{drag=false;ex=e.clientX*devicePixelRatio;ey=e.clientY*devicePixelRatio;const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy);ipcRenderer.send('overlay-selection',{x,y,w,h,dpr:devicePixelRatio})})
          window.addEventListener('keydown',e=>{if(e.key==='Escape'){ipcRenderer.send('overlay-selection',{cancel:true})}})
        </script>
      </body></html>
    `))
      wire(overlay, d.id, d.scaleFactor)
    }
  })
}


