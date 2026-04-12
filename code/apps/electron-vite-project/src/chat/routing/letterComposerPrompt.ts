/**
 * Letter Composer — system and user prompt builders for chatDirect (no store access).
 */

export function buildLetterComposerSystemPrompt(params: {
  targetFieldLabel: string
  targetFieldName: string
}): string {
  const { targetFieldLabel, targetFieldName } = params
  return `Du bist ein Assistent für formelle Geschäftsbriefe auf Deutsch (Sie-Form).

AUFGABE:
- Der Nutzer bearbeitet genau EIN Zielfeld der Vorlage: ${targetFieldLabel} (technischer Name: ${targetFieldName}).
- Erzeuge ausschließlich den Text für dieses Feld.
- Erkläre nicht deinen Denkprozess. Gib keine Alternativen, wenn nicht verlangt.

FORMAT:
- Gib NUR den fertigen Text für das Zielfeld aus.
- Keine Markdown-Überschriften, keine Codeblöcke, keine Anführungsrahmen.
- Keine Einleitung wie „Hier ist der Text:" — beginne direkt mit dem Feldinhalt.
- Wenn das Feld eine Anrede oder Grußformel ist, gib nur diese eine Zeile aus.`
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
