import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';

import { canonicalizeStableJson } from '../canonical.js';
import { bytesToHex } from '../encoding.js';
import {
  UNSAFE_ENVELOPE_PLACEHOLDER,
  buildMessageUnderProcessing,
  filterEnvelopeFrom,
  filterEnvelopeSubject,
  resolveDiagnosticReportSigner,
  signDiagnosticReport,
  verifyDiagnosticReport,
} from '../diagnosticReport.js';
import type {
  DiagnosticContainerRole,
  DiagnosticExceptionKind,
  DiagnosticStage,
  UnsignedDiagnosticReportV1,
} from '../diagnosticReport.js';

const ALL_EXCEPTION_KINDS: DiagnosticExceptionKind[] = [
  'RangeError',
  'TypeError',
  'SyntaxError',
  'BufferOverflowError',
  'TimeoutError',
  'ResourceExhaustedError',
  'StuckHealthProbeError',
  'UnknownError',
];

const ALL_STAGES: DiagnosticStage[] = [
  'mime_decode',
  'base64_parse',
  'header_parse',
  'attachment_extract',
  'imap_fetch',
  'oauth_refresh',
  'capsule_validate',
  'capsule_normalize',
  'seal_compute',
  'cert_sign',
  'pod_internal',
];

const ALL_ROLES: DiagnosticContainerRole[] = [
  'ingestor',
  'validator',
  'depackager',
  'sealer',
  'certifier',
  'verifier',
  'mail-fetcher',
];

function sampleUnsigned(
  overrides: Partial<UnsignedDiagnosticReportV1> = {},
): UnsignedDiagnosticReportV1 {
  return {
    report_v: 1,
    edge_pod_id: '550e8400-e29b-41d4-a716-446655440000',
    replica_id: 'replica-a',
    timestamp_iso8601: '2026-05-24T12:00:00.000Z',
    failed_container: {
      role: 'depackager',
      container_id_short: 'abc123def456',
      previous_uptime_seconds: 42,
    },
    failure: {
      exception_kind: 'TypeError',
      stage: 'capsule_normalize',
      source_file_basename: 'depackager.ts',
      source_line: 128,
    },
    system_metrics_at_failure: {
      cpu_percent: 12.5,
      memory_mb: 256,
      fd_count: 32,
      container_uptime_seconds: 42,
    },
    message_under_processing: buildMessageUnderProcessing({
      sha256_hex: 'a'.repeat(64),
      size_bytes: 4096,
      envelope_from: 'sender@example.com',
      envelope_to: 'recipient@example.com',
      envelope_date_iso8601: '2026-05-24T11:59:00.000Z',
      envelope_subject: 'Test subject',
    }),
    ...overrides,
  };
}

describe('diagnostic report schema and signing', () => {
  it('builds, serializes, and signs a report for each enum value', () => {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);

    for (const exception_kind of ALL_EXCEPTION_KINDS) {
      for (const stage of ALL_STAGES) {
        for (const role of ALL_ROLES) {
          const unsigned = sampleUnsigned({
            failed_container: {
              role,
              container_id_short: 'abc123def456',
              previous_uptime_seconds: 1,
            },
            failure: {
              exception_kind,
              stage,
              source_file_basename: `${role}.ts`,
              source_line: 1,
            },
          });

          const bytes = canonicalizeStableJson(unsigned);
          expect(bytes.length).toBeGreaterThan(0);

          const signed = signDiagnosticReport(unsigned, privateKey);
          expect(signed.certificate).toMatch(/^ed25519:[0-9a-f]{128}$/);
          expect(verifyDiagnosticReport(signed, publicKey)).toEqual({ ok: true });
        }
      }
    }
  });

  it('round-trip: sign → serialize → parse → verify signature', () => {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    const unsigned = sampleUnsigned();

    const signed = signDiagnosticReport(unsigned, privateKey);
    const json = JSON.stringify(signed);
    const parsed = JSON.parse(json) as typeof signed;

    expect(verifyDiagnosticReport(parsed, publicKey)).toEqual({ ok: true });
  });

  it('supervisor signer field is included in canonical payload', () => {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    const unsigned = sampleUnsigned({ signer: 'supervisor' });
    const signed = signDiagnosticReport(unsigned, privateKey);

    expect(resolveDiagnosticReportSigner(signed)).toBe('supervisor');
    expect(verifyDiagnosticReport(signed, publicKey)).toEqual({ ok: true });
    expect(resolveDiagnosticReportSigner(sampleUnsigned())).toBe('edge');
  });

  it('filters envelope_subject control characters', () => {
    const subject = 'Hello\x07World\x1f!';
    expect(filterEnvelopeSubject(subject)).toBe('HelloWorld!');
  });

  it('filters envelope_from RTL override characters', () => {
    const from = 'user\u202e@example.com';
    expect(filterEnvelopeFrom(from)).toBe('user@example.com');
  });

  it('truncates subject longer than 200 chars with " [truncated]" suffix', () => {
    const subject = 'x'.repeat(250);
    const filtered = filterEnvelopeSubject(subject);
    expect(filtered.length).toBe(200);
    expect(filtered.endsWith(' [truncated]')).toBe(true);
    expect(filtered.slice(0, 187)).toBe('x'.repeat(187));
  });

  it('replaces subject that is mostly control characters with placeholder', () => {
    const subject = '\x00'.repeat(60) + 'a'.repeat(40);
    expect(filterEnvelopeSubject(subject)).toBe(UNSAFE_ENVELOPE_PLACEHOLDER);
  });

  it('matches snapshot for canonical unsigned report bytes', () => {
    const unsigned = sampleUnsigned({
      message_under_processing: buildMessageUnderProcessing({
        sha256_hex: 'deadbeef'.repeat(8),
        size_bytes: 1024,
        envelope_from: 'alice@example.org',
        envelope_to: 'bob@example.org',
        envelope_date_iso8601: '2026-05-24T10:00:00.000Z',
        envelope_subject: 'Snapshot subject',
      }),
    });

    const hex = bytesToHex(canonicalizeStableJson(unsigned));
    expect(hex).toMatchInlineSnapshot(
      `"7b22656467655f706f645f6964223a2235353065383430302d653239622d343164342d613731362d343436363535343430303030222c226661696c65645f636f6e7461696e6572223a7b22636f6e7461696e65725f69645f73686f7274223a22616263313233646566343536222c2270726576696f75735f757074696d655f7365636f6e6473223a34322c22726f6c65223a2264657061636b61676572227d2c226661696c757265223a7b22657863657074696f6e5f6b696e64223a22547970654572726f72222c22736f757263655f66696c655f626173656e616d65223a2264657061636b616765722e7473222c22736f757263655f6c696e65223a3132382c227374616765223a2263617073756c655f6e6f726d616c697a65227d2c226d6573736167655f756e6465725f70726f63657373696e67223a7b22656e76656c6f70655f646174655f69736f38363031223a22323032362d30352d32345431303a30303a30302e3030305a222c22656e76656c6f70655f66726f6d223a22616c696365406578616d706c652e6f7267222c22656e76656c6f70655f7375626a6563745f66696c7465726564223a22536e617073686f74207375626a656374222c22656e76656c6f70655f746f223a22626f62406578616d706c652e6f7267222c227368613235365f686578223a2264656164626565666465616462656566646561646265656664656164626565666465616462656566646561646265656664656164626565666465616462656566222c2273697a655f6279746573223a313032347d2c227265706c6963615f6964223a227265706c6963612d61222c227265706f72745f76223a312c2273797374656d5f6d6574726963735f61745f6661696c757265223a7b22636f6e7461696e65725f757074696d655f7365636f6e6473223a34322c226370755f70657263656e74223a31322e352c2266645f636f756e74223a33322c226d656d6f72795f6d62223a3235367d2c2274696d657374616d705f69736f38363031223a22323032362d30352d32345431323a30303a30302e3030305a227d"`,
    );
  });
});
