/**
 * XOAUTH2 token for IMAP (Gmail + Microsoft).
 */

export function buildXoauth2Token(email: string, accessToken: string): string {
  const auth = `user=${email}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(auth, 'utf8').toString('base64');
}
