export type AtomicBlock = {
  id: string
  ui?: {
    kind: string
    props?: Record<string, any>
  }
  logic?: {
    kind?: string
    script?: string
  }
  intent_tags?: string[]
  description?: string
  metadata?: Record<string, any>
}

export type MiniApp = {
  id: string
  blocks: AtomicBlock[]
}

export type RuntimeState = Record<string, any>
