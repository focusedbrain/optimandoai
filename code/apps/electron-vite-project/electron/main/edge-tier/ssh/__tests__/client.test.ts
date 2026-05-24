/**
 * SshClient — unit tests (P4.1)
 */

import { describe, test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Client } from 'ssh2'

import { SshClient } from '../client.js'

function makeMockClient(opts?: { execError?: Error; failOnConnect?: boolean }) {
  let ended = false

  const client = new EventEmitter() as Client & {
    connect: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    sftp: ReturnType<typeof vi.fn>
  }

  client.connect = vi.fn((config: unknown) => {
    if (opts?.failOnConnect) {
      process.nextTick(() => client.emit('error', new Error('connect failed')))
      return client
    }
    process.nextTick(() => client.emit('ready'))
    return client
  })

  client.exec = vi.fn((_command: string, callback: (err: Error | null, stream?: EventEmitter) => void) => {
    if (opts?.execError) {
      callback(opts.execError)
      return
    }

    const stream = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    stream.stderr = new EventEmitter()
    callback(null, stream)
    process.nextTick(() => {
      stream.emit('data', Buffer.from('ok'))
      stream.emit('close', 0)
    })
  })

  client.end = vi.fn(() => {
    ended = true
    client.emit('close')
  })

  client.sftp = vi.fn((cb: (err: Error | null, sftp?: unknown) => void) => {
    cb(null, {
      fastPut: (_l: string, _r: string, done: (err?: Error) => void) => done(),
      writeFile: (_p: string, _d: Buffer, _o: object, done: (err?: Error) => void) => done(),
      end: () => undefined,
    })
  })

  return { client, wasEnded: () => ended }
}

describe('SshClient', () => {
  test('connect + run emits progress and returns stdout', async () => {
    const { client } = makeMockClient()
    const ssh = new SshClient(() => client)
    const events: string[] = []
    ssh.on('progress', (e: { type: string }) => events.push(e.type))

    await ssh.connect({
      host: '127.0.0.1',
      username: 'root',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
    })

    const result = await ssh.run('echo hi')
    expect(result.stdout).toBe('ok')
    expect(result.code).toBe(0)
    expect(events).toContain('stdout')
    expect(events).toContain('exit')

    await ssh.disconnect()
    expect(client.end).toHaveBeenCalled()
  })

  test('disconnects on exec error', async () => {
    const { client, wasEnded } = makeMockClient({ execError: new Error('exec failed') })
    const ssh = new SshClient(() => client)

    await ssh.connect({
      host: '127.0.0.1',
      username: 'root',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
    })

    await expect(ssh.run('false')).rejects.toThrow('exec failed')
    expect(wasEnded()).toBe(true)
  })

  test('disconnects on connect error', async () => {
    const { client } = makeMockClient({ failOnConnect: true })
    const ssh = new SshClient(() => client)

    await expect(
      ssh.connect({
        host: '127.0.0.1',
        username: 'root',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----',
      }),
    ).rejects.toThrow('connect failed')
    expect(client.end).toHaveBeenCalled()
  })
})
