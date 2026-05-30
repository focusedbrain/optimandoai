/**
 * Isolation provider public API.
 *
 * Application code imports from here; never directly from the backend files.
 * Use resolveIsolationProvider() at startup to warm the capability ladder.
 * Use getIsolationProviderSync() at call sites that cannot await.
 */

export type { IsolationProvider, CapabilityResult, IsolationTier } from './IsolationProvider.js'
export { IsolationChannelError, IsolationNotImplementedError } from './IsolationProvider.js'
export { PodmanExecProvider } from './PodmanExecProvider.js'
export { HyperVProvider } from './HyperVProvider.js'
export { FirecrackerProvider } from './FirecrackerProvider.js'
export {
  resolveIsolationProvider,
  getCachedIsolationProvider,
  getIsolationProviderSync,
  clearIsolationProviderCacheForTest,
} from './resolveIsolationProvider.js'
