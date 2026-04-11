/**

 * Inline BEAP™ composer for the Electron dashboard (dashboard panel, not popup).

 * Mirrors popup-chat draft fields; delivery uses `executeDeliveryAction` like InboxDetailAiPanel.

 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { useDraftRefineStore } from '../stores/useDraftRefineStore';

import { RecipientHandshakeSelect, RecipientModeSwitch } from '@ext/beap-messages';

import {
  executeDeliveryAction,
  type BeapPackageConfig,
} from '@ext/beap-messages/services/BeapPackageBuilder';

import { getSigningKeyPair } from '@ext/beap-messages/services/beapCrypto';

import type { CapsuleAttachment } from '@ext/beap-builder/canonical-types';

import { BeapDocumentReaderModal } from '@ext/beap-builder/components/BeapDocumentReaderModal';

import { AttachmentStatusBadge } from '@ext/beap-builder/components/AttachmentStatusBadge';

import type { AttachmentParseStatus } from '@ext/beap-builder/components/AttachmentStatusBadge';

import type { DeliveryMethod } from '@ext/beap-messages/components/DeliveryMethodPanel';

import type { RecipientMode } from '@ext/beap-messages/components/RecipientModeSwitch';

import {
  hasHandshakeKeyMaterial,
  type HandshakeRecord,
  type SelectedHandshakeRecipient,
} from '@ext/handshake/rpcTypes';

import { listHandshakes } from '../shims/handshakeRpc';

import './handshakeViewTypes';

import '../styles/dashboard-base.css';

import './composer-layout.css';

import { ConnectEmailLaunchSource } from '@ext/shared/email/connectEmailFlow';

import { EmailAccountSelector } from './shared/EmailAccountSelector';

import { extractTextForPackagePreview } from '../lib/beapPackageAttachmentPreview';

import { AiDraftContextRail } from './AiDraftContextRail';

import { ComposerAttachmentButton } from './ComposerAttachmentButton';

import { DraftRefineLabel } from './DraftRefineLabel';

export interface BeapInlineComposerProps {
  onClose: () => void;

  onSent: () => void;

  /** Pre-select handshake when opening from a reply flow */

  replyToHandshakeId?: string;

  /**
   * Full-width automation dashboard: hide inner title bar, match email composer rail width,
   * expose Clear with primary actions (AnalysisCanvas supplies the back bar).
   */
  embedInDashboard?: boolean;
}

type LocalAttachment = {
  id: string;

  name: string;

  path: string;

  size: number;

  mime?: string;

  previewText?: string | null;

  previewError?: string | null;

  /** PDF attachment parse lifecycle (legacy capsule builder pattern). */

  parseStatus?: AttachmentParseStatus;
};

const draftSurface: CSSProperties = {
  background: '#ffffff',

  color: '#0f172a',

  border: '1px solid #cbd5e1',
};

const draftFocusOutline = '2px solid #6366f1';

type OrchestratorSession = { id: string; name: string };

/** Map IPC `HandshakeRecord` to builder `SelectedHandshakeRecipient` (same field contract as extension picker). */

function handshakeRecordToSelectedRecipient(h: HandshakeRecord): SelectedHandshakeRecipient {
  const email = h.counterparty_email ?? '';

  return {
    handshake_id: h.handshake_id,

    counterparty_email: email,

    counterparty_user_id: h.counterparty_user_id,

    sharing_mode: h.sharing_mode === 'reciprocal' ? 'reciprocal' : 'receive-only',

    receiver_email_list: email ? [email] : [],

    receiver_display_name: email ? email.split('@')[0] : 'Peer',

    peerX25519PublicKey: h.peerX25519PublicKey,

    peerPQPublicKey: h.peerPQPublicKey,

    p2pEndpoint: h.p2pEndpoint ?? null,
  };
}

function isPdfAttachment(name: string, mime?: string): boolean {
  const m = (mime || '').toLowerCase();

  return m === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
}

export function BeapInlineComposer({
  onClose,
  onSent,
  replyToHandshakeId,
  embedInDashboard = false,
}: BeapInlineComposerProps) {
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('p2p');

  const [recipientMode, setRecipientMode] = useState<RecipientMode>('private');

  const [handshakeRows, setHandshakeRows] = useState<HandshakeRecord[]>([]);

  const [selectedHandshakeId, setSelectedHandshakeId] = useState<string | null>(null);

  const [handshakesLoading, setHandshakesLoading] = useState(true);

  const [handshakesError, setHandshakesError] = useState<string | null>(null);

  const [emailTo, setEmailTo] = useState('');

  const [subject, setSubject] = useState('BEAP™ Message');

  const [publicMessage, setPublicMessage] = useState('');

  const [encryptedMessage, setEncryptedMessage] = useState('');

  const [sessionId, setSessionId] = useState('');

  const [sessions, setSessions] = useState<OrchestratorSession[]>([]);

  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);

  const [readerOpen, setReaderOpen] = useState(false);

  const [readerFilename, setReaderFilename] = useState('');

  const [readerText, setReaderText] = useState('');

  const [fingerprintShort, setFingerprintShort] = useState('—');

  const [fingerprintFull, setFingerprintFull] = useState('');

  const [fingerprintCopied, setFingerprintCopied] = useState(false);

  const [sending, setSending] = useState(false);

  const [sendError, setSendError] = useState<string | null>(null);

  const [sendSuccess, setSendSuccess] = useState(false);

  const sendSuccessCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useDraftRefineStore((s) => s.connect);

  const disconnect = useDraftRefineStore((s) => s.disconnect);

  const connected = useDraftRefineStore((s) => s.connected);

  const refineTarget = useDraftRefineStore((s) => s.refineTarget);

  const updateDraftText = useDraftRefineStore((s) => s.updateDraftText);

  const selectedRecipient: SelectedHandshakeRecipient | null = useMemo(() => {
    if (recipientMode !== 'private' || !selectedHandshakeId) return null;

    const raw = handshakeRows.find((r) => r.handshake_id === selectedHandshakeId);

    if (!raw) return null;

    return handshakeRecordToSelectedRecipient(raw);
  }, [handshakeRows, recipientMode, selectedHandshakeId]);

  useEffect(() => {
    const loadFp = async () => {
      try {
        const kp = await getSigningKeyPair();

        const fp = kp.publicKey;

        setFingerprintFull(fp);

        setFingerprintShort(fp.length > 12 ? `${fp.slice(0, 4)}…${fp.slice(-4)}` : fp);
      } catch {
        setFingerprintShort('—');

        setFingerprintFull('');
      }
    };

    void loadFp();
  }, []);

  useEffect(() => {
    return () => {
      if (sendSuccessCloseTimerRef.current) {
        clearTimeout(sendSuccessCloseTimerRef.current);
        sendSuccessCloseTimerRef.current = null;
      }
    };
  }, []);

  const refreshHandshakes = useCallback(async () => {
    setHandshakesLoading(true);

    setHandshakesError(null);

    try {
      const records = await listHandshakes('active');

      setHandshakeRows(records ?? []);
    } catch (e) {
      setHandshakesError(e instanceof Error ? e.message : 'Failed to load handshakes');

      setHandshakeRows([]);
    } finally {
      setHandshakesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHandshakes();
  }, [refreshHandshakes]);

  useEffect(() => {
    if (replyToHandshakeId && handshakeRows.some((r) => r.handshake_id === replyToHandshakeId)) {
      setSelectedHandshakeId(replyToHandshakeId);

      setRecipientMode('private');
    }
  }, [replyToHandshakeId, handshakeRows]);

  /** Click the field or AI refine button to connect the top chat; click again to disconnect. */
  const handleAiRefineToggle = useCallback(
    (field: 'public' | 'encrypted') => {
      const target = field === 'public' ? 'capsule-public' : 'capsule-encrypted';

      if (connected && refineTarget === target) {
        disconnect();
      } else {
        connect(
          null,

          'New BEAP Message',

          field === 'public' ? publicMessage : encryptedMessage,

          (text) => (field === 'public' ? setPublicMessage(text) : setEncryptedMessage(text)),

          target,
        );
      }
    },

    [connected, refineTarget, disconnect, connect, publicMessage, encryptedMessage],
  );

  useEffect(() => {
    if (!connected) return;

    if (refineTarget === 'capsule-public') updateDraftText(publicMessage);
    else if (refineTarget === 'capsule-encrypted') updateDraftText(encryptedMessage);
  }, [publicMessage, encryptedMessage, connected, refineTarget, updateDraftText]);

  useEffect(() => () => disconnect(), [disconnect]);

  const loadSessions = useCallback(async () => {
    try {
      if (typeof window.orchestrator?.connect === 'function') {
        await window.orchestrator.connect();
      }
    } catch {
      /* best-effort */
    }

    try {
      const json = (await window.orchestrator?.listSessions?.()) as
        | {
            success?: boolean;
            data?: Array<{ id: string; name: string }>;
          }
        | undefined;

      if (json?.success && Array.isArray(json.data)) {
        setSessions(json.data.map((s) => ({ id: s.id, name: s.name })));
      } else {
        setSessions([]);
      }
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    const onOrchestratorSession = () => void loadSessions();
    window.addEventListener('orchestrator-session-display-updated', onOrchestratorSession);
    return () => window.removeEventListener('orchestrator-session-display-updated', onOrchestratorSession);
  }, [loadSessions]);

  const resetForm = useCallback(() => {
    disconnect();

    setDeliveryMethod('p2p');

    setRecipientMode('private');

    setEmailTo('');

    setSubject('BEAP™ Message');

    setPublicMessage('');

    setEncryptedMessage('');

    setSessionId('');

    setAttachments([]);

    setSendError(null);

    setSelectedHandshakeId(replyToHandshakeId ?? null);
  }, [disconnect, replyToHandshakeId]);

  const handleComposerClose = useCallback(() => {
    disconnect();

    onClose();
  }, [disconnect, onClose]);

  const addAttachments = useCallback(async () => {
    if (
      !window.emailInbox?.showOpenDialogForAttachments ||
      !window.emailInbox?.readFileForAttachment
    )
      return;

    const res = await window.emailInbox.showOpenDialogForAttachments();

    const files = res?.ok ? res.data?.files : undefined;

    if (!files?.length) return;

    for (const f of files) {
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const read = await window.emailInbox.readFileForAttachment(f.path);

      const mime = read?.ok ? read.data?.mimeType : undefined;

      const b64 = read?.ok ? read.data?.contentBase64 : undefined;

      const pdf = isPdfAttachment(f.name, mime);

      if (pdf) {
        setAttachments((prev) => [
          ...prev,

          {
            id,

            name: f.name,

            path: f.path,

            size: f.size,

            mime,

            previewText: null,

            previewError: null,

            parseStatus: 'pending',
          },
        ]);

        let previewText: string | null = null;

        let previewError: string | null = null;

        let parseStatus: AttachmentParseStatus = 'failed';

        if (b64) {
          const extracted = await extractTextForPackagePreview({
            name: f.name,
            mimeType: mime,
            base64: b64,
          });

          if (extracted.text) {
            previewText = extracted.text;

            parseStatus = 'success';
          } else {
            previewError = extracted.error ?? 'Could not extract text.';

            parseStatus = 'failed';
          }
        } else {
          previewError = 'Could not read file for preview.';

          parseStatus = 'failed';
        }

        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, previewText, previewError, parseStatus } : a)),
        );

        continue;
      }

      let previewText: string | null = null;

      let previewError: string | null = null;

      if (b64) {
        const extracted = await extractTextForPackagePreview({
          name: f.name,
          mimeType: mime,
          base64: b64,
        });

        if (extracted.text) previewText = extracted.text;
        else if (extracted.error) previewError = extracted.error;
      } else {
        previewError = 'Could not read file for preview.';
      }

      setAttachments((prev) => [
        ...prev,

        {
          id,

          name: f.name,

          path: f.path,

          size: f.size,

          mime,

          previewText,

          previewError,
        },
      ]);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const openAttachmentReader = useCallback((a: LocalAttachment) => {
    if (!a.previewText?.trim()) return;

    setReaderFilename(a.name);

    setReaderText(a.previewText);

    setReaderOpen(true);
  }, []);

  const copyFingerprint = useCallback(() => {
    if (!fingerprintFull) return;

    void navigator.clipboard.writeText(fingerprintFull);

    setFingerprintCopied(true);

    window.setTimeout(() => setFingerprintCopied(false), 2000);
  }, [fingerprintFull]);

  const handleSend = useCallback(async () => {
    setSendError(null);

    setSendSuccess(false);

    if (sendSuccessCloseTimerRef.current) {
      clearTimeout(sendSuccessCloseTimerRef.current);

      sendSuccessCloseTimerRef.current = null;
    }

    if (!publicMessage.trim()) {
      setSendError('Enter the public BEAP™ message text before sending.');

      return;
    }

    if (recipientMode === 'private' && !selectedRecipient) {
      setSendError('Select a handshake recipient for private mode.');

      return;
    }

    if (
      recipientMode === 'private' &&
      selectedRecipient &&
      !hasHandshakeKeyMaterial(selectedRecipient)
    ) {
      setSendError(
        'Handshake is missing X25519 / ML-KEM keys — re-establish the handshake for qBEAP.',
      );

      return;
    }

    if (recipientMode === 'public' && deliveryMethod === 'email' && !emailTo.trim()) {
      setSendError('Enter a delivery email address.');

      return;
    }

    setSending(true);

    try {
      const kp = await getSigningKeyPair();

      const senderFp = kp.publicKey;

      const senderShort =
        senderFp.length > 12 ? `${senderFp.slice(0, 4)}…${senderFp.slice(-4)}` : senderFp;

      const capsuleAttachments: CapsuleAttachment[] = [];

      const originalFiles: NonNullable<BeapPackageConfig['originalFiles']> = [];

      if (attachments.length > 0 && window.emailInbox?.readFileForAttachment) {
        for (const att of attachments) {
          const res = await window.emailInbox.readFileForAttachment(att.path);

          if (!res?.ok || !res.data?.contentBase64) continue;

          const mime = res.data.mimeType || att.mime || 'application/octet-stream';

          originalFiles.push({
            attachmentId: att.id,

            filename: att.name,

            mime,

            base64: res.data.contentBase64,
          });

          capsuleAttachments.push({
            id: att.id,

            originalName: att.name,

            originalSize: att.size,

            originalType: mime,

            semanticContent: null,

            semanticExtracted: false,

            encryptedRef: `encrypted_${att.id}`,

            encryptedHash: '',

            previewRef: null,

            rasterProof: null,

            isMedia:
              mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/'),

            hasTranscript: false,
          });
        }
      }

      const config: BeapPackageConfig = {
        recipientMode,

        deliveryMethod,

        selectedRecipient: recipientMode === 'private' ? selectedRecipient : null,

        senderFingerprint: senderFp,

        senderFingerprintShort: senderShort,

        messageBody: publicMessage,

        subject: subject.trim() || 'BEAP™ Message',

        emailTo: recipientMode === 'public' ? emailTo.trim() : undefined,

        attachments: capsuleAttachments.length > 0 ? capsuleAttachments : undefined,

        originalFiles: originalFiles.length > 0 ? originalFiles : undefined,

        ...(recipientMode === 'private' && encryptedMessage.trim()
          ? { encryptedMessage: encryptedMessage.trim() }
          : {}),
      };

      const logPayload = {
        config,

        orchestratorSessionId: sessionId || undefined,

        selectedEmailAccountId: selectedEmailAccountId ?? undefined,
      };

      console.log('[BeapInlineComposer] send payload:', logPayload);

      const result = await executeDeliveryAction(config);

      if (result.success) {
        try {
          const counterpartyDisplay =
            recipientMode === 'private'
              ? selectedRecipient?.counterparty_email ||
                selectedRecipient?.receiver_display_name ||
                selectedHandshakeId ||
                'Handshake'
              : emailTo.trim() || 'Public';
          const insertPayload: Record<string, unknown> = {
            id: crypto.randomUUID(),
            handshakeId: recipientMode === 'private' ? selectedHandshakeId ?? undefined : undefined,
            counterpartyDisplay,
            subject: subject.trim() || 'BEAP™ Message',
            publicBodyPreview: publicMessage.slice(0, 500),
            encryptedBodyPreview:
              recipientMode === 'private' && encryptedMessage.trim()
                ? encryptedMessage.trim().slice(0, 500)
                : undefined,
            hasEncryptedInner: recipientMode === 'private' && !!encryptedMessage.trim(),
            deliveryMethod: deliveryMethod,
            deliveryStatus: 'sent',
            deliveryDetailJson: JSON.stringify({
              action: result.action,
              message: result.message,
              coordinationRelayDelivery: result.coordinationRelayDelivery,
              delivered: result.delivered,
            }),
            attachmentSummaryJson:
              attachments.length > 0
                ? JSON.stringify(attachments.map((f) => ({ name: f.name, size: f.size })))
                : undefined,
          };
          void window.outbox?.insertSent?.(insertPayload)?.catch((err: unknown) =>
            console.warn('[Outbox] insert failed:', err),
          );
        } catch {
          /* fire-and-forget */
        }

        setSendSuccess(true);

        sendSuccessCloseTimerRef.current = setTimeout(() => {
          sendSuccessCloseTimerRef.current = null;

          setSendSuccess(false);

          onSent();
        }, 2000);
      } else {
        setSendError(result.message || 'Send failed');
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }, [
    attachments,

    deliveryMethod,

    emailTo,

    encryptedMessage,

    onSent,

    publicMessage,

    recipientMode,

    selectedRecipient,

    selectedHandshakeId,

    selectedEmailAccountId,

    sessionId,

    subject,
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();

        void handleSend();
      }
    };

    window.addEventListener('keydown', handler);

    return () => window.removeEventListener('keydown', handler);
  }, [handleSend]);

  const border = '1px solid #e2e8f0';

  /** Light dashboard — matches surrounding shell; not legacy popup dark theme */
  const textPrimary = '#0f172a';

  const labelMuted = '#64748b';

  /** Alias for uppercase field labels */
  const muted = labelMuted;

  const surfacePage = '#f8fafc';

  const surfaceHeader = '#ffffff';

  const hintOnRail = '#475569';

  return (
    <div
      className={embedInDashboard ? 'beap-inline-composer beap-inline-composer--dashboard' : 'beap-inline-composer'}
      style={{
        background: surfacePage,

        color: textPrimary,

        fontFamily: 'inherit',
      }}
    >
      <div className="compose-grid" style={{ gap: 0, background: surfacePage }}>
        <div className="composer-main-column" style={{ borderRight: border, background: surfacePage }}>
        {!embedInDashboard && (
        <div
          className="compose-field-fixed"
          style={{
            display: 'flex',

            alignItems: 'center',

            justifyContent: 'space-between',

            padding: '12px 16px',

            borderBottom: border,

            background: surfaceHeader,
          }}
        >
          <span
            style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: textPrimary }}
          >
            BEAP™ Composer
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={resetForm}
              style={{
                fontSize: 12,
                padding: '6px 10px',
                cursor: 'pointer',
                color: textPrimary,
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
              }}
            >
              Clear
            </button>

            <button
              type="button"
              onClick={handleComposerClose}
              aria-label="Close composer"
              style={{
                fontSize: 18,
                lineHeight: 1,
                padding: '4px 10px',
                cursor: 'pointer',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                color: textPrimary,
              }}
            >
              ✕
            </button>
          </div>
        </div>
        )}

        <div className="composer-form-column" style={{ background: surfacePage }}>
          {/* Fingerprint + distribution order matches legacy builder; colors = light (popup standard branch) */}

          <div
            style={{
              background: '#dbeafe',
              border: '1px solid #93c5fd',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: '#1e40af',
                marginBottom: 6,
              }}
            >
              Your Fingerprint
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  color: '#1e40af',
                  wordBreak: 'break-all',
                }}
              >
                {fingerprintShort}
              </code>

              <button
                type="button"
                onClick={copyFingerprint}
                disabled={!fingerprintFull}
                style={{
                  background: fingerprintCopied ? '#16a34a' : '#3b82f6',
                  border: 'none',
                  color: '#ffffff',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 10,
                  cursor: fingerprintFull ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {fingerprintCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <RecipientModeSwitch
            mode={recipientMode}
            onModeChange={setRecipientMode}
            theme="standard"
          />

          {recipientMode === 'private' && (
            <RecipientHandshakeSelect
              handshakes={handshakeRows}
              selectedHandshakeId={selectedHandshakeId}
              onSelect={(recipient) => {
                setSelectedHandshakeId(recipient?.handshake_id ?? null);
              }}
              theme="standard"
              isLoading={handshakesLoading}
              fetchError={handshakesError}
              onRetry={() => void refreshHandshakes()}
            />
          )}

          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: muted,
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: 6,
                letterSpacing: '0.5px',
              }}
            >
              Delivery method
            </label>

            <select
              value={deliveryMethod}
              onChange={(e) => setDeliveryMethod(e.target.value as DeliveryMethod)}
              style={{
                width: '100%',

                padding: '10px 12px',

                borderRadius: 8,

                ...draftSurface,

                fontSize: 13,

                outline: 'none',
              }}
            >
              <option value="email">Email</option>

              <option value="p2p">P2P</option>

              <option value="download">Download (USB / wallet)</option>
            </select>
          </div>

          {deliveryMethod === 'email' && (
            <div className="compose-field-fixed">
              <EmailAccountSelector
                selectedAccountId={selectedEmailAccountId}
                onAccountChange={setSelectedEmailAccountId}
                connectTheme="professional"
                connectLaunchSource={ConnectEmailLaunchSource.BeapInboxDashboard}
              />
            </div>
          )}

          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: textPrimary,
                marginBottom: 6,
                letterSpacing: '0.5px',
              }}
            >
              Delivery details
            </div>

            {deliveryMethod === 'email' && recipientMode === 'private' && (
              <p style={{ margin: 0, fontSize: 12, color: '#334155' }}>
                {selectedRecipient?.receiver_email_list?.length
                  ? `Sends to: ${selectedRecipient.receiver_email_list[0]}`
                  : 'No email on this handshake — package may be built for manual delivery.'}
              </p>
            )}

            {deliveryMethod === 'email' && recipientMode === 'public' && (
              <label style={{ display: 'block', marginTop: 8 }}>
                <span style={{ fontSize: 11, color: '#475569' }}>To (email)</span>

                <input
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="recipient@example.com"
                  style={{
                    width: '100%',
                    marginTop: 4,
                    padding: 8,
                    borderRadius: 6,
                    ...draftSurface,
                    outline: 'none',
                  }}
                />
              </label>
            )}

            {deliveryMethod === 'p2p' && (
              <p style={{ margin: 0, fontSize: 12, color: '#334155' }}>
                {recipientMode === 'private'
                  ? 'Sends via encrypted P2P to the handshake peer when the endpoint is available.'
                  : 'Public P2P distribution uses the standard pBEAP builder path.'}
              </p>
            )}

            {deliveryMethod === 'download' && (
              <p style={{ margin: 0, fontSize: 12, color: '#334155' }}>
                Saves a .beap package locally (download action after build).
              </p>
            )}
          </div>

          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: muted,
              textTransform: 'uppercase',
              display: 'block',
              marginBottom: 6,
              letterSpacing: '0.5px',
            }}
          >
            Subject
          </label>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: 8,
              ...draftSurface,
              fontSize: 13,
              outline: 'none',
            }}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow = `0 0 0 1px ${draftFocusOutline}`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = 'none';
            }}
          />

          <div className="composer-body-container beap-message-field">
            <div
              className="compose-field-fixed beap-message-field__header"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                flexWrap: 'wrap',
              }}
            >
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: muted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                margin: 0,
              }}
            >
              <DraftRefineLabel active={connected && refineTarget === 'capsule-public'}>
                BEAP™ message (required)
              </DraftRefineLabel>
            </label>
            <button
              type="button"
              onClick={() => handleAiRefineToggle('public')}
              title={
                connected && refineTarget === 'capsule-public'
                  ? 'Disconnect AI refinement'
                  : 'Connect top chat for AI refinement'
              }
              style={{
                flexShrink: 0,
                background: connected && refineTarget === 'capsule-public' ? '#7c3aed' : '#ffffff',
                color: connected && refineTarget === 'capsule-public' ? '#ffffff' : '#374151',
                border: connected && refineTarget === 'capsule-public' ? '1px solid #7c3aed' : '1px solid #d1d5db',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {connected && refineTarget === 'capsule-public' ? '✏️ AI connected' : '✏️ AI refine'}
            </button>
          </div>

          <textarea
            data-compose-field="public-message"
            value={publicMessage}
            onChange={(e) => setPublicMessage(e.target.value)}
            onClick={() => handleAiRefineToggle('public')}
            placeholder="Public capsule / transport-visible text"
            rows={5}
            className={`beap-message-textarea${connected && refineTarget === 'capsule-public' ? ' field-selected-for-ai' : ''}`}
            style={{
              lineHeight: 1.5,
              outline: 'none',
              resize: 'vertical',
            }}
            onFocus={(e) => {
              if (!(connected && refineTarget === 'capsule-public'))
                e.currentTarget.style.boxShadow = `0 0 0 1px ${draftFocusOutline}`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          </div>

          {recipientMode === 'private' && (
            <div className="composer-body-container beap-message-field">
              <div
                className="compose-field-fixed beap-message-field__header"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  flexWrap: 'wrap',
                }}
              >
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: muted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    margin: 0,
                  }}
                >
                  <DraftRefineLabel active={connected && refineTarget === 'capsule-encrypted'}>
                    Encrypted message (private)
                  </DraftRefineLabel>
                </label>
                <button
                  type="button"
                  onClick={() => handleAiRefineToggle('encrypted')}
                  title={
                    connected && refineTarget === 'capsule-encrypted'
                      ? 'Disconnect AI refinement'
                      : 'Connect top chat for AI refinement'
                  }
                  style={{
                    flexShrink: 0,
                    background:
                      connected && refineTarget === 'capsule-encrypted' ? '#7c3aed' : '#ffffff',
                    color: connected && refineTarget === 'capsule-encrypted' ? '#ffffff' : '#374151',
                    border:
                      connected && refineTarget === 'capsule-encrypted' ? '1px solid #7c3aed' : '1px solid #d1d5db',
                    borderRadius: 4,
                    padding: '4px 10px',
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {connected && refineTarget === 'capsule-encrypted' ? '✏️ AI connected' : '✏️ AI refine'}
                </button>
              </div>

              <textarea
                data-compose-field="encrypted-message"
                value={encryptedMessage}
                onChange={(e) => setEncryptedMessage(e.target.value)}
                onClick={() => handleAiRefineToggle('encrypted')}
                placeholder="Private qBEAP payload (optional; authoritative when set)"
                rows={5}
                className={`beap-encrypted-textarea${connected && refineTarget === 'capsule-encrypted' ? ' field-selected-for-ai' : ''}`}
                style={{
                  lineHeight: 1.5,
                  outline: 'none',
                  resize: 'vertical',
                }}
                onFocus={(e) => {
                  if (!(connected && refineTarget === 'capsule-encrypted'))
                    e.currentTarget.style.boxShadow = `0 0 0 1px ${draftFocusOutline}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>
          )}

          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: muted,
                textTransform: 'uppercase',
                display: 'block',
                marginBottom: 6,
                letterSpacing: '0.5px',
              }}
            >
              Session (optional)
            </label>

            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                ...draftSurface,
                fontSize: 13,
                outline: 'none',
              }}
            >
              <option value="">
                {sessions.length === 0 ? '— No sessions —' : '— Select session —'}
              </option>

              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: muted,
                textTransform: 'uppercase',
                marginBottom: 6,
                letterSpacing: '0.5px',
              }}
            >
              Attachments
            </div>

            <ComposerAttachmentButton
              label="Add attachments"
              onClick={() => void addAttachments()}
            />

            {attachments.length > 0 && (
              <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
                {attachments.map((a) => {
                  const pdf = isPdfAttachment(a.name, a.mime);

                  const showPdfBadge =
                    pdf &&
                    a.parseStatus != null &&
                    (a.parseStatus === 'pending' ||
                      a.parseStatus === 'success' ||
                      a.parseStatus === 'failed');

                  return (
                    <li
                      key={a.id}
                      style={{
                        display: 'flex',

                        flexDirection: 'column',

                        gap: 6,

                        padding: '8px 10px',

                        marginBottom: 6,

                        background: '#f8fafc',

                        border: '1px solid #e2e8f0',

                        borderRadius: 8,

                        fontSize: 12,

                        color: '#0f172a',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {a.name}
                          </span>

                          {showPdfBadge && a.parseStatus ? (
                            <AttachmentStatusBadge status={a.parseStatus} />
                          ) : null}
                        </div>

                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
                        >
                          {a.previewText?.trim() ? (
                            <button
                              type="button"
                              onClick={() => openAttachmentReader(a)}
                              style={{
                                fontSize: 11,

                                fontWeight: 600,

                                padding: '4px 8px',

                                borderRadius: 6,

                                border: '1px solid #4f46e5',

                                background: '#ffffff',

                                color: '#1e1b4b',

                                cursor: 'pointer',
                              }}
                            >
                              View text
                            </button>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => removeAttachment(a.id)}
                            style={{
                              cursor: 'pointer',
                              color: '#b91c1c',
                              background: 'none',
                              border: 'none',
                              fontWeight: 600,
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      {a.previewError ? (
                        <div style={{ fontSize: 11, color: '#b45309', lineHeight: 1.4 }}>
                          {a.previewError}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {sendSuccess && (
            <div
              style={{
                background: '#dcfce7',
                color: '#166534',
                border: '1px solid #86efac',
                borderRadius: 6,
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              ✅ BEAP™ message sent successfully
            </div>
          )}

          {sendError && (
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontSize: 13,
              }}
            >
              {sendError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={sending || sendSuccess}
              onClick={() => void handleSend()}
              style={{
                padding: '12px 20px',

                borderRadius: 8,

                border: 'none',

                background: '#7c3aed',

                color: '#ffffff',

                fontWeight: 700,

                cursor: sending ? 'wait' : 'pointer',
              }}
            >
              {sending ? 'Sending…' : embedInDashboard ? '📤 Send BEAP Message' : 'Send BEAP™'}
            </button>

            {embedInDashboard && (
              <button
                type="button"
                onClick={resetForm}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  background: '#ffffff',
                  color: '#374151',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Clear
              </button>
            )}

            <button
              type="button"
              onClick={handleComposerClose}
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: '#ffffff',
                color: '#374151',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <aside
        style={{
          padding: '18px 16px',

          fontSize: 12,

          lineHeight: 1.55,

          color: hintOnRail,

          overflowY: 'auto',

          minWidth: 0,

          minHeight: 0,

          borderLeft: border,

          background: '#f1f5f9',
        }}
      >
        <AiDraftContextRail
          footer={
            <>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#0f172a' }}>
                Package attachments below are included in the BEAP™ send — separate from AI context
                above.
              </p>

              <p style={{ margin: '0 0 10px', color: '#0f172a' }}>
                Private mode uses your active handshake keys for qBEAP. Public mode builds pBEAP
                without a handshake binding.
              </p>

              <p style={{ margin: '0 0 10px', color: '#0f172a' }}>
                Email delivery uses the built package and the configured mail account when
                available.
              </p>

              <p style={{ margin: 0, color: '#0f172a' }}>
                Click the public or encrypted message field (or AI refine) to target the top chat; click the same field again to disconnect. You can always type directly in the fields.
              </p>
            </>
          }
        />
      </aside>
      </div>

      <BeapDocumentReaderModal
        open={readerOpen}
        onClose={() => setReaderOpen(false)}
        filename={readerFilename}
        semanticContent={readerText}
        theme="standard"
      />
    </div>
  );
}

export default BeapInlineComposer;
