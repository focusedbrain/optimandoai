/**
 * Monospace technical formatting for diagnostic reports (P5.6).
 *
 * Input is already validated/signed JSON from main process; output is plain text only.
 */

export function formatDiagnosticReportText(rawJson: string): string {
  const parsed = JSON.parse(rawJson) as unknown
  return JSON.stringify(parsed, null, 2)
}
