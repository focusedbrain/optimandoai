/**
 * Display grid (V1 + V2): read-only page-level badge for integration default automation icon.
 *
 * Source of truth: chrome.storage.local key `beap_integration_default_automation_v1`
 * (see beap-messages/integrationDefaultAutomationMetadata.ts). Reverse lookup:
 * entry.defaultSessionKey === sessionKey (URL param). Icon: defaultAutomationIcon.
 *
 * Ambiguity: if more than one integration row claims the same defaultSessionKey, no icon is shown.
 * Does not persist; does not mutate session or displayGrids.
 *
 * Verbose console logs: URL ?gridBadgeDebug=1 (see docs/display-grid-integration-default-badge.md).
 */
;(function () {
  var STORAGE_KEY = 'beap_integration_default_automation_v1'
  var LOG_PREFIX = '[grid-integration-default-badge]'
  var BADGE_DOM_ID = 'grid-integration-default-badge'
  /** Last sessionKey from tryRender — used by storage listener */
  var activeGridSessionKey = ''
  var storageListenerAttached = false

  /**
   * Opt-in verbose logs: URL `?gridBadgeDebug=1` or `window.__GRID_INTEGRATION_BADGE_DEBUG__ = true` (see docs).
   */
  function debugEnabled() {
    try {
      if (typeof window === 'undefined') return false
      if (window.__GRID_INTEGRATION_BADGE_DEBUG__ === true) return true
      var q = window.location && window.location.search
      return typeof q === 'string' && /(?:^|[?&])gridBadgeDebug=1(?:&|$)/.test(q)
    } catch (_) {
      return false
    }
  }

  function logDebug(msg, detail) {
    if (!debugEnabled()) return
    try {
      if (detail !== undefined) {
        console.log(LOG_PREFIX, msg, detail)
      } else {
        console.log(LOG_PREFIX, msg)
      }
    } catch (_) {}
  }

  function logWarn(msg, detail) {
    try {
      if (detail !== undefined) {
        console.warn(LOG_PREFIX, msg, detail)
      } else {
        console.warn(LOG_PREFIX, msg)
      }
    } catch (_) {}
  }

  function parseRoot(raw) {
    if (raw === null || raw === undefined || typeof raw !== 'object') return null
    if (raw.schemaVersion !== 1) return null
    if (typeof raw.byIntegrationKey !== 'object' || raw.byIntegrationKey === null) return null
    return raw
  }

  /**
   * All valid rows with defaultSessionKey === sessionKey (integration-key collisions counted here).
   * @returns {{ integrationKeys: string[], entries: object[] }}
   */
  function collectRowsForSession(sessionKey, root) {
    var result = { integrationKeys: [], entries: [] }
    if (!sessionKey || typeof sessionKey !== 'string' || !sessionKey.trim()) return result
    var by = root.byIntegrationKey
    for (var k in by) {
      if (!Object.prototype.hasOwnProperty.call(by, k)) continue
      var entry = by[k]
      if (!entry || typeof entry !== 'object') continue
      if (entry.schemaVersion !== 1) continue
      if (entry.defaultSessionKey !== sessionKey) continue
      result.integrationKeys.push(k)
      result.entries.push(entry)
    }
    return result
  }

  function removeBadge() {
    var el = document.getElementById(BADGE_DOM_ID)
    if (el) el.remove()
  }

  /**
   * @param {{ icon: string, label: string | null }} match
   */
  function renderBadge(match) {
    removeBadge()
    var wrap = document.createElement('div')
    wrap.id = BADGE_DOM_ID
    wrap.setAttribute('role', 'img')
    var tip = 'Integration default automation'
    if (match.label) tip += ' — ' + match.label
    wrap.title = tip
    wrap.style.cssText = [
      'position:fixed',
      'top:12px',
      'left:12px',
      'z-index:999',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'min-width:28px',
      'min-height:28px',
      'padding:4px',
      'border-radius:8px',
      'background:rgba(15,23,42,0.65)',
      'border:1px solid rgba(148,163,184,0.35)',
      'box-shadow:0 2px 8px rgba(0,0,0,0.2)',
      'pointer-events:none',
    ].join(';')

    var icon = match.icon
    if (/^https?:\/\//i.test(icon) || /^data:/i.test(icon)) {
      var img = document.createElement('img')
      img.src = icon
      img.alt = ''
      img.draggable = false
      img.style.cssText =
        'width:22px;height:22px;object-fit:contain;display:block;border-radius:4px'
      img.onerror = function () {
        logWarn('badge skipped: image load failed', { src: icon })
        wrap.remove()
      }
      wrap.appendChild(img)
    } else {
      var span = document.createElement('span')
      span.textContent = icon
      span.style.cssText = 'font-size:18px;line-height:1;display:block'
      wrap.appendChild(span)
    }
    document.body.appendChild(wrap)
  }

  function attachStorageListenerOnce() {
    if (storageListenerAttached) return
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return
    storageListenerAttached = true
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local') return
      if (!changes[STORAGE_KEY]) return
      var sk = activeGridSessionKey
      if (!sk) return
      logDebug('storage changed, refreshing badge', { key: STORAGE_KEY })
      resolveBadge(sk, 'storage-onChanged')
    })
  }

  /**
   * @param {string} sessionKey
   * @param {string} reason initial | storage-onChanged
   */
  function resolveBadge(sessionKey, reason) {
    reason = reason || 'initial'
    if (!sessionKey || typeof sessionKey !== 'string' || !sessionKey.trim()) {
      removeBadge()
      logDebug('badge skipped: empty sessionKey', { reason: reason })
      return
    }
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      removeBadge()
      logDebug('badge skipped: chrome.storage.local unavailable', { reason: reason })
      return
    }

    try {
      chrome.storage.local.get([STORAGE_KEY], function (items) {
        if (chrome.runtime && chrome.runtime.lastError) {
          removeBadge()
          logWarn('badge skipped: storage get error', {
            reason: reason,
            message: chrome.runtime.lastError.message,
          })
          return
        }

        var raw = items[STORAGE_KEY]
        var root = parseRoot(raw)
        if (!root) {
          removeBadge()
          logDebug('badge skipped: no or invalid integration metadata root', {
            reason: reason,
            sessionKey: sessionKey,
            hadRaw: raw != null,
          })
          return
        }

        var coll = collectRowsForSession(sessionKey, root)
        var rowCount = coll.entries.length

        if (rowCount === 0) {
          removeBadge()
          logDebug('badge skipped: no integration rows for defaultSessionKey', {
            reason: reason,
            sessionKey: sessionKey,
            matchingRows: 0,
            rendered: false,
          })
          return
        }

        if (rowCount > 1) {
          removeBadge()
          logWarn('badge skipped: ambiguous defaultSessionKey (multiple integration rows)', {
            reason: reason,
            sessionKey: sessionKey,
            matchingRows: rowCount,
            integrationKeys: coll.integrationKeys,
            rendered: false,
          })
          return
        }

        var entry = coll.entries[0]
        var iconRaw = entry.defaultAutomationIcon
        if (typeof iconRaw !== 'string' || !iconRaw.trim()) {
          removeBadge()
          logDebug('badge skipped: single match but no defaultAutomationIcon', {
            reason: reason,
            sessionKey: sessionKey,
            matchingRows: 1,
            rendered: false,
          })
          return
        }

        var label = entry.defaultAutomationLabel
        var match = {
          icon: iconRaw.trim(),
          label: typeof label === 'string' && label.trim() ? label.trim() : null,
        }
        renderBadge(match)
        logDebug('badge rendered', {
          reason: reason,
          sessionKey: sessionKey,
          matchingRows: 1,
          rendered: true,
        })
      })
    } catch (e) {
      removeBadge()
      logWarn('badge skipped: exception during resolve', { reason: reason, error: String(e) })
    }
  }

  /**
   * @param {string} sessionKey orchestrator session key from grid URL
   */
  function tryRender(sessionKey) {
    activeGridSessionKey = sessionKey || ''
    logDebug('tryRender', { sessionKey: activeGridSessionKey || '(empty)' })
    attachStorageListenerOnce()
    resolveBadge(activeGridSessionKey, 'initial')
  }

  window.gridV2IntegrationDefaultBadge = { tryRender: tryRender }
})()
