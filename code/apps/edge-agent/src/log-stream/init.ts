import type { AgentConfig } from '../config.js'
import type { AgentStorage } from '../storage.js'
import { AgentLogRingBuffer } from './buffer.js'
import { bindAgentLogStream } from './emit.js'

export function initAgentLogStream(config: AgentConfig, storage: AgentStorage): AgentLogRingBuffer {
  const ring = new AgentLogRingBuffer(config.stateDir)
  bindAgentLogStream({ ringBuffer: ring, agentStorage: storage })
  void ring.recoverPartialTrailingLine()
  return ring
}
