// eslint.config.mjs (Flat Config für ESLint v9)
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// ─────────────────────────────────────────────────────────────────────────────
// Phase B Canon Enforcement Plugin
//
// Detects raw db.prepare() writes (INSERTs / UPDATEs) and reads (SELECTs)
// on inbox-bound sealed-storage tables.  Writes are forbidden in production
// code; reads are warned so the team can migrate them to sealedQuery over time.
//
// Rule: beap-canon/no-raw-inbox-write  (error)
//   db.prepare(INSERT INTO inbox_messages | quarantine_messages)
//   db.prepare(UPDATE inbox_messages | quarantine_messages SET)
//   → must use prepareSealedInsert / runSealedTransaction /
//     prepareSealedOperationalUpdate / reseal helpers
//
// Rule: beap-canon/no-raw-inbox-select  (warn)
//   db.prepare(SELECT … FROM inbox_messages | quarantine_messages)
//   → should migrate to sealedQuery() so seal + attachment hashes are verified
//
// Exceptions: **/__tests__/**, **/test/**, **/sealed-storage/** — these may
// use raw prepare() for test fixtures and the gate implementation itself.
//
// Phase B Architecture, PR B-11/11, Decision A.
// ─────────────────────────────────────────────────────────────────────────────

/** @param {string} sql */
function isRawInboxWrite(sql) {
  const u = sql.toUpperCase().replace(/\s+/g, ' ').trim()
  return (
    /^INSERT (OR\s+\w+\s+)?INTO (INBOX_MESSAGES|QUARANTINE_MESSAGES)/.test(u) ||
    /^UPDATE (INBOX_MESSAGES|QUARANTINE_MESSAGES) SET/.test(u)
  )
}

/** @param {string} sql */
function isRawInboxSelect(sql) {
  const u = sql.toUpperCase().replace(/\s+/g, ' ').trim()
  return /^SELECT .* FROM (INBOX_MESSAGES|QUARANTINE_MESSAGES)/.test(u)
}

/**
 * Extract the SQL string from a db.prepare() call node.
 * Returns null when the argument is not a static string literal or
 * a simple tagged-template-literal (template literals with expressions are
 * not analysed — the rule only catches the safe-to-detect static cases).
 *
 * @param {import('eslint').Rule.RuleContext} _context unused, kept for signature
 * @param {import('estree').CallExpression} node
 * @returns {string|null}
 */
function extractPrepareSql(_context, node) {
  if (node.arguments.length === 0) return null
  const arg = node.arguments[0]
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0)
    return arg.quasis[0]?.value?.raw ?? null
  return null
}

const beapCanonPlugin = {
  meta: { name: 'beap-canon', version: '1.0.0' },
  rules: {
    /** Forbid raw db.prepare writes to sealed-storage inbox tables. */
    'no-raw-inbox-write': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Raw db.prepare() INSERTs and UPDATEs on inbox-bound tables bypass the sealed-storage gate.',
          url: 'docs/phase-b/PR-B-11.md',
        },
        messages: {
          forbiddenWrite:
            'Raw db.prepare() write on a sealed-storage table is forbidden. ' +
            'Use prepareSealedInsert / runSealedTransaction (for INSERTs) or ' +
            'prepareSealedOperationalUpdate / a reseal helper (for UPDATEs). ' +
            'Phase B Architecture, Decision A.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (
              node.callee.type !== 'MemberExpression' ||
              node.callee.property.type !== 'Identifier' ||
              node.callee.property.name !== 'prepare'
            )
              return
            const sql = extractPrepareSql(context, node)
            if (sql && isRawInboxWrite(sql)) {
              context.report({ node, messageId: 'forbiddenWrite' })
            }
          },
        }
      },
    },

    /** Warn on raw db.prepare SELECTs on sealed-storage inbox tables. */
    'no-raw-inbox-select': {
      meta: {
        type: 'suggestion',
        docs: {
          description:
            'Raw db.prepare() SELECTs on inbox-bound tables skip seal and attachment-hash verification.',
          url: 'docs/phase-b/PR-B-11.md',
        },
        messages: {
          warnSelect:
            'Raw db.prepare() SELECT on a sealed-storage table skips seal verification. ' +
            'Migrate to sealedQuery() so HMAC and attachment hashes are verified on every read. ' +
            'Phase B Architecture, Decision A.',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (
              node.callee.type !== 'MemberExpression' ||
              node.callee.property.type !== 'Identifier' ||
              node.callee.property.name !== 'prepare'
            )
              return
            const sql = extractPrepareSql(context, node)
            if (sql && isRawInboxSelect(sql)) {
              context.report({ node, messageId: 'warnSelect' })
            }
          },
        }
      },
    },
  },
}

export default [
  // Solide TypeScript-Regeln (ohne type-checking; schnell & stabil)
  ...tseslint.configs.recommended,

  // Globales Ignorieren von Build-/Dependency-Verzeichnissen
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', '**/coverage/**'],
  },

  // ── Write Boundary: restrict setValueSafely imports ──
  // Only committer.ts (definition), inlinePopover.ts (click-to-fill), and
  // test files may import setValueSafely. All other callers must use
  // commitInsert via writeBoundary.ts or the barrel index.
  {
    files: ['apps/extension-chromium/src/**/*.ts', 'apps/extension-chromium/src/**/*.tsx'],
    ignores: [
      'apps/extension-chromium/src/vault/autofill/committer.ts',
      'apps/extension-chromium/src/vault/autofill/inlinePopover.ts',
      'apps/extension-chromium/src/vault/autofill/writeBoundary.ts',
      'apps/extension-chromium/src/vault/autofill/**/*.test.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: './committer',
            importNames: ['setValueSafely'],
            message: 'setValueSafely is restricted. Use commitInsert() via writeBoundary instead.',
          },
          {
            name: '../committer',
            importNames: ['setValueSafely'],
            message: 'setValueSafely is restricted. Use commitInsert() via writeBoundary instead.',
          },
        ],
        patterns: [
          {
            group: ['**/committer'],
            importNames: ['setValueSafely'],
            message: 'setValueSafely is restricted. Use commitInsert() via writeBoundary instead.',
          },
        ],
      }],
    },
  },

  // ── Phase B Canon: sealed-storage bypass detection ──────────────────────────
  // Error: raw db.prepare writes (INSERT/UPDATE) on inbox-bound sealed tables.
  // Warn:  raw db.prepare SELECTs on inbox-bound sealed tables.
  // Exceptions: test directories and the sealed-storage implementation itself.
  {
    plugins: { 'beap-canon': beapCanonPlugin },
    files: [
      'apps/electron-vite-project/electron/main/**/*.ts',
      'apps/electron-vite-project/electron/main/**/*.tsx',
    ],
    ignores: [
      'apps/electron-vite-project/electron/main/**/__tests__/**',
      'apps/electron-vite-project/electron/main/**/test/**',
      'apps/electron-vite-project/electron/main/sealed-storage/**',
    ],
    rules: {
      'beap-canon/no-raw-inbox-write': 'error',
      'beap-canon/no-raw-inbox-select': 'warn',
    },
  },

  // Prettier zuletzt, um Konflikte zu neutralisieren
  prettier,
];
