/**
 * Wizard step: provider, endpoint (Ollama), model.
 * Local: GET {endpoint}/api/tags (installed). Host AI: `llm.status` → `wrChatAvailableModels`
 * (same registry as WR Chat via `computeHandshakeAvailableModels` / `listSandboxHostInternalInferenceTargets`).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { CustomModeDraft } from '../../../../shared/ui/customModeTypes'
import { DEFAULT_OLLAMA_ENDPOINT } from '../../../../shared/ui/customModeTypes'
import { safeDraftString } from '../../../../shared/ui/customModeDisplay'
import {
  fetchInstalledLocalModelNames,
  fetchOllamaModelNamesFromEndpoint,
  fetchWrChatSelectorModelsFromBackend,
} from '../../../../services/localOllamaModels'
import type { WrChatSelectorRow } from '../../../../lib/wrChatModelsFromLlmStatus'
import { isHostInferenceRouteId } from '../../../../lib/hostInferenceRouteIds'
import { getThemeTokens, inputStyle, labelStyle } from '../../../../shared/ui/lightboxTheme'
import type { InlineFieldErrors } from '../addModeWizardValidation'
import { WIZARD_MODEL_PROVIDERS } from '../wizardConstants'
import { inputStyleWithError, wizardFieldColumnStyle } from '../wizardStyles'
import { WizardFieldError } from './WizardFieldError'

function useDebounced<T>(value: T, ms: number): T {
  const [d, setD] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setD(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return d
}

function hostModelOptionLabel(row: WrChatSelectorRow): string {
  const title = row.displayTitle ?? row.displayLabel ?? row.name
  if (row.isHostActiveModel) return `${title} (active on Host)`
  return title
}

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

  const endpointTrim = (data.endpoint?.trim() || DEFAULT_OLLAMA_ENDPOINT).replace(/\/$/, '')
  const debouncedEndpoint = useDebounced(endpointTrim, 450)

  const [installedNames, setInstalledNames] = useState<string[]>([])
  const [hostModels, setHostModels] = useState<WrChatSelectorRow[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsHint, setModelsHint] = useState<string | null>(null)
  const [hostModelsHint, setHostModelsHint] = useState<string | null>(null)

  const loadOllamaModels = useCallback(async () => {
    setLoadingModels(true)
    setModelsHint(null)
    setHostModelsHint(null)
    try {
      const [endpointNames, wrChatRegistry] = await Promise.all([
        (async () => {
          let names = await fetchOllamaModelNamesFromEndpoint(debouncedEndpoint)
          if (names.length === 0) {
            const fb = await fetchInstalledLocalModelNames()
            names = fb.names ?? []
            if (names.length > 0) {
              setModelsHint('Using models from WR Desk (could not reach this endpoint’s /api/tags).')
            } else if (!fb.ok && fb.error) {
              setModelsHint(fb.error)
            } else if (fb.ollamaInstalled === false || fb.ollamaRunning === false) {
              setModelsHint('Ollama does not appear to be running — start it, then refresh.')
            }
          }
          return [...new Set(names)].sort((a, b) => a.localeCompare(b))
        })(),
        fetchWrChatSelectorModelsFromBackend(),
      ])

      setInstalledNames(endpointNames)
      setData({ metadata: { _ollamaTags: endpointNames } })

      const hosts = wrChatRegistry.hostRows
      setHostModels(hosts)
      if (hosts.length === 0) {
        if (!wrChatRegistry.ok && wrChatRegistry.error) {
          setHostModelsHint('Host AI models unavailable — could not load the WR Chat model registry.')
        } else {
          setHostModelsHint(
            'No Host AI models listed. Connect an active internal Host handshake, then refresh.',
          )
        }
      }
    } catch (err) {
      console.error('[StepModel] loadOllamaModels failed:', err)
      setInstalledNames([])
      setHostModels([])
      setModelsHint(
        err instanceof Error
          ? err.message
          : 'Could not load models. Check the endpoint and try Refresh.',
      )
    } finally {
      setLoadingModels(false)
    }
  }, [debouncedEndpoint, setData])

  useEffect(() => {
    if (!isOllama) return
    void loadOllamaModels()
  }, [isOllama, debouncedEndpoint, loadOllamaModels])

  const modelName = safeDraftString(data.modelName)
  const hostModelIds = useMemo(() => new Set(hostModels.map((h) => h.name)), [hostModels])

  const selectedLocal = useMemo(
    () => (modelName && installedNames.includes(modelName) ? modelName : ''),
    [modelName, installedNames],
  )
  const selectedHost = useMemo(
    () => (modelName && hostModelIds.has(modelName) ? modelName : ''),
    [modelName, hostModelIds],
  )
  const selectedInList = selectedLocal || selectedHost

  const orphanSelection = useMemo(() => {
    if (!modelName) return ''
    if (installedNames.includes(modelName) || hostModelIds.has(modelName)) return ''
    return modelName
  }, [modelName, installedNames, hostModelIds])

  const orphanIsHostRoute = orphanSelection ? isHostInferenceRouteId(orphanSelection) : false

  const selectValue = orphanSelection
    ? `__orphan__:${orphanSelection}`
    : selectedInList

  const emptyPlaceholder =
    loadingModels && installedNames.length === 0 && hostModels.length === 0
      ? 'Loading models…'
      : installedNames.length === 0 && hostModels.length === 0
        ? 'No local or Host AI models available'
        : 'Use active model (or select one)…'

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
          <p style={{ margin: '6px 0 0', fontSize: 11, color: t.textMuted, lineHeight: 1.4 }}>
            Local models load from this server’s <code style={{ fontSize: 10 }}>/api/tags</code>. Host AI
            models come from the same WR Chat registry (requires an active Host handshake).
          </p>
        </div>
      ) : null}

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <label htmlFor={isOllama ? 'cmw-model-select' : 'cmw-model'} style={labelStyle(t)}>
            Model{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', opacity: 0.85 }}>(optional)</span>
          </label>
          {isOllama ? (
            <button
              type="button"
              onClick={() => void loadOllamaModels()}
              disabled={loadingModels}
              style={{
                ...inputStyle(t),
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 600,
                cursor: loadingModels ? 'wait' : 'pointer',
                width: 'auto',
              }}
            >
              {loadingModels ? 'Loading…' : 'Refresh list'}
            </button>
          ) : null}
        </div>

        {isOllama ? (
          <>
            {modelsHint ? (
              <p style={{ margin: '0 0 8px', fontSize: 11, color: t.textMuted }}>{modelsHint}</p>
            ) : null}
            {hostModelsHint && hostModels.length === 0 ? (
              <p style={{ margin: '0 0 8px', fontSize: 11, color: t.textMuted }}>{hostModelsHint}</p>
            ) : null}
            <select
              id="cmw-model-select"
              value={selectValue}
              onChange={(e) => {
                const v = e.target.value
                if (v.startsWith('__orphan__:')) return
                if (v === '') {
                  setData({ modelName: '' })
                  return
                }
                setData({ modelName: v })
              }}
              disabled={loadingModels && installedNames.length === 0 && hostModels.length === 0}
              style={{ ...inputStyleWithError(inputStyle(t), t, mnErr), cursor: 'pointer' }}
              aria-invalid={mnErr ? true : undefined}
              aria-describedby={mnErr ? 'cmw-model-err' : undefined}
            >
              <option value="">{emptyPlaceholder}</option>
              {orphanSelection ? (
                <option value={`__orphan__:${orphanSelection}`} disabled>
                  {orphanIsHostRoute
                    ? `${orphanSelection} (Host AI unavailable — refresh or pick another)`
                    : `${orphanSelection} (not in list — pick another)`}
                </option>
              ) : null}
              {installedNames.length > 0 ? (
                <optgroup label="Local models">
                  {installedNames.map((name) => (
                    <option key={`local:${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {hostModels.length > 0 ? (
                <optgroup label="Host AI">
                  {hostModels.map((row) => (
                    <option key={`host:${row.name}`} value={row.name}>
                      {hostModelOptionLabel(row)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {orphanSelection ? (
              <p style={{ margin: '8px 0 0', fontSize: 11, color: t.warningText }}>
                {orphanIsHostRoute
                  ? 'This mode points at a Host AI model that is not available right now. Refresh the list when the Host is connected, or choose another model.'
                  : 'This mode points at a model that is not in the list above. Choose an installed local model, a Host AI model, or fix the endpoint.'}
              </p>
            ) : selectedHost ? (
              <p style={{ margin: '8px 0 0', fontSize: 11, color: t.text, lineHeight: 1.45 }}>
                Allocated Host AI model — mode runs pull inference from the Host’s GPU (via sealed relay on
                Sandbox).
              </p>
            ) : null}
            <WizardFieldError id="cmw-model-err" message={mnErr} t={t} />
          </>
        ) : (
          <>
            <input
              id="cmw-model"
              type="text"
              value={modelName}
              onChange={(e) => setData({ modelName: e.target.value })}
              placeholder="e.g. gpt-4o-mini (optional)"
              style={inputStyleWithError(inputStyle(t), t, mnErr)}
              autoComplete="off"
              aria-invalid={mnErr ? true : undefined}
              aria-describedby={mnErr ? 'cmw-model-err' : undefined}
            />
            <WizardFieldError id="cmw-model-err" message={mnErr} t={t} />
          </>
        )}
        <p style={{ fontSize: 12, color: t.textMuted, marginTop: 8, lineHeight: 1.45 }}>
          Optional. If set, this model is used when the mode runs (local Ollama or Host AI). You can still
          change the model during runtime in WR Chat.
        </p>
      </div>
    </div>
  )
}
