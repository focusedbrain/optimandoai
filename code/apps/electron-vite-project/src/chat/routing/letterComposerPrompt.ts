/**
 * Letter Composer — system and user prompt builders for chatDirect (no store access).
 */

export function buildLetterComposerSystemPrompt(params: {
  targetFieldLabel: string
  targetFieldName: string
  /** e.g. 'de', 'en', or undefined — reserved for future use; LLM follows user instruction language. */
  userLanguageHint?: string
}): string {
  const { targetFieldLabel, targetFieldName } = params
  return `You are an assistant for composing formal business letters.

TASK:
- The user is editing exactly ONE target field of the letter template: ${targetFieldLabel} (technical name: ${targetFieldName}).
- Produce ONLY the text for this field.
- Do not explain your reasoning. Do not offer alternatives unless asked.

LANGUAGE RULE:
- Write in the SAME language the user uses in their instruction.
- If the user writes in German, respond in German (formal Sie-Form).
- If the user writes in English, respond in English.
- If unclear, default to German (formal).

FORMAT:
- Output ONLY the finished text for the target field.
- No markdown headings, no code blocks, no quote frames.
- No preamble like "Here is the text:" — start directly with the field content.
- If the field is a salutation or closing, output only that single line.`
}

function nonEmpty(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = s.trim()
  return t.length > 0 ? t : null
}

export function buildLetterComposerUserPrompt(params: {
  userInstruction: string
  templateExcerpt?: string | null
  fieldSnapshot?: string | null
  scannedLetterText?: string | null
  contextDocuments?: string | null
  chatAttachmentText?: string | null
}): string {
  const parts: string[] = []

  const ex = nonEmpty(params.templateExcerpt)
  if (ex) parts.push(`VORLAGE (bisheriger Stand):\n${ex}\n\n`)

  const fs = nonEmpty(params.fieldSnapshot)
  if (fs) parts.push(`AKTUELLE FELDWERTE:\n${fs}\n\n`)

  const sl = nonEmpty(params.scannedLetterText)
  if (sl) parts.push(`EINGESCANNTES SCHREIBEN:\n${sl}\n\n`)

  const cd = nonEmpty(params.contextDocuments)
  if (cd) parts.push(`ZUSÄTZLICHE DOKUMENTE:\n${cd}\n\n`)

  const ca = nonEmpty(params.chatAttachmentText)
  if (ca) parts.push(`ANHÄNGE AUS CHAT:\n${ca}\n\n`)

  const instruction = nonEmpty(params.userInstruction) ?? ''
  parts.push(`ANWEISUNG:\n${instruction}`)

  return parts.join('')
}
