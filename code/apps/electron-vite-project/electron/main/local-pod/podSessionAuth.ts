/**
 * In-memory POD_AUTH_SECRET for the current local pod session (never persisted).
 */

let sessionPodAuthSecret: string | null = null

export function setPodSessionAuthSecret(secret: string): void {
  sessionPodAuthSecret = secret
}

export function clearPodSessionAuthSecret(): void {
  sessionPodAuthSecret = null
}

export function getPodSessionAuthSecret(): string | null {
  return sessionPodAuthSecret
}
