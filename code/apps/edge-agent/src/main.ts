/**

 * WR Desk Edge Agent — entry point (Stream C).

 */



import { rolePolicy, EDGE_ROLE_POLICY_ACCOUNT } from '@repo/role-policy'



import { loadConfig } from './config.js'

import { startAgentRuntime } from './agentRuntime.js'



async function main(): Promise<void> {

  const config = loadConfig()



  const sendPolicy = rolePolicy.canSend(EDGE_ROLE_POLICY_ACCOUNT, {

    mode: 'EdgeActive',

    context: 'edge_mail_fetcher',

  })

  if (sendPolicy.allowed) {

    console.error(

      JSON.stringify({

        level: 'error',

        source: 'agent',

        event: 'role_policy_violation',

        message: 'edge agent must not allow send',

      }),

    )

    process.exit(1)

  }



  const runtime = await startAgentRuntime(config)



  const shutdown = async (signal: string) => {

    console.log(JSON.stringify({ level: 'info', source: 'agent', event: 'shutdown', signal }))

    await runtime.shutdown()

    process.exit(0)

  }



  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  process.on('SIGINT', () => void shutdown('SIGINT'))



  console.log(

    JSON.stringify({

      level: 'info',

      source: 'agent',

      event: 'started',

      phase: runtime.phase,

      setupUrl: `http://${config.setupHost}:${config.setupPort}/`,

      pairingPort: config.pairingPort,

    }),

  )

}



main().catch((err) => {

  console.error(JSON.stringify({ level: 'error', source: 'agent', event: 'fatal', message: String(err) }))

  process.exit(1)

})


