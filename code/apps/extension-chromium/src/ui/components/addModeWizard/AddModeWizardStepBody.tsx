/**
 * Routes the Add Mode wizard to the active step component.
 */

import React from 'react'
import type { CustomModeDefinition, CustomModeDraft } from '../../../shared/ui/customModeTypes'
import { isBuiltInModeId } from '../../../shared/ui/customModeTypes'
import { getThemeTokens } from '../../../shared/ui/lightboxTheme'
import type { AddModeWizardStepIndex } from './addModeWizardTypes'
import type { InlineFieldErrors } from './addModeWizardValidation'
import { StepBasics } from './steps/StepBasics'
import { StepFocus } from './steps/StepFocus'
import { StepModel } from './steps/StepModel'
import { StepReview } from './steps/StepReview'
import { StepRun } from './steps/StepRun'
import { StepSession } from './steps/StepSession'

export function AddModeWizardStepBody({
  stepIndex,
  data,
  setData,
  themeTokens: t,
  inlineErrors = {},
  showInlineErrors = false,
  editTarget,
}: {
  stepIndex: AddModeWizardStepIndex
  data: CustomModeDraft
  setData: (patch: Partial<CustomModeDraft>) => void
  themeTokens: ReturnType<typeof getThemeTokens>
  inlineErrors?: InlineFieldErrors
  showInlineErrors?: boolean
  editTarget?: CustomModeDefinition | null
}) {
  const err = showInlineErrors ? inlineErrors : {}
  const lockBasics = editTarget != null && isBuiltInModeId(editTarget.id)
  switch (stepIndex) {
    case 0:
      return (
        <StepBasics
          data={data}
          setData={setData}
          t={t}
          fieldErrors={err}
          lockName={lockBasics}
        />
      )
    case 1:
      return <StepModel data={data} setData={setData} t={t} fieldErrors={err} />
    case 2:
      return <StepSession data={data} setData={setData} t={t} />
    case 3:
      return <StepFocus data={data} setData={setData} t={t} fieldErrors={err} />
    case 4:
      return <StepRun data={data} setData={setData} t={t} fieldErrors={err} />
    case 5:
      return <StepReview data={data} t={t} />
    default:
      return null
  }
}
