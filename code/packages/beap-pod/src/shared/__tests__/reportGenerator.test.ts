import { describe, expect, it } from 'vitest';

import { BeapPodError } from '../beapPodError.js';
import {
  buildSignedDiagnosticReport,
  classifyException,
} from '../reportGenerator.js';

describe('reportGenerator', () => {
  it('classifies built-in and typed errors without reading message strings', () => {
    expect(classifyException(new RangeError('secret'))).toBe('RangeError');
    expect(classifyException(new TypeError('secret'))).toBe('TypeError');
    expect(classifyException(new BeapPodError('BufferOverflowError'))).toBe('BufferOverflowError');
    expect(classifyException(new BeapPodError('NotARealKind' as never))).toBe('UnknownError');
    expect(classifyException({ kind: 'TimeoutError' })).toBe('TimeoutError');
    expect(classifyException('plain string failure')).toBe('UnknownError');
  });
});
