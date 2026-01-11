import { useEffect, useState, useCallback } from 'react'
import './App.css'
import AnalysisCanvas from './components/AnalysisCanvas'
import { type AnalysisOpenPayload, sanitizeAnalysisOpenPayload } from './components/analysis'

// Type declaration for the Analysis Dashboard preload API
declare global {
  interface Window {
    analysisDashboard?: {
      onOpen: (callback: (rawPayload: unknown) => void) => () => void
      onThemeChange: (callback: (theme: string) => void) => () => void
      requestTheme: () => void
    }
  }
}

// Extension theme types: 'default' (purple), 'dark', 'professional' (light/white)
type ExtensionTheme = 'default' | 'dark' | 'professional'

// Map extension theme to CSS data-ui-theme attribute
function mapThemeToCss(theme: ExtensionTheme): string {
  // 'default' is purple theme, 'dark' stays dark, 'professional' is light
  return theme
}

// WR Code Logo Component - semi-transparent
function WRCodeLogo({ size = 24 }: { size?: number }) {
  return (
    <img 
      src="/wrcode-logo.svg" 
      alt="WR Code Logo"
      width={size}
      height={size * 1.25}
    />
  )
}

// Theme selector component - allows manual theme changes
function ThemeSelector({ value, onChange }: { value: ExtensionTheme, onChange: (v: ExtensionTheme) => void }) {
  return (
    <div className="theme-switcher">
      <span className="theme-switcher__label">Theme</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ExtensionTheme)}
        className="theme-switcher__select"
        aria-label="Theme selection"
      >
        <option value="default">Default (Original)</option>
        <option value="dark">Dark</option>
        <option value="professional">Professional</option>
      </select>
    </div>
  )
}

function App() {
  // Extension theme state - synced from extension via main process
  const [extensionTheme, setExtensionTheme] = useState<ExtensionTheme>('default')
  const [deepLinkPayload, setDeepLinkPayload] = useState<AnalysisOpenPayload | null>(null)

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement
    const cssTheme = mapThemeToCss(extensionTheme)
    root.setAttribute('data-ui-theme', cssTheme)
    console.log('[APP] Theme applied:', extensionTheme, '-> CSS:', cssTheme)
  }, [extensionTheme])

  // Listen for theme changes from extension via main process
  useEffect(() => {
    const cleanup = window.analysisDashboard?.onThemeChange((theme: string) => {
      console.log('[APP] Theme changed from extension:', theme)
      if (['default', 'dark', 'professional'].includes(theme)) {
        setExtensionTheme(theme as ExtensionTheme)
      }
    })
    // Request current theme on mount
    window.analysisDashboard?.requestTheme()
    return () => { cleanup?.() }
  }, [])

  // Handle Analysis Dashboard open request from main process
  const handleOpenAnalysisDashboard = useCallback((rawPayload: unknown) => {
    const payload = sanitizeAnalysisOpenPayload(rawPayload)
    console.log('[APP] OPEN_ANALYSIS_DASHBOARD received, sanitized:', payload)
    // Extract theme from payload if provided
    if (payload && typeof payload === 'object' && 'theme' in payload) {
      const theme = (payload as any).theme
      if (['default', 'dark', 'professional'].includes(theme)) {
        setExtensionTheme(theme as ExtensionTheme)
      }
    }
    setDeepLinkPayload(payload)
  }, [])

  // Listen for OPEN_ANALYSIS_DASHBOARD from main process
  useEffect(() => {
    const cleanup = window.analysisDashboard?.onOpen(handleOpenAnalysisDashboard)
    return () => { cleanup?.() }
  }, [handleOpenAnalysisDashboard])

  return (
    <div className="app-root">
      {/* Minimal Header Bar */}
      <header className="app-header">
        <div className="app-header__brand">
          <WRCodeLogo size={28} />
          <span className="app-header__title">WR Code<sup className="app-header__tm">™</sup></span>
          <span className="app-header__subtitle">Analysis Dashboard</span>
        </div>
        <div className="app-header__spacer" />
        <ThemeSelector value={extensionTheme} onChange={setExtensionTheme} />
      </header>

      {/* Full-width Analysis Canvas */}
      <main className="app-main">
        <AnalysisCanvas 
          deepLinkPayload={deepLinkPayload ?? undefined}
          onDeepLinkConsumed={() => setDeepLinkPayload(null)}
        />
      </main>
    </div>
  )
}

export default App
