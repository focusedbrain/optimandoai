/**
 * Critical-Job Routing Seam — public barrel (Build A).
 *
 * Flag-gated and NOT wired into the live email path. Steps 1–4 of the refactor:
 * seam types + JobKind generalization, InProcessExecutor (with the role gate),
 * MicroVMExecutor (thin adapter over SandboxHypervisorProvider), and the
 * dispatcher + resolution table. RemoteHandshakeExecutor is a typed stub (Build C).
 */

export * from './types'
export * from './executor'
export * from './verify'
export * from './resolution'
export { CriticalJobDispatcher, type ExecutorRegistry } from './dispatcher'
export {
  buildResolutionContext,
  resolveRole,
  type BuildContextOptions,
} from './context'
export { InProcessExecutor } from './executors/inProcessExecutor'
export { MicroVMExecutor, createCrosvmMicroVmExecutor } from './executors/microVmExecutor'
export { RemoteHandshakeExecutor } from './executors/remoteHandshakeExecutor'
