/**
 * Letter Composer — chatDirect flow (template or scanned-letter port). Reads Zustand stores; does not write them.
 */

import { useChatFocusStore } from '@ext/stores/chatFocusStore'
import { useAiDraftContextStore } from '../../stores/useAiDraftContextStore'
import { useLetterComposerStore } from '../../stores/useLetterComposerStore'
import { buildLetterComposerSystemPrompt, buildLetterComposerUserPrompt } from './letterComposerPrompt'

const FALLBACK_FIELD = { label: 'Body', name: 'body' }

function fieldSnapshotFromFocusMeta(
  fields: Array<{ id: string; name: string; value: string }> | undefined,
): string | null {
  if (!fields?.length) return null
  const lines = fields.map((f) => `${f.name}: ${f.value ?? ''}`)
  return lines.join('\n')
}

export async function handleLetterComposerChat(params: {
  userQuery: string
  chatAttachmentText: string | null
  model: string
  provider: string
  stream: boolean
}): Promise<{ success: boolean; answer?: string; error?: string }> {
  const { focusMeta } = useChatFocusStore.getState()
  const letter = useLetterComposerStore.getState()
  const { documents } = useAiDraftContextStore.getState()

  const activeTemplateId = letter.activeTemplateId
  const templateId = focusMeta?.letterComposerTemplateId ?? activeTemplateId
  const tpl = templateId ? letter.templates.find((t) => t.id === templateId) : null

  const fieldId = focusMeta?.letterComposerApplyFieldId ?? letter.focusedTemplateFieldId
  let targetFieldLabel = FALLBACK_FIELD.label
  let targetFieldName = FALLBACK_FIELD.name
  if (tpl?.fields?.length) {
    const f = fieldId ? tpl.fields.find((x) => x.id === fieldId) : undefined
    if (f) {
      targetFieldLabel = f.label || f.name || FALLBACK_FIELD.label
      targetFieldName = f.name || FALLBACK_FIELD.name
    }
  }

  const systemPrompt = buildLetterComposerSystemPrompt({
    targetFieldLabel,
    targetFieldName,
  })

  const fieldSnapshot = focusMeta?.letterComposerFields
    ? fieldSnapshotFromFocusMeta(focusMeta.letterComposerFields)
    : null

  const contextDocumentsBlock =
    documents.length > 0
      ? documents.map((d) => `--- ${d.name || 'Dokument'} ---\n${d.text}`).join('\n\n')
      : null

  const userPrompt = buildLetterComposerUserPrompt({
    userInstruction: params.userQuery,
    templateExcerpt: focusMeta?.letterComposerTemplateHtmlExcerpt ?? null,
    fieldSnapshot,
    scannedLetterText: focusMeta?.letterComposerLetterPageText ?? null,
    contextDocuments: contextDocumentsBlock,
    chatAttachmentText: params.chatAttachmentText,
  })

  const chatDirect = window.handshakeView?.chatDirect
  if (typeof chatDirect !== 'function') {
    return { success: false, error: 'chatDirect not available' }
  }

  try {
    console.log('LINK3: letterComposerChat calling chatDirect', {
      stream: params.stream,
      model: params.model,
      provider: params.provider,
      userQuery: params.userQuery?.substring(0, 200),
      userPromptLen: userPrompt.length,
      systemPromptLen: systemPrompt.length,
    })
    const result = await chatDirect({
      model: params.model,
      provider: params.provider,
      systemPrompt,
      userPrompt,
      stream: params.stream,
    })
    if (!result.success) {
      const err = (result.error ?? result.message)?.trim() || 'chatDirect failed'
      return { success: false, error: err }
    }
    return { success: true, answer: result.answer }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  }
}
