/**
 * Role stub: ingestor
 *
 * Phase 1 stub — logs role identity, handles SIGTERM, exits after 5 s.
 * Real logic wired in P1.4 (structural validation) and P1.8 (hot-path routing).
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('role: ingestor');

  process.on('SIGTERM', () => {
    console.log('[ingestor] SIGTERM received — exiting');
    process.exit(0);
  });

  await sleep(5_000);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[ingestor] fatal:', err);
  process.exit(1);
});

export {};
