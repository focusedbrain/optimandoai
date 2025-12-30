// AtomicBlock (Tier 3): minimal schema representing an atomic UI or logic block
export type AtomicBlock = {
  id: string // unique block id
  type: 'atomic' // tier 3 type marker
  group?: string // block group, e.g., 'ui.action', 'ui.input', 'ui.display', 'logic.*'
  ui?: {
    kind: string // ui kind, e.g., 'text', 'input', 'textarea', 'button'
    label?: string // button/input label
    value?: string // default value for text elements
    placeholder?: string // placeholder for inputs
    inputType?: string // input type for input elements
    role?: string // role for text elements (e.g., 'label')
    props?: Record<string, any> // optional arbitrary UI props
  }
  logic?: {
    kind?: string // optional logic kind
    script?: string // optional inline script or descriptor
  }
  behaviour?: {
    onChange?: { action: string, key?: string } // onChange handler for inputs
    onClick?: { action: string, event?: string } // onClick handler for buttons
    [key: string]: any // support onEvent:* pattern
  }
  intent_tags?: string[] // semantic tags describing the block's intent
  description?: string // human-readable description
  security?: string // security level
  metadata?: Record<string, any> // optional additional metadata
}

// Component (Tier 2): composed of atomic blocks with bindings and behaviour
export type Component = {
  id: string // unique component id
  tier: 2 // tier marker
  type: 'component' // tier 2 type marker
  name: string // component name
  description: string // component description
  intent_tags: string[] // semantic tags
  blocks: string[] // array of tier3 block ids
  bindings?: Record<string, Record<string, any>> // bindings for blocks
  behaviour?: Record<string, any> // behaviour handlers
  state?: Record<string, any> // initial state
  security: string // security level
}

// MiniApp (Tier 1): composed of components with layout and state
export type MiniApp = {
  id: string // unique mini-app id
  tier: 1 // tier marker
  type: 'mini_app' // tier 1 type marker
  name: string // mini-app name
  description: string // mini-app description
  intent_tags: string[] // semantic tags
  components: string[] // array of tier2 component ids
  bindings?: Record<string, Record<string, any>> // bindings for components
  state?: Record<string, any> // initial state
  layout?: {
    type: string // layout type (vertical, horizontal, card, etc.)
    spacing?: string // spacing between components
  }
  security: string // security level
}

// RuntimeState: generic mapping used by the runtime for state persistence
export type RuntimeState = Record<string, any>

// Registry to store all loaded blocks, components, and mini-apps
export type BEAPRegistry = {
  tier3: Map<string, AtomicBlock> // tier3 atomic blocks by id
  tier2: Map<string, Component> // tier2 components by id
  tier1: Map<string, MiniApp> // tier1 mini-apps by id
}
