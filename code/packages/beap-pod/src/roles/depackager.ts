/**
 * Role stub: depackager
 *
 * Phase 1 stub — logs role identity, handles SIGTERM, exits after 5 s.
 * Real logic wired in P1.4 (/depackage endpoint with injectable key material)
 * and P1.5 (depackaging-core extraction).
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('role: depackager');

  process.on('SIGTERM', () => {
    console.log('[depackager] SIGTERM received — exiting');
    process.exit(0);
  });

  await sleep(5_000);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[depackager] fatal:', err);
  process.exit(1);
});

export {};
