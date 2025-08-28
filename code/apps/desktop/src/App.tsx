import './App.css';
import { useCounter } from './store';

export default function App() {
  const { count, inc, reset } = useCounter();
  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>OpenGiraffe Desktop App</h1>
      <p>
        Counter: <b>{count}</b>
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={inc}>+1</button>
        <button onClick={reset}>Reset</button>
      </div>
      <p style={{ marginTop: 16, color: '#666' }}>
        Läuft in Electron (Chromium + Node). Änderungen werden live neu geladen.
      </p>
    </div>
  );
}
