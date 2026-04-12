/**
 * In-memory sliding-window rate limiter for sandbox inference only.
 */

import type { NextFunction, Request, Response } from 'express'

export const INFERENCE_CHAT_RATE_WINDOW_MS = 60_000
export const INFERENCE_CHAT_RATE_MAX = 30

export class InferenceRateLimiter {
  private requests: Map<string, number[]> = new Map()
  private readonly windowMs: number
  private readonly maxRequests: number

  constructor(
    windowMs: number = INFERENCE_CHAT_RATE_WINDOW_MS,
    maxRequests: number = INFERENCE_CHAT_RATE_MAX,
  ) {
    this.windowMs = windowMs
    this.maxRequests = maxRequests
  }

  isAllowed(subject: string): boolean {
    const now = Date.now()
    const timestamps = (this.requests.get(subject) || []).filter((t) => t > now - this.windowMs)
    if (timestamps.length >= this.maxRequests) return false
    timestamps.push(now)
    this.requests.set(subject, timestamps)
    return true
  }

  /** Drop idle map entries to bound memory growth. */
  cleanup(): void {
    const now = Date.now()
    for (const [key, timestamps] of this.requests) {
      const active = timestamps.filter((t) => t > now - this.windowMs)
      if (active.length === 0) this.requests.delete(key)
      else this.requests.set(key, active)
    }
  }

  getWindowMs(): number {
    return this.windowMs
  }
}

export const inferenceChatRateLimiter = new InferenceRateLimiter()

let cleanupStarted = false

/** Run {@link InferenceRateLimiter.cleanup} every 5 minutes (idempotent). */
export function startInferenceChatRateLimiterCleanup(): void {
  if (cleanupStarted) return
  cleanupStarted = true
  const t = setInterval(() => inferenceChatRateLimiter.cleanup(), 5 * 60 * 1000)
  if (typeof t.unref === 'function') t.unref()
}

/**
 * Rate limit by JWT `sub`. Place after `jwtAuth` and `requireScope` on `/api/inference/chat`.
 */
export function inferenceChatRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const sub = req.user && typeof req.user.sub === 'string' ? req.user.sub : null
  if (!sub) {
    console.warn('[HTTP-INFERENCE] rate limiter: missing JWT sub')
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  if (!inferenceChatRateLimiter.isAllowed(sub)) {
    console.warn('[HTTP-INFERENCE] rate_limited', { sub })
    res.status(429).json({
      error: 'rate_limited',
      retryAfterMs: inferenceChatRateLimiter.getWindowMs(),
    })
    return
  }
  next()
}
