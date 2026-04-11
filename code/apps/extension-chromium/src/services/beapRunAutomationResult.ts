/**
 * Pure interpretation of mode-run results for BEAP inbox "Run Automation".
 * Keeps failure messages explicit (no silent success when no mode_trigger matches).
 */

export const BEAP_AUTOMATION_NO_MODE_TRIGGER_MSG =
  'No eligible automation: this session has no enabled agents with mode_trigger matching this session, or triggers are misconfigured. Use Edit to adjust agents, add a Mode Trigger for this session, then try Run again.'

export type ModeRunAgentsResultLite = {
  matches: { length: number }
  executions: Array<{ success: boolean; agentName: string; error?: string }>
}

export type BeapAutomationModeRunOk = {
  ok: true
  sessionKey: string
  matchCount: number
  executed: string[]
  failures?: Array<{ agentName: string; error?: string }>
}

export type BeapAutomationModeRunErr = {
  ok: false
  sessionKey: string
  phase: 'mode_run'
  error: string
}

export function interpretBeapAutomationModeRun(
  sessionKey: string,
  runResult: ModeRunAgentsResultLite,
): BeapAutomationModeRunOk | BeapAutomationModeRunErr {
  if (runResult.matches.length === 0) {
    return {
      ok: false,
      sessionKey,
      phase: 'mode_run',
      error: BEAP_AUTOMATION_NO_MODE_TRIGGER_MSG,
    }
  }

  const failures = runResult.executions.filter((e) => !e.success)
  const successes = runResult.executions.filter((e) => e.success)

  if (successes.length === 0) {
    return {
      ok: false,
      sessionKey,
      phase: 'mode_run',
      error: failures.map((f) => `${f.agentName}: ${f.error || 'failed'}`).join('; '),
    }
  }

  return {
    ok: true,
    sessionKey,
    matchCount: runResult.matches.length,
    executed: successes.map((s) => s.agentName),
    failures:
      failures.length > 0
        ? failures.map((f) => ({ agentName: f.agentName, error: f.error }))
        : undefined,
  }
}
