import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Switch between demos with URL parameter: ?demo=template
const urlParams = new URLSearchParams(window.location.search);
const demoMode = urlParams.get('demo');

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

// Dynamically load the appropriate demo
if (demoMode === 'template') {
  // Template-driven mini-app demo
  import('./TemplateDrivenDemo').then((module) => {
    // TemplateDrivenDemo mounts itself
    console.log('[main] Loaded Template-Driven Demo');
  });
} else {
  // Original App
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
