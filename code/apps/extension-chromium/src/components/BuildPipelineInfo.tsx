/**
 * Shows extension + desktop orchestrator build identity so you can confirm the MV3
 * extension and Electron are from the same rebuild (old unpacked paths / service
 * workers otherwise keep stale JS).
 */
import React, { useEffect, useState } from 'react'

const ORCHESTRATOR = 'http://127.0.0.1:51248'

type HealthJson = {
  ok?: boolean
  pid?: number
  orchestratorBuildStamp?: string
  orchestratorAppPath?: string
  version?: string
}

function shortStamp(s: string, max = 28): string {
  if (!s) return '—'
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function BuildPipelineInfo() {
  const extV = chrome.runtime.getManifest().version
  const extStamp = import.meta.env.VITE_EXT_BUILD_STAMP ?? ''
  const [health, setHealth] = useState<HealthJson | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`${ORCHESTRATOR}/api/health`, { signal: AbortSignal.timeout(4000) })
        const j = (await r.json()) as HealthJson
        if (alive) setHealth(j.ok !== false ? j : { ok: false })
      } catch {
        if (alive) setHealth({ ok: false })
      }
    }
    load()
    const id = setInterval(load, 20_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const desktopOk = health && health.ok !== false && health.orchestratorBuildStamp
  const pathHint = health?.orchestratorAppPath ?? ''

  return (
    <div
      style={{
        fontSize: '9px',
        opacity: 0.72,
        padding: '6px 12px 8px',
        lineHeight: 1.4,
        borderTop: '1px solid rgba(128,128,128,0.22)',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div>
        <strong>Extension</strong> v{extV} · {shortStamp(extStamp || 'no stamp (dev?)')}
      </div>
      {desktopOk ? (
        <div title={`Path: ${pathHint}`}>
          <strong>Desktop</strong> pid {health?.pid ?? '—'} · {shortStamp(String(health?.orchestratorBuildStamp))} · app{' '}
          {shortStamp(pathHint, 36)}
        </div>
      ) : (
        <div style={{ color: '#c2410c', fontWeight: 600 }}>
          Desktop not reachable on :51248 — run WR Desk from this repo (`pnpm dev` in electron-vite-project) or Reload
          extension after rebuilding.
        </div>
      )}
    </div>
  )
}
