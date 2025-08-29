import { useState } from 'react'
import { APP_NAME } from '@shared/core'
import { parseMsg } from '@shared/extension'

export default function App() {
  const [count, setCount] = useState(0)
  const [parsed, setParsed] = useState<string>('(noch nichts)')

  const handleParse = () => {
    // Demo: wir simulieren eine Antwort vom Desktop/WS
    const raw = JSON.stringify({ type: 'pong', ts: Date.now() })
    const msg = parseMsg(raw)
    setParsed(msg ? `${msg.type} @ ${('ts' in msg ? new Date(msg.ts).toLocaleTimeString() : '')}` : 'ungültige Nachricht')
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, Segoe UI, Arial, sans-serif' }}>
      <h1 style={{ margin: 0 }}>{APP_NAME}</h1>
      <p style={{ marginTop: 8, color: '#445' }}>Electron + React + Vite + pnpm workspaces</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
        <button onClick={() => setCount((c) => c + 1)}>count: {count}</button>
        <button onClick={handleParse}>Simuliere parseMsg()</button>
      </div>

      <div style={{ marginTop: 12, padding: 12, background: '#f6f8fa', borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Letztes parseMsg-Ergebnis</div>
        <code>{parsed}</code>
      </div>
    </div>
  )
}
