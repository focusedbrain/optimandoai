import { AtomicBlock, MiniApp } from './types'
import { createRuntimeState } from './runtime'

function createElementForBlock(block: AtomicBlock, app: MiniApp, runtime: any, emitEvent: (ev:string)=>void) : HTMLElement {
  const container = document.createElement('div')
  container.style.padding = '8px'
  container.style.borderBottom = '1px solid rgba(0,0,0,0.08)'
  if (block.ui && block.ui.kind) {
    const kind = block.ui.kind
    if (kind === 'text' || kind === 'label') {
      const el = document.createElement('div')
      el.textContent = block.ui.value || block.description || ''
      container.appendChild(el)
    } else if (kind === 'input') {
      const input = document.createElement('input')
      input.type = block.ui.inputType || 'text'
      input.placeholder = block.ui.placeholder || ''
      input.style.width = '100%'
      input.addEventListener('input', (e) => {
        const v = (e.target as HTMLInputElement).value
        // honour behaviour
        const behaviour = (block as any).behaviour
        if (behaviour && behaviour.onChange && behaviour.onChange.action === 'state.set') {
          const key = behaviour.onChange.key || block.id
          runtime.set(key, v)
        } else {
          runtime.set(block.id, v)
        }
      })
      container.appendChild(input)
    } else if (kind === 'textarea') {
      const ta = document.createElement('textarea')
      ta.placeholder = block.ui.placeholder || ''
      ta.style.width = '100%'
      ta.addEventListener('input', (e) => {
        const v = (e.target as HTMLTextAreaElement).value
        const behaviour = (block as any).behaviour
        if (behaviour && behaviour.onChange && behaviour.onChange.action === 'state.set') {
          const key = behaviour.onChange.key || block.id
          runtime.set(key, v)
        } else {
          runtime.set(block.id, v)
        }
      })
      container.appendChild(ta)
    } else if (kind === 'button') {
      const btn = document.createElement('button')
      btn.textContent = block.ui.label || block.ui.props?.text || 'Button'
      btn.addEventListener('click', () => {
        const behaviour = (block as any).behaviour
        if (behaviour && behaviour.onClick) {
          const click = behaviour.onClick
          if (click.action === 'event.emit' && click.event) {
            emitEvent(click.event)
          }
        }
      })
      container.appendChild(btn)
    } else {
      const el = document.createElement('div')
      el.textContent = JSON.stringify(block.ui)
      container.appendChild(el)
    }
  } else {
    container.textContent = block.description || JSON.stringify(block)
  }
  return container
}

export function renderMiniApp(app: MiniApp): HTMLElement {
  const root = document.createElement('div')
  root.style.padding = '12px'
  root.style.background = 'white'
  root.style.color = 'black'
  root.style.borderRadius = '8px'
  root.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'
  const header = document.createElement('h3')
  header.textContent = 'Mini-App: ' + app.id
  header.style.marginTop = '0'
  root.appendChild(header)

  const runtime = createRuntimeState(app.id)

  const emitEvent = (evt:string) => {
    // find logic blocks in app.blocks that listen to this event
    app.blocks.forEach(b => {
      const beh = (b as any).behaviour || {}
      const key = 'onEvent:' + evt
      if (beh[key]) {
        const action = beh[key]
        // support state.persist and state.set
        if (action.action === 'state.persist') {
          const source = action.source
          if (source) {
            const val = runtime.get(source)
            // persist into runtime and then persist to storage
            runtime.set(source, val)
            runtime.persist()
          }
        } else if (action.action === 'state.set') {
          const target = action.key || 'value'
          const from = action.source
          runtime.set(target, from ? runtime.get(from) : null)
        }
      }
    })
  }

  app.blocks.forEach(b => {
    const el = createElementForBlock(b, app, runtime, emitEvent)
    root.appendChild(el)
  })

  return root
}
