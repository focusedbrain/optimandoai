import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  capsuleCanonicalHash,
  packageHash,
  sha256Hex,
  validationResultDigest,
} from '../hashing.js';

const textEncoder = new TextEncoder();

describe('hash helpers', () => {
  it('sha256Hex(empty) matches known vector', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('sha256Hex("abc") matches known vector', () => {
    expect(sha256Hex(textEncoder.encode('abc'))).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('packageHash delegates to sha256Hex', () => {
    const raw = textEncoder.encode('raw-beap-bytes');
    const expected = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    expect(packageHash(raw)).toBe(expected);
  });

  it('capsuleCanonicalHash delegates to sha256Hex', () => {
    const capsule = textEncoder.encode('{"normalized":true}');
    const expected = `sha256:${createHash('sha256').update(capsule).digest('hex')}`;
    expect(capsuleCanonicalHash(capsule)).toBe(expected);
  });

  it('validationResultDigest delegates to sha256Hex', () => {
    const resultJson = textEncoder.encode('{"valid":true,"reason_code":null}');
    const expected = `sha256:${createHash('sha256').update(resultJson).digest('hex')}`;
    expect(validationResultDigest(resultJson)).toBe(expected);
  });
});
