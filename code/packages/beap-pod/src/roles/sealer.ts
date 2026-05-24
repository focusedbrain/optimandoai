/**
 * Role stub: sealer
 *
 * Phase 1 stub — logs role identity, handles SIGTERM, exits after 5 s.
 * Real logic wired in P1.6 (PodClient) and P1.10 (remove encrypted-variant stubs).
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('role: sealer');

  process.on('SIGTERM', () => {
    console.log('[sealer] SIGTERM received — exiting');
    process.exit(0);
  });

  await sleep(5_000);
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[sealer] fatal:', err);
  process.exit(1);
});

export {};
