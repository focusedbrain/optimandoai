import { describe, test, expect } from 'vitest'
import { buildCloudSnippet } from '../cloudSnippet'

describe('Deterministic Snippet Builder', () => {
  test('strips email signature after "--"', () => {
    const input = 'Hello world\n--\nJohn Doe\nCEO'
    const result = buildCloudSnippet(input)
    expect(result).toBe('Hello world')
  })

  test('strips email signature after "Best regards"', () => {
    const input = 'Meeting at 3pm.\nBest regards\nJane'
    const result = buildCloudSnippet(input)
    expect(result).toBe('Meeting at 3pm.')
  })

  test('strips email signature after "Mit freundlichen Grüßen"', () => {
    const input = 'Termin um 15 Uhr.\nMit freundlichen Grüßen\nHans'
    const result = buildCloudSnippet(input)
    expect(result).toBe('Termin um 15 Uhr.')
  })

  test('removes quoted reply lines starting with ">"', () => {
    const input = 'My reply\n> Original message\n> More original'
    const result = buildCloudSnippet(input)
    expect(result).toBe('My reply')
  })

  test('removes forwarded message blocks', () => {
    const input = 'FYI see below.\n---------- Forwarded message ----------\nFrom: someone'
    const result = buildCloudSnippet(input)
    expect(result).toBe('FYI see below.')
  })

  test('normalizes whitespace (collapses multiple spaces/newlines)', () => {
    const input = 'Hello   world\n\n\n\nNext line'
    const result = buildCloudSnippet(input)
    expect(result).toBe('Hello world\nNext line')
  })

  test('truncates to maxBytes on word boundary', () => {
    const input = 'word '.repeat(300) // 1500 bytes
    const result = buildCloudSnippet(input, 20)
    expect(new TextEncoder().encode(result).length).toBeLessThanOrEqual(25) // 20 + ellipsis
    expect(result.endsWith('…')).toBe(true)
  })

  test('appends ellipsis when truncated', () => {
    const input = 'a '.repeat(1000)
    const result = buildCloudSnippet(input, 50)
    expect(result.endsWith('…')).toBe(true)
  })

  test('does not truncate short input', () => {
    const input = 'Short text'
    const result = buildCloudSnippet(input, 1200)
    expect(result).toBe('Short text')
    expect(result.endsWith('…')).toBe(false)
  })

  test('handles empty input → empty string', () => {
    expect(buildCloudSnippet('')).toBe('')
  })

  test('pure function: same input always produces same output', () => {
    const input = 'Deterministic test content\n> quoted\n--\nSig'
    const r1 = buildCloudSnippet(input)
    const r2 = buildCloudSnippet(input)
    expect(r1).toBe(r2)
  })

  test('no PII detection, no NLP — deterministic text processing only', () => {
    const input = 'John Smith, 123 Main St, john@example.com, SSN: 123-45-6789'
    const result = buildCloudSnippet(input)
    // PII is NOT stripped — this is just text processing
    expect(result).toContain('John Smith')
    expect(result).toContain('123-45-6789')
  })
})
