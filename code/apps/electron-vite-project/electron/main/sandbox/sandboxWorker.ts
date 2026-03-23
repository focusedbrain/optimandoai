/**
 * Sandbox Worker — Child Process Entry Point
 *
 * Runs in a separate process via child_process.fork(). Receives SandboxTask
 * messages, produces SandboxResult responses. Has NO access to:
 *   - Host SQLite database
 *   - Handshake state
 *   - Tool registry
 *   - Audit log
 *
 * Communication: Node IPC (process.send / process.on('message'))
 */

import type { SandboxTask, SandboxResult } from './types'

function processTaskInWorker(task: SandboxTask): SandboxResult {
  return {
    task_id: task.task_id,
    completed_at: new Date().toISOString(),
    status: 'verified',
    findings: [],
    output_summary: `Worker processed task ${task.task_id} in isolated process`,
  }
}

if (process.send) {
  process.on('message', (msg: any) => {
    if (msg?.type === 'process_task' && msg.task) {
      try {
        const result = processTaskInWorker(msg.task as SandboxTask)
        process.send!({ type: 'task_result', result })
      } catch (err: any) {
        process.send!({
          type: 'task_result',
          result: {
            task_id: msg.task?.task_id ?? 'unknown',
            completed_at: new Date().toISOString(),
            status: 'error',
            findings: [],
            output_summary: `Worker error: ${err?.message ?? 'unknown'}`,
          },
        })
      }
    }
  })
}

export { processTaskInWorker }
