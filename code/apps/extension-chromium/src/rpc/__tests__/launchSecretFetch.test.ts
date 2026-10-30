import { describe, expect, it } from 'vitest'
import { createLaunchSecretFetch, isStaleLaunchSecretResponse } from '../launchSecretFetch'

const STALE_401 = () =>
  new Response(JSON.stringify({ error: 'Unauthorized: missing or invalid launch secret' }), { status: 401 })

/** Fake desktop app that accepts only `current`. */
function fakeApp(current: () => string) {
  const seen: Array<string | null> = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const secret = new Headers(init?.headers).get('X-Launch-Secret')
    seen.push(secret)
    return secret === current() ? new Response(JSON.stringify({ ok: true }), { status: 200 }) : STALE_401()
  }) as typeof fetch
  return { fetchImpl, seen }
}

describe('launch secret fetch', () => {
  it('after an app restart, waits for the new handshake and retries once with the new secret', async () => {
    let cached = 'old'
    const app = fakeApp(() => 'new')
    const electronFetch = createLaunchSecretFetch({
      getSecret: () => cached,
      awaitFreshSecret: async (stale) => {
        expect(stale).toBe('old')
        cached = 'new' // the WebSocket handshake arrives
        return true
      },
      fetchImpl: app.fetchImpl,
    })
    const res = await electronFetch('http://127.0.0.1:51248/api/auth/login-url', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(app.seen).toEqual(['old', 'new'])
  })

  it('returns the 401 when no new secret arrives, without a second request', async () => {
    const app = fakeApp(() => 'new')
    const electronFetch = createLaunchSecretFetch({
      getSecret: () => 'old',
      awaitFreshSecret: async () => false,
      fetchImpl: app.fetchImpl,
    })
    const res = await electronFetch('http://127.0.0.1:51248/api/auth/status')
    expect(res.status).toBe(401)
    expect(app.seen).toEqual(['old'])
  })

  it('does not wait or retry on a valid secret or on other 401s', async () => {
    let waited = 0
    const other401 = (async () =>
      new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401 })) as unknown as typeof fetch
    const electronFetch = createLaunchSecretFetch({
      getSecret: () => 's',
      awaitFreshSecret: async () => {
        waited++
        return true
      },
      fetchImpl: other401,
    })
    expect((await electronFetch('http://x/api/a')).status).toBe(401)
    const ok = createLaunchSecretFetch({
      getSecret: () => 's',
      awaitFreshSecret: async () => {
        waited++
        return true
      },
      fetchImpl: fakeApp(() => 's').fetchImpl,
    })
    expect((await ok('http://x/api/a')).status).toBe(200)
    expect(waited).toBe(0)
  })

  it('leaves the response body readable for the caller', async () => {
    const res = STALE_401()
    expect(await isStaleLaunchSecretResponse(res)).toBe(true)
    expect(((await res.json()) as { error: string }).error).toContain('launch secret')
  })
})
