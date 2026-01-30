/**
 * sanitizeReturnTo - HTTPS-only redirect URL sanitizer
 * 
 * This module provides a fail-closed sanitization function for returnTo/redirect URLs
 * to prevent custom scheme redirects that could trigger Windows protocol handler prompts
 * (e.g., "Open Electron?" dialog) or other security issues.
 * 
 * WHY THIS EXISTS:
 * A Windows "Open Electron" prompt and "Unable to find Electron app" error occurred
 * because our SSO flow was inadvertently triggering custom protocol schemes like:
 * - wrcode://start
 * - electron://...
 * - opengiraffe://...
 * 
 * Windows had a broken protocol handler mapping pointing to C:\Windows\System32\wrcode\start,
 * which doesn't exist. This is NOT an OIDC auth failure - it's an invalid post-login redirect.
 * 
 * SOLUTION:
 * - Web SSO NEVER triggers custom schemes - all redirects remain HTTPS-only
 * - Desktop/Electron SSO uses loopback redirect (http://127.0.0.1:<port>/callback)
 * - This sanitizer provides fail-closed behavior: on any uncertainty, redirect to "/"
 */

/**
 * Dangerous URL schemes that should NEVER be allowed in web redirects
 */
const DANGEROUS_SCHEMES = [
  'wrcode:',
  'opengiraffe:',
  'electron:',
  'file:',
  'javascript:',
  'data:',
  'vbscript:',
  'about:',
  'blob:',
  'chrome:',
  'chrome-extension:',
  'edge:',
  'ms-windows-store:',
  'ms-appinstaller:',
] as const;

/**
 * Configuration for sanitizeReturnTo
 */
export interface SanitizeReturnToConfig {
  /**
   * Default path to redirect to when input is invalid
   * @default "/"
   */
  defaultPath?: string;
  
  /**
   * Optional list of allowed HTTPS origins (e.g., ["https://wrdesk.com", "https://auth.wrdesk.com"])
   * If not provided, only relative paths are allowed
   */
  allowedOrigins?: string[];
  
  /**
   * Callback for logging rejected values (for diagnostics)
   * Should NOT include secrets/tokens in the log message
   */
  onRejected?: (reason: string, value: string) => void;
}

/**
 * Result of sanitization
 */
export interface SanitizeResult {
  /** The sanitized URL (always safe to use) */
  sanitized: string;
  /** Whether the original value was rejected and replaced with default */
  wasRejected: boolean;
  /** Reason for rejection, if any */
  rejectionReason?: string;
}

/**
 * Sanitize a returnTo/redirect URL to prevent custom scheme redirects
 * 
 * BEHAVIOR:
 * - Allow relative paths (e.g., "/dashboard", "/account", "/app?foo=bar")
 * - Allow HTTPS URLs to allowlisted origins (if configured)
 * - Reject anything containing dangerous schemes
 * - Reject protocol-relative URLs (//evil.com)
 * - Reject URLs with backslashes or control characters
 * - On any rejection, return the default path (fail-closed)
 * 
 * @param input - The returnTo/redirect URL to sanitize (may be null/undefined)
 * @param config - Optional configuration
 * @returns Sanitized URL safe for redirect (never a custom scheme)
 * 
 * @example
 * sanitizeReturnTo("/app") // => { sanitized: "/app", wasRejected: false }
 * sanitizeReturnTo("wrcode://start") // => { sanitized: "/", wasRejected: true, rejectionReason: "dangerous_scheme" }
 * sanitizeReturnTo("//evil.com") // => { sanitized: "/", wasRejected: true, rejectionReason: "protocol_relative" }
 */
export function sanitizeReturnTo(
  input: string | null | undefined,
  config: SanitizeReturnToConfig = {}
): SanitizeResult {
  const { defaultPath = '/', allowedOrigins = [], onRejected } = config;

  const reject = (reason: string): SanitizeResult => {
    if (onRejected && input) {
      // Truncate long values for safety
      const safeValue = input.length > 100 ? input.substring(0, 100) + '...' : input;
      onRejected(reason, safeValue);
    }
    return { sanitized: defaultPath, wasRejected: true, rejectionReason: reason };
  };

  // Null/undefined/empty -> default
  if (!input || typeof input !== 'string') {
    return { sanitized: defaultPath, wasRejected: false };
  }

  const trimmed = input.trim();
  
  // Empty after trim -> default
  if (!trimmed) {
    return { sanitized: defaultPath, wasRejected: false };
  }

  // Reject control characters (potential encoding attacks)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return reject('control_characters');
  }

  // Reject backslashes (can be used for path confusion attacks on Windows)
  if (trimmed.includes('\\')) {
    return reject('backslash');
  }

  // Reject protocol-relative URLs (//evil.com)
  if (trimmed.startsWith('//')) {
    return reject('protocol_relative');
  }

  // Check for dangerous schemes (case-insensitive)
  const lowerTrimmed = trimmed.toLowerCase();
  
  // Check explicit dangerous schemes
  for (const scheme of DANGEROUS_SCHEMES) {
    if (lowerTrimmed.startsWith(scheme)) {
      return reject('dangerous_scheme');
    }
  }

  // Check for any "://" in the string which indicates a scheme
  if (trimmed.includes('://')) {
    // Try to parse as URL to check the scheme
    try {
      const url = new URL(trimmed);
      
      // Only allow https: scheme
      if (url.protocol !== 'https:') {
        return reject('non_https_scheme');
      }
      
      // Check if origin is in allowlist
      if (allowedOrigins.length > 0) {
        const normalizedOrigin = url.origin.toLowerCase();
        const isAllowed = allowedOrigins.some(
          allowed => normalizedOrigin === allowed.toLowerCase()
        );
        
        if (!isAllowed) {
          return reject('origin_not_allowlisted');
        }
      } else {
        // No allowlist configured and this is an absolute URL -> reject
        return reject('absolute_url_not_allowed');
      }
      
      // Return the parsed URL (normalized)
      return { sanitized: trimmed, wasRejected: false };
    } catch {
      // Invalid URL -> reject
      return reject('invalid_url');
    }
  }

  // At this point, it should be a relative path
  // Ensure it starts with "/" for safety
  if (!trimmed.startsWith('/')) {
    return reject('relative_path_must_start_with_slash');
  }

  // Valid relative path
  return { sanitized: trimmed, wasRejected: false };
}

/**
 * Simple version that just returns the sanitized string
 * Convenience wrapper around sanitizeReturnTo()
 */
export function sanitizeReturnToSimple(
  input: string | null | undefined,
  config: SanitizeReturnToConfig = {}
): string {
  return sanitizeReturnTo(input, config).sanitized;
}

/**
 * Check if a URL is safe for redirect (without modifying it)
 * Returns true if the URL would pass sanitization
 */
export function isReturnToSafe(
  input: string | null | undefined,
  config: Omit<SanitizeReturnToConfig, 'onRejected'> = {}
): boolean {
  return !sanitizeReturnTo(input, config).wasRejected;
}
