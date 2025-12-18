// AtomicBlock: minimal schema representing an atomic UI or logic block
export type AtomicBlock = {
  id: string // unique block id
  ui?: {
    kind: string // ui kind, e.g., 'text', 'input', 'textarea', 'button'
    props?: Record<string, any> // optional arbitrary UI props
  }
  logic?: {
    kind?: string // optional logic kind
    script?: string // optional inline script or descriptor
  }
  intent_tags?: string[] // semantic tags describing the block's intent
  description?: string // human-readable description
  metadata?: Record<string, any> // optional additional metadata
}

// MiniApp: runtime-assembled collection of AtomicBlocks
export type MiniApp = {
  id: string // generated mini-app id
  blocks: AtomicBlock[] // ordered blocks included in the app
}

// RuntimeState: generic mapping used by the runtime for state persistence
export type RuntimeState = Record<string, any>
