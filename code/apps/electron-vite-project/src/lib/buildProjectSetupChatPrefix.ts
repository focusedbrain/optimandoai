import type { ProjectSetupChatContextState } from '../stores/useProjectSetupChatContextStore'
import { projectSetupChatHasBridgeableContent } from '../stores/useProjectSetupChatContextStore'

const MAX_FIELD = 12_000
const MAX_SNIPPET_TEXT = 6_000

function clip(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}\n… [truncated]`
}

/**
 * Builds the V1 project-setup assistance prefix for HybridSearch.
 * Returns empty when disabled or nothing to send — caller must not treat as error.
 *
 * Structure (machine-readable tags + explicit non-persistence disclaimer):
 * - [WR_DESK / PROJECT_SETUP_ASSISTANCE]
 * - META: analysis dashboard, renderer drafts, no auto-apply
 * - TAGGED fields + SNIPPET entries
 * - ASSISTANT_INSTRUCTIONS
 */
export function buildProjectSetupChatPrefix(state: ProjectSetupChatContextState): string {
  if (!state.includeInChat || !projectSetupChatHasBridgeableContent(state)) return ''

  const name = clip(state.projectNameDraft, MAX_FIELD)
  const goals = clip(state.goalsDraft, MAX_FIELD)
  const milestones = clip(state.milestonesDraft, MAX_FIELD)
  const setup = clip(state.setupTextDraft, MAX_FIELD)

  const snippetLines: string[] = []
  for (const sn of state.snippets) {
    const lab = sn.label.trim()
    const txt = clip(sn.text, MAX_SNIPPET_TEXT)
    if (!lab && !txt) continue
    snippetLines.push(
      `  <snippet label=${JSON.stringify(lab || '(untitled)')}>\n${txt}\n  </snippet>`,
    )
  }

  const parts: string[] = [
    '[WR_DESK / PROJECT_SETUP_ASSISTANCE]',
    '',
    'META:',
    '- surface: Analysis dashboard',
    '- content: user-authored setup drafts only (renderer memory)',
    '- persistence: NONE — these are not saved as project entities',
    '- write_back: user copies assistant output manually into setup fields if desired',
    '- do_not: claim a project was created, updated, or stored; invent project IDs; run optimization',
    '',
    '<project_name_draft>',
    name || '(empty)',
    '</project_name_draft>',
    '',
    '<goals_draft>',
    goals || '(empty)',
    '</goals_draft>',
    '',
    '<milestones_draft>',
    milestones || '(empty)',
    '</milestones_draft>',
    '',
    '<setup_and_context_draft>',
    setup || '(empty)',
    '</setup_and_context_draft>',
    '',
    '<context_snippets>',
    snippetLines.length ? snippetLines.join('\n') : '(none)',
    '</context_snippets>',
    '',
    'ASSISTANT_INSTRUCTIONS:',
    'Help refine goals, milestones, and setup text based on the user message below.',
    'If you propose replacement text, make sections easy to copy. State clearly that changes are suggestions only.',
    '',
    '[END_WR_DESK_PROJECT_SETUP_ASSISTANCE]',
  ]

  return parts.join('\n')
}
