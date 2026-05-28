/**
 * PDF parsing consent dialog + extraction orchestration for inbox and chat flows.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PdfParsingConsentVariant } from '../lib/pdfParsingConsentDecision.js'
import {
  attachmentHasReadableExtractedText,
  attachmentNeedsPdfExtraction,
  resolvePdfParsingConsent,
  type ConsentAttachmentLike,
} from '../lib/pdfParsingConsentDecision.js'
import {
  runChatPdfExtractAfterConsent,
  runInboxPdfExtractionWithConsent,
  waitForEdgeReachability,
  openEdgeVerificationSetup,
  type InboxPdfAttachmentTarget,
} from '../lib/pdfParsingConsentFlow.js'
import { grantSessionConsent } from '../lib/sessionConsent.js'
import { useVerificationContext } from './useVerificationContext.js'

export interface PdfConsentDialogState {
  open: boolean
  variant: PdfParsingConsentVariant
  filename: string
  busy: boolean
  error: string | null
  transitionNotice: string | null
}

const CLOSED: PdfConsentDialogState = {
  open: false,
  variant: 'VARIANT_FREE_TIER',
  filename: '',
  busy: false,
  error: null,
  transitionNotice: null,
}

export function usePdfParsingConsentFlow() {
  const verificationContext = useVerificationContext()
  const [dialog, setDialog] = useState<PdfConsentDialogState>(CLOSED)
  const pendingRef = useRef<{
    resolve: (r: {
      ok: boolean
      cancelled?: boolean
      error?: string
      text?: string
    }) => void
    inboxTarget?: InboxPdfAttachmentTarget
    chatPdf?: { filename: string; base64: string }
    grantSessionOnProceed: boolean
  } | null>(null)

  const closeDialog = useCallback((cancelled: boolean, error?: string) => {
    const pending = pendingRef.current
    pendingRef.current = null
    setDialog(CLOSED)
    if (pending) {
      pending.resolve({ ok: false, cancelled, error })
    }
  }, [])

  const openDialogForVariant = useCallback(
    (
      variant: PdfParsingConsentVariant,
      filename: string,
      pending: NonNullable<typeof pendingRef.current>,
    ) => {
      pendingRef.current = pending
      setDialog({
        open: true,
        variant,
        filename,
        busy: false,
        error: null,
        transitionNotice: null,
      })
    },
    [],
  )

  const ensureInboxPdfReady = useCallback(
    (target: InboxPdfAttachmentTarget): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> => {
      if (attachmentHasReadableExtractedText(target) && !attachmentNeedsPdfExtraction(target)) {
        return Promise.resolve({ ok: true })
      }

      const decision = resolvePdfParsingConsent(verificationContext, target)
      if (decision.kind === 'proceed') {
        return runInboxPdfExtractionWithConsent(target, {
          grantSession: verificationContext.sessionConsentGranted,
        }).then((r) => {
          if (r.ok) return { ok: true }
          if (r.cancelled) return { ok: false, cancelled: true }
          return { ok: false, error: r.error }
        })
      }

      return new Promise((resolve) => {
        openDialogForVariant(decision.variant, target.filename ?? 'document.pdf', {
          resolve,
          inboxTarget: target,
          grantSessionOnProceed: false,
        })
      })
    },
    [verificationContext, openDialogForVariant],
  )

  const ensureChatPdfExtracted = useCallback(
    (opts: {
      filename: string
      base64: string
    }): Promise<{ ok: boolean; text?: string; cancelled?: boolean; error?: string }> => {
      const pseudoAtt: ConsentAttachmentLike = {
        text_extraction_status: 'consent_required',
        filename: opts.filename,
        content_type: 'application/pdf',
      }
      const decision = resolvePdfParsingConsent(verificationContext, pseudoAtt)
      if (decision.kind === 'proceed') {
        return runChatPdfExtractAfterConsent({
          filename: opts.filename,
          base64: opts.base64,
          grantSession: verificationContext.sessionConsentGranted,
        }).then((r) =>
          r.text ? { ok: true, text: r.text } : { ok: false, error: r.error ?? 'Extraction failed' },
        )
      }

      return new Promise((resolve) => {
        openDialogForVariant(decision.variant, opts.filename, {
          resolve,
          chatPdf: opts,
          grantSessionOnProceed: false,
        })
      })
    },
    [verificationContext, openDialogForVariant],
  )

  /** Re-evaluate variant while dialog is open (tier/mode/edge transitions). */
  useEffect(() => {
    if (!dialog.open || !pendingRef.current) return

    const probe = pendingRef.current.inboxTarget ?? {
      text_extraction_status: 'consent_required' as const,
      filename: dialog.filename,
    }
    const decision = resolvePdfParsingConsent(verificationContext, probe)

    if (decision.kind === 'proceed') {
      setDialog((d) => ({
        ...d,
        transitionNotice:
          'Your verification server is reachable again. You can close this dialog and retry via edge, or continue with on-device parsing.',
      }))
      return
    }

    if (decision.variant !== dialog.variant) {
      setDialog((d) => ({ ...d, variant: decision.variant, transitionNotice: null }))
    }
  }, [
    dialog.open,
    dialog.variant,
    dialog.filename,
    verificationContext.tier,
    verificationContext.modeResolverState,
    verificationContext.edgeConfigurationState,
    verificationContext.sessionConsentGranted,
  ])

  const handleProceedOnce = useCallback(async () => {
    const pending = pendingRef.current
    if (!pending) return
    setDialog((d) => ({ ...d, busy: true, error: null }))

    try {
      if (pending.inboxTarget) {
        const result = await runInboxPdfExtractionWithConsent(pending.inboxTarget, {
          grantSession: pending.grantSessionOnProceed,
        })
        if (result.ok) {
          pending.resolve({ ok: true })
          pendingRef.current = null
          setDialog(CLOSED)
          return
        }
        setDialog((d) => ({
          ...d,
          busy: false,
          error: result.cancelled ? null : result.error ?? 'Extraction failed',
        }))
        if (result.cancelled) closeDialog(true)
        return
      }

      if (pending.chatPdf) {
        const result = await runChatPdfExtractAfterConsent({
          ...pending.chatPdf,
          grantSession: pending.grantSessionOnProceed,
        })
        if (result.text) {
          pending.resolve({ ok: true, text: result.text })
          pendingRef.current = null
          setDialog(CLOSED)
          return
        }
        setDialog((d) => ({ ...d, busy: false, error: result.error ?? 'Extraction failed' }))
        return
      }
    } catch (err) {
      setDialog((d) => ({
        ...d,
        busy: false,
        error: err instanceof Error ? err.message : 'Extraction failed',
      }))
    }
  }, [closeDialog])

  const handleDontAskAgain = useCallback(() => {
    grantSessionConsent('pdf_parsing')
    const pending = pendingRef.current
    if (pending) {
      pending.grantSessionOnProceed = true
    }
    void handleProceedOnce()
  }, [handleProceedOnce])

  const handleCancel = useCallback(() => {
    closeDialog(true)
  }, [closeDialog])

  const handleWaitForServer = useCallback(async () => {
    setDialog((d) => ({ ...d, busy: true, error: null }))
    const ok = await waitForEdgeReachability()
    setDialog((d) => ({
      ...d,
      busy: false,
      error: ok
        ? null
        : 'Verification server is still unreachable. Try again later or parse on this computer.',
      transitionNotice: ok
        ? 'Your verification server is reachable again. Close this dialog and retry your query.'
        : null,
    }))
  }, [])

  const handleSetupServer = useCallback(() => {
    openEdgeVerificationSetup()
    closeDialog(true)
  }, [closeDialog])

  return {
    verificationContext,
    dialog,
    ensureInboxPdfReady,
    ensureChatPdfExtracted,
    openConsentDialog: openDialogForVariant,
    handleProceedOnce,
    handleDontAskAgain,
    handleCancel,
    handleWaitForServer,
    handleSetupServer,
    closeDialog,
  }
}
