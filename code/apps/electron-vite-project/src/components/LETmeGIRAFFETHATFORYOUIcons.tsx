import { useEffect, useState } from 'react'

export default function LETmeGIRAFFETHATFORYOUIcons({ onCapture }: { onCapture: (p: any) => void }) {
  const [autoSend, setAutoSend] = useState(false)
  const [presets, setPresets] = useState<any[]>([])

  useEffect(() => {
    // @ts-ignore
    window.LETmeGIRAFFETHATFORYOU?.onCapture((p: any) => onCapture(p))
    // @ts-ignore
    window.LETmeGIRAFFETHATFORYOU?.onHotkey((k: string) => {
      if (k === 'screenshot') startShot()
      if (k === 'stream') startStream()
      if (k === 'stop') stopStream()
    })

    const ipc: any = (window as any).ipcRenderer
    const refresh = async () => {
      try {
        // @ts-ignore
        const data = await window.LETmeGIRAFFETHATFORYOU?.getPresets()
        setPresets(data?.regions || [])
      } catch (err) {
        console.log('Error loading presets:', err)
      }
    }
    refresh()

    if (ipc?.on) {
      const handler = () => {
        console.log('[UI] TRIGGERS_UPDATED received, reloading presets')
        refresh()
      }
      ipc.on('TRIGGERS_UPDATED', handler)
      return () => {
        ipc.off?.('TRIGGERS_UPDATED', handler)
      }
    }
  }, [])

  const startShot = async () => {
    // @ts-ignore
    await window.LETmeGIRAFFETHATFORYOU?.selectScreenshot()
  }
  const startStream = async () => {
    // @ts-ignore
    await window.LETmeGIRAFFETHATFORYOU?.selectStream()
  }
  const stopStream = async () => {
    // @ts-ignore
    await window.LETmeGIRAFFETHATFORYOU?.stopStream()
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button title="Screenshot (Alt+Shift+S)" onClick={startShot} aria-label="Screenshot">📸</button>
      <button title="Stream (Alt+Shift+V)" onClick={startStream} aria-label="Start stream">🎥</button>
      <button title="Stop stream (Alt+0)" onClick={stopStream} aria-label="Stop stream">■</button>
      <select title="Tagged triggers" onChange={async (e) => {
        const id = e.target.value
        console.log('[UI] Trigger selected, id:', id)
        console.log('[UI] Available presets:', presets)
        const p = presets.find((r) => r.id === id)
        console.log('[UI] Found preset:', p)
        if (!p) {
          console.log('[UI] No preset found for id:', id)
          return
        }
        console.log('[UI] Calling capturePreset with:', { mode: p.mode, rect: { x: p.x, y: p.y, w: p.w, h: p.h }, displayId: p.displayId })
        // @ts-ignore
        if (p.mode === 'stream') await window.LETmeGIRAFFETHATFORYOU?.capturePreset({ mode: 'stream', rect: { x: p.x, y: p.y, w: p.w, h: p.h }, displayId: p.displayId })
        else await window.LETmeGIRAFFETHATFORYOU?.capturePreset({ mode: 'screenshot', rect: { x: p.x, y: p.y, w: p.w, h: p.h }, displayId: p.displayId })
        console.log('[UI] capturePreset call completed')
        e.currentTarget.selectedIndex = 0
      }}>
        <option value="">Triggers…</option>
        {presets.map((r) => (
          <option key={r.id} value={r.id}>{r.name || 'Trigger'}</option>
        ))}
      </select>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
        <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
        <span style={{ fontSize: 12 }}>Auto-send</span>
      </label>
    </div>
  )
}



