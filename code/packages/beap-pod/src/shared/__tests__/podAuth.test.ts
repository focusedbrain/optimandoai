import { describe, test, expect, vi, afterEach } from 'vitest';
import type http from 'node:http';
import {
  createPodAuthMiddleware,
  podAuthFetch,
  requirePodAuthSecret,
} from '../podAuth.js';

// ── helpers ───────────────────────────────────────────────────────────────────

const SECRET = 'correct-shared-secret-for-tests';

function makeReq(headers: Record<string, string>): http.IncomingMessage {
  return { headers } as unknown as http.IncomingMessage;
}

function makeRes(): { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } & http.ServerResponse {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } & http.ServerResponse;
}

// ── middleware tests ──────────────────────────────────────────────────────────

describe('createPodAuthMiddleware', () => {
  const mw = createPodAuthMiddleware(SECRET);

  test('rejects request with missing X-Pod-Auth header — 401', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res.writeHead).toHaveBeenCalledOnce();
    expect(res.writeHead.mock.calls[0][0]).toBe(401);
    expect(res.end).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects request with wrong X-Pod-Auth header — 401', () => {
    const req = makeReq({ 'x-pod-auth': 'definitely-wrong-secret' });
    const res = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(res.writeHead).toHaveBeenCalledOnce();
    expect(res.writeHead.mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('accepts request with correct X-Pod-Auth header — calls next()', () => {
    const req = makeReq({ 'x-pod-auth': SECRET });
    const res = makeRes();
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  test('401 body is valid JSON with an error field', () => {
    const req = makeReq({ 'x-pod-auth': 'wrong' });
    const res = makeRes();

    mw(req, res, vi.fn());

    const body = res.end.mock.calls[0][0] as string;
    const parsed = JSON.parse(body) as { error: string };
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.length).toBeGreaterThan(0);
  });
});

// ── fetch wrapper tests ───────────────────────────────────────────────────────

describe('podAuthFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('adds X-Pod-Auth header to outgoing request', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const authedFetch = podAuthFetch(SECRET);
    await authedFetch('http://127.0.0.1:17181/health');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect((init.headers as Headers).get('x-pod-auth')).toBe(SECRET);
  });

  test('preserves existing init headers alongside X-Pod-Auth', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const authedFetch = podAuthFetch(SECRET);
    await authedFetch('http://127.0.0.1:17181/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    const headers = init.headers as Headers;
    expect(headers.get('x-pod-auth')).toBe(SECRET);
    expect(headers.get('content-type')).toBe('application/json');
  });
});

// ── requirePodAuthSecret tests ────────────────────────────────────────────────

describe('requirePodAuthSecret', () => {
  const originalEnv = process.env['POD_AUTH_SECRET'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['POD_AUTH_SECRET'];
    } else {
      process.env['POD_AUTH_SECRET'] = originalEnv;
    }
  });

  test('throws when POD_AUTH_SECRET is not set', () => {
    delete process.env['POD_AUTH_SECRET'];
    expect(() => requirePodAuthSecret()).toThrow(/POD_AUTH_SECRET/);
  });

  test('throws when POD_AUTH_SECRET is an empty string', () => {
    process.env['POD_AUTH_SECRET'] = '';
    expect(() => requirePodAuthSecret()).toThrow(/POD_AUTH_SECRET/);
  });

  test('returns the secret value when POD_AUTH_SECRET is set', () => {
    process.env['POD_AUTH_SECRET'] = SECRET;
    expect(requirePodAuthSecret()).toBe(SECRET);
  });
});
