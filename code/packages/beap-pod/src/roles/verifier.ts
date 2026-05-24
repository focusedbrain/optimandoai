/**
 * BEAP verifier role container (stub — P3.2).
 *
 * LOCAL_VERIFY only. Will expose POST /verify-cert on 127.0.0.1:18105 and hold
 * attested edge public keys. Real logic lands in P3.6.
 */

const ROLE = 'verifier';

console.log(`role: ${ROLE}`);

process.exit(0);
