import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { readdirSync } from 'node:fs';

import type {
  DiagnosticContainerRole,
  DiagnosticExceptionKind,
  DiagnosticReportV1,
  DiagnosticStage,
} from '@repo/beap-cert';
import {
  buildMessageUnderProcessing,
  signDiagnosticReport,
} from '@repo/beap-cert';

import { DEFAULT_DIAGNOSTIC_REPORTS_DIR } from './diagnosticConstants.js';
import { getMessageProcessingContext } from './messageWatchdog.js';
import { QuarantineStore, hasQuarantineKey } from './quarantine/index.js';

const VALID_EXCEPTION_KINDS = new Set<DiagnosticExceptionKind>([
  'RangeError',
  'TypeError',
  'SyntaxError',
  'BufferOverflowError',
  'TimeoutError',
  'ResourceExhaustedError',
  'StuckHealthProbeError',
  'UnknownError',
]);

export interface ReportMessageContext {
  hash: string;
  size: number;
  envelopeFrom: string;
  envelopeTo: string;
  envelopeDate: string;
  envelopeSubject: string;
  rawBytes?: Buffer;
}

export interface BuildAndWriteReportArgs {
  role: DiagnosticContainerRole;
  exception: unknown;
  stage: DiagnosticStage;
  sourceFile: string;
  sourceLine: number;
  messageContext: ReportMessageContext | null;
  containerStartedAt: Date;
}

export interface ReportGeneratorDeps {
  reportsDir?: string;
  edgePodId?: string;
  replicaId?: string;
  containerIdShort?: string;
  signingKey?: Uint8Array;
  now?: () => Date;
  writeFileFn?: typeof writeFile;
  mkdirFn?: typeof mkdir;
}

let cachedSigningKey: Uint8Array | null | undefined;

/** Classify an exception without reading error message strings or stringifying the error. */
export function classifyException(exception: unknown): DiagnosticExceptionKind {
  if (exception instanceof RangeError) {
    return 'RangeError';
  }
  if (exception instanceof TypeError) {
    return 'TypeError';
  }
  if (exception instanceof SyntaxError) {
    return 'SyntaxError';
  }
  if (typeof exception === 'object' && exception !== null && 'kind' in exception) {
    const kindValue = (exception as { kind: unknown }).kind;
    if (typeof kindValue === 'string' && VALID_EXCEPTION_KINDS.has(kindValue as DiagnosticExceptionKind)) {
      return kindValue as DiagnosticExceptionKind;
    }
  }
  return 'UnknownError';
}

export function sourceFileBasename(sourceFile: string): string {
  const normalized = sourceFile.replace(/\\/g, '/');
  return basename(normalized) || 'unknown.ts';
}

function parseSigningKeyHex(hex: string | undefined): Uint8Array | null {
  if (!hex || hex.trim().length === 0) {
    return null;
  }
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length !== 64) {
    return null;
  }
  return Uint8Array.from(Buffer.from(trimmed, 'hex'));
}

export function loadDiagnosticSigningKey(env: NodeJS.ProcessEnv = process.env): Uint8Array | null {
  if (cachedSigningKey !== undefined) {
    return cachedSigningKey;
  }
  const hex = env['DIAGNOSTIC_SIGNING_KEY_HEX'] ?? env['EDGE_PRIVATE_KEY_HEX'];
  cachedSigningKey = parseSigningKeyHex(hex);
  return cachedSigningKey;
}

export function resetDiagnosticSigningKeyCacheForTests(): void {
  cachedSigningKey = undefined;
}

function resolveEdgePodId(env: NodeJS.ProcessEnv, override?: string): string {
  if (override) {
    return override;
  }
  const fromEnv = env['EDGE_POD_ID']?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return '00000000-0000-4000-8000-000000000000';
}

function resolveReplicaId(env: NodeJS.ProcessEnv, override?: string): string {
  if (override) {
    return override;
  }
  const fromEnv = env['REPLICA_ID']?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'replica-0';
}

function resolveContainerIdShort(env: NodeJS.ProcessEnv, override?: string): string {
  if (override) {
    return override.slice(0, 12);
  }
  const fromEnv = env['CONTAINER_ID_SHORT']?.trim() ?? env['HOSTNAME']?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.slice(0, 12);
  }
  return 'local-dev-00';
}

function countOpenFileDescriptors(): number {
  try {
    return readdirSync('/proc/self/fd').length;
  } catch {
    return 0;
  }
}

export function collectSystemMetricsAtFailure(containerStartedAt: Date, now = new Date()) {
  const memoryMb = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10;
  const uptimeSeconds = Math.max(
    0,
    Math.floor((now.getTime() - containerStartedAt.getTime()) / 1000),
  );
  return {
    cpu_percent: 0,
    memory_mb: memoryMb,
    fd_count: countOpenFileDescriptors(),
    container_uptime_seconds: uptimeSeconds,
  };
}

export function buildUnsignedDiagnosticReport(
  args: BuildAndWriteReportArgs,
  deps: ReportGeneratorDeps = {},
): Omit<DiagnosticReportV1, 'certificate'> {
  const now = deps.now?.() ?? new Date();
  const env = process.env;
  const messageContext = args.messageContext ?? getMessageProcessingContext();

  return {
    report_v: 1,
    edge_pod_id: resolveEdgePodId(env, deps.edgePodId),
    replica_id: resolveReplicaId(env, deps.replicaId),
    timestamp_iso8601: now.toISOString(),
    failed_container: {
      role: args.role,
      container_id_short: resolveContainerIdShort(env, deps.containerIdShort),
      previous_uptime_seconds: Math.max(
        0,
        Math.floor((now.getTime() - args.containerStartedAt.getTime()) / 1000),
      ),
    },
    failure: {
      exception_kind: classifyException(args.exception),
      stage: args.stage,
      source_file_basename: sourceFileBasename(args.sourceFile),
      source_line: args.sourceLine,
    },
    system_metrics_at_failure: collectSystemMetricsAtFailure(args.containerStartedAt, now),
    message_under_processing: messageContext
      ? buildMessageUnderProcessing({
          sha256_hex: messageContext.hash,
          size_bytes: messageContext.size,
          envelope_from: messageContext.envelopeFrom,
          envelope_to: messageContext.envelopeTo,
          envelope_date_iso8601: messageContext.envelopeDate,
          envelope_subject: messageContext.envelopeSubject,
        })
      : null,
  };
}

export function buildSignedDiagnosticReport(
  args: BuildAndWriteReportArgs,
  deps: ReportGeneratorDeps = {},
): DiagnosticReportV1 {
  const signingKey = deps.signingKey ?? loadDiagnosticSigningKey();
  if (!signingKey) {
    throw new BeapPodReportError('missing_signing_key');
  }
  const unsigned = buildUnsignedDiagnosticReport(args, deps);
  return signDiagnosticReport(unsigned, signingKey);
}

export class BeapPodReportError extends Error {
  constructor(readonly code: 'missing_signing_key' | 'write_failed') {
    super(code);
    this.name = 'BeapPodReportError';
  }
}

function reportFilename(timestampIso: string, containerIdShort: string): string {
  const safeTs = timestampIso.replace(/[:.]/g, '-');
  return `${safeTs}-${containerIdShort}.json`;
}

/** Generate, sign, and persist a hardened diagnostic report for supervisor pickup (P5.4). */
export async function buildAndWriteReport(
  args: BuildAndWriteReportArgs,
  deps: ReportGeneratorDeps = {},
): Promise<string> {
  const signed = buildSignedDiagnosticReport(args, deps);
  const reportsDir = deps.reportsDir ?? process.env['DIAGNOSTIC_REPORTS_DIR'] ?? DEFAULT_DIAGNOSTIC_REPORTS_DIR;
  const writeFileFn = deps.writeFileFn ?? writeFile;
  const mkdirFn = deps.mkdirFn ?? mkdir;
  const messageContext = args.messageContext ?? getMessageProcessingContext();

  await mkdirFn(reportsDir, { recursive: true });
  const filename = reportFilename(
    signed.timestamp_iso8601,
    signed.failed_container.container_id_short,
  );
  const fullPath = `${reportsDir}/${filename}`;
  await writeFileFn(fullPath, JSON.stringify(signed), 'utf8');

  if (messageContext?.rawBytes && hasQuarantineKey()) {
    try {
      const store = new QuarantineStore();
      await store.writeEntry({
        hash: messageContext.hash,
        rawBytes: messageContext.rawBytes,
        envelopeFrom: messageContext.envelopeFrom,
        envelopeTo: messageContext.envelopeTo,
        envelopeDate: messageContext.envelopeDate,
        envelopeSubject: messageContext.envelopeSubject,
        failedContainerRole: args.role,
        failedStage: args.stage,
      });
    } catch (err) {
      console.warn(
        '[beap-pod] quarantine write failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return fullPath;
}

export function hashMessageBytes(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function messageContextFromEnvelope(fields: {
  rawBytes: Uint8Array | Buffer;
  envelopeFrom?: string;
  envelopeTo?: string;
  envelopeDate?: string;
  envelopeSubject?: string;
}): ReportMessageContext {
  return {
    hash: hashMessageBytes(fields.rawBytes),
    size: fields.rawBytes.length,
    envelopeFrom: fields.envelopeFrom ?? '',
    envelopeTo: fields.envelopeTo ?? '',
    envelopeDate: fields.envelopeDate ?? new Date(0).toISOString(),
    envelopeSubject: fields.envelopeSubject ?? '',
    rawBytes: Buffer.isBuffer(fields.rawBytes) ? fields.rawBytes : Buffer.from(fields.rawBytes),
  };
}
