/**
 * useMediaQuery
 *
 * Returns true when the given media query matches.
 * Uses window.matchMedia; updates on resize.
 */

import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', handler)
    setMatches(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [query])

  return matches
}

/** Breakpoint: viewport width < 768px (narrow, sidebar collapses) */
export const NARROW_VIEWPORT = '(max-width: 767px)'

/** Breakpoint: viewport width < 900px (bulk grid: 1 column) */
export const BULK_GRID_1COL = '(max-width: 899px)'

/** Breakpoint: viewport width >= 1600px (bulk grid: 3 columns) */
export const BULK_GRID_3COL = '(min-width: 1600px)'
