/**
 * Role stub: validator
 *
 * Phase 1 stub — logs role identity, handles SIGTERM, exits after 5 s.
 * Real logic wired in P1.3 (MAX_STRING_LENGTH / ALLOWED_CONTENT_TYPES enforcement)
 * and P1.8 (hot-path routing).
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('role: validator');

  process.on('SIGTERM', () => {
    console.log('[validator] SIGTERM received — exiting');
    process.exit(0);
  });

  await sleep(5_000);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[validator] fatal:', err);
  process.exit(1);
});

export {};
