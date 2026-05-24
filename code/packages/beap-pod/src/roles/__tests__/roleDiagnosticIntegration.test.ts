import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  assertSignedReportStructure,
  cleanupDiagnosticReportEnv,
  FIXTURE_EDGE_POD_ID,
  FIXTURE_SIGNING_HEX,
  readLatestDiagnosticReport,
  setupDiagnosticReportEnv,
} from '../../shared/__tests__/diagnosticReportTestHelpers.js';
import { ROLE_MESSAGE_TIMEOUT_MS } from '../../shared/diagnosticConstants.js';
import {
  beginMessageProcessing,
  resetMessageWatchdogStateForTests,
} from '../../shared/messageWatchdog.js';
import {
  buildAndWriteReport,
} from '../../shared/reportGenerator.js';
import {
  createRoleDiagnosticRuntime,
  failRoleClosed,
  startRoleMessageWatchdog,
  stopRoleMessageWatchdogForTests,
} from '../../shared/roleDiagnostic.js';
import { BeapPodError } from '../../shared/beapPodError.js';
import type { DiagnosticContainerRole } from '@repo/beap-cert';

const SIGNING_KEY = Uint8Array.from(Buffer.from(FIXTURE_SIGNING_HEX, 'hex'));

const ALL_ROLES: DiagnosticContainerRole[] = [
  'ingestor',
  'validator',
  'depackager',
  'sealer',
  'certifier',
  'verifier',
  'mail-fetcher',
];

function signingDeps(reportDir: string) {
  return {
    reportsDir: reportDir,
    signingKey: SIGNING_KEY,
    edgePodId: FIXTURE_EDGE_POD_ID,
    containerIdShort: 'testcont1234',
    now: () => new Date('2026-05-24T12:00:00.000Z'),
  };
}

describe('role diagnostic reports', () => {
  let reportDir: string;
  let exitSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reportDir = setupDiagnosticReportEnv();
    exitSpy = vi.fn();
    stopRoleMessageWatchdogForTests();
    resetMessageWatchdogStateForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupDiagnosticReportEnv();
    vi.restoreAllMocks();
  });

  test.each(ALL_ROLES)('%s writes signed hardened report', async (role) => {
    await buildAndWriteReport(
      {
        role,
        exception: new BeapPodError('TimeoutError'),
        stage: 'pod_internal',
        sourceFile: `${role}.ts`,
        sourceLine: 1,
        messageContext: {
          hash: 'a'.repeat(64),
          size: 64,
          envelopeFrom: 'from@example.com',
          envelopeTo: 'to@example.com',
          envelopeDate: '2026-05-24T10:00:00.000Z',
          envelopeSubject: 'subject line',
        },
        containerStartedAt: new Date('2026-05-24T11:00:00.000Z'),
      },
      signingDeps(reportDir),
    );

    const report = readLatestDiagnosticReport(reportDir);
    expect(report.failed_container.role).toBe(role);
    expect(report.failure.exception_kind).toBe('TimeoutError');
    assertSignedReportStructure(report);
  });

  test('failRoleClosed writes report on internal exception', async () => {
    const runtime = createRoleDiagnosticRuntime('validator', {
      startWatchdog: false,
      deps: signingDeps(reportDir),
      exitProcess: exitSpy as never,
    });

    await failRoleClosed({
      runtime,
      exception: new TypeError('must-not-appear-in-report'),
      stage: 'capsule_validate',
      sourceFile: 'validator.ts',
      sourceLine: 210,
    });

    const report = readLatestDiagnosticReport(reportDir);
    expect(report.failure.exception_kind).toBe('TypeError');
    assertSignedReportStructure(report);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('stuck watchdog writes StuckHealthProbeError report', async () => {
    vi.useFakeTimers();
    const containerStartedAt = new Date('2026-05-24T12:00:00.000Z');
    const runtime = createRoleDiagnosticRuntime('validator', {
      startWatchdog: false,
      containerStartedAt,
      deps: signingDeps(reportDir),
      exitProcess: exitSpy as never,
    });
    startRoleMessageWatchdog(runtime);

    beginMessageProcessing({
      hash: 'b'.repeat(64),
      size: 128,
      envelopeFrom: 'from@example.com',
      envelopeTo: 'to@example.com',
      envelopeDate: '2026-05-24T10:00:00.000Z',
      envelopeSubject: 'stuck-subject',
    });

    await vi.advanceTimersByTimeAsync(ROLE_MESSAGE_TIMEOUT_MS.validator + 1_000);
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitUntil(() => exitSpy.mock.calls.length > 0);

    const report = readLatestDiagnosticReport(reportDir);
    expect(report.failure.exception_kind).toBe('StuckHealthProbeError');
    assertSignedReportStructure(report);
    expect(report).toMatchSnapshot({
      certificate: expect.stringMatching(/^ed25519:/),
      timestamp_iso8601: expect.any(String),
      system_metrics_at_failure: {
        cpu_percent: expect.any(Number),
        memory_mb: expect.any(Number),
        fd_count: expect.any(Number),
        container_uptime_seconds: expect.any(Number),
      },
    });
  });

  test('failRoleClosed exits when report write fails', async () => {
    const runtime = createRoleDiagnosticRuntime('certifier', {
      startWatchdog: false,
      deps: {
        ...signingDeps(reportDir),
        signingKey: undefined,
        writeFileFn: vi.fn().mockRejectedValue(new Error('disk full')),
      },
      exitProcess: exitSpy as never,
    });

    await expect(
      failRoleClosed({
        runtime,
        exception: new BeapPodError('UnknownError'),
        stage: 'cert_sign',
        sourceFile: 'certifier.ts',
        sourceLine: 10,
      }),
    ).resolves.toBeUndefined();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
