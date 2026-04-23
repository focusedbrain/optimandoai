/**
 * Dev-only: repair `counterparty_public_key` for poisoned handshake rows.
 *
 * Usage:
 *   pnpm exec tsx apps/electron-vite-project/scripts/repair-handshake-counterparty.ts -- --db <path> [--all | --handshake-id <id>] [--plan] [--apply] [--remote-hex <64-hex>] [--i-understand]
 *
 * - Opens a **plain** SQLite file (unencrypted). SQLCipher-encrypted WR Desk vaults must be
 *   exported to an unencrypted copy first, or use a test DB. Does **not** auto-heal in the verifier.
 * - Default: inspect matching rows
 * - `--plan`: show repair plan (apply / refuse / noop)
 * - `--apply` + `--i-understand`: write via `updateHandshakeCounterpartyKey` (logs [HANDSHAKE][KEY_BINDING] like production)
 * - `--remote-hex <64-hex>`: optional; forces the new counterparty (use when auto detection is ambiguous)
 */
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'
import {
  buildInspectRow,
  planCounterpartyRepair,
  printInspectLine,
} from '../electron/main/handshake/counterpartyRepair'
import {
  getHandshakeRecord,
  getP2pPendingPackageJsonsForHandshake,
  updateHandshakeCounterpartyKey,
} from '../electron/main/handshake/db'

type Row = { handshake_id: string }

function parseArgs(argv: string[]) {
  const o: {
    db?: string
    all?: boolean
    handshakeId?: string
    plan?: boolean
    apply?: boolean
    remoteHex?: string
    iUnderstand?: boolean
  } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--db' && argv[i + 1]) o.db = argv[++i]
    else if (a === '--all') o.all = true
    else if (a === '--handshake-id' && argv[i + 1]) o.handshakeId = argv[++i]
    else if (a === '--plan') o.plan = true
    else if (a === '--apply') o.apply = true
    else if (a === '--remote-hex' && argv[i + 1]) o.remoteHex = argv[++i]
    else if (a === '--i-understand') o.iUnderstand = true
  }
  return o
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.db) {
    console.error('Missing --db <path-to.sqlite>')
    console.error('Safety: this tool is for unencrypted dev/test DBs; do not use on a live SQLCipher file without a decrypted copy.')
    process.exit(1)
  }
  if (!args.all && !args.handshakeId) {
    console.error('Specify --all or --handshake-id <id>')
    process.exit(1)
  }
  if (args.apply && !args.iUnderstand) {
    console.error('Refusing --apply without --i-understand (manual confirmation of backup / correct DB).')
    process.exit(1)
  }

  const abs = path.resolve(args.db)
  const db = new Database(abs, { readonly: !args.apply })
  const ids: string[] = args.handshakeId
    ? [args.handshakeId]
    : (db.prepare("SELECT handshake_id FROM handshakes WHERE state IN ('PENDING_ACCEPT','PENDING_REVIEW','ACCEPTED','ACTIVE')").all() as Row[]).map(
        (r) => r.handshake_id,
      )

  console.log(`[repair] db=${abs} rows=${ids.length} readonly=${!args.apply}`)

  for (const hid of ids) {
    const rec = getHandshakeRecord(db, hid)
    if (!rec) {
      console.log(`[repair] ${hid} NOT_FOUND`)
      continue
    }
    const p2p = getP2pPendingPackageJsonsForHandshake(db, hid)
    const row = buildInspectLine(buildInspectRow(rec))
    console.log(`[inspect] ${row} p2p_packages=${p2p.length}`)

    if (args.plan || args.apply) {
      const p = planCounterpartyRepair(rec, p2p, {
        remoteEd25519Override: args.remoteHex,
      })
      if (p.kind === 'noop') {
        console.log(`[plan] ${hid} NOOP: ${p.message}`)
        continue
      }
      if (p.kind === 'refuse') {
        console.log(`[plan] ${hid} REFUSE: ${p.reason}${p.hint ? ` (hint: ${p.hint})` : ''}`)
        continue
      }
      console.log(
        `[plan] ${hid} APPLY remote=${p.remote_ed25519.slice(0, 16)}… source=${p.source} poison_acceptor=${p.poison_acceptor_bound_to_self}`,
      )
      if (args.apply) {
        updateHandshakeCounterpartyKey(db, hid, p.remote_ed25519)
        console.log(`[apply] ${hid} UPDATED (same entry point as updateHandshakeCounterpartyKey)`)
      }
    }
  }
}

main()
