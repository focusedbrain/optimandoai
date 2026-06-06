#!/usr/bin/env node
/**
 * Run vitest suites that require the NATIVE `better-sqlite3` binding on the
 * runtime that ships in production: Electron's Node, via ELECTRON_RUN_AS_NODE.
 *
 * WHY: `better-sqlite3` is electron-rebuilt to Electron's ABI for the app, so it
 * will NOT load under a plain-`node` vitest run — those suites `skipIf(!Database)`
 * there (by design). To actually PROVE them (e.g. the flag-on/flag-off live email
 * path parity in `messageRouter.depackageSeam.test.ts`) we run vitest under
 * Electron's embedded Node, where the same shipping binary loads natively. No
 * rebuild, no second binary, no disturbance to the Electron native module.
 *
 * Usage:
 *   node scripts/run-native-db-tests.cjs                 # default in-scope set
 *   node scripts/run-native-db-tests.cjs <file> [<file>] # explicit files
 *   pnpm test:native-db
 */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

// `require('electron')` from a plain Node process resolves to the absolute path
// of the Electron executable.
const electronBin = require('electron')
const vitestEntry = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')

const DEFAULT_FILES = [
  // Live email-path proof: flag-on consumer of the depackage seam + flag-off
  // inline parity. Native sqlite required for the inbox/quarantine row assertions.
  'apps/electron-vite-project/electron/main/email/__tests__/messageRouter.depackageSeam.test.ts',
]

const files = process.argv.slice(2)
const targets = files.length > 0 ? files : DEFAULT_FILES

const res = spawnSync(electronBin, [vitestEntry, 'run', '--pool=forks', ...targets], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
process.exit(res.status == null ? 1 : res.status)
