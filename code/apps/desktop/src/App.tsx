import { useState } from 'react'
import { APP_NAME } from '@shared/core'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ padding: 24 }}>
      <h1>{APP_NAME}</h1>
      <p>Electron + React + Vite + pnpm workspaces</p>
      <button onClick={() => setCount((c) => c + 1)}>count: {count}</button>
    </div>
  )
}

export default App
