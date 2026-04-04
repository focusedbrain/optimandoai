/**
 * Sandbox Process Bridge
 *
 * Replaces direct stub import in sandboxClient.ts. Spawns the sandbox worker
 * as a child_process.fork() and communicates via Node IPC.
 *
 * sandboxClient.ts SHALL import only this module, never worker internals.
 *
 * If the worker crashes, the task is failed — no host crash.
 */

import { fork, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type { SandboxTask, SandboxResult } from './types'

const __dirname = dirname(fileURLToPath(import.meta.url))

let worker: ChildProcess | null = null
let workerPath = join(__dirname, 'sandboxWorker.js')

export function setWorkerPath(path: string): void {
  workerPath = path
}

function ensureWorker(): ChildProcess {
  if (worker && !worker.killed && worker.connected) {
    return worker
  }
  worker = fork(workerPath, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  })
  worker.on('exit', () => { worker = null })
  return worker
}

export function shutdownWorker(): void {
  if (worker && !worker.killed) {
    worker.kill()
    worker = null
  }
}

export async function processTaskViaWorker(task: SandboxTask): Promise<SandboxResult> {
  return new Promise<SandboxResult>((resolve) => {
    let w: ChildProcess
    try {
      w = ensureWorker()
    } catch (err: any) {
      resolve(crashResult(task, `Failed to spawn worker: ${err?.message}`))
      return
    }

    const timeout = Math.max(task.constraints.time_limit_ms, 5000)
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        shutdownWorker()
        resolve(crashResult(task, 'Worker timed out'))
      }
    }, timeout)

    const onMessage = (msg: any) => {
      if (settled) return
      if (msg?.type === 'task_result' && msg.result?.task_id === task.task_id) {
        settled = true
        clearTimeout(timer)
        w.removeListener('message', onMessage)
        w.removeListener('exit', onExit)
        resolve(msg.result as SandboxResult)
      }
    }

    const onExit = (code: number | null) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        w.removeListener('message', onMessage)
        resolve(crashResult(task, `Worker exited with code ${code}`))
      }
    }

    w.on('message', onMessage)
    w.on('exit', onExit)

    try {
      w.send({ type: 'process_task', task })
    } catch (err: any) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        w.removeListener('message', onMessage)
        w.removeListener('exit', onExit)
        resolve(crashResult(task, `Failed to send message: ${err?.message}`))
      }
    }
  })
}

function crashResult(task: SandboxTask, reason: string): SandboxResult {
  return {
    task_id: task.task_id,
    completed_at: new Date().toISOString(),
    status: 'error',
    findings: [],
    output_summary: reason,
  }
}
