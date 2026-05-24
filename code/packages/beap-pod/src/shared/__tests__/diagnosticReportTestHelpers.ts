import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ed25519 } from '@noble/curves/ed25519.js';
import type { DiagnosticReportV1 } from '@repo/beap-cert';
import { verifyDiagnosticReport } from '@repo/beap-cert';
import { expect } from 'vitest';

import { resetDiagnosticSigningKeyCacheForTests } from '../reportGenerator.js';
import { resetMessageWatchdogStateForTests } from '../messageWatchdog.js';
import { stopRoleMessageWatchdogForTests } from '../roleDiagnostic.js';

const FIXTURE_PRIVATE_KEY = ed25519.utils.randomSecretKey();
export const FIXTURE_SIGNING_HEX = Buffer.from(FIXTURE_PRIVATE_KEY).toString('hex');
export const FIXTURE_PUBLIC_KEY = ed25519.getPublicKey(FIXTURE_PRIVATE_KEY);
export const FIXTURE_EDGE_POD_ID = '550e8400-e29b-41d4-a716-446655440000';

export function setupDiagnosticReportEnv(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beap-diag-'));
  process.env['DIAGNOSTIC_REPORTS_DIR'] = dir;
  process.env['DIAGNOSTIC_SIGNING_KEY_HEX'] = FIXTURE_SIGNING_HEX;
  process.env['EDGE_POD_ID'] = FIXTURE_EDGE_POD_ID;
  process.env['CONTAINER_ID_SHORT'] = 'testcont1234';
  resetDiagnosticSigningKeyCacheForTests();
  resetMessageWatchdogStateForTests();
  stopRoleMessageWatchdogForTests();
  return dir;
}

export function readLatestDiagnosticReport(reportDir: string): DiagnosticReportV1 {
  const files = readdirSync(reportDir).filter((name) => name.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);
  const latest = files.sort().at(-1)!;
  return JSON.parse(readFileSync(join(reportDir, latest), 'utf8')) as DiagnosticReportV1;
}

export function assertReportHasNoExceptionStrings(report: DiagnosticReportV1): void {
  const serialized = JSON.stringify(report);
  expect(serialized).not.toMatch(/Error:\s*\S/);
  expect(serialized).not.toMatch(/TypeError:\s*\S/);
  expect(report).not.toHaveProperty('message');
  expect(Object.keys(report)).not.toContain('message');
  if (report.message_under_processing) {
    expect(Object.keys(report.message_under_processing)).not.toContain('message');
  }
}

export function assertSignedReportStructure(report: DiagnosticReportV1): void {
  expect(report.report_v).toBe(1);
  expect(report.certificate).toMatch(/^ed25519:[0-9a-f]{128}$/);
  expect(verifyDiagnosticReport(report, FIXTURE_PUBLIC_KEY)).toEqual({ ok: true });
  assertReportHasNoExceptionStrings(report);
}

export function cleanupDiagnosticReportEnv(): void {
  delete process.env['DIAGNOSTIC_REPORTS_DIR'];
  delete process.env['DIAGNOSTIC_SIGNING_KEY_HEX'];
  resetDiagnosticSigningKeyCacheForTests();
  resetMessageWatchdogStateForTests();
  stopRoleMessageWatchdogForTests();
}
