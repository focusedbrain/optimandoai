/**
 * Wizard step: provider, model name, endpoint (Ollama).
 */

import React from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { DEFAULT_OLLAMA_ENDPOINT } from '../../../../shared/ui/customModeTypes'
import { safeDraftString } from '../../../../shared/ui/customModeDisplay'
import { getThemeTokens, inputStyle, labelStyle } from '../../../../shared/ui/lightboxTheme'
import type { InlineFieldErrors } from '../addModeWizardValidation'
import { WIZARD_MODEL_PROVIDERS } from '../wizardConstants'
import { inputStyleWithError, wizardFieldColumnStyle } from '../wizardStyles'
import { WizardFieldError } from './WizardFieldError'

export function StepModel({
  data,
  setData,
  t,
  fieldErrors,
}: {
  data: CustomModeDraft
  setData: (patch: Partial<CustomModeDraft>) => void
  t: ReturnType<typeof getThemeTokens>
  fieldErrors: InlineFieldErrors
}) {
  const provider = (data.modelProvider || 'ollama').toLowerCase()
  const isOllama = provider === 'ollama'
  const mnErr = fieldErrors.modelName
  const epErr = fieldErrors.endpoint

  return (
    <div style={wizardFieldColumnStyle()}>
      <div>
        <label htmlFor="cmw-provider" style={labelStyle(t)}>
          Provider
        </label>
        <select
          id="cmw-provider"
          value={provider}
          onChange={(e) => {
            const modelProvider = e.target.value
            setData({
              modelProvider,
              endpoint:
                modelProvider === 'ollama'
                  ? data.endpoint?.trim() || DEFAULT_OLLAMA_ENDPOINT
                  : data.endpoint,
            })
          }}
          style={{ ...inputStyle(t), cursor: 'pointer' }}
        >
          {WIZARD_MODEL_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="cmw-model" style={labelStyle(t)}>
          Model name <span aria-hidden="true">*</span>
        </label>
        <input
          id="cmw-model"
          type="text"
          value={safeDraftString(data.modelName)}
          onChange={(e) => setData({ modelName: e.target.value })}
          placeholder={isOllama ? 'e.g. llama3.2, mistral' : 'e.g. gpt-4o-mini'}
          style={inputStyleWithError(inputStyle(t), t, mnErr)}
          autoComplete="off"
          list={isOllama ? 'cmw-model-suggestions' : undefined}
          aria-invalid={mnErr ? true : undefined}
          aria-describedby={mnErr ? 'cmw-model-err' : undefined}
          aria-required
        />
        <WizardFieldError id="cmw-model-err" message={mnErr} t={t} />
        {isOllama ? (
          <datalist id="cmw-model-suggestions">
            <option value="llama3.2" />
            <option value="mistral" />
            <option value="qwen2.5" />
            <option value="phi3" />
          </datalist>
        ) : null}
      </div>
      {isOllama ? (
        <div>
          <label htmlFor="cmw-endpoint" style={labelStyle(t)}>
            Ollama endpoint <span aria-hidden="true">*</span>
          </label>
          <input
            id="cmw-endpoint"
            type="url"
            value={safeDraftString(data.endpoint)}
            onChange={(e) => setData({ endpoint: e.target.value })}
            placeholder={DEFAULT_OLLAMA_ENDPOINT}
            style={inputStyleWithError(inputStyle(t), t, epErr)}
            autoComplete="off"
            aria-invalid={epErr ? true : undefined}
            aria-describedby={epErr ? 'cmw-endpoint-err' : undefined}
            aria-required
          />
          <WizardFieldError id="cmw-endpoint-err" message={epErr} t={t} />
        </div>
      ) : null}
    </div>
  )
}
