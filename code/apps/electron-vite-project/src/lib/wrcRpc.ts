/**
 * Typed client for the main-process `wrc.*` surface, over the dashboard RPC
 * bridge (`window.handshakeView.vaultRpc` → `dashboard:vaultRpc`). Every call
 * requires a signed-in SSO session; main refuses otherwise.
 *
 * The surface renders what main returns: offers and refusals arrive as the
 * view model built in `electron/main/wrc/wrcSubmissionView.ts`.
 */

import type { WrCodeCaptureResult } from '@repo/ingestion-core'
import type { WrcSubmissionView } from '../../electron/main/wrc/wrcSubmissionView'
import type { WrcMessageScanResult } from '../../electron/main/wrc/wrcMessageScan'
import type { WrcRuntimeStatus } from '../../electron/main/wrc/wrcRuntime'

export type { WrcSubmissionView, WrcMessageScanResult, WrcRuntimeStatus }

export type WrcRpcResult<T> = ({ success: true } & T) | { success: false; error: string }

type VaultRpc = (args: { method: string; params?: Record<string, unknown> }) => Promise<unknown>

function bridge(): VaultRpc | null {
  const w = window as unknown as { handshakeView?: { vaultRpc?: VaultRpc } }
  return w.handshakeView?.vaultRpc ?? null
}

async function call<T>(method: string, params: Record<string, unknown>): Promise<WrcRpcResult<T>> {
  const rpc = bridge()
  if (!rpc) return { success: false, error: 'bridge_unavailable' }
  try {
    const res = (await rpc({ method, params })) as WrcRpcResult<T> | null
    return res && typeof res === 'object' ? res : { success: false, error: 'empty_response' }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export const wrcRpc = {
  /** Local syntax check only; no network. */
  capture: (raw: string) => call<{ result: WrCodeCaptureResult }>('wrc.captureReference', { raw }),
  scanMessage: (messageId: string, scan: boolean) =>
    call<{ result: WrcMessageScanResult }>('wrc.scanMessage', { messageId, scan }),
  submit: (raw: string, requestInstanceId: string) =>
    call<{ view: WrcSubmissionView; acceptanceToken?: string }>('wrc.submitReference', { raw, requestInstanceId }),
  accept: (acceptanceToken: string) =>
    call<{ result: { accepted: true; consumed: boolean } }>('wrc.acceptReference', { acceptanceToken }),
  decline: (acceptanceToken: string) =>
    call<{ result: { declined: true } }>('wrc.declineReference', { acceptanceToken }),
  status: () => call<{ result: WrcRuntimeStatus }>('wrc.runtimeStatus', {}),
}

/** Human copy for a failed RPC call (bridge, session, main-process error). */
export function wrcRpcErrorCopy(error: string): string {
  if (/no active session/i.test(error)) return 'Sign in to use WR Codes.'
  if (error === 'bridge_unavailable') return 'WR Codes are not available in this window.'
  return 'Something went wrong. Try again.'
}
