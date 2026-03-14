/**
 * Intent Classifier — Unit tests
 */

import { describe, test, expect } from 'vitest'
import { classifyIntent, queryRequiresAttachmentSelection } from '../intentClassifier'

describe('intentClassifier', () => {
  test('knowledge_query: opening hours', () => {
    const r = classifyIntent('What are the opening hours of ExampleTech?')
    expect(r.intent).toBe('knowledge_query')
  })

  test('document_lookup: invoice', () => {
    const r = classifyIntent('Show me the last invoice from XYZ')
    expect(r.intent).toBe('document_lookup')
  })

  test('document_lookup: contract', () => {
    const r = classifyIntent('Find the contract with ACME')
    expect(r.intent).toBe('document_lookup')
  })

  test('handshake_context_query: what did we agree', () => {
    const r = classifyIntent('What did we agree with ACME?')
    expect(r.intent).toBe('handshake_context_query')
  })

  test('handshake_context_query: agreement with', () => {
    const r = classifyIntent('agreement with partner')
    expect(r.intent).toBe('handshake_context_query')
  })

  test('general_search: search for', () => {
    const r = classifyIntent('Search for monitoring documentation')
    expect(r.intent).toBe('general_search')
  })

  test('inbox_lookup: BEAP inbox', () => {
    const r = classifyIntent('Search the BEAP inbox for messages')
    expect(r.intent).toBe('inbox_lookup')
  })

  test('empty query defaults to knowledge_query', () => {
    const r = classifyIntent('')
    expect(r.intent).toBe('knowledge_query')
  })

  test('document_lookup: attachment summary phrasing', () => {
    expect(classifyIntent('Summarize the attachment').intent).toBe('document_lookup')
    expect(classifyIntent('Summarize the document').intent).toBe('document_lookup')
    expect(classifyIntent('Can you summarise the document?').intent).toBe('document_lookup')
    expect(classifyIntent('Give me a short summary of the attachment').intent).toBe('document_lookup')
    expect(classifyIntent('Briefly summarize this document').intent).toBe('document_lookup')
  })

  test('queryRequiresAttachmentSelection: summary phrasing', () => {
    expect(queryRequiresAttachmentSelection('Summarize the attachment')).toBe(true)
    expect(queryRequiresAttachmentSelection('Give me a short summary of the attachment')).toBe(true)
    expect(queryRequiresAttachmentSelection('Briefly summarize this document')).toBe(true)
  })

  test('broad corpus: document say about X stays knowledge_query', () => {
    const r = classifyIntent('What does the document say about refunds?')
    expect(r.intent).toBe('knowledge_query')
    expect(queryRequiresAttachmentSelection('What does the document say about refunds?')).toBe(false)
  })
})
