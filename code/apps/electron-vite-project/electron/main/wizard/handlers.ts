/**
 * Wizard step handlers — Phase 4 (P4.4).
 *
 * Injectable deps for unit tests; production uses live edge-tier + SSH modules.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

import { resolveBeapPodRemoteEdgeManifestPath } from '../local-pod/beapPodPaths.js'

import { ensureSession, getCachedUserInfo } from '../../../src/auth/session.js'
import { resolveTier, TIER_LEVEL, type Tier } from '../../../src/auth/capabilities.js'
import { generateEdgeKeypair } from '../edge-tier/keygen.js'
import { requestSsoAttestation } from '../edge-tier/attestation.js'
import { storeEncryptedEdgePrivateKey } from '../edge-tier/keyStorage.js'
import { upsertEdgeReplica, setEdgeTierNativeBeapRouting, setEdgeTierPending, type EdgeReplica, type NativeBeapRouting } from '../edge-tier/settings.js'
import type { EdgeTierPodVault } from '../edge-tier/podLifecycle.js'
import { SshClient } from '../edge-tier/ssh/client.js'
import { probeTarget } from '../edge-tier/ssh/probe.js'
import { installPodman, type InstallEvent } from '../edge-tier/ssh/install-podman.js'
import {
  deployEdgePod,
  buildTeardownCommand,
  type DeployEvent,
} from '../edge-tier/ssh/deploy.js'
import type { TargetProbe } from '../edge-tier/ssh/types.js'

import { bufferToUtf8, bufferToUtf8Optional } from '../security/sshSecretBuffers.js'
import { assertNoSecretsInValue } from '../security/secretScrubber.js'
import { readAndValidateSshKeyFile } from './readSshKeyFile.js'
import {
  clearWizardVmCredentials,
  getWizardVmCredentials,
  storeWizardVmCredentials,
} from './sshSession.js'
import type {
  WizardAuthenticateResponse,
  WizardProbeInput,
  WizardVmCredentialsPublic,
} from './types.js'
import { verifyEdgeRoundTripAndEnable, type VerifyEdgeRoundTripDeps } from './verify.js'
import { parsePairingLink } from '../edge-agent/parsePairingLink.js'
import {
  OrchestratorPairingError,
  pairConfirm,
  pairInitiate,
  pollPairingUntilPaired,
} from '../edge-agent/orchestratorPairing.js'
import { completeAgentPairing } from '../edge-agent/completeAgentPairing.js'
import {
  clearPendingWizardPairing,
  getPendingWizardPairing,
  setPendingWizardPairing,
} from './pairingSession.js'

const PAID_TIERS: ReadonlySet<Tier> = new Set([
  'private',
  'private_lifetime',
  'pro',
  'publisher',
  'publisher_lifetime',
  'enterprise',
])

export function isPaidTier(tier: Tier): boolean {
  return PAID_TIERS.has(tier) || (TIER_LEVEL[tier] ?? 0) >= TIER_LEVEL.pro
}

export interface WizardHandlerDeps {
  readonly vault: EdgeTierPodVault
  readonly ensureSession?: typeof ensureSession
  readonly getCachedUserInfo?: typeof getCachedUserInfo
  readonly requestAttestation?: typeof requestSsoAttestation
  readonly probeTarget?: typeof probeTarget
  readonly readManifestYaml?: () => string
  readonly verifyRoundTrip?: (
    replicaIndex: number,
    deps: VerifyEdgeRoundTripDeps,
  ) => Promise<{ verified: boolean; reason?: string }>
}

export function createDefaultWizardHandlerDeps(vault: EdgeTierPodVault): WizardHandlerDeps {
  return {
    vault,
    ensureSession,
    getCachedUserInfo,
    requestAttestation: requestSsoAttestation,
    probeTarget,
    readManifestYaml: readRemoteEdgeManifestTemplate,
    verifyRoundTrip: verifyEdgeRoundTripAndEnable,
  }
}

export function readRemoteEdgeManifestTemplate(): string {
  return readFileSync(resolveBeapPodRemoteEdgeManifestPath(), 'utf8')
}

export async function wizardRefreshTier(
  deps: WizardHandlerDeps,
): Promise<{ tier: Tier; isPaidTier: boolean }> {
  const ensure = deps.ensureSession ?? ensureSession
  const getInfo = deps.getCachedUserInfo ?? getCachedUserInfo

  await ensure(true)
  const info = getInfo()
  const tier = info?.canonical_tier ?? resolveTier(info?.wrdesk_plan, info?.roles ?? [], info?.sso_tier)
  return { tier, isPaidTier: isPaidTier(tier) }
}

export async function wizardAuthenticate(deps: WizardHandlerDeps): Promise<WizardAuthenticateResponse> {
  const ensure = deps.ensureSession ?? ensureSession
  const getInfo = deps.getCachedUserInfo ?? getCachedUserInfo

  try {
    await ensure(true)
    const info = getInfo()
    if (!info?.sub) {
      return { ok: false, error: 'No active SSO session — sign in and try again.' }
    }
    const tier = info.canonical_tier ?? resolveTier(info.wrdesk_plan, info.roles ?? [], info.sso_tier)
    if (!isPaidTier(tier)) {
      return {
        ok: false,
        error: `Edge deployment requires a paid plan (current tier: ${tier}).`,
      }
    }
    return {
      ok: true,
      plan: info.wrdesk_plan ?? tier,
      sub: info.sub,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function wizardStoreVmCredentials(input: WizardProbeInput): WizardVmCredentialsPublic {
  const keyPem = readAndValidateSshKeyFile(
    input.keyFilePath,
    bufferToUtf8Optional(input.passphrase),
  )
  const privateKey = Buffer.from(keyPem, 'utf8')
  return storeWizardVmCredentials({
    host: input.host,
    port: input.port,
    user: input.user,
    privateKey,
    passphrase: input.passphrase,
  })
}

async function connectSshFromSession(): Promise<SshClient> {
  const creds = getWizardVmCredentials()
  if (!creds) {
    throw new Error('SSH credentials not set — complete Step 2 first.')
  }
  const client = new SshClient()
  await client.connect({
    host: creds.host,
    port: creds.port,
    username: creds.username,
    privateKey: bufferToUtf8(creds.privateKey),
    passphrase: bufferToUtf8Optional(creds.passphrase),
  })
  return client
}

export async function wizardProbe(deps: WizardHandlerDeps): Promise<TargetProbe> {
  const probe = deps.probeTarget ?? probeTarget
  const client = await connectSshFromSession()
  try {
    return await probe(client)
  } finally {
    await client.disconnect()
  }
}

export async function* wizardInstallPodman(
  probe: TargetProbe,
  signal?: AbortSignal,
): AsyncGenerator<InstallEvent> {
  const client = await connectSshFromSession()
  try {
    for await (const event of installPodman(client, probe)) {
      if (signal?.aborted) {
        yield { kind: 'error', message: 'Podman install cancelled.', stage_name: 'install' }
        return
      }
      yield event
      if (event.kind === 'error' || event.kind === 'done') return
    }
  } finally {
    await client.disconnect()
  }
}

export async function* wizardGenerateAndDeploy(
  deps: WizardHandlerDeps,
  input: { readonly replicaIndex: number; readonly ingestPort?: number },
  signal?: AbortSignal,
): AsyncGenerator<DeployEvent> {
  const creds = getWizardVmCredentials()
  if (!creds) {
    yield { kind: 'error', message: 'SSH credentials not set.', stage_name: 'upload_manifest' }
    return
  }

  const client = await connectSshFromSession()
  let deployStarted = false

  try {
    const keypair = generateEdgeKeypair()
    const ensure = deps.ensureSession ?? ensureSession
    const session = await ensure(false)
    const attestation = deps.requestAttestation ?? requestSsoAttestation
    const { jwt } = await attestation(keypair.publicKeyHex, keypair.podId, session.accessToken)

    storeEncryptedEdgePrivateKey(keypair.podId, keypair.privateKeyHex, deps.vault)

    const manifestYaml = (deps.readManifestYaml ?? readRemoteEdgeManifestTemplate)()
    const podAuthSecret = randomBytes(32).toString('hex')
    const ingestPort = input.ingestPort ?? 18100

    deployStarted = true
    setEdgeTierPending()
    for await (const event of deployEdgePod({
      client,
      host: creds.host,
      podId: keypair.podId,
      publicKey: keypair.publicKeyClaim,
      privateKeyHex: keypair.privateKeyHex,
      attestationJwt: jwt,
      podAuthSecret,
      manifestYaml,
      certTtlSeconds: 86400,
    })) {
      if (signal?.aborted) {
        await client.run(buildTeardownCommand())
        yield { kind: 'error', message: 'Deploy cancelled.', stage_name: event.stage_name ?? 'start_pod' }
        return
      }
      yield event
      if (event.kind === 'done' && event.replica_state) {
        const replica: EdgeReplica = {
          host: creds.host,
          port: ingestPort,
          edge_pod_id: event.replica_state.podId,
          edge_public_key: event.replica_state.publicKey,
          sso_attestation_jwt: event.replica_state.attestationJwt,
        }
        upsertEdgeReplica(replica)
      }
      if (event.kind === 'error' || event.kind === 'done') return
    }
  } catch (err) {
    if (deployStarted) {
      await client.run(buildTeardownCommand()).catch(() => undefined)
    }
    yield {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
      stage_name: 'start_pod',
    }
  } finally {
    await client.disconnect()
    clearWizardVmCredentials()
  }
}

export function wizardParsePairingLink(raw: string): { address: string; code: string } | null {
  return parsePairingLink(raw)
}

export async function wizardPairInitiate(input: {
  address: string
  pairingCode: string
  orchestratorSub: string
}): Promise<{ fingerprint: string; address: string }> {
  try {
    const initiated = await pairInitiate(input)
    setPendingWizardPairing({
      ...initiated,
      pairingAddress: input.address,
      orchestratorSub: input.orchestratorSub,
    })
    return { fingerprint: initiated.fingerprint, address: input.address }
  } catch (err) {
    if (err instanceof OrchestratorPairingError) throw err
    throw new OrchestratorPairingError('pairing_failed', err instanceof Error ? err.message : String(err))
  }
}

export async function wizardPairConfirm(deps: WizardHandlerDeps): Promise<void> {
  const pending = getPendingWizardPairing()
  if (!pending) {
    throw new OrchestratorPairingError('session_not_found', 'No pairing session — start pairing again.')
  }

  const confirm = await pairConfirm({
    address: pending.pairingAddress,
    sessionId: pending.sessionId,
    orchestratorP2pAuthToken: pending.orchestratorP2pAuthToken,
  })

  if (confirm.status !== 'paired') {
    await pollPairingUntilPaired({
      address: pending.pairingAddress,
      sessionId: pending.sessionId,
    })
  }

  await completeAgentPairing(deps.vault, {
    ...pending,
    pairingAddress: pending.pairingAddress,
    orchestratorSub: pending.orchestratorSub,
  })
  clearPendingWizardPairing()
}

export async function wizardVerifyAndSwitch(
  deps: WizardHandlerDeps,
  replicaIndex: number,
  nativeBeapRouting: NativeBeapRouting = 'direct',
  totalReplicas = 1,
): Promise<{ verified: boolean; reason?: string }> {
  setEdgeTierNativeBeapRouting(nativeBeapRouting)
  const verify = deps.verifyRoundTrip ?? verifyEdgeRoundTripAndEnable
  return verify(replicaIndex, { vault: deps.vault, totalReplicas })
}

/** @deprecated Use assertNoSecretsInValue — kept for existing IPC call sites (P4.5.14). */
export function assertNoSecretsInRendererPayload(payload: unknown): void {
  assertNoSecretsInValue(payload, 'renderer IPC payload')
}
