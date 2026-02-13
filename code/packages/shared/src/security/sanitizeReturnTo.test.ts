/**
 * Unit tests for sanitizeReturnTo
 * 
 * These tests verify that the returnTo sanitizer properly blocks dangerous URL schemes
 * that could trigger Windows "Open Electron?" prompts or other security issues.
 */

import { describe, it, expect, vi } from 'vitest';
import { 
  sanitizeReturnTo, 
  sanitizeReturnToSimple, 
  isReturnToSafe,
  type SanitizeReturnToConfig 
} from './sanitizeReturnTo';

describe('sanitizeReturnTo', () => {
  describe('valid relative paths', () => {
    it('should allow "/" (root)', () => {
      const result = sanitizeReturnTo('/');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(false);
    });

    it('should allow "/app"', () => {
      const result = sanitizeReturnTo('/app');
      expect(result.sanitized).toBe('/app');
      expect(result.wasRejected).toBe(false);
    });

    it('should allow "/dashboard"', () => {
      const result = sanitizeReturnTo('/dashboard');
      expect(result.sanitized).toBe('/dashboard');
      expect(result.wasRejected).toBe(false);
    });

    it('should allow "/account/settings"', () => {
      const result = sanitizeReturnTo('/account/settings');
      expect(result.sanitized).toBe('/account/settings');
      expect(result.wasRejected).toBe(false);
    });

    it('should allow relative paths with query strings', () => {
      const result = sanitizeReturnTo('/app?foo=bar&baz=qux');
      expect(result.sanitized).toBe('/app?foo=bar&baz=qux');
      expect(result.wasRejected).toBe(false);
    });

    it('should allow relative paths with hash fragments', () => {
      const result = sanitizeReturnTo('/app#section');
      expect(result.sanitized).toBe('/app#section');
      expect(result.wasRejected).toBe(false);
    });
  });

  describe('dangerous schemes (MUST REJECT)', () => {
    it('should reject "wrcode://start" -> "/"', () => {
      const result = sanitizeReturnTo('wrcode://start');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('dangerous_scheme');
    });

    it('should reject "electron://start" -> "/"', () => {
      const result = sanitizeReturnTo('electron://start');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('dangerous_scheme');
    });

    it('should reject "opengiraffe://lmgtfy" -> "/"', () => {
      const result = sanitizeReturnTo('opengiraffe://lmgtfy');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('dangerous_scheme');
    });

    it('should reject "javascript:alert(1)" -> "/"', () => {
      const result = sanitizeReturnTo('javascript:alert(1)');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('dangerous_scheme');
    });

    it('should reject "data:text/html,<script>alert(1)</script>" -> "/"', () => {
      const result = sanitizeReturnTo('data:text/html,<script>alert(1)</script>');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('dangerous_scheme');
    });

    it('should reject "file:///etc/passwd" -> "/"', () => {
      const result = sanitizeReturnTo('file:///etc/passwd');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('dangerous_scheme');
    });

    it('should reject "vbscript:msgbox" -> "/"', () => {
      const result = sanitizeReturnTo('vbscript:msgbox');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('dangerous_scheme');
    });

    it('should reject schemes case-insensitively', () => {
      expect(sanitizeReturnTo('WRCODE://start').wasRejected).toBe(true);
      expect(sanitizeReturnTo('WrCode://start').wasRejected).toBe(true);
      expect(sanitizeReturnTo('JavaScript:alert(1)').wasRejected).toBe(true);
    });
  });

  describe('protocol-relative URLs (MUST REJECT)', () => {
    it('should reject "//evil.com" -> "/"', () => {
      const result = sanitizeReturnTo('//evil.com');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('protocol_relative');
    });

    it('should reject "//evil.com/path" -> "/"', () => {
      const result = sanitizeReturnTo('//evil.com/path');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('protocol_relative');
    });
  });

  describe('non-HTTPS schemes (MUST REJECT)', () => {
    it('should reject "http://example.com" (non-HTTPS)', () => {
      const result = sanitizeReturnTo('http://example.com');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('non_https_scheme');
    });

    it('should reject "ftp://example.com" (non-HTTPS)', () => {
      const result = sanitizeReturnTo('ftp://example.com');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('non_https_scheme');
    });
  });

  describe('HTTPS without allowlist (MUST REJECT)', () => {
    it('should reject "https://example.com" when no allowlist configured', () => {
      const result = sanitizeReturnTo('https://example.com');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('absolute_url_not_allowed');
    });
  });

  describe('HTTPS with allowlist', () => {
    const config: SanitizeReturnToConfig = {
      allowedOrigins: ['https://wrdesk.com', 'https://auth.wrdesk.com'],
    };

    it('should allow "https://wrdesk.com/app" when origin in allowlist', () => {
      const result = sanitizeReturnTo('https://wrdesk.com/app', config);
      expect(result.sanitized).toBe('https://wrdesk.com/app');
      expect(result.wasRejected).toBe(false);
    });

    it('should allow "https://auth.wrdesk.com/callback" when origin in allowlist', () => {
      const result = sanitizeReturnTo('https://auth.wrdesk.com/callback', config);
      expect(result.sanitized).toBe('https://auth.wrdesk.com/callback');
      expect(result.wasRejected).toBe(false);
    });

    it('should reject "https://evil.com/app" when origin not in allowlist', () => {
      const result = sanitizeReturnTo('https://evil.com/app', config);
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('origin_not_allowlisted');
    });

    it('should handle case-insensitive origin matching', () => {
      const result = sanitizeReturnTo('https://WRDESK.COM/app', config);
      expect(result.wasRejected).toBe(false);
    });
  });

  describe('security edge cases', () => {
    it('should reject backslashes (path confusion)', () => {
      const result = sanitizeReturnTo('/app\\..\\etc\\passwd');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('backslash');
    });

    it('should reject control characters', () => {
      const result = sanitizeReturnTo('/app\x00hidden');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('control_characters');
    });

    it('should reject paths not starting with /', () => {
      const result = sanitizeReturnTo('app/path');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(true);
      expect(result.rejectionReason).toBe('relative_path_must_start_with_slash');
    });
  });

  describe('null/undefined/empty handling', () => {
    it('should return default "/" for null', () => {
      const result = sanitizeReturnTo(null);
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(false);
    });

    it('should return default "/" for undefined', () => {
      const result = sanitizeReturnTo(undefined);
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(false);
    });

    it('should return default "/" for empty string', () => {
      const result = sanitizeReturnTo('');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(false);
    });

    it('should return default "/" for whitespace-only string', () => {
      const result = sanitizeReturnTo('   ');
      expect(result.sanitized).toBe('/');
      expect(result.wasRejected).toBe(false);
    });
  });

  describe('custom default path', () => {
    it('should use custom default path on rejection', () => {
      const result = sanitizeReturnTo('wrcode://start', { defaultPath: '/home' });
      expect(result.sanitized).toBe('/home');
      expect(result.wasRejected).toBe(true);
    });
  });

  describe('onRejected callback', () => {
    it('should call onRejected with reason and value when input is rejected', () => {
      const onRejected = vi.fn();
      sanitizeReturnTo('wrcode://start', { onRejected });
      expect(onRejected).toHaveBeenCalledWith('dangerous_scheme', 'wrcode://start');
    });

    it('should truncate long values in onRejected', () => {
      const onRejected = vi.fn();
      const longValue = 'wrcode://' + 'a'.repeat(200);
      sanitizeReturnTo(longValue, { onRejected });
      expect(onRejected).toHaveBeenCalled();
      const [, value] = onRejected.mock.calls[0];
      expect(value.length).toBeLessThanOrEqual(103); // 100 + '...'
    });
  });
});

describe('sanitizeReturnToSimple', () => {
  it('should return just the sanitized string', () => {
    expect(sanitizeReturnToSimple('/app')).toBe('/app');
    expect(sanitizeReturnToSimple('wrcode://start')).toBe('/');
    expect(sanitizeReturnToSimple(null)).toBe('/');
  });
});

describe('isReturnToSafe', () => {
  it('should return true for safe URLs', () => {
    expect(isReturnToSafe('/app')).toBe(true);
    expect(isReturnToSafe('/dashboard?tab=1')).toBe(true);
  });

  it('should return false for dangerous URLs', () => {
    expect(isReturnToSafe('wrcode://start')).toBe(false);
    expect(isReturnToSafe('javascript:alert(1)')).toBe(false);
    expect(isReturnToSafe('//evil.com')).toBe(false);
  });
});
