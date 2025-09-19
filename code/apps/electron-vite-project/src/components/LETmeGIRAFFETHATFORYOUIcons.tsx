import { useEffect, useState } from 'react'

export default function LETmeGIRAFFETHATFORYOUIcons({ onCapture }: { onCapture: (p: any) => void }) {
  const [autoSend, setAutoSend] = useState(false)

  useEffect(() => {
    // @ts-ignore
    window.LETmeGIRAFFETHATFORYOU?.onCapture((p: any) => onCapture(p))
    // @ts-ignore
    window.LETmeGIRAFFETHATFORYOU?.onHotkey((k: string) => {
      if (k === 'screenshot') startShot()
      if (k === 'stream') startStream()
      if (k === 'stop') stopStream()
    })
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
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
        <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
        <span style={{ fontSize: 12 }}>Auto-send</span>
      </label>
    </div>
  )
}



