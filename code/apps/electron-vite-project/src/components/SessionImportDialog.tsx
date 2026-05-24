/**
 * Consent dialog before importing a workflow session from a BEAP message into the orchestrator DB.
 */

export interface SessionImportDialogSessionRef {
  sessionId: string
  sessionName?: string
  requiredCapability?: string
}

interface SessionImportDialogProps {
  sessionRef: SessionImportDialogSessionRef
  messageId: string
  onConfirm: () => void
  onCancel: () => void
  importing: boolean
}

export default function SessionImportDialog({
  sessionRef,
  messageId,
  onConfirm,
  onCancel,
  importing,
}: SessionImportDialogProps) {
  return (
    <div className="session-import-overlay">
      <div className="session-import-dialog">
        <div className="session-import-header">Run Automation — session import consent</div>
        <div className="session-import-body">
          <p>
            This BEAP message contains a <strong>validated text instruction set</strong> (a workflow
            session). No executable code is run from the message itself — only structured agent
            instructions that your orchestrator applies under your policy and handshake agreement.
          </p>
          <div className="session-import-details">
            <div>
              <strong>Session:</strong> {sessionRef.sessionName || sessionRef.sessionId}
            </div>
            {sessionRef.requiredCapability ? (
              <div>
                <strong>Required capability:</strong> {sessionRef.requiredCapability}
              </div>
            ) : null}
            <div>
              <strong>Message:</strong> {messageId}
            </div>
          </div>
          <p className="session-import-warning">
            Importing stores a working copy in your orchestrator database, then activates it in the
            active browser tab and runs eligible mode-trigger agents.
          </p>
          <p className="session-import-warning">
            <strong>Sensitive automation</strong> involving PII, credentials, or critical actions
            should be tested in a <strong>Sandbox environment</strong> first (use Sandbox clone from
            the inbox) before running on your host orchestrator.
          </p>
          <p className="session-import-warning">
            You can review and revoke imported sessions at any time from the{' '}
            <strong>Received Automations</strong> section in Sessions History.
          </p>
        </div>
        <div className="session-import-actions">
          <button type="button" className="session-import-cancel" onClick={onCancel} disabled={importing}>
            Cancel
          </button>
          <button type="button" className="session-import-confirm" onClick={onConfirm} disabled={importing}>
            {importing ? 'Running…' : 'Run Automation'}
          </button>
        </div>
      </div>
    </div>
  )
}
