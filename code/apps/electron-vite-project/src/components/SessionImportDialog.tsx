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
        <div className="session-import-header">⚠️ Session Import Consent</div>
        <div className="session-import-body">
          <p>
            This BEAP message contains a workflow session that can be imported and executed on your system.
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
            Importing this session will store it in your orchestrator database. Execution will occur under
            capability constraints defined by your policy and the handshake agreement.
          </p>
          <p className="session-import-warning">
            <strong>You can review and revoke this session at any time.</strong>
          </p>
        </div>
        <div className="session-import-actions">
          <button type="button" className="session-import-cancel" onClick={onCancel} disabled={importing}>
            Cancel
          </button>
          <button type="button" className="session-import-confirm" onClick={onConfirm} disabled={importing}>
            {importing ? 'Importing…' : '▶ Import & Run'}
          </button>
        </div>
      </div>
    </div>
  )
}
