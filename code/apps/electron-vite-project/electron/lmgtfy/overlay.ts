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
    const { bounds, scaleFactor, id } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const overlay = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      fullscreenable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })

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
          const c=document.getElementById('c');
          const ctx=c.getContext('2d');
          function resize(){c.width=window.innerWidth*devicePixelRatio;c.height=window.innerHeight*devicePixelRatio;draw()}
          window.addEventListener('resize',resize);resize();
          let sx=0,sy=0,ex=0,ey=0,drag=false
          function draw(){ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='rgba(0,0,0,0.25)';ctx.fillRect(0,0,c.width,c.height);if(drag){const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy);ctx.clearRect(x,y,w,h);ctx.strokeStyle='rgba(255,255,255,0.9)';ctx.lineWidth=2*devicePixelRatio;ctx.setLineDash([6*devicePixelRatio,4*devicePixelRatio]);ctx.strokeRect(x,y,w,h)}}
          window.addEventListener('mousedown',e=>{drag=true;sx=e.clientX*devicePixelRatio;sy=e.clientY*devicePixelRatio;ex=sx;ey=sy;draw()})
          window.addEventListener('mousemove',e=>{if(!drag)return;ex=e.clientX*devicePixelRatio;ey=e.clientY*devicePixelRatio;draw()})
          window.addEventListener('mouseup',e=>{drag=false;ex=e.clientX*devicePixelRatio;ey=e.clientY*devicePixelRatio;const x=Math.min(sx,ex),y=Math.min(sy,ey),w=Math.abs(ex-sx),h=Math.abs(ey-sy);window.electronAPI && window.electronAPI.postMessage({x,y,w,h,dpr:devicePixelRatio})})
          window.addEventListener('keydown',e=>{if(e.key==='Escape'){window.electronAPI && window.electronAPI.postMessage({cancel:true})}})
        </script>
      </body></html>
    `))

    const onMessage = (_: any, data: any) => {
      overlay.removeAllListeners('close')
      overlay.close()
      if (data?.cancel) return resolve(null)
      resolve({ displayId: id, x: Math.round(data.x/scaleFactor), y: Math.round(data.y/scaleFactor), w: Math.round(data.w/scaleFactor), h: Math.round(data.h/scaleFactor), dpr: scaleFactor })
    }

    // Use content scripts messaging to communicate back
    overlay.webContents.on('ipc-message', onMessage)
    overlay.on('close', () => resolve(null))
  })
}


