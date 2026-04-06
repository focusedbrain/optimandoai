/**
 * Multi-step "Add Mode" wizard — modal shell, step nav, validation hooks.
 * Reusable: pass onSave / validateStep; no dependency on ModeSelect.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getThemeTokens,
  overlayStyle,
  panelStyle,
  bodyStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  closeButtonStyle,
} from '../../../shared/ui/lightboxTheme'
import type { LightboxTheme } from '../../../shared/ui/lightboxTheme'
import type { CustomModeDraft } from '../../../shared/ui/customModeTypes'
import { defaultCustomModeDraft } from '../../../shared/ui/customModeTypes'
import { ADD_MODE_WIZARD_STEPS, type AddModeWizardStepIndex, type ValidateStepFn } from './addModeWizardTypes'
import {
  validateAddModeWizardStep,
  isAddModeWizardDraftValid,
  getInlineFieldErrorsForStep,
} from './addModeWizardValidation'
import { isCustomModeDraftDirty } from './customModeDraftDirty'
import { AddModeWizardStepBody } from './AddModeWizardStepBody'

export interface AddModeWizardProps {
  open: boolean
  onClose: () => void
  /**
   * Persist the draft. Throw on failure (e.g. duplicate name); wizard shows the message and stays open.
   * On success, return void (or a resolved promise).
   */
  onSave?: (data: CustomModeDraft) => void | Promise<void>
  /** Called after save succeeds, before the dialog closes (e.g. show a toast). */
  onSaved?: () => void
  theme?: LightboxTheme
  /** Per-step validation; return error message or null. */
  validateStep?: ValidateStepFn
  /** Reset draft when opening (default true). */
  resetOnOpen?: boolean
}

const LAST_STEP = (ADD_MODE_WIZARD_STEPS.length - 1) as AddModeWizardStepIndex

export const AddModeWizard: React.FC<AddModeWizardProps> = ({
  open,
  onClose,
  onSave,
  onSaved,
  theme = 'default',
  validateStep = validateAddModeWizardStep,
  resetOnOpen = true,
}) => {
  const t = useMemo(() => getThemeTokens(theme), [theme])
  const [step, setStep] = useState<AddModeWizardStepIndex>(0)
  const [data, setData] = useState<CustomModeDraft>(() => defaultCustomModeDraft())
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [inlineErrorStep, setInlineErrorStep] = useState<number | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = 'add-mode-wizard-title'
  const descId = 'add-mode-wizard-desc'

  useEffect(() => {
    if (!open) return
    if (resetOnOpen) {
      setStep(0)
      setData(defaultCustomModeDraft())
      setError(null)
      setIsSaving(false)
      setInlineErrorStep(null)
    }
  }, [open, resetOnOpen])

  /** Clear inline field highlights when the user edits the draft. */
  useEffect(() => {
    setInlineErrorStep(null)
  }, [data])

  const mergeData = useCallback((patch: Partial<CustomModeDraft>) => {
    setData((prev) => ({ ...prev, ...patch }))
  }, [])

  const runValidation = useCallback(
    (index: AddModeWizardStepIndex): string | null => {
      try {
        return validateStep(index, data)
      } catch (e) {
        return e instanceof Error ? e.message : 'Validation failed'
      }
    },
    [validateStep, data],
  )

  const canSave = useMemo(() => isAddModeWizardDraftValid(data), [data])

  const inlineErrors = useMemo(() => {
    if (inlineErrorStep !== step) return {}
    return getInlineFieldErrorsForStep(step, data)
  }, [inlineErrorStep, step, data])

  const focusFirstField = useCallback(() => {
    requestAnimationFrame(() => {
      const root = panelRef.current
      if (!root) return
      const focusable = root.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )
      focusable?.focus()
    })
  }, [])

  useEffect(() => {
    if (!open) return
    focusFirstField()
  }, [open, step, focusFirstField])

  const handleNext = () => {
    const err = runValidation(step)
    if (err) {
      setError(err)
      setInlineErrorStep(step)
      return
    }
    setError(null)
    setInlineErrorStep(null)
    setStep((s) => (Math.min(s + 1, LAST_STEP) as AddModeWizardStepIndex))
  }

  const handleBack = () => {
    setError(null)
    setInlineErrorStep(null)
    setStep((s) => (Math.max(s - 1, 0) as AddModeWizardStepIndex))
  }

  const requestClose = () => {
    setError(null)
    setInlineErrorStep(null)
    onClose()
  }

  const handleCancel = () => {
    if (isSaving) return
    if (isCustomModeDraftDirty(data) && !window.confirm('Discard changes and close?')) return
    requestClose()
  }

  const handleSave = async () => {
    const err = runValidation(step)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    if (!onSave) {
      requestClose()
      return
    }
    setIsSaving(true)
    try {
      await Promise.resolve(onSave({ ...data }))
      onSaved?.()
      requestClose()
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Could not save this mode. Please try again.'
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isSaving) handleCancel()
  }

  const handleDialogKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (!isSaving) handleCancel()
  }

  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (isSaving) return
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && step === LAST_STEP && canSave) {
      e.preventDefault()
      void handleSave()
    }
  }

  const panelSx = useMemo(
    (): React.CSSProperties => ({
      ...panelStyle(t),
      maxWidth: 440,
      width: '100%',
      maxHeight: 'min(90vh, 640px)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      outline: 'none',
    }),
    [t],
  )

  if (!open) return null

  const isReview = step === LAST_STEP

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-busy={isSaving}
      style={overlayStyle(t)}
      onClick={handleOverlayClick}
      onKeyDown={handleDialogKeyDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={panelSx}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={handlePanelKeyDown}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 18px',
            borderBottom: `1px solid ${t.border}`,
            flexShrink: 0,
          }}
        >
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.text }}>
              Add mode
            </h2>
            <p id={descId} style={{ margin: '6px 0 0', fontSize: 12, color: t.textMuted }}>
              Step {step + 1} of {ADD_MODE_WIZARD_STEPS.length} — {ADD_MODE_WIZARD_STEPS[step]}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              ...closeButtonStyle(t),
              ...(isSaving ? { opacity: 0.45, cursor: 'not-allowed' as const } : {}),
            }}
            aria-label="Close"
            disabled={isSaving}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '10px 18px 0', flexShrink: 0 }} aria-hidden>
          <div style={{ display: 'flex', gap: 4 }}>
            {ADD_MODE_WIZARD_STEPS.map((label, i) => (
              <div
                key={label}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background: i <= step ? t.accentColor : t.border,
                  opacity: i <= step ? 1 : 0.45,
                }}
                title={`${label}${i < step ? ' — completed' : i === step ? ' — current' : ''}`}
              />
            ))}
          </div>
        </div>

        <div style={{ ...bodyStyle(t), flex: 1, overflow: 'auto', paddingTop: 12 }}>
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              style={{
                marginBottom: 12,
                padding: '8px 10px',
                borderRadius: 8,
                fontSize: 12,
                background: `${t.error}18`,
                color: t.errorText,
                border: `1px solid ${t.error}40`,
              }}
            >
              {error}
            </div>
          )}

          <AddModeWizardStepBody
            stepIndex={step}
            data={data}
            setData={mergeData}
            themeTokens={t}
            inlineErrors={inlineErrors}
            showInlineErrors={inlineErrorStep === step}
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            padding: '14px 18px',
            borderTop: `1px solid ${t.border}`,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={handleCancel}
            style={secondaryButtonStyle(t, isSaving)}
            disabled={isSaving}
          >
            Cancel
          </button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {step > 0 && (
              <button
                type="button"
                onClick={handleBack}
                style={secondaryButtonStyle(t, isSaving)}
                disabled={isSaving}
              >
                Back
              </button>
            )}
            {!isReview ? (
              <button
                type="button"
                onClick={handleNext}
                style={primaryButtonStyle(t, isSaving)}
                disabled={isSaving}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSave()}
                style={primaryButtonStyle(t, !canSave || isSaving)}
                disabled={!canSave || isSaving}
                aria-busy={isSaving}
                title={
                  !canSave
                    ? 'Complete required fields on earlier steps'
                    : isSaving
                      ? 'Saving…'
                      : 'Save (Ctrl+Enter)'
                }
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AddModeWizard
