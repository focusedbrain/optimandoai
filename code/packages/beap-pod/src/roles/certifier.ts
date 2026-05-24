/**
 * BEAP certifier role container (stub — P3.2).
 *
 * REMOTE_EDGE only. Will expose POST /certify on 127.0.0.1:18104 and hold the
 * Ed25519 private key in memory. Real logic lands in P3.4.
 */

const ROLE = 'certifier';

console.log(`role: ${ROLE}`);

setTimeout(() => process.exit(0), 5_000);
