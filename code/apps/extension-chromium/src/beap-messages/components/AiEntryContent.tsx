/**
 * AiEntryContent
 *
 * Renders AI output by type: text (plain), markdown (formatted), chart (table/JSON).
 * M.10: Markdown rendered via react-markdown; chart as formatted table.
 */

import React from 'react'
import ReactMarkdown from 'react-markdown'
import type { AiOutputEntry } from '../hooks/useBeapMessageAi'

interface AiEntryContentProps {
  entry: AiOutputEntry
  textColor: string
  mutedColor: string
  borderColor: string
  isProfessional: boolean
  /** Compact mode for grid cells (smaller font). */
  compact?: boolean
}

function renderChartAsTable(
  content: string,
  textColor: string,
  mutedColor: string,
  borderColor: string,
): React.ReactNode {
  try {
    const data = JSON.parse(content)
    if (Array.isArray(data)) {
      if (data.length === 0) return <span style={{ color: textColor }}>No data</span>
      const first = data[0]
      const keys = typeof first === 'object' && first !== null ? Object.keys(first) : ['value']
      return (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr>
                {keys.map((k) => (
                  <th
                    key={k}
                    style={{
                      padding: '4px 8px',
                      textAlign: 'left',
                      borderBottom: `1px solid ${borderColor}`,
                      color: textColor,
                      fontWeight: 600,
                    }}
                  >
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 20).map((row: Record<string, unknown>, i: number) => (
                <tr key={i}>
                  {keys.map((k) => (
                    <td
                      key={k}
                      style={{
                        padding: '4px 8px',
                        borderBottom: `1px solid ${borderColor}`,
                        color: textColor,
                      }}
                    >
                      {String(row[k] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 20 && (
            <div style={{ fontSize: '10px', color: mutedColor, marginTop: '4px' }}>
              … and {data.length - 20} more rows
            </div>
          )}
        </div>
      )
    }
    if (typeof data === 'object' && data !== null) {
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <tbody>
            {Object.entries(data).map(([k, v]) => (
              <tr key={k}>
                <td
                  style={{
                    padding: '4px 8px',
                    borderBottom: `1px solid ${borderColor}`,
                    color: mutedColor,
                    fontWeight: 500,
                  }}
                >
                  {k}
                </td>
                <td
                  style={{
                    padding: '4px 8px',
                    borderBottom: `1px solid ${borderColor}`,
                    color: textColor,
                  }}
                >
                  {String(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
  } catch {
    // Fallback: render as pre
  }
  return (
    <pre
      style={{
        margin: 0,
        fontSize: '11px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: textColor,
      }}
    >
      {content}
    </pre>
  )
}

export const AiEntryContent: React.FC<AiEntryContentProps> = ({
  entry,
  textColor,
  mutedColor,
  borderColor,
  isProfessional,
  compact = false,
}) => {
  const baseStyle: React.CSSProperties = {
    fontSize: compact ? '11px' : '12px',
    lineHeight: 1.6,
    color: textColor,
    wordBreak: 'break-word' as const,
  }

  if (entry.type === 'markdown') {
    return (
      <div
        style={baseStyle}
        className="ai-entry-markdown"
      >
        <ReactMarkdown
          components={{
            p: ({ children }: { children?: React.ReactNode }) => <p style={{ margin: '0 0 6px 0' }}>{children}</p>,
            ul: ({ children }: { children?: React.ReactNode }) => <ul style={{ margin: '4px 0', paddingLeft: '18px' }}>{children}</ul>,
            ol: ({ children }: { children?: React.ReactNode }) => <ol style={{ margin: '4px 0', paddingLeft: '18px' }}>{children}</ol>,
            li: ({ children }: { children?: React.ReactNode }) => <li style={{ marginBottom: '2px' }}>{children}</li>,
            code: ({ children }: { children?: React.ReactNode }) => (
              <code
                style={{
                  background: isProfessional ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)',
                  padding: '1px 4px',
                  borderRadius: '4px',
                  fontSize: '0.9em',
                }}
              >
                {children}
              </code>
            ),
            pre: ({ children }: { children?: React.ReactNode }) => (
              <pre
                style={{
                  margin: '6px 0',
                  padding: '8px 10px',
                  background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)',
                  borderRadius: '6px',
                  overflow: 'auto',
                  fontSize: '0.9em',
                }}
              >
                {children}
              </pre>
            ),
            strong: ({ children }: { children?: React.ReactNode }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
            a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
              const safeHref = href && !href.toLowerCase().startsWith('javascript:') ? href : '#'
              return (
                <a
                  href={safeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#a855f7', textDecoration: 'underline' }}
                >
                  {children}
                </a>
              )
            },
          }}
        >
          {entry.content}
        </ReactMarkdown>
      </div>
    )
  }

  if (entry.type === 'chart') {
    return (
      <div style={baseStyle}>
        {renderChartAsTable(entry.content, textColor, mutedColor, borderColor)}
      </div>
    )
  }

  // text (default)
  return (
    <div
      style={{
        ...baseStyle,
        whiteSpace: 'pre-wrap' as const,
      }}
    >
      {entry.content}
    </div>
  )
}
