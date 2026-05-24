/**
 * POST fetched RFC 822 bytes to the local ingestor (no X-Pod-Auth on /ingest).
 */

export interface IngestMessageInput {
  readonly accountId: string;
  readonly messageId: string;
  readonly from: string;
  readonly recipient: string;
  readonly rfc822: Buffer;
}

export interface IngestClient {
  postMessage(input: IngestMessageInput): Promise<{ ok: boolean; status: number }>;
}

export function createIngestClient(baseUrl: string, fetchImpl: typeof fetch = fetch): IngestClient {
  const ingestUrl = `${baseUrl.replace(/\/$/, '')}/ingest`;

  return {
    async postMessage(input: IngestMessageInput): Promise<{ ok: boolean; status: number }> {
      const body = JSON.stringify({
        body: input.rfc822.toString('base64'),
        source_type: 'email',
        mime_type: 'message/rfc822',
        message_id: input.messageId,
        sender_address: input.from,
        recipient_address: input.recipient,
        channel_id: input.accountId,
      });

      const res = await fetchImpl(ingestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      return { ok: res.ok, status: res.status };
    },
  };
}
