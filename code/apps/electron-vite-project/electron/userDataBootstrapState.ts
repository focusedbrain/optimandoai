/**
 * Process-local flag: custom userData bootstrap has run.
 * Side-effect-free — safe to import from persistence modules without triggering setPath.
 * Set only by `bootstrapUserData.ts`.
 */

let bootstrapped = false

export function isUserDataPathBootstrapped(): boolean {
  return bootstrapped
}

/** @internal Called from `bootstrapUserData.ts` only. */
export function markUserDataPathBootstrapped(): void {
  bootstrapped = true
}

/** @internal Vitest reset between cases. */
export function resetUserDataBootstrapStateForTests(): void {
  bootstrapped = false
}
