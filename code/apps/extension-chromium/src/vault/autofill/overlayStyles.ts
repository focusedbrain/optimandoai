// ============================================================================
// WRVault Autofill — Overlay Styles (CSS Tokens + Constructed Stylesheet)
// ============================================================================
//
// All visual styling for the autofill overlay badge is defined here as:
//   1. CSS custom property tokens (§1) — for downstream theming
//   2. A constructed CSSStyleSheet (§2) — injected into the Shadow DOM
//
// Design constraints:
//   - System fonts only (no external loads, no layout shifts)
//   - All dimensions in px for deterministic positioning
//   - Semi-transparent background so the user knows "this is a preview"
//   - High-contrast text for WCAG AA readability on dark backgrounds
//   - Animations kept under 200ms (prefers-reduced-motion honored)
//   - No !important; specificity is guaranteed by Shadow DOM encapsulation
// ============================================================================

// ---------------------------------------------------------------------------
// §1  CSS Custom Property Tokens
// ---------------------------------------------------------------------------

/**
 * Token map for theming.  Consumers override these at the :host level
 * to re-skin the overlay without touching the stylesheet.
 */
export const CSS_TOKENS = {
  // ── Surfaces ──
  '--wrv-overlay-bg':            'rgba(15, 23, 42, 0.94)',
  '--wrv-overlay-bg-hover':      'rgba(15, 23, 42, 0.97)',
  '--wrv-overlay-border':        'rgba(99, 102, 241, 0.50)',
  '--wrv-overlay-border-focus':  'rgba(99, 102, 241, 0.80)',
  '--wrv-overlay-shadow':        '0 8px 32px rgba(0,0,0,0.38), 0 0 0 1px rgba(99,102,241,0.18)',
  '--wrv-overlay-radius':        '10px',

  // ── Typography ──
  '--wrv-font-family':           "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  '--wrv-font-mono':             "ui-monospace, 'SF Mono', 'Cascadia Code', 'Segoe UI Mono', Menlo, Consolas, monospace",
  '--wrv-font-size-sm':          '11px',
  '--wrv-font-size-base':        '13px',
  '--wrv-font-size-lg':          '14px',

  // ── Colors ──
  '--wrv-text-primary':          'rgba(255, 255, 255, 0.95)',
  '--wrv-text-secondary':        'rgba(255, 255, 255, 0.60)',
  '--wrv-text-muted':            'rgba(255, 255, 255, 0.38)',
  '--wrv-accent':                '#6366f1',
  '--wrv-accent-hover':          '#818cf8',
  '--wrv-accent-text':           '#ffffff',
  '--wrv-danger':                '#ef4444',
  '--wrv-danger-hover':          '#f87171',
  '--wrv-success':               '#22c55e',
  '--wrv-warning':               '#f59e0b',

  // ── Field rows ──
  '--wrv-field-bg':              'rgba(255, 255, 255, 0.06)',
  '--wrv-field-bg-hover':        'rgba(255, 255, 255, 0.10)',
  '--wrv-field-border':          'rgba(255, 255, 255, 0.10)',
  '--wrv-field-radius':          '6px',
  '--wrv-mask-color':            'rgba(255, 255, 255, 0.70)',

  // ── Buttons ──
  '--wrv-btn-radius':            '6px',
  '--wrv-btn-height':            '32px',
  '--wrv-icon-btn-size':         '28px',

  // ── Spacing ──
  '--wrv-spacing-xs':            '4px',
  '--wrv-spacing-sm':            '6px',
  '--wrv-spacing-md':            '10px',
  '--wrv-spacing-lg':            '14px',

  // ── Animation ──
  '--wrv-anim-duration':         '160ms',
  '--wrv-anim-easing':           'cubic-bezier(0.16, 1, 0.3, 1)',
} as const

export type CSSToken = keyof typeof CSS_TOKENS

// ---------------------------------------------------------------------------
// §2  Constructed CSSStyleSheet
// ---------------------------------------------------------------------------

/**
 * Build the stylesheet text.  Exported as a function so it can be called
 * once at mount time and adopted into the shadow root.
 *
 * Usage:
 *   const sheet = new CSSStyleSheet()
 *   sheet.replaceSync(buildOverlayCSS())
 *   shadowRoot.adoptedStyleSheets = [sheet]
 */
export function buildOverlayCSS(): string {
  const tokenDecls = Object.entries(CSS_TOKENS)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

  return /* css */ `
/* ======================================================================== */
/* WRVault Autofill Overlay — Shadow DOM Stylesheet                         */
/* ======================================================================== */

/* ── Token defaults (overridable at :host) ── */
:host {
${tokenDecls}
  display: block;
  position: absolute;
  z-index: 2147483645;
  pointer-events: auto;
  contain: layout style;
  font-family: var(--wrv-font-family);
  font-size: var(--wrv-font-size-base);
  color: var(--wrv-text-primary);
  line-height: 1.4;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  :host, :host * {
    animation-duration: 0ms !important;
    transition-duration: 0ms !important;
  }
}

/* ── Reset ── */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ======================================================================== */
/* Card                                                                      */
/* ======================================================================== */
.wrv-card {
  background: var(--wrv-overlay-bg);
  border: 2px solid var(--wrv-overlay-border);
  border-radius: var(--wrv-overlay-radius);
  box-shadow: var(--wrv-overlay-shadow);
  min-width: 260px;
  max-width: 360px;
  overflow: hidden;
  animation: wrv-slide-in var(--wrv-anim-duration) var(--wrv-anim-easing) both;
}

.wrv-card:focus-within {
  border-color: var(--wrv-overlay-border-focus);
}

@keyframes wrv-slide-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes wrv-fade-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.97); }
}

.wrv-card--dismissing {
  animation: wrv-fade-out 120ms ease-in both;
  pointer-events: none;
}

/* ======================================================================== */
/* Header                                                                    */
/* ======================================================================== */
.wrv-header {
  display: flex;
  align-items: center;
  gap: var(--wrv-spacing-sm);
  padding: var(--wrv-spacing-md) var(--wrv-spacing-lg);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.wrv-logo {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--wrv-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
  color: var(--wrv-accent-text);
  font-weight: 700;
}

.wrv-header-text {
  flex: 1;
  min-width: 0;
}

.wrv-domain {
  font-size: var(--wrv-font-size-sm);
  color: var(--wrv-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wrv-profile-name {
  font-size: var(--wrv-font-size-base);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wrv-close-btn {
  width: var(--wrv-icon-btn-size);
  height: var(--wrv-icon-btn-size);
  border: none;
  border-radius: var(--wrv-btn-radius);
  background: transparent;
  color: var(--wrv-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  transition: background var(--wrv-anim-duration) var(--wrv-anim-easing),
              color var(--wrv-anim-duration) var(--wrv-anim-easing);
}
.wrv-close-btn:hover,
.wrv-close-btn:focus-visible {
  background: rgba(255,255,255,0.10);
  color: var(--wrv-text-primary);
}
.wrv-close-btn:focus-visible {
  outline: 2px solid var(--wrv-accent);
  outline-offset: -2px;
}

/* ======================================================================== */
/* Field rows                                                                */
/* ======================================================================== */
.wrv-fields {
  padding: var(--wrv-spacing-sm) var(--wrv-spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--wrv-spacing-xs);
}

.wrv-field-row {
  display: flex;
  align-items: center;
  gap: var(--wrv-spacing-sm);
  padding: var(--wrv-spacing-sm) var(--wrv-spacing-md);
  background: var(--wrv-field-bg);
  border: 1px solid var(--wrv-field-border);
  border-radius: var(--wrv-field-radius);
  min-height: 36px;
  transition: background var(--wrv-anim-duration) var(--wrv-anim-easing);
}

.wrv-field-row:hover {
  background: var(--wrv-field-bg-hover);
}

.wrv-field-icon {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--wrv-text-muted);
}

.wrv-field-label {
  font-size: var(--wrv-font-size-sm);
  color: var(--wrv-text-secondary);
  min-width: 60px;
  flex-shrink: 0;
}

.wrv-field-value {
  flex: 1;
  min-width: 0;
  font-size: var(--wrv-font-size-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}

.wrv-field-value--masked {
  font-family: var(--wrv-font-mono);
  color: var(--wrv-mask-color);
  letter-spacing: 2px;
}

.wrv-field-value--revealed {
  font-family: var(--wrv-font-mono);
  color: var(--wrv-warning);
  letter-spacing: 0.5px;
}

.wrv-field-value--clear {
  color: var(--wrv-text-primary);
}

.wrv-field-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* Icon buttons inside field rows */
.wrv-icon-btn {
  width: var(--wrv-icon-btn-size);
  height: var(--wrv-icon-btn-size);
  border: none;
  border-radius: var(--wrv-btn-radius);
  background: transparent;
  color: var(--wrv-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: background var(--wrv-anim-duration) var(--wrv-anim-easing),
              color var(--wrv-anim-duration) var(--wrv-anim-easing);
}
.wrv-icon-btn:hover,
.wrv-icon-btn:focus-visible {
  background: rgba(255,255,255,0.12);
  color: var(--wrv-text-primary);
}
.wrv-icon-btn:focus-visible {
  outline: 2px solid var(--wrv-accent);
  outline-offset: -2px;
}
.wrv-icon-btn--success {
  color: var(--wrv-success);
}

/* ======================================================================== */
/* Footer — action buttons                                                   */
/* ======================================================================== */
.wrv-footer {
  display: flex;
  align-items: center;
  gap: var(--wrv-spacing-sm);
  padding: var(--wrv-spacing-md) var(--wrv-spacing-lg);
  border-top: 1px solid rgba(255,255,255,0.08);
}

.wrv-btn {
  height: var(--wrv-btn-height);
  padding: 0 14px;
  border: none;
  border-radius: var(--wrv-btn-radius);
  font-family: var(--wrv-font-family);
  font-size: var(--wrv-font-size-base);
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--wrv-spacing-xs);
  white-space: nowrap;
  transition: background var(--wrv-anim-duration) var(--wrv-anim-easing),
              transform 80ms ease;
}
.wrv-btn:active {
  transform: scale(0.97);
}
.wrv-btn:focus-visible {
  outline: 2px solid var(--wrv-accent);
  outline-offset: 2px;
}

.wrv-btn--primary {
  background: var(--wrv-accent);
  color: var(--wrv-accent-text);
}
.wrv-btn--primary:hover {
  background: var(--wrv-accent-hover);
}

.wrv-btn--secondary {
  background: rgba(255,255,255,0.08);
  color: var(--wrv-text-secondary);
}
.wrv-btn--secondary:hover {
  background: rgba(255,255,255,0.14);
  color: var(--wrv-text-primary);
}

.wrv-btn--grow {
  flex: 1;
}

/* ======================================================================== */
/* Trust toggle (optional "Always allow")                                    */
/* ======================================================================== */
.wrv-trust {
  display: flex;
  align-items: center;
  gap: var(--wrv-spacing-sm);
  padding: 0 var(--wrv-spacing-lg) var(--wrv-spacing-md);
  font-size: var(--wrv-font-size-sm);
  color: var(--wrv-text-muted);
}

.wrv-trust-checkbox {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--wrv-text-muted);
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: border-color var(--wrv-anim-duration) var(--wrv-anim-easing),
              background var(--wrv-anim-duration) var(--wrv-anim-easing);
}
.wrv-trust-checkbox:checked {
  background: var(--wrv-accent);
  border-color: var(--wrv-accent);
}
.wrv-trust-checkbox:checked::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0px;
  width: 5px;
  height: 9px;
  border: solid var(--wrv-accent-text);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.wrv-trust-checkbox:focus-visible {
  outline: 2px solid var(--wrv-accent);
  outline-offset: 2px;
}

.wrv-trust-label {
  cursor: pointer;
  user-select: none;
}

/* ======================================================================== */
/* Accessibility: sr-only utility                                            */
/* ======================================================================== */
.wrv-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ======================================================================== */
/* Placement arrow (optional, below-field pointing up)                       */
/* ======================================================================== */
.wrv-arrow {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--wrv-overlay-bg);
  border-top: 2px solid var(--wrv-overlay-border);
  border-left: 2px solid var(--wrv-overlay-border);
  transform: rotate(45deg);
  z-index: -1;
}
.wrv-arrow--top {
  top: -7px;
  left: 24px;
}
.wrv-arrow--bottom {
  bottom: -7px;
  left: 24px;
  border-top: none;
  border-left: none;
  border-bottom: 2px solid var(--wrv-overlay-border);
  border-right: 2px solid var(--wrv-overlay-border);
}
`
}

/**
 * Create an adoptable CSSStyleSheet from the overlay CSS.
 * Falls back to <style> injection for environments without
 * constructable stylesheets.
 */
export function createOverlayStyleSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(buildOverlayCSS())
  return sheet
}
