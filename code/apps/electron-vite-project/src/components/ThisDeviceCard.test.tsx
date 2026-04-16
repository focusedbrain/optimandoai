import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ThisDeviceCard from './ThisDeviceCard'

describe('ThisDeviceCard', () => {
  it('renders the Coordination ID (UUID) and a Copy button', () => {
    const uuid = '11111111-2222-3333-4444-555555555555'
    const html = renderToStaticMarkup(
      <ThisDeviceCard deviceName="My Laptop" mode="host" instanceId={uuid} />,
    )

    expect(html).toContain(uuid)
    expect(html).toMatch(/data-testid="this-device-coordination-id"/)
    expect(html).toMatch(/data-testid="this-device-copy-button"/)
    expect(html).toMatch(/aria-label="Copy Coordination ID"/)
    expect(html).toContain('>Copy</button>')
    expect(html).toContain('Share this ID with your other device')
    expect(html).toContain('My Laptop')
    expect(html).toContain('>host<')
  })
})
