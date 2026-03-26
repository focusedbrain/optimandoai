/**
 * Popup document reader for draft / inbox attachment text (synthetic paging).
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

const CONTENT_FONT = "'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace"

/** Split long text into pages: prefer paragraph boundaries, then char budget. */
export function splitToSyntheticPages(text: string, charsPerPage = 3000): string[] {
  const t = text.trim()
  if (!t) return ['']
  const paragraphs = t.split(/\n\n+/)
  const pages: string[] = []
  let current = ''
  for (const para of paragraphs) {
    const piece = para.trim()
    if (!piece) continue
    const joiner = current ? '\n\n' : ''
    if (current.length + joiner.length + piece.length > charsPerPage && current.length > 0) {
      pages.push(current.trim())
      current = piece
    } else {
      current += joiner + piece
    }
  }
  if (current.trim()) pages.push(current.trim())
  return pages.length > 0 ? pages : [t]
}

export interface BeapDocumentReaderModalProps {
  open: boolean
  onClose: () => void
  filename: string
  semanticContent: string
  theme?: 'standard' | 'dark'
}

export const BeapDocumentReaderModal: React.FC<BeapDocumentReaderModalProps> = ({
  open,
  onClose,
  filename,
  semanticContent,
  theme = 'dark',
}) => {
  const isLight = theme === 'standard'
  const textColor = isLight ? '#1e293b' : '#e2e8f0'
  const mutedColor = isLight ? '#64748b' : '#94a3b8'
  const borderColor = isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.12)'
  const cardBg = isLight ? '#ffffff' : '#0f172a'
  const sidebarBg = isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.04)'

  const pages = useMemo(() => splitToSyntheticPages(semanticContent), [semanticContent])
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHitLabel, setSearchHitLabel] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setCurrentPage(1)
      setSearchQuery('')
      setSearchHitLabel(null)
    }
  }, [open, filename, semanticContent])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const pageCount = pages.length
  const safePage = Math.min(Math.max(currentPage, 1), Math.max(pageCount, 1))
  const pageText = pages[safePage - 1] ?? ''

  const runSearch = useCallback(() => {
    const q = searchQuery.trim()
    if (!q) {
      setSearchHitLabel(null)
      return
    }
    const lower = q.toLowerCase()
    for (let i = 0; i < pages.length; i++) {
      const idx = (pages[i] ?? '').toLowerCase().indexOf(lower)
      if (idx >= 0) {
        setCurrentPage(i + 1)
        setSearchHitLabel(`Match on page ${i + 1}`)
        setTimeout(() => contentRef.current?.querySelector('pre')?.scrollIntoView({ block: 'start' }), 0)
        return
      }
    }
    setSearchHitLabel('No matches')
  }, [pages, searchQuery])

  const copyPage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pageText)
    } catch {
      /* ignore */
    }
  }, [pageText])

  const copyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(pages.join('\n\n'))
    } catch {
      /* ignore */
    }
  }, [pages])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        backgroundColor: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Document reader"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: cardBg,
          borderRadius: 8,
          width: '90%',
          maxWidth: 900,
          height: 'min(85vh, 800px)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          border: `1px solid ${borderColor}`,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: textColor,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginRight: 12,
            }}
            title={filename}
          >
            📄 {filename}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: mutedColor,
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <div
            style={{
              width: 72,
              flexShrink: 0,
              overflowY: 'auto',
              borderRight: `1px solid ${borderColor}`,
              background: sidebarBg,
              padding: '6px 4px',
            }}
          >
            {pages.map((p, i) => {
              const n = i + 1
              const active = n === safePage
              const preview = (p || '').replace(/\s+/g, ' ').slice(0, 42)
              return (
                <button
                  key={n}
                  type="button"
                  data-page={n}
                  onClick={() => setCurrentPage(n)}
                  title={preview || `Page ${n}`}
                  style={{
                    width: '100%',
                    marginBottom: 6,
                    padding: '6px 4px',
                    fontSize: 9,
                    lineHeight: 1.2,
                    textAlign: 'left' as const,
                    cursor: 'pointer',
                    borderRadius: 4,
                    border: `1px solid ${active ? 'rgba(139,92,246,0.6)' : borderColor}`,
                    background: active ? 'rgba(139,92,246,0.15)' : 'transparent',
                    color: active ? '#a855f7' : mutedColor,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>P{n}</div>
                  <div style={{ opacity: 0.85, wordBreak: 'break-word' as const }}>{preview || '·'}</div>
                </button>
              )
            })}
          </div>

          <div ref={contentRef} style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '14px 18px' }}>
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: CONTENT_FONT,
                fontSize: 13,
                lineHeight: 1.6,
                color: textColor,
              }}
            >
              {pageText}
            </pre>
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderTop: `1px solid ${borderColor}`,
          }}
        >
          <input
            type="search"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setSearchHitLabel(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
            style={{
              flex: 1,
              minWidth: 120,
              padding: '6px 10px',
              fontSize: 12,
              borderRadius: 6,
              border: `1px solid ${borderColor}`,
              background: isLight ? '#fff' : 'rgba(255,255,255,0.06)',
              color: textColor,
            }}
          />
          <button
            type="button"
            onClick={runSearch}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              borderRadius: 6,
              border: `1px solid ${borderColor}`,
              background: 'transparent',
              color: mutedColor,
              cursor: 'pointer',
            }}
          >
            Find
          </button>
          <span style={{ fontSize: 11, color: mutedColor }}>
            Page {safePage} of {pageCount}
          </span>
          {searchHitLabel && (
            <span style={{ fontSize: 11, color: '#a855f7' }}>{searchHitLabel}</span>
          )}
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            style={{ padding: '6px 10px', fontSize: 11, cursor: safePage <= 1 ? 'not-allowed' : 'pointer' }}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
            disabled={safePage >= pageCount}
            style={{ padding: '6px 10px', fontSize: 11, cursor: safePage >= pageCount ? 'not-allowed' : 'pointer' }}
          >
            Next
          </button>
          <button
            type="button"
            onClick={copyPage}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              borderRadius: 6,
              border: 'none',
              background: 'rgba(139,92,246,0.25)',
              color: '#c4b5fd',
              cursor: 'pointer',
            }}
          >
            Copy page
          </button>
          <button
            type="button"
            onClick={copyAll}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              borderRadius: 6,
              border: 'none',
              background: 'rgba(139,92,246,0.35)',
              color: '#f5f3ff',
              cursor: 'pointer',
            }}
          >
            Copy all
          </button>
        </div>

        <div
          style={{
            fontSize: 10,
            color: mutedColor,
            padding: '4px 14px 10px',
            borderTop: `1px solid ${borderColor}`,
          }}
        >
          Page boundaries are approximate when text was extracted as a single stream.
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default BeapDocumentReaderModal
