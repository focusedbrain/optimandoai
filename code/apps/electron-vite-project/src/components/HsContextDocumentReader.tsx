/**
 * HsContextDocumentReader — Premium page-by-page document reader
 *
 * Full document review experience with:
 * - Top bar: filename, Page X of Y, search
 * - Left sidebar: page list with length bars
 * - Main content: full page text with line numbers
 * - Bottom bar: Prev/Next, page input, Copy Page, Download Full Text, View Original
 *
 * Uses handshakeView IPC bridge (Electron) or passed-in api (extension).
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// ── API abstraction (Electron uses handshakeView; extension passes api) ──
export interface DocumentSearchMatch {
  page_number: number
  match_count: number
  snippet: string
}

export interface HsContextDocumentReaderApi {
  getDocumentPageCount: (documentId: string) => Promise<{ count: number }>
  getDocumentPage: (documentId: string, pageNumber: number) => Promise<{ text: string | null }>
  getDocumentPageList: (documentId: string) => Promise<{ pages: Array<{ page_number: number; char_count: number }> }>
  getDocumentFullText: (documentId: string) => Promise<{ text: string | null }>
  searchDocumentPages?: (documentId: string, query: string) => Promise<{ matches: DocumentSearchMatch[] }>
}

function getDefaultApi(): HsContextDocumentReaderApi | null {
  const hv = (window as any).handshakeView
  if (!hv?.getDocumentPageCount || !hv?.getDocumentPage || !hv?.getDocumentPageList || !hv?.getDocumentFullText) {
    return null
  }
  return {
    getDocumentPageCount: (id) => hv.getDocumentPageCount(id),
    getDocumentPage: (id, pn) => hv.getDocumentPage(id, pn),
    getDocumentPageList: (id) => hv.getDocumentPageList(id),
    getDocumentFullText: (id) => hv.getDocumentFullText(id),
    searchDocumentPages: hv.searchDocumentPages ? (id, q) => hv.searchDocumentPages(id, q) : undefined,
  }
}

// ── Props ──
interface HsContextDocumentReaderProps {
  documentId: string
  filename: string
  mimeType?: string
  /** Optional: for extension context when handshakeView is not available */
  api?: HsContextDocumentReaderApi | null
  /** Optional: full extracted text from context block (received documents). When provided and no page records exist, splits by \\n\\n into synthetic pages. */
  fullText?: string | null
  /**
   * When set (e.g. inbox IPC with pdfjs per-page extraction), use this array as pages instead of splitting `fullText` by \\n\\n.
   * Avoids mis-splitting when a page body contains blank lines.
   */
  pageTexts?: string[] | null
  /** When true, grow to fill a flex parent (e.g. modal) instead of a fixed min-height. */
  fillParent?: boolean
  /** When true, hide the “approximate page boundaries” banner (e.g. email inbox attachments). */
  hideSyntheticPageBanner?: boolean
  /** Optional: callback to open original PDF (e.g. ProtectedAccessWarningDialog flow) */
  onViewOriginal?: () => void
  /** Optional: whether View Original button is available (vault unlocked, etc.) */
  canViewOriginal?: boolean
  onClose?: () => void
}

const CONTENT_FONT = "'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace"
const CONTENT_FONT_SIZE = 13
const SIDEBAR_WIDTH = 60
const ACCENT = '#8b5cf6'
const MUTED = 'var(--color-text-muted, #94a3b8)'
const BORDER = '1px solid rgba(255,255,255,0.08)'

/** Split full text by double newline into synthetic pages (matches extraction format). */
function splitToSyntheticPages(fullText: string): string[] {
  const pages = fullText.split(/\n\n+/).map((s) => s.trim()).filter(Boolean)
  return pages.length > 0 ? pages : ['']
}

export const HsContextDocumentReader: React.FC<HsContextDocumentReaderProps> = ({
  documentId,
  filename,
  mimeType = 'application/pdf',
  api: apiProp,
  fullText: fullTextProp,
  pageTexts: pageTextsProp,
  fillParent = false,
  hideSyntheticPageBanner = false,
  onViewOriginal,
  canViewOriginal = false,
  onClose,
}) => {
  /** Use `api={null}` to force synthetic/fullText-only mode (e.g. inbox); `??` would treat null as missing. */
  const api = apiProp !== undefined ? apiProp : getDefaultApi()
  /** `fullText !== undefined` means caller supplied text explicitly (including empty), e.g. inbox after IPC fetch. */
  const resolvedFullText = fullTextProp !== undefined ? String(fullTextProp ?? '') : null
  const syntheticPages = useMemo(() => {
    if (pageTextsProp != null && pageTextsProp.length > 0) {
      return pageTextsProp
    }
    if (resolvedFullText !== null) {
      return splitToSyntheticPages(resolvedFullText)
    }
    return null
  }, [pageTextsProp, resolvedFullText])

  const [pageCount, setPageCount] = useState(0)
  const [pageList, setPageList] = useState<Array<{ page_number: number; char_count: number }>>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageText, setPageText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageCache, setPageCache] = useState<Record<number, string>>({})
  const [fullTextMode, setFullTextMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchMatches, setSearchMatches] = useState<DocumentSearchMatch[]>([])
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [copySuccess, setCopySuccess] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const isPdf = /pdf/i.test(mimeType) || filename.toLowerCase().endsWith('.pdf')
  const maxCharCount = pageList.length > 0 ? Math.max(...pageList.map((p) => p.char_count), 1) : 1

  // Load page list and count (fullText first when available, else API)
  // When fullText is provided (e.g. from context block payload), use it immediately.
  // Do NOT wait for IPC — getDocumentPageCount can hang (getEffectiveTier, vault init)
  // for received documents that don't exist in local vault.
  useEffect(() => {
    if (syntheticPages && syntheticPages.length > 0) {
      setFullTextMode(true)
      setPageCount(syntheticPages.length)
      setPageList(syntheticPages.map((text, i) => ({ page_number: i + 1, char_count: text.length })))
      setLoading(false)
      return
    }
    if (!api) return
    let cancelled = false
    setLoading(true)
    const timeoutMs = 8000
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Document load timeout')), timeoutMs),
    )
    Promise.race([
      Promise.all([
        api.getDocumentPageCount(documentId),
        api.getDocumentPageList(documentId),
      ]),
      timeoutPromise,
    ])
      .then(([countRes, listRes]) => {
        if (cancelled) return
        const count = countRes.count
        const pages = listRes.pages ?? []
        if (count > 0 && pages.length > 0) {
          setFullTextMode(false)
          setPageCount(count)
          setPageList(pages)
        } else if (syntheticPages && syntheticPages.length > 0) {
          setFullTextMode(true)
          setPageCount(syntheticPages.length)
          setPageList(syntheticPages.map((text, i) => ({ page_number: i + 1, char_count: text.length })))
        } else {
          setFullTextMode(false)
          setPageCount(0)
          setPageList([])
        }
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled && syntheticPages && syntheticPages.length > 0) {
          setFullTextMode(true)
          setPageCount(syntheticPages.length)
          setPageList(syntheticPages.map((text, i) => ({ page_number: i + 1, char_count: text.length })))
        } else if (!cancelled) {
          setFullTextMode(false)
          setPageCount(0)
          setPageList([])
        }
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [api, documentId, resolvedFullText, syntheticPages])

  // Load current page text (API or synthetic)
  useEffect(() => {
    if (pageCount === 0 || currentPage < 1 || currentPage > pageCount) {
      setPageText(null)
      return
    }
    if (fullTextMode && syntheticPages) {
      setPageText(syntheticPages[currentPage - 1] ?? null)
      return
    }
    if (!api) return
    const cached = pageCache[currentPage]
    if (cached !== undefined) {
      setPageText(cached)
      return
    }
    setPageText(null)
    let cancelled = false
    api.getDocumentPage(documentId, currentPage).then((res) => {
      if (cancelled) return
      const text = res.text ?? ''
      setPageText(text)
      setPageCache((prev) => ({ ...prev, [currentPage]: text }))
    })
    return () => { cancelled = true }
  }, [api, documentId, currentPage, pageCount, pageCache, fullTextMode, syntheticPages])

  // Scroll active page into view in sidebar
  useEffect(() => {
    const el = sidebarRef.current?.querySelector(`[data-page="${currentPage}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentPage])

  // Debounced search (API or client-side when fullTextMode)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([])
      return
    }
    const q = searchQuery.trim()
    const qLower = q.toLowerCase()
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

    if (fullTextMode && syntheticPages) {
      const timer = setTimeout(() => {
        const matches: DocumentSearchMatch[] = []
        syntheticPages.forEach((text, i) => {
          const count = (text.match(regex) ?? []).length
          if (count > 0) {
            const idx = text.toLowerCase().indexOf(qLower)
            const start = Math.max(0, idx - 30)
            const end = Math.min(text.length, idx + q.length + 50)
            matches.push({
              page_number: i + 1,
              match_count: count,
              snippet: (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''),
            })
          }
        })
        setSearchMatches(matches)
        setSearchMatchIndex(0)
        if (matches.length > 0) setCurrentPage(matches[0].page_number)
      }, 300)
      return () => clearTimeout(timer)
    }
    if (!api?.searchDocumentPages) return
    const timer = setTimeout(() => {
      api.searchDocumentPages!(documentId, q).then((res) => {
        setSearchMatches(res.matches ?? [])
        setSearchMatchIndex(0)
        if (res.matches?.length > 0) setCurrentPage(res.matches[0].page_number)
      }).catch(() => setSearchMatches([]))
    }, 300)
    return () => clearTimeout(timer)
  }, [api, documentId, searchQuery, fullTextMode, syntheticPages])

  // Sync searchMatchIndex when currentPage changes (e.g. from sidebar click)
  useEffect(() => {
    if (searchMatches.length === 0) return
    const idx = searchMatches.findIndex((m) => m.page_number === currentPage)
    if (idx >= 0) setSearchMatchIndex(idx)
  }, [currentPage, searchMatches])

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchFocused(false)
        return
      }
      if (searchFocused) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setCurrentPage((p) => Math.max(1, p - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setCurrentPage((p) => Math.min(pageCount, p + 1))
      } else if (e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        setSearchFocused(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [searchFocused, pageCount])

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10)
    if (!Number.isNaN(v) && v >= 1 && v <= pageCount) {
      setCurrentPage(v)
    }
  }

  const handleCopyPage = useCallback(async () => {
    if (!pageText) return
    try {
      await navigator.clipboard.writeText(pageText)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 1500)
    } catch {
      // ignore
    }
  }, [pageText])

  const handleDownloadFullText = useCallback(async () => {
    let text = ''
    if (fullTextMode && resolvedFullText !== null) text = resolvedFullText
    else if (api) {
      const res = await api.getDocumentFullText(documentId)
      text = res.text ?? ''
    }
    if (!text) return
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename.replace(/\.pdf$/i, '.txt') || 'document.txt'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      // ignore
    }
  }, [api, documentId, filename, fullTextMode, resolvedFullText])

  const hasSyntheticInput =
    (pageTextsProp != null && pageTextsProp.length > 0) || resolvedFullText !== null
  if (!api && !hasSyntheticInput) {
    return (
      <div style={{
        padding: 24,
        color: MUTED,
        fontSize: 13,
        background: 'var(--color-bg, #0f172a)',
        borderRadius: 8,
        border: BORDER,
      }}>
        Document reader is not available in this context.
      </div>
    )
  }

  if (loading && pageCount === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 200,
        color: MUTED,
        background: 'var(--color-bg, #0f172a)',
        borderRadius: 8,
        border: BORDER,
      }}>
        Loading document…
      </div>
    )
  }

  if (pageCount === 0) {
    return (
      <div style={{
        padding: 24,
        color: MUTED,
        fontSize: 13,
        background: 'var(--color-bg, #0f172a)',
        borderRadius: 8,
        border: BORDER,
      }}>
        No pages available. The document may still be extracting, or it may belong to another user's vault (e.g. when viewing a received handshake).
      </div>
    )
  }

  const lines = (pageText ?? '').split('\n')
  const hasScrollShadow = (contentRef.current?.scrollTop ?? 0) > 4

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: fillParent ? '100%' : '100%',
        minHeight: fillParent ? 0 : 400,
        flex: fillParent ? 1 : undefined,
        background: 'var(--color-bg, #0f172a)',
        borderRadius: 8,
        overflow: 'hidden',
        border: BORDER,
      }}
    >
      {fullTextMode && !hideSyntheticPageBanner && (
        <div
          style={{
            padding: '8px 14px',
            fontSize: 11,
            color: MUTED,
            background: 'rgba(139,92,246,0.08)',
            borderBottom: BORDER,
            flexShrink: 0,
          }}
        >
          ℹ️ Viewing received document — page boundaries are approximate
        </div>
      )}
      {/* ── Top bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: BORDER,
          background: 'rgba(255,255,255,0.03)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text, #e2e8f0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
          📄 {filename}
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>
          Page {currentPage} of {pageCount}
          {searchMatches.length > 0 && (
            <span style={{ marginLeft: 8, color: ACCENT }}>
              {searchMatches.reduce((a, m) => a + m.match_count, 0)} results across {searchMatches.length} page{searchMatches.length !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {}}
              style={{
                fontSize: 12,
                padding: '6px 10px 6px 28px',
                width: 140,
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${searchFocused ? ACCENT : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 6,
                color: 'var(--color-text, #e2e8f0)',
                outline: 'none',
              }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: MUTED }}>🔍</span>
          </div>
        </div>
      </div>

      {/* ── Main layout: sidebar + content ── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ── Left sidebar ── */}
        <div
          ref={sidebarRef}
          style={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            borderRight: BORDER,
            background: 'rgba(255,255,255,0.02)',
            overflowY: 'auto',
            padding: '8px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {pageList.map((p) => {
            const isActive = p.page_number === currentPage
            const barWidth = Math.max(4, (p.char_count / maxCharCount) * 24)
            const matchInfo = searchMatches.find((m) => m.page_number === p.page_number)
            return (
              <button
                key={p.page_number}
                data-page={p.page_number}
                type="button"
                onClick={() => setCurrentPage(p.page_number)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 8px',
                  background: isActive ? `${ACCENT}22` : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? `3px solid ${ACCENT}` : '3px solid transparent',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: isActive ? 12 : 11,
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? ACCENT : MUTED,
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span style={{ minWidth: 18 }}>{p.page_number}</span>
                <div
                  style={{
                    width: barWidth,
                    height: 4,
                    background: isActive ? ACCENT : 'rgba(255,255,255,0.2)',
                    borderRadius: 2,
                  }}
                />
                {matchInfo && (
                  <span style={{ fontSize: 9, background: ACCENT, color: '#fff', padding: '1px 4px', borderRadius: 4, marginLeft: 'auto' }}>
                    {matchInfo.match_count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* ── Main content ── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            position: 'relative',
          }}
        >
          {hasScrollShadow && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 12,
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.15), transparent)',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />
          )}
          <div
            ref={contentRef}
            onScroll={() => {
              // Trigger re-render for scroll shadow (simplified: we could use a scroll listener)
            }}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 20px',
              background: '#ffffff',
              color: '#1e293b',
              fontFamily: CONTENT_FONT,
              fontSize: CONTENT_FONT_SIZE,
              lineHeight: 1.6,
            }}
          >
            {pageText === null ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: `${60 + Math.random() * 30}%`,
                      height: 12,
                      background: 'linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%)',
                      backgroundSize: '200% 100%',
                      animation: 'shimmer 1.5s infinite',
                      borderRadius: 4,
                    }}
                  />
                ))}
              </div>
            ) : pageText.trim() === '' ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 48 }}>
                No text content on this page. The original may contain images or graphics that could not be extracted.
              </div>
            ) : (
              <div style={{ display: 'flex' }}>
                <div
                  style={{
                    paddingRight: 16,
                    color: '#cbd5e1',
                    fontSize: 11,
                    fontFamily: CONTENT_FONT,
                    userSelect: 'none',
                    minWidth: 32,
                    textAlign: 'right',
                  }}
                >
                  {lines.map((_, i) => (
                    <div key={i} style={{ lineHeight: 1.6 }}>
                      {i + 1}
                    </div>
                  ))}
                </div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    flex: 1,
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                    lineHeight: 'inherit',
                  }}
                >
                  {searchQuery.trim() && pageText
                    ? (() => {
                        const q = searchQuery.trim()
                        const parts = pageText.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
                        return parts.map((part, i) =>
                          part.toLowerCase() === q.toLowerCase() ? (
                            <mark key={i} style={{ background: 'rgba(251,191,36,0.4)', padding: '0 1px' }}>{part}</mark>
                          ) : (
                            part
                          )
                        )
                      })()
                    : pageText}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderTop: BORDER,
          background: 'rgba(255,255,255,0.03)',
          flexShrink: 0,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {searchMatches.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  const idx = (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length
                  setSearchMatchIndex(idx)
                  setCurrentPage(searchMatches[idx].page_number)
                }}
                style={{
                  fontSize: 11,
                  padding: '5px 8px',
                  background: 'transparent',
                  border: BORDER,
                  borderRadius: 6,
                  color: 'var(--color-text, #e2e8f0)',
                  cursor: 'pointer',
                }}
              >
                ◀ Prev match
              </button>
              <button
                type="button"
                onClick={() => {
                  const idx = (searchMatchIndex + 1) % searchMatches.length
                  setSearchMatchIndex(idx)
                  setCurrentPage(searchMatches[idx].page_number)
                }}
                style={{
                  fontSize: 11,
                  padding: '5px 8px',
                  background: 'transparent',
                  border: BORDER,
                  borderRadius: 6,
                  color: 'var(--color-text, #e2e8f0)',
                  cursor: 'pointer',
                }}
              >
                Next match ▶
              </button>
            </>
          )}
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              background: 'transparent',
              border: BORDER,
              borderRadius: 6,
              color: currentPage <= 1 ? MUTED : 'var(--color-text, #e2e8f0)',
              cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
              opacity: currentPage <= 1 ? 0.5 : 1,
            }}
          >
            ◀ Prev
          </button>
          <span style={{ fontSize: 11, color: MUTED }}>
            Page{' '}
            <input
              type="number"
              min={1}
              max={pageCount}
              value={currentPage}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (!Number.isNaN(v)) setCurrentPage(Math.max(1, Math.min(pageCount, v)))
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              style={{
                width: 40,
                fontSize: 11,
                padding: '4px 6px',
                background: 'rgba(255,255,255,0.06)',
                border: BORDER,
                borderRadius: 4,
                color: 'var(--color-text, #e2e8f0)',
                textAlign: 'center',
              }}
            />{' '}
            of {pageCount}
          </span>
          <button
            type="button"
            disabled={currentPage >= pageCount}
            onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              background: 'transparent',
              border: BORDER,
              borderRadius: 6,
              color: currentPage >= pageCount ? MUTED : 'var(--color-text, #e2e8f0)',
              cursor: currentPage >= pageCount ? 'not-allowed' : 'pointer',
              opacity: currentPage >= pageCount ? 0.5 : 1,
            }}
          >
            Next ▶
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={handleCopyPage}
            disabled={!pageText}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              background: 'transparent',
              border: BORDER,
              borderRadius: 6,
              color: copySuccess ? '#22c55e' : 'var(--color-text, #e2e8f0)',
              cursor: pageText ? 'pointer' : 'not-allowed',
              opacity: pageText ? 1 : 0.5,
            }}
          >
            {copySuccess ? '✓ Copied' : 'Copy Page'}
          </button>
          <button
            type="button"
            onClick={handleDownloadFullText}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              background: 'transparent',
              border: BORDER,
              borderRadius: 6,
              color: 'var(--color-text, #e2e8f0)',
              cursor: 'pointer',
            }}
          >
            ⬇ Download Full Text
          </button>
          {isPdf && canViewOriginal && onViewOriginal && (
            <button
              type="button"
              onClick={onViewOriginal}
              style={{
                fontSize: 11,
                padding: '5px 10px',
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: 6,
                color: ACCENT,
                cursor: 'pointer',
              }}
            >
              View Original
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                fontSize: 11,
                padding: '5px 10px',
                background: 'transparent',
                border: BORDER,
                borderRadius: 6,
                color: MUTED,
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  )
}
