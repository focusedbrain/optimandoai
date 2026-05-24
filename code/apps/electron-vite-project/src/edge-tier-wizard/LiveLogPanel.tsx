/**
 * Live log panel for install/deploy streaming events.
 */

import type { LogEvent } from './types.js'

export interface LiveLogPanelProps {
  events: LogEvent[]
  emptyMessage?: string
}

export function LiveLogPanel({ events, emptyMessage = 'Waiting for output…' }: LiveLogPanelProps) {
  const stages = groupByStage(events)

  return (
    <div
      data-testid="wizard-live-log"
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 11,
        background: 'rgba(0,0,0,0.35)',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: 10,
        maxHeight: 220,
        overflow: 'auto',
        marginTop: 12,
      }}
    >
      {events.length === 0 ? (
        <div style={{ color: '#64748b' }}>{emptyMessage}</div>
      ) : (
        stages.map(({ stage, lines }) => (
          <div key={stage} style={{ marginBottom: 10 }}>
            <div style={{ color: '#a78bfa', fontWeight: 600, marginBottom: 4 }}>{stage}</div>
            {lines.map((line, i) => (
              <div
                key={`${stage}-${i}`}
                style={{
                  color: line.kind === 'error' ? '#f87171' : '#cbd5e1',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {line.message}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}

function groupByStage(events: LogEvent[]): Array<{ stage: string; lines: LogEvent[] }> {
  const map = new Map<string, LogEvent[]>()
  for (const event of events) {
    const stage = event.stage_name ?? (event.kind === 'stage' ? event.message : 'log')
    const bucket = map.get(stage) ?? []
    bucket.push(event)
    map.set(stage, bucket)
  }
  return [...map.entries()].map(([stage, lines]) => ({ stage, lines }))
}
