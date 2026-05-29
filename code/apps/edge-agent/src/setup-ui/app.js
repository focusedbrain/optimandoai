/* global fetch */

const pollMs = 1500

async function refresh() {
  const res = await fetch('/agent/health')
  if (res.status === 410) {
    document.body.innerHTML =
      '<h1>Setup complete</h1><p>Manage this server from WR Desk. You can close this tab.</p>'
    return
  }
  const data = await res.json()
  render(data)
}

function el(id) {
  return document.getElementById(id)
}

function render(data) {
  const screens = document.querySelectorAll('[data-screen]')
  screens.forEach((s) => {
    s.hidden = s.getAttribute('data-screen') !== data.setupPhase
  })

  if (data.setupPhase === 'registry_ready') {
    if (data.registryPairingCodeDisplay) {
      el('registry-pairing-code').textContent = data.registryPairingCodeDisplay
    }
    if (data.ssoEmail) el('registry-signed-in-as').textContent = data.ssoEmail
    if (data.deviceName) el('registry-device-name').textContent = data.deviceName
  }

  if (data.setupPhase === 'code_displayed' || data.setupPhase === 'pairing_in_progress') {
    if (data.pairingCodeDisplay) el('pairing-code').textContent = data.pairingCodeDisplay
    if (data.ssoEmail) el('signed-in-as').textContent = data.ssoEmail
  }

  if (data.setupPhase === 'pairing_in_progress' && data.sessionId) {
    el('fingerprint').textContent = data.fingerprint || '—'
    el('confirm-form').dataset.sessionId = data.sessionId
  }

  if (data.ssoError) {
    el('sso-error').textContent = data.ssoError
    el('sso-error').hidden = false
  } else if (el('sso-error')) {
    el('sso-error').hidden = true
  }
}

document.addEventListener('click', async (ev) => {
  const target = ev.target
  if (!(target instanceof HTMLElement)) return
  if (target.id === 'regenerate-code' || target.id === 'regenerate-registry-code') {
    ev.preventDefault()
    await fetch('/setup/regenerate-code', { method: 'POST' })
    await refresh()
  }
})

document.getElementById('confirm-form')?.addEventListener('submit', async (ev) => {
  ev.preventDefault()
  const form = ev.target
  if (!(form instanceof HTMLFormElement)) return
  const sessionId = form.dataset.sessionId
  if (!sessionId) return
  await fetch('/setup/pair/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  })
  await refresh()
})

document.getElementById('reject-pairing')?.addEventListener('click', async () => {
  await fetch('/setup/pair/reject', { method: 'POST' })
  await refresh()
})

refresh()
setInterval(refresh, pollMs)
