import { AtomicBlock, MiniApp as MiniAppType } from './types' // types for blocks and mini-app
import { createRuntimeState } from './runtime' // runtime state helper

// Helper: Get spacing value from layout definition
function getLayoutSpacing(spacing?: string): string {
  const spacingMap: Record<string, string> = {
    'small': '8px',
    'medium': '16px',
    'large': '24px'
  }
  return spacingMap[spacing || 'medium'] || '16px'
}

// Helper: Apply layout styles based on layout type
function applyLayoutStyles(root: HTMLElement, layout?: { type: string, spacing?: string }) {
  if (!layout) return
  
  const { type, spacing } = layout
  
  if (type === 'vertical') {
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = getLayoutSpacing(spacing)
  } else if (type === 'horizontal') {
    root.style.display = 'flex'
    root.style.flexDirection = 'row'
    root.style.gap = getLayoutSpacing(spacing)
    root.style.flexWrap = 'wrap'
  } else if (type === 'card') {
    root.style.border = '1px solid #e0e0e0'
    root.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
    root.style.borderRadius = '12px'
  }
}

// createElementForBlock: map an AtomicBlock to a DOM element
function createElementForBlock(block: AtomicBlock, runtime: any, emitEvent: (ev:string)=>void, blockStateKey?: string) : HTMLElement {
  const container = document.createElement('div') // wrapper element for this block
  container.style.marginBottom = '12px' // spacing between blocks
  
  if (block.ui && block.ui.kind) { // only handle blocks that specify UI
    const kind = block.ui.kind // ui kind (text, input, textarea, button)
    if (kind === 'text' || kind === 'label') {
      const el = document.createElement('div') // static text element
      const displayText = block.ui.value || block.ui.label || block.description || ''
      el.textContent = displayText // show value, label, or description
      el.style.fontSize = '14px' // styling for label
      el.style.fontWeight = 'bold'
      el.style.marginBottom = '8px'
      el.style.color = '#333'
      
      // CRITICAL FIX #3: Add data-state-key for reactive updates if text was bound to state
      if (blockStateKey) {
        el.setAttribute('data-state-key', blockStateKey)
        // Subscribe to state changes for reactive updates
        runtime.subscribe(blockStateKey, (newValue: any) => {
          el.textContent = String(newValue)
        })
      }
      
      container.appendChild(el) // add to container
    } else if (kind === 'input') {
      const label = document.createElement('label') // label for single-line input
      label.style.display = 'block'
      label.style.marginBottom = '6px'
      label.style.fontSize = '12px'
      label.style.color = '#666'
      label.style.fontWeight = 'bold'
      label.textContent = block.ui.label || 'Input' // label text
      
      const input = document.createElement('input') // create input element
      input.type = block.ui.inputType || 'text' // set input type
      input.placeholder = block.ui.placeholder || '' // placeholder text
      input.style.width = '100%'
      input.style.padding = '8px'
      input.style.border = '1px solid #ddd'
      input.style.borderRadius = '4px'
      input.style.fontSize = '14px'
      input.style.boxSizing = 'border-box'
      
      input.addEventListener('input', (e) => { // wire input to runtime state
        const v = (e.target as HTMLInputElement).value
        const behaviour = (block as any).behaviour
        if (behaviour && behaviour.onChange && behaviour.onChange.action === 'state.set') {
          const key = behaviour.onChange.key || block.id // respect configured key
          runtime.set(key, v) // set to runtime
        } else {
          runtime.set(block.id, v) // fallback: use block id
        }
      })
      
      container.appendChild(label) // append label
      container.appendChild(input) // append input
    } else if (kind === 'textarea') {
      const label = document.createElement('label') // label for textarea
      label.style.display = 'block'
      label.style.marginBottom = '6px'
      label.style.fontSize = '12px'
      label.style.color = '#666'
      label.style.fontWeight = 'bold'
      label.textContent = block.ui.label || 'Notes' // default to 'Notes'
      
      const ta = document.createElement('textarea') // create textarea element
      ta.placeholder = block.ui.placeholder || 'Enter your notes here...'
      ta.style.width = '100%'
      ta.style.minHeight = '120px'
      ta.style.padding = '8px'
      ta.style.border = '1px solid #ddd'
      ta.style.borderRadius = '4px'
      ta.style.fontSize = '14px'
      ta.style.fontFamily = 'inherit'
      ta.style.boxSizing = 'border-box'
      ta.style.resize = 'vertical'
      
      ta.addEventListener('input', (e) => { // wire textarea to runtime state
        const v = (e.target as HTMLTextAreaElement).value
        const behaviour = (block as any).behaviour
        if (behaviour && behaviour.onChange && behaviour.onChange.action === 'state.set') {
          const key = behaviour.onChange.key || block.id
          runtime.set(key, v)
        } else {
          runtime.set(block.id, v)
        }
      })
      
      container.appendChild(label) // append label
      container.appendChild(ta) // append textarea
    } else if (kind === 'button') {
      const btn = document.createElement('button') // create button element
      btn.textContent = block.ui.label || block.ui.props?.text || 'Button' // button text
      btn.style.padding = '10px 16px'
      btn.style.background = '#4CAF50'
      btn.style.color = 'white'
      btn.style.border = 'none'
      btn.style.borderRadius = '4px'
      btn.style.fontSize = '14px'
      btn.style.fontWeight = 'bold'
      btn.style.cursor = 'pointer'
      btn.style.marginTop = '8px'
      btn.style.transition = 'background 0.2s ease'
      
      btn.addEventListener('mouseover', () => { // hover effect
        btn.style.background = '#45a049'
      })
      btn.addEventListener('mouseout', () => {
        btn.style.background = '#4CAF50'
      })
      
      btn.addEventListener('click', () => { // on click, emit configured event
        const behaviour = (block as any).behaviour
        if (behaviour && behaviour.onClick) {
          const click = behaviour.onClick
          if (click.action === 'event.emit' && click.event) {
            emitEvent(click.event) // call emitEvent to run logic blocks
          }
        }
      })
      
      container.appendChild(btn) // append button
    } else {
      const el = document.createElement('div') // fallback: render raw ui JSON
      el.textContent = JSON.stringify(block.ui)
      container.appendChild(el)
    }
  } else {
    container.textContent = block.description || JSON.stringify(block) // fallback: show description
  }
  return container // return constructed container element
}

// renderMiniApp: create the root element for a MiniApp and wire event handling
// Supports both old format (blocks array) and new format (resolved from tier1/tier2)
export function renderMiniApp(app: { id: string, blocks: AtomicBlock[], layout?: { type: string, spacing?: string } } | MiniAppType): HTMLElement {
  const root = document.createElement('div') // root wrapper
  root.style.padding = '16px'
  root.style.background = 'white'
  root.style.color = '#333'
  root.style.borderRadius = '8px'
  root.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'
  
  // CRITICAL FIX #4: Apply layout system
  const appWithLayout = app as MiniAppType
  if (appWithLayout.layout) {
    applyLayoutStyles(root, appWithLayout.layout)
  }
  
  const header = document.createElement('h3') // header showing mini-app id
  header.textContent = 'Mini-App: ' + app.id
  header.style.marginTop = '0'
  header.style.marginBottom = '16px'
  header.style.fontSize = '16px'
  header.style.color = '#333'
  root.appendChild(header)

  const runtime = createRuntimeState(app.id, { persistToFile: true }) // create scoped runtime state with file persistence

  const emitEvent = async (evt:string) => {
    // find logic blocks in app.blocks that listen to this event
    app.blocks.forEach(b => {
      const beh = (b as any).behaviour || {} // behaviour map
      const key = 'onEvent:' + evt // event key convention
      if (beh[key]) {
        const action = beh[key]
        // support state.persist, state.set, and state.increment actions
        if (action.action === 'state.persist') {
          const source = action.source
          if (source) {
            const val = runtime.get(source) // read source from runtime
            // persist into runtime and then persist to storage
            runtime.set(source, val)
            ;(async () => {
              try {
                const path = await runtime.persist(source)
                const msg = document.createElement('div')
                msg.style.padding = '10px 12px'
                msg.style.background = '#d4edda'
                msg.style.border = '1px solid #c3e6cb'
                msg.style.color = '#155724'
                msg.style.borderRadius = '4px'
                msg.style.marginTop = '12px'
                msg.style.fontSize = '13px'
                if (path) {
                  msg.textContent = '✅ Notes saved successfully! File: ' + path
                } else {
                  msg.textContent = '✅ Notes saved successfully! (persisted)'
                }
                root.appendChild(msg)
                setTimeout(() => msg.remove(), 3000)
              } catch (e) {
                const msg = document.createElement('div')
                msg.style.padding = '10px 12px'
                msg.style.background = '#f8d7da'
                msg.style.border = '1px solid #f5c6cb'
                msg.style.color = '#721c24'
                msg.style.borderRadius = '4px'
                msg.style.marginTop = '12px'
                msg.style.fontSize = '13px'
                msg.textContent = '⚠️ Failed to save notes.'
                root.appendChild(msg)
                setTimeout(() => msg.remove(), 3000)
              }
            })()
          }
        } else if (action.action === 'state.set') {
          const target = action.key || 'value' // target key to set
          const from = action.source // source key to read from
          runtime.set(target, from ? runtime.get(from) : null) // set target from source
        } else if (action.action === 'state.increment') {
          const target = action.key || 'count' // target key to increment
          runtime.increment(target) // increment the value (will notify listeners automatically)
        }
      }
    })
  }

  // Only render blocks that have UI (skip pure logic blocks)
  app.blocks.forEach(b => {
    if (b.ui && b.ui.kind) {
      // Extract state key from behaviour if this block displays state
      let stateKey: string | undefined
      if (b.behaviour) {
        // Check if block has onChange that sets state
        const onChange = (b.behaviour as any).onChange
        if (onChange && onChange.action === 'state.set' && onChange.key) {
          stateKey = onChange.key
        }
      }
      
      const el = createElementForBlock(b, runtime, emitEvent, stateKey)
      root.appendChild(el)
    }
  })

  return root // return assembled root element
}



