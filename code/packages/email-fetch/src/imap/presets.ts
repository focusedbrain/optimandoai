/**
 * IMAP endpoint presets (aligned with desktop IMAP_PRESETS).
 */

import type { EmailFetchProvider, ImapEndpointConfig } from '../types.js';

export const IMAP_PRESETS: Record<EmailFetchProvider, ImapEndpointConfig> = {
  google: {
    host: 'imap.gmail.com',
    port: 993,
    security: 'ssl',
  },
  microsoft: {
    host: 'outlook.office365.com',
    port: 993,
    security: 'ssl',
  },
};

export function resolveImapConfig(
  provider: EmailFetchProvider,
  override?: ImapEndpointConfig,
): ImapEndpointConfig {
  return override ?? IMAP_PRESETS[provider];
}
