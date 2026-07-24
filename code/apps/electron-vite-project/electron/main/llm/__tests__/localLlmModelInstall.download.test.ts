/**
 * Download hardening tests for `downloadGgufFromAllowedUrl`:
 *  (a) resume path — existing .part + HTTP 206 → append + hash over the COMPLETE file
 *  (b) 200-despite-Range — server ignores Range → restart from scratch (no duplicated bytes)
 *  (c) .part.meta mismatch (different URL) → discard the .part, full re-download
 *  (d) stall timer fires on ABSENT progress, not on slow-but-moving progress
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

let tmpModelsDir: string

vi.mock('../localLlmPaths', async () => {
  const actual = await vi.importActual<typeof import('../localLlmPaths')>('../localLlmPaths')
  return {
    ...actual,
    getLocalLlmModelsDirectory: () => tmpModelsDir,
  }
})

const URL_A = 'https://huggingface.co/org/repo/resolve/main/model-a.gguf'
const URL_B = 'https://huggingface.co/org/repo/resolve/main/model-b.gguf'

// 10-byte payload starting with the GGUF magic so finalize's magic check passes.
const FULL = Buffer.from('GGUFabcdef')
const FULL_SHA256 = crypto.createHash('sha256').update(FULL).digest('hex')

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!)
      else controller.close()
    },
  })
}

/** Emits `chunks`, then hangs forever; erroring the stream when `signal` aborts (like real fetch). */
function hangingStream(chunks: Uint8Array[], signal?: AbortSignal): ReadableStream<Uint8Array> {
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
  let i = 0
  const s = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
    pull(c) {
      if (i < chunks.length) {
        c.enqueue(chunks[i++]!)
        return
      }
      return new Promise<never>(() => {
        /* hang until aborted */
      })
    },
  })
  signal?.addEventListener('abort', () => {
    try {
      ctrl?.error(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    } catch {
      /* already closed */
    }
  })
  return s
}

/** Emits one chunk every `delayMs` — slow, but never silent longer than `delayMs`. */
function slowStream(chunks: Uint8Array[], delayMs: number): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (i < chunks.length) controller.enqueue(chunks[i++]!)
          else controller.close()
          resolve()
        }, delayMs)
      })
    },
  })
}

function mockResponse(input: {
  status: number
  headers: Record<string, string>
  body: ReadableStream<Uint8Array>
}) {
  return {
    ok: input.status >= 200 && input.status < 300,
    status: input.status,
    headers: new Headers(input.headers),
    body: input.body,
  }
}

function partPaths(fileName: string) {
  const dest = path.join(tmpModelsDir, fileName)
  return { dest, part: `${dest}.part`, meta: `${dest}.part.meta` }
}

describe('downloadGgufFromAllowedUrl (stall detection + Range resume + retry)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tmpModelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gguf-download-test-'))
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    try {
      fs.rmSync(tmpModelsDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('(a) resumes an existing .part via Range: 206 appends and the hash covers the complete file', async () => {
    const { dest, part, meta } = partPaths('model-a.gguf')
    // First 4 bytes already on disk from a previous (stalled) attempt.
    fs.writeFileSync(part, FULL.subarray(0, 4))
    fs.writeFileSync(meta, JSON.stringify({ url: URL_A, totalBytes: FULL.length }))

    fetchMock.mockImplementation(async (_href: string, init: { headers?: Record<string, string> }) => {
      expect(init.headers?.Range).toBe('bytes=4-')
      return mockResponse({
        status: 206,
        headers: { 'content-range': `bytes 4-9/${FULL.length}` },
        body: streamFrom([FULL.subarray(4)]),
      })
    })

    const { downloadGgufFromAllowedUrl } = await import('../localLlmModelInstall')
    const result = await downloadGgufFromAllowedUrl(URL_A)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(dest)).toEqual(FULL)
    expect(result.sha256).toBe(FULL_SHA256) // hash of the COMPLETE file, not just the appended tail
    expect(result.sizeBytes).toBe(FULL.length)
    expect(fs.existsSync(part)).toBe(false)
    expect(fs.existsSync(meta)).toBe(false)
  })

  it('(b) restarts from scratch when the server answers 200 despite the Range header', async () => {
    const { dest, part, meta } = partPaths('model-a.gguf')
    fs.writeFileSync(part, FULL.subarray(0, 6))
    fs.writeFileSync(meta, JSON.stringify({ url: URL_A, totalBytes: FULL.length }))

    fetchMock.mockImplementation(async (_href: string, init: { headers?: Record<string, string> }) => {
      expect(init.headers?.Range).toBe('bytes=6-') // Range was requested…
      return mockResponse({
        status: 200, // …but the server ignored it
        headers: { 'content-length': String(FULL.length) },
        body: streamFrom([FULL]),
      })
    })

    const { downloadGgufFromAllowedUrl } = await import('../localLlmModelInstall')
    const result = await downloadGgufFromAllowedUrl(URL_A)

    // No duplicated bytes: the stale 6-byte prefix was discarded, file is exactly the full payload.
    expect(fs.readFileSync(dest)).toEqual(FULL)
    expect(result.sha256).toBe(FULL_SHA256)
  })

  it('(c) discards the .part when the .part.meta URL does not match the requested URL', async () => {
    const { dest, part, meta } = partPaths('model-a.gguf')
    fs.writeFileSync(part, FULL.subarray(0, 6))
    fs.writeFileSync(meta, JSON.stringify({ url: URL_B, totalBytes: FULL.length })) // foreign URL

    fetchMock.mockImplementation(async (_href: string, init: { headers?: Record<string, string> }) => {
      expect(init.headers?.Range).toBeUndefined() // .part was discarded before the request
      return mockResponse({
        status: 200,
        headers: { 'content-length': String(FULL.length) },
        body: streamFrom([FULL]),
      })
    })

    const { downloadGgufFromAllowedUrl } = await import('../localLlmModelInstall')
    const result = await downloadGgufFromAllowedUrl(URL_A)

    expect(fs.readFileSync(dest)).toEqual(FULL)
    expect(result.sha256).toBe(FULL_SHA256)
  })

  it('(d1) stall timer fires when progress is ABSENT, then the retry resumes from the received bytes', async () => {
    const { dest } = partPaths('model-a.gguf')
    const progressStatuses: string[] = []

    fetchMock
      // Attempt 1: sends the first 4 bytes, then goes silent → stall abort.
      .mockImplementationOnce(async (_href: string, init: { signal?: AbortSignal }) =>
        mockResponse({
          status: 200,
          headers: { 'content-length': String(FULL.length) },
          body: hangingStream([FULL.subarray(0, 4)], init.signal),
        }),
      )
      // Attempt 2: resume with Range from byte 4.
      .mockImplementationOnce(async (_href: string, init: { headers?: Record<string, string> }) => {
        expect(init.headers?.Range).toBe('bytes=4-')
        return mockResponse({
          status: 206,
          headers: { 'content-range': `bytes 4-9/${FULL.length}` },
          body: streamFrom([FULL.subarray(4)]),
        })
      })

    const { downloadGgufFromAllowedUrl } = await import('../localLlmModelInstall')
    const result = await downloadGgufFromAllowedUrl(URL_A, {
      stallTimeoutMs: 100,
      retryBackoffMs: [10],
      onProgress: (p) => progressStatuses.push(p.status),
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(progressStatuses).toContain('stalled — resuming (attempt 2/2)')
    expect(fs.readFileSync(dest)).toEqual(FULL)
    expect(result.sha256).toBe(FULL_SHA256)
  })

  it('(d2) stall timer does NOT fire on slow-but-moving progress', async () => {
    const { dest } = partPaths('model-a.gguf')
    // 5 chunks of 2 bytes, one every 50ms — total 250ms+, but never silent for 200ms.
    const chunks = [0, 2, 4, 6, 8].map((o) => FULL.subarray(o, o + 2))

    fetchMock.mockImplementation(async () =>
      mockResponse({
        status: 200,
        headers: { 'content-length': String(FULL.length) },
        body: slowStream(chunks, 50),
      }),
    )

    const { downloadGgufFromAllowedUrl } = await import('../localLlmModelInstall')
    const result = await downloadGgufFromAllowedUrl(URL_A, {
      stallTimeoutMs: 200,
      retryBackoffMs: [], // a stall would be a hard failure — proves the timer never fired
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(dest)).toEqual(FULL)
    expect(result.sha256).toBe(FULL_SHA256)
  })
})
