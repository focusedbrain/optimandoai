/**
 * App-wide PDF parsing consent dialog (single instance).
 */

import { createContext, useContext, type ReactNode } from 'react'
import { PdfParsingConsentDialog } from '../components/PdfParsingConsentDialog.js'
import { usePdfParsingConsentFlow } from '../hooks/usePdfParsingConsentFlow.js'

export type PdfParsingConsentApi = ReturnType<typeof usePdfParsingConsentFlow>

const PdfParsingConsentContext = createContext<PdfParsingConsentApi | null>(null)

export function PdfParsingConsentProvider({ children }: { children: ReactNode }) {
  const flow = usePdfParsingConsentFlow()

  return (
    <PdfParsingConsentContext.Provider value={flow}>
      <PdfParsingConsentDialog
        variant={flow.dialog.variant}
        filename={flow.dialog.filename}
        open={flow.dialog.open}
        busy={flow.dialog.busy}
        error={flow.dialog.error}
        transitionNotice={flow.dialog.transitionNotice}
        onProceedOnce={() => void flow.handleProceedOnce()}
        onDontAskAgainSession={flow.handleDontAskAgain}
        onSetupServer={flow.handleSetupServer}
        onFinishSetup={flow.handleSetupServer}
        onWaitForServer={() => void flow.handleWaitForServer()}
        onCancel={flow.handleCancel}
      />
      {children}
    </PdfParsingConsentContext.Provider>
  )
}

export function usePdfParsingConsent(): PdfParsingConsentApi {
  const ctx = useContext(PdfParsingConsentContext)
  if (!ctx) {
    throw new Error('usePdfParsingConsent must be used within PdfParsingConsentProvider')
  }
  return ctx
}
