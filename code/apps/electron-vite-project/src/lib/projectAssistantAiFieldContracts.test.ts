import { describe, it, expect } from 'vitest'
import {
  PROJECT_ASSISTANT_DATA_FIELD_IDS,
  projectAssistantDataFieldSelector,
  projectAssistantMilestoneSelector,
} from './projectAssistantAiFieldContracts'

describe('projectAssistantAiFieldContracts', () => {
  it('keeps stable data-field selector shape for HybridSearch / flashFieldEl', () => {
    expect(projectAssistantDataFieldSelector('title')).toBe('[data-field="title"]')
    expect(projectAssistantDataFieldSelector('description')).toBe('[data-field="description"]')
    expect(projectAssistantDataFieldSelector('goals')).toBe('[data-field="goals"]')
  })

  it('keeps stable data-milestone-id selector shape for flashMilestoneEl', () => {
    expect(projectAssistantMilestoneSelector('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '[data-milestone-id="550e8400-e29b-41d4-a716-446655440000"]',
    )
  })

  it('documents the three inline form field ids wired to data-field', () => {
    expect([...PROJECT_ASSISTANT_DATA_FIELD_IDS]).toEqual(['title', 'description', 'goals'])
  })
})
