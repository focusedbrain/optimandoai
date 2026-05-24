export type {
  EmailFetchProvider,
  EncryptedCredentialBundleWire,
  FetchedRfc822Message,
  GoogleOAuthRefreshInput,
  ImapEndpointConfig,
  ImapOAuthSessionConfig,
  MailFetcherCredentialPayload,
  MicrosoftOAuthRefreshInput,
  OAuthRefreshResult,
} from './types.js';
export { CredentialDecryptError, OAuthRefreshRejectedError } from './types.js';

export {
  decryptCredentialBundle,
  encryptCredentialBundle,
  parseAccountKeyHex,
  parseEncryptedBundle,
  zeroizeBuffer,
} from './crypto/aesGcm.js';

export { refreshGoogleAccessToken } from './oauth/googleRefresh.js';
export {
  DEFAULT_MICROSOFT_SCOPES,
  refreshMicrosoftAccessToken,
} from './oauth/microsoftRefresh.js';
export { AccessTokenCache } from './oauth/tokenCache.js';

export { IMAP_PRESETS, resolveImapConfig } from './imap/presets.js';
export { buildXoauth2Token } from './imap/xoauth2.js';
export {
  fetchUnseenRfc822Messages,
  markImapMessageSeen,
  type FetchUnseenOptions,
} from './imap/fetchUnseenRfc822.js';

export function parseCredentialPayload(json: string): import('./types.js').MailFetcherCredentialPayload {
  const parsed = JSON.parse(json) as import('./types.js').MailFetcherCredentialPayload;
  if (!parsed?.provider || !parsed.email || !parsed.refresh_token || !parsed.oauth_client_id) {
    throw new Error('Invalid credential payload');
  }
  return parsed;
}
