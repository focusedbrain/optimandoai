import { describe, test, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(__dirname, '..')
const distServer = join(pkgRoot, 'dist/server.js')

/**
 * Regression: dist/server.js used to import index.js (which runs main() at load)
 * and then call main() again — double listen on COORD_PORT / EADDRINUSE on ws.
 * server.ts must not bootstrap the process; only dist/index.js starts the service.
 */
describe('coordination-service startup', () => {
  test('dist/server.js loads without starting HTTP (no duplicate bootstrap)', async () => {
    const child = spawn(process.execPath, [distServer], {
      cwd: pkgRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stderr = ''
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString()
    })
    const [code] = await once(child, 'exit')
    expect(code).toBe(0)
    expect(stderr).not.toMatch(/EADDRINUSE/)
  })
})
