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

// Inline Giraffe Icon Component
function GiraffeIcon({ size = 24 }: { size?: number }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 128 128" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      aria-label="OpenGiraffe Logo"
    >
      <defs>
        <linearGradient id="giraffeGradInline" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#F5A623', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#D4851D', stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <ellipse cx="64" cy="90" rx="28" ry="22" fill="url(#giraffeGradInline)"/>
      <path d="M58 75 L50 30 Q48 20 52 18 L60 18 Q64 20 63 30 L70 75 Z" fill="url(#giraffeGradInline)"/>
      <ellipse cx="56" cy="16" rx="14" ry="10" fill="url(#giraffeGradInline)"/>
      <ellipse cx="44" cy="8" rx="4" ry="6" fill="#D4851D"/>
      <ellipse cx="68" cy="8" rx="4" ry="6" fill="#D4851D"/>
      <circle cx="48" cy="4" r="3" fill="#8B4513"/>
      <circle cx="64" cy="4" r="3" fill="#8B4513"/>
      <ellipse cx="46" cy="20" rx="8" ry="5" fill="#FFDAB9"/>
      <circle cx="52" cy="14" r="3" fill="#1a1a1a"/>
      <circle cx="53" cy="13" r="1" fill="white"/>
      <ellipse cx="55" cy="40" rx="5" ry="4" fill="#8B4513" opacity="0.6"/>
      <ellipse cx="60" cy="55" rx="4" ry="3" fill="#8B4513" opacity="0.6"/>
      <ellipse cx="50" cy="85" rx="6" ry="5" fill="#8B4513" opacity="0.6"/>
      <ellipse cx="70" cy="82" rx="5" ry="6" fill="#8B4513" opacity="0.6"/>
      <rect x="46" y="108" width="6" height="18" rx="2" fill="#D4851D"/>
      <rect x="56" y="108" width="6" height="18" rx="2" fill="#D4851D"/>
      <rect x="66" y="108" width="6" height="18" rx="2" fill="url(#giraffeGradInline)"/>
      <rect x="76" y="108" width="6" height="18" rx="2" fill="url(#giraffeGradInline)"/>
    </svg>
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
          <GiraffeIcon size={28} />
          <span className="app-header__title">OpenGiraffe<sup className="app-header__tm">™</sup></span>
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
