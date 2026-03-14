/**
 * Unit tests for custom_fields extraction in block extraction.
 */
import { describe, it, expect } from 'vitest'
import { extractBlocks } from '../blockExtraction'

describe('extractBlocks — custom_fields', () => {
  it('extracts custom_fields as separate searchable blocks for ctx-* blocks', () => {
    const payload = JSON.stringify({
      profile: {
        id: 'p1',
        name: 'Acme',
        fields: { generalEmail: 'info@acme.example' },
        custom_fields: [
          { label: 'Opening Hours', value: 'Mon-Fri 9-17' },
          { label: 'Annex Location', value: 'See Annex A in onboarding pack' },
          { label: 'Preferred Language', value: 'English' },
          { label: 'Support Tier', value: 'Gold' },
        ],
      },
      documents: [],
    })
    const blockHash = 'a'.repeat(64)
    const blocks = extractBlocks('ctx-abc123-acceptor-001', payload, blockHash, 'context_blocks.ctx-abc123-acceptor-001')

    const mainBlock = blocks.find((b) => b.block_id === 'ctx-abc123-acceptor-001')
    expect(mainBlock).toBeDefined()
    expect(mainBlock!.text).toContain('profile')

    const cfBlocks = blocks.filter((b) => b.block_id.startsWith('ctx-abc123-acceptor-001.custom_field_'))
    expect(cfBlocks.length).toBe(4)

    expect(cfBlocks[0].block_id).toBe('ctx-abc123-acceptor-001.custom_field_0')
    expect(cfBlocks[0].text).toContain('Custom field: Opening Hours')
    expect(cfBlocks[0].text).toContain('Mon-Fri 9-17')
    expect(cfBlocks[0].parent_block_id).toBe('ctx-abc123-acceptor-001')

    expect(cfBlocks[1].text).toContain('Annex Location')
    expect(cfBlocks[1].text).toContain('onboarding pack')

    expect(cfBlocks[2].text).toContain('Preferred Language')
    expect(cfBlocks[2].text).toContain('English')

    expect(cfBlocks[3].text).toContain('Support Tier')
    expect(cfBlocks[3].text).toContain('Gold')
  })

  it('skips custom_fields for non-ctx-* blocks', () => {
    const payload = JSON.stringify({
      profile: {
        custom_fields: [{ label: 'X', value: 'Y' }],
      },
    })
    const blockHash = 'b'.repeat(64)
    const blocks = extractBlocks('doc-123', payload, blockHash, 'context_blocks.doc-123')

    const cfBlocks = blocks.filter((b) => b.block_id.includes('custom_field'))
    expect(cfBlocks.length).toBe(0)
  })

  it('skips empty custom_fields', () => {
    const payload = JSON.stringify({
      profile: {
        name: 'Acme',
        custom_fields: [],
      },
      documents: [],
    })
    const blockHash = 'c'.repeat(64)
    const blocks = extractBlocks('ctx-xyz-acceptor-001', payload, blockHash, 'context_blocks.ctx-xyz-acceptor-001')

    const cfBlocks = blocks.filter((b) => b.block_id.includes('custom_field'))
    expect(cfBlocks.length).toBe(0)
  })

  it('skips custom_fields with empty label and value', () => {
    const payload = JSON.stringify({
      profile: {
        name: 'Acme',
        custom_fields: [
          { label: '', value: '' },
          { label: 'Valid', value: 'Data' },
        ],
      },
      documents: [],
    })
    const blockHash = 'd'.repeat(64)
    const blocks = extractBlocks('ctx-xyz-acceptor-001', payload, blockHash, 'context_blocks.ctx-xyz-acceptor-001')

    const cfBlocks = blocks.filter((b) => b.block_id.includes('custom_field'))
    expect(cfBlocks.length).toBe(1)
    expect(cfBlocks[0].text).toContain('Valid')
    expect(cfBlocks[0].text).toContain('Data')
  })
})
