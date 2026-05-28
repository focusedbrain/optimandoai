import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary'
import { PdfParsingConsentProvider } from './contexts/PdfParsingConsentContext.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PdfParsingConsentProvider>
        <App />
      </PdfParsingConsentProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

// Typed lifecycle bridge (replaces raw ipcRenderer access)
;(window as any).lifecycle?.onMainProcessMessage((message: string) => {
  console.log(message)
})
