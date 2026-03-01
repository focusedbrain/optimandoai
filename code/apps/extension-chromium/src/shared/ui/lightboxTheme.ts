/**
 * Unified Lightbox Theme System
 *
 * Provides consistent design tokens and style helpers for all lightboxes,
 * modals, and dialogs across the extension. All three themes (Standard,
 * Pro, Dark) share the same structural pattern but use distinct color palettes.
 *
 * Reference design: WRVault lightbox — full available screen real estate,
 * colors matched to the active theme. WRVault VAULT_THEMES is the source of truth.
 *
 * Contrast rules:
 *  - Dark panel → white/light text
 *  - Light panel → black/dark text (#0f1419)
 *  - Never use light text on light backgrounds or dark text on dark backgrounds
 */

export type LightboxTheme = 'default' | 'dark' | 'professional';

// ─── Theme Token Sets ─────────────────────────────────────────────────────────

interface ThemeTokens {
  /** True when panel background is light (Standard theme) */
  isLight: boolean;
  /** Main lightbox panel background */
  panelBg: string;
  /** Panel background as CSS value (may be gradient) */
  panelBgStyle: string;
  /** Header area background */
  headerBg: string;
  /** Accent / brand gradient used on active elements and buttons */
  accentGradient: string;
  /** Accent solid color (for borders, highlights) */
  accentColor: string;
  /** Primary text color — always high-contrast against panelBg */
  text: string;
  /** Secondary / muted text color — still legible, not invisible */
  textMuted: string;
  /** Border color for dividers, cards, inputs */
  border: string;
  /** Input / field background */
  inputBg: string;
  /** Input border */
  inputBorder: string;
  /** Input text color — always high-contrast against inputBg */
  inputText: string;
  /** Card / surface background */
  cardBg: string;
  /** Card text color */
  cardText: string;
  /** Tab / button inactive background */
  tabBg: string;
  /** Tab inactive text */
  tabText: string;
  /** Tab active background */
  tabActiveBg: string;
  /** Tab active text color */
  tabActiveText: string;
  /** Overlay / backdrop color */
  overlay: string;
  /** Close button background */
  closeBg: string;
  /** Close button hover background */
  closeHoverBg: string;
  /** Close button icon color */
  closeText: string;
  /** Success accent */
  success: string;
  /** Success text — readable on panel background */
  successText: string;
  /** Error accent */
  error: string;
  /** Error text — readable on panel background */
  errorText: string;
  /** Warning accent */
  warning: string;
  /** Warning text */
  warningText: string;
  /** Info accent */
  info: string;
  /** Info text */
  infoText: string;
  /** Scrollbar thumb color */
  scrollbarThumb: string;
  /** Scrollbar track color */
  scrollbarTrack: string;
  /** Box shadow for the panel */
  panelShadow: string;
}

// ── Pro: vivid purple chrome — exact WRVault Pro palette ──
const PRO_TOKENS: ThemeTokens = {
  isLight: false,
  panelBg: '#1e1040',
  panelBgStyle: 'linear-gradient(135deg, #1e1040 0%, #2d1b69 50%, #1a0e3a 100%)',
  headerBg: 'rgba(168,85,247,0.12)',
  accentGradient: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
  accentColor: '#a855f7',
  text: '#f3f0ff',
  textMuted: '#c4b5fd',
  border: 'rgba(168,85,247,0.18)',
  inputBg: 'rgba(0,0,0,0.3)',
  inputBorder: 'rgba(168,85,247,0.30)',
  inputText: '#f3f0ff',
  cardBg: 'rgba(168,85,247,0.06)',
  cardText: '#f3f0ff',
  tabBg: 'rgba(168,85,247,0.08)',
  tabText: '#f3f0ff',
  tabActiveBg: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(30,10,60,0.92)',
  closeBg: 'rgba(168,85,247,0.18)',
  closeHoverBg: 'rgba(168,85,247,0.35)',
  closeText: '#ffffff',
  success: '#4ade80',
  successText: '#4ade80',
  error: '#ff6b6b',
  errorText: '#ff6b6b',
  warning: '#fbbf24',
  warningText: '#fbbf24',
  info: '#a5b4fc',
  infoText: '#a5b4fc',
  scrollbarThumb: 'rgba(168,85,247,0.4)',
  scrollbarTrack: 'rgba(168,85,247,0.08)',
  panelShadow: '0 20px 60px rgba(30,10,60,0.6)',
};

// ── Standard: LIGHT theme — exact WRVault Standard palette ──
const STANDARD_TOKENS: ThemeTokens = {
  isLight: true,
  panelBg: '#f8f9fb',
  panelBgStyle: '#f8f9fb',
  headerBg: '#ffffff',
  accentGradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
  accentColor: '#6366f1',
  text: '#0f1419',
  textMuted: '#536471',
  border: '#e1e8ed',
  inputBg: '#ffffff',
  inputBorder: '#d1d9e0',
  inputText: '#0f1419',
  cardBg: '#ffffff',
  cardText: '#0f1419',
  tabBg: '#f1f3f5',
  tabText: '#0f1419',
  tabActiveBg: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(15,20,25,0.60)',
  closeBg: 'rgba(15,20,25,0.06)',
  closeHoverBg: 'rgba(15,20,25,0.12)',
  closeText: '#0f1419',
  success: '#16a34a',
  successText: '#166534',
  error: '#dc2626',
  errorText: '#991b1b',
  warning: '#b45309',
  warningText: '#92400e',
  info: '#4f46e5',
  infoText: '#3730a3',
  scrollbarThumb: '#d1d9e0',
  scrollbarTrack: '#f1f3f5',
  panelShadow: '0 20px 60px rgba(15,23,42,0.10)',
};

// ── Dark: deep slate — exact WRVault Dark palette ──
const DARK_TOKENS: ThemeTokens = {
  isLight: false,
  panelBg: '#111827',
  panelBgStyle: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  headerBg: 'rgba(30,41,59,0.8)',
  accentGradient: 'linear-gradient(135deg, #818cf8 0%, #6366f1 100%)',
  accentColor: '#818cf8',
  text: '#e7e9ea',
  textMuted: '#94a3b8',
  border: 'rgba(148,163,184,0.15)',
  inputBg: 'rgba(15,23,42,0.8)',
  inputBorder: 'rgba(148,163,184,0.22)',
  inputText: '#e7e9ea',
  cardBg: 'rgba(30,41,59,0.5)',
  cardText: '#e7e9ea',
  tabBg: 'rgba(30,41,59,0.5)',
  tabText: '#e7e9ea',
  tabActiveBg: 'linear-gradient(135deg, #818cf8 0%, #6366f1 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(0,0,0,0.90)',
  closeBg: 'rgba(148,163,184,0.15)',
  closeHoverBg: 'rgba(148,163,184,0.25)',
  closeText: '#e7e9ea',
  success: '#4ade80',
  successText: '#4ade80',
  error: '#f87171',
  errorText: '#f87171',
  warning: '#fbbf24',
  warningText: '#fbbf24',
  info: '#818cf8',
  infoText: '#818cf8',
  scrollbarThumb: 'rgba(148,163,184,0.3)',
  scrollbarTrack: 'rgba(30,41,59,0.5)',
  panelShadow: '0 20px 60px rgba(0,0,0,0.7)',
};

// ─── Token Lookup ─────────────────────────────────────────────────────────────

export function getThemeTokens(theme: LightboxTheme): ThemeTokens {
  switch (theme) {
    case 'professional':
      return STANDARD_TOKENS;
    case 'dark':
      return DARK_TOKENS;
    default:
      return PRO_TOKENS;
  }
}

// ─── Shared Structural Styles ─────────────────────────────────────────────────

/**
 * Returns inline styles for the full-screen backdrop overlay.
 * The lightbox occupies the full available screen real estate.
 */
export function overlayStyle(t: ThemeTokens): React.CSSProperties {
  return {
    position: 'fixed',
    inset: 0,
    zIndex: 2147483640,
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
    background: t.overlay,
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  };
}

/**
 * Returns inline styles for the main lightbox panel.
 * Uses full available space with a small margin for breathing room.
 */
export function panelStyle(t: ThemeTokens): React.CSSProperties {
  return {
    flex: 1,
    margin: '8px',
    background: t.panelBgStyle,
    borderRadius: '14px',
    border: `1px solid ${t.border}`,
    boxShadow: t.panelShadow,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    color: t.text,
    fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif',
  };
}

/**
 * Returns inline styles for the lightbox header bar.
 */
export function headerStyle(t: ThemeTokens): React.CSSProperties {
  return {
    padding: '18px 24px',
    background: t.headerBg,
    color: t.isLight ? t.text : '#ffffff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
    gap: '12px',
    borderBottom: `1px solid ${t.border}`,
  };
}

/**
 * Returns inline styles for the header title text block.
 */
export function headerTitleStyle(): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flex: 1,
    minWidth: 0,
  };
}

/**
 * Returns inline styles for the main title in the header.
 * Color is inherited from headerStyle — do not set color here.
 */
export function headerMainTitleStyle(): React.CSSProperties {
  return {
    fontSize: '17px',
    fontWeight: 700,
    lineHeight: 1.2,
    margin: 0,
  };
}

/**
 * Returns inline styles for the subtitle/description in the header.
 */
export function headerSubtitleStyle(t?: ThemeTokens): React.CSSProperties {
  return {
    fontSize: '12px',
    color: t ? (t.isLight ? t.textMuted : 'rgba(255,255,255,0.75)') : 'rgba(255,255,255,0.75)',
    margin: '2px 0 0 0',
    lineHeight: 1.3,
  };
}

/**
 * Returns inline styles for the close (×) button.
 */
export function closeButtonStyle(t: ThemeTokens): React.CSSProperties {
  return {
    background: t.closeBg,
    border: t.isLight ? `1px solid ${t.border}` : 'none',
    color: t.closeText,
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'background 0.2s',
    lineHeight: 1,
  };
}

/**
 * Returns inline styles for the scrollable content body.
 */
export function bodyStyle(t: ThemeTokens): React.CSSProperties {
  return {
    flex: 1,
    overflowY: 'auto',
    padding: '24px',
    color: t.text,
    scrollbarWidth: 'thin',
    scrollbarColor: `${t.scrollbarThumb} ${t.scrollbarTrack}`,
  };
}

/**
 * Returns inline styles for a tab bar container.
 */
export function tabBarStyle(t: ThemeTokens): React.CSSProperties {
  return {
    display: 'flex',
    gap: '6px',
    padding: '12px 20px',
    background: 'transparent',
    borderBottom: `1px solid ${t.border}`,
    flexShrink: 0,
  };
}

/**
 * Returns inline styles for an individual tab button.
 */
export function tabStyle(t: ThemeTokens, isActive: boolean, isDisabled?: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '10px 14px',
    background: isActive ? t.tabActiveBg : t.tabBg,
    border: isActive ? 'none' : `1px solid ${t.border}`,
    borderRadius: '8px',
    color: isActive ? t.tabActiveText : t.tabText,
    fontSize: '13px',
    fontWeight: isActive ? 600 : 500,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.45 : 1,
    transition: 'all 0.18s',
    whiteSpace: 'nowrap',
  };
}

/**
 * Returns inline styles for an input field.
 */
export function inputStyle(t: ThemeTokens): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    background: t.inputBg,
    border: `1px solid ${t.inputBorder}`,
    borderRadius: '8px',
    color: t.inputText,
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
  };
}

/**
 * Returns inline styles for a label element.
 */
export function labelStyle(t: ThemeTokens): React.CSSProperties {
  return {
    display: 'block',
    fontSize: '11px',
    fontWeight: 600,
    color: t.textMuted,
    marginBottom: '5px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
}

/**
 * Returns inline styles for a card/section container.
 */
export function cardStyle(t: ThemeTokens): React.CSSProperties {
  return {
    background: t.cardBg,
    border: `1px solid ${t.border}`,
    borderRadius: '12px',
    padding: '16px',
    color: t.cardText,
  };
}

/**
 * Returns inline styles for a primary action button.
 */
export function primaryButtonStyle(t: ThemeTokens, disabled?: boolean): React.CSSProperties {
  return {
    padding: '11px 20px',
    background: t.accentGradient,
    border: 'none',
    borderRadius: '9px',
    color: '#ffffff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'all 0.18s',
    boxShadow: t.isLight ? '0 2px 8px rgba(99,102,241,0.25)' : '0 4px 14px rgba(139,92,246,0.35)',
  };
}

/**
 * Returns inline styles for a secondary/ghost button.
 */
export function secondaryButtonStyle(t: ThemeTokens, disabled?: boolean): React.CSSProperties {
  return {
    padding: '11px 20px',
    background: t.cardBg,
    border: `1px solid ${t.border}`,
    borderRadius: '9px',
    color: t.text,
    fontSize: '13px',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'all 0.18s',
  };
}

/**
 * Returns inline styles for a status/notification banner.
 * Uses theme-aware text colors for proper contrast on any background.
 */
export function notificationStyle(type: 'success' | 'error' | 'info' | 'warning', t?: ThemeTokens): React.CSSProperties {
  const isLight = t?.isLight ?? false;
  const colors = {
    success: {
      bg: isLight ? 'rgba(22,163,74,0.08)' : 'rgba(34,197,94,0.15)',
      border: isLight ? 'rgba(22,163,74,0.3)' : 'rgba(34,197,94,0.4)',
      text: isLight ? '#166534' : '#4ade80',
    },
    error: {
      bg: isLight ? 'rgba(220,38,38,0.08)' : 'rgba(239,68,68,0.15)',
      border: isLight ? 'rgba(220,38,38,0.3)' : 'rgba(239,68,68,0.4)',
      text: isLight ? '#991b1b' : '#f87171',
    },
    info: {
      bg: isLight ? 'rgba(79,70,229,0.08)' : 'rgba(129,140,248,0.15)',
      border: isLight ? 'rgba(79,70,229,0.25)' : 'rgba(129,140,248,0.4)',
      text: isLight ? '#3730a3' : '#a5b4fc',
    },
    warning: {
      bg: isLight ? 'rgba(217,119,6,0.08)' : 'rgba(251,191,36,0.15)',
      border: isLight ? 'rgba(217,119,6,0.3)' : 'rgba(251,191,36,0.4)',
      text: isLight ? '#92400e' : '#fbbf24',
    },
  };
  const c = colors[type];
  return {
    padding: '12px 16px',
    background: c.bg,
    border: `1px solid ${c.border}`,
    borderRadius: '10px',
    color: c.text,
    fontSize: '13px',
    fontWeight: 500,
  };
}

/**
 * Returns inline styles for a floating toast notification.
 */
export function toastStyle(type: 'success' | 'error'): React.CSSProperties {
  return {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '13px 22px',
    background: type === 'success' ? 'rgba(34,197,94,0.96)' : 'rgba(239,68,68,0.96)',
    border: `1px solid ${type === 'success' ? '#22c55e' : '#ef4444'}`,
    borderRadius: '10px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    zIndex: 2147483647,
    boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
    backdropFilter: 'blur(4px)',
  };
}

/**
 * Returns inline styles for a section heading inside the body.
 */
export function sectionHeadingStyle(t: ThemeTokens): React.CSSProperties {
  return {
    fontSize: '13px',
    fontWeight: 700,
    color: t.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    margin: '0 0 12px 0',
  };
}

/**
 * Returns inline styles for a divider line.
 */
export function dividerStyle(t: ThemeTokens): React.CSSProperties {
  return {
    height: '1px',
    background: t.border,
    margin: '16px 0',
    flexShrink: 0,
  };
}
