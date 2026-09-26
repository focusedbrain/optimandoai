/**
 * Phase 2 — A2 guard: `ingress_path` is LOG-ONLY, forever [VII.4.6].
 *
 * The field exists for evidence and rendering; formation via different paths
 * must yield semantically identical relationships, so NO code may dispatch
 * on an ingress_path VALUE. Allowed uses: writing it (construction / log
 * payload fields) and structural validation (null / string-shape checks).
 * Forbidden uses this guard detects across repository source:
 *
 *  - equality/inequality comparison against a string literal
 *    (`x.ingress_path === 'relay_pull'`),
 *  - `switch` on an ingress_path expression,
 *  - value-prefix dispatch (`ingress_path.startsWith(...)`,
 *    `.includes(...)`, `.match(...)`, `.endsWith(...)`).
 *
 * Any future semantic branch trips this test and must instead become
 * profile-record data or an extension namespace (Phase 3+).
 */
import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve, sep } from 'path'
import { fileURLToPath } from 'url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../../../../..')

const SOURCE_ROOTS = [
  'apps/electron-vite-project/electron',
  'apps/electron-vite-project/src',
  'apps/extension-chromium/src',
  'packages',
]

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.git', 'coverage'])

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry) || entry.startsWith('build0')) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walk(full)
    } else if (SOURCE_EXT.test(entry)) {
      yield full
    }
  }
}

function normalize(file: string): string {
  return file.split(sep).join('/')
}

/** Semantic-dispatch patterns over an ingress_path value. */
const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'string-literal comparison',
    re: /ingress_path\s*(===|!==|==|!=)\s*['"`]/,
  },
  {
    name: 'string-literal comparison (reversed)',
    re: /['"`][a-z0-9_./-]*['"`]\s*(===|!==|==|!=)\s*[A-Za-z0-9_.?!]*ingress_path/i,
  },
  {
    name: 'switch dispatch',
    re: /switch\s*\(\s*[^)]*ingress_path/,
  },
  {
    name: 'value-prefix dispatch',
    re: /ingress_path\s*[.?]+\s*(startsWith|endsWith|includes|match|indexOf)\s*\(/,
  },
]

describe('ingress_path is log-only [VII.4.6]', () => {
  test('no source file dispatches on an ingress_path value', () => {
    const offenders: string[] = []
    for (const root of SOURCE_ROOTS) {
      for (const file of walk(join(repoRoot, root))) {
        const rel = normalize(file).slice(normalize(repoRoot).length + 1)
        if (rel.includes('__tests__/') || rel.includes('.test.')) continue
        const content = readFileSync(file, 'utf8')
        if (!content.includes('ingress_path')) continue
        for (const { name, re } of FORBIDDEN_PATTERNS) {
          if (re.test(content)) offenders.push(`${rel} (${name})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
