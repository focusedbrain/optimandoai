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
    // @ts-ignore
    window.LETmeGIRAFFETHATFORYOU?.getPresets()?.then((d: any) => setPresets(d?.regions || []))
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
        const p = presets.find((r) => r.id === id)
        if (!p) return
        // @ts-ignore
        if (p.mode === 'stream') await window.LETmeGIRAFFETHATFORYOU?.capturePreset({ mode: 'stream', rect: { x: p.x, y: p.y, w: p.w, h: p.h }, displayId: p.displayId })
        else await window.LETmeGIRAFFETHATFORYOU?.capturePreset({ mode: 'screenshot', rect: { x: p.x, y: p.y, w: p.w, h: p.h }, displayId: p.displayId })
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



