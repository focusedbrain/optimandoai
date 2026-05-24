/**
 * Shared email-fetch types — desktop + mail-fetcher container.
 */

export type EmailFetchProvider = 'google' | 'microsoft';

export interface ImapEndpointConfig {
  readonly host: string;
  readonly port: number;
  readonly security: 'ssl' | 'starttls' | 'none';
}

/** Plain credential payload encrypted into encrypted_bundle (strategy §11.5). */
export interface MailFetcherCredentialPayload {
  readonly provider: EmailFetchProvider;
  readonly email: string;
  readonly refresh_token: string;
  readonly oauth_client_id: string;
  readonly oauth_client_secret?: string;
  readonly tenant_id?: string;
  readonly imap: ImapEndpointConfig;
}

export interface EncryptedCredentialBundleWire {
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export interface OAuthRefreshResult {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly refreshToken?: string;
}

export interface FetchedRfc822Message {
  readonly uid: number;
  readonly messageId: string;
  readonly from: string;
  readonly rfc822: Buffer;
}

export interface ImapOAuthSessionConfig {
  readonly email: string;
  readonly accessToken: string;
  readonly imap: ImapEndpointConfig;
  readonly folder?: string;
}

export interface GoogleOAuthRefreshInput {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly refreshToken: string;
}

export interface MicrosoftOAuthRefreshInput {
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly refreshToken: string;
  readonly tenantId?: string;
  readonly scopes?: readonly string[];
}

export class OAuthRefreshRejectedError extends Error {
  readonly category = 'auth' as const;

  constructor(message: string) {
    super(message);
    this.name = 'OAuthRefreshRejectedError';
  }
}

export class CredentialDecryptError extends Error {
  readonly category = 'decrypt' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CredentialDecryptError';
  }
}
