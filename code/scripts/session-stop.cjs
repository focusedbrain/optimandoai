#!/usr/bin/env node
/**
 * Tear down the two-box LAN coordination relay started by session:start.
 *
 * Usage: pnpm session:stop
 */
const { stopRelay, RELAY_DB } = require('./session/lib.cjs')

function main() {
  const result = stopRelay()
  if (result.stopped) {
    console.log(`relay stopped (pid ${result.pid})`)
  } else if (result.reason === 'not_running') {
    console.log('relay not running')
  } else {
    console.log('relay not running (stale pid file removed)')
  }
  console.log(`relay db preserved at ${RELAY_DB}`)
}

main()
