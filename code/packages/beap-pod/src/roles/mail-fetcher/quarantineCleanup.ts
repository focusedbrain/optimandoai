/**
 * Periodic quarantine retention cleanup in mail-fetcher (P5.5).
 */

import type { QuarantineStore } from '../../shared/quarantine/index.js';

export const DEFAULT_QUARANTINE_RETENTION_DAYS = 30;
export const QUARANTINE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export function resolveQuarantineRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['QUARANTINE_RETENTION_DAYS']?.trim();
  if (!raw) return DEFAULT_QUARANTINE_RETENTION_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_QUARANTINE_RETENTION_DAYS;
}

export function startQuarantineCleanupTask(
  store: QuarantineStore,
  retentionDays = resolveQuarantineRetentionDays(),
): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = () => {
    void store.cleanupExpired(retentionDays).then((removed) => {
      if (removed.length > 0) {
        console.log(
          `[mail-fetcher] quarantine cleanup removed ${removed.length} expired entries`,
        );
      }
    });
  };

  run();
  timer = setInterval(run, QUARANTINE_CLEANUP_INTERVAL_MS);
  timer.unref?.();

  return () => {
    if (timer) clearInterval(timer);
  };
}
