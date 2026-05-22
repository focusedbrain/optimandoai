import { describe, expect, it } from 'vitest'
import {
  isOrchestratorSessionContent,
  isSessionImportArtefactWrapper,
  orchestratorSessionContentToTabImport,
  unwrapSessionImportPayloadForTab,
} from '../sessionImportArtefactUnwrap'

describe('sessionImportArtefactUnwrap', () => {
  it('unwraps SessionImportArtefact wrapper to tab-import shape', () => {
    const artefact = {
      schema_version: '1.0.0',
      sessions: [
        {
          session_kind: 'orchestrator_session',
          session_id: 'session_src',
          session_name: 'Flow A',
          agents: [{ id: 'a1' }],
          agent_boxes: [{ id: 'b1' }],
          display_grids: [{ layout: 'default' }],
        },
      ],
    }
    expect(isSessionImportArtefactWrapper(artefact)).toBe(true)
    const r = unwrapSessionImportPayloadForTab(artefact)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.tabName).toBe('Flow A')
    expect(r.payload.agentBoxes).toEqual([{ id: 'b1' }])
    expect(r.payload.agents).toEqual([{ id: 'a1' }])
    expect(r.payload.displayGrids).toEqual([{ layout: 'default' }])
  })

  it('maps orchestrator session content directly', () => {
    const raw = {
      session_kind: 'orchestrator_session',
      session_id: 's1',
      session_name: 'Direct',
      agents: [],
      agent_boxes: [],
      display_grids: [],
    }
    expect(isOrchestratorSessionContent(raw)).toBe(true)
    const mapped = orchestratorSessionContentToTabImport(raw)
    expect(mapped.tabName).toBe('Direct')
    expect(mapped.agentBoxes).toEqual([])
  })
})
