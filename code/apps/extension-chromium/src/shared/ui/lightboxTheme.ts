/**
 * Unified Lightbox Theme System
 *
 * Provides consistent design tokens and style helpers for all lightboxes,
 * modals, and dialogs across the extension. All three themes (Standard,
 * Pro, Dark) share the same structural pattern but use distinct color palettes.
 *
 * Reference design: WRVault lightbox — full available screen real estate,
 * colors matched to the active theme.
 */

export type LightboxTheme = 'default' | 'dark' | 'professional';

// ─── Theme Token Sets ─────────────────────────────────────────────────────────

interface ThemeTokens {
  /** Main lightbox panel background */
  panelBg: string;
  /** Panel background as CSS value (may be gradient) */
  panelBgStyle: string;
  /** Header area background */
  headerBg: string;
  /** Accent / brand gradient used on header and active elements */
  accentGradient: string;
  /** Accent solid color (for borders, highlights) */
  accentColor: string;
  /** Primary text color */
  text: string;
  /** Secondary / muted text color */
  textMuted: string;
  /** Border color for dividers, cards, inputs */
  border: string;
  /** Input / field background */
  inputBg: string;
  /** Input border */
  inputBorder: string;
  /** Card / surface background */
  cardBg: string;
  /** Tab / button inactive background */
  tabBg: string;
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
  /** Success accent */
  success: string;
  /** Error accent */
  error: string;
  /** Warning accent */
  warning: string;
  /** Info accent */
  info: string;
  /** Scrollbar thumb color */
  scrollbarThumb: string;
  /** Scrollbar track color */
  scrollbarTrack: string;
  /** Box shadow for the panel */
  panelShadow: string;
}

// ── Pro: vivid purple chrome — exact WRVault Pro palette ──
const PRO_TOKENS: ThemeTokens = {
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
  cardBg: 'rgba(168,85,247,0.06)',
  tabBg: 'rgba(168,85,247,0.08)',
  tabActiveBg: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(30,10,60,0.92)',
  closeBg: 'rgba(168,85,247,0.18)',
  closeHoverBg: 'rgba(168,85,247,0.35)',
  success: '#4ade80',
  error: '#ff3b30',
  warning: '#fbbf24',
  info: '#818cf8',
  scrollbarThumb: 'rgba(168,85,247,0.4)',
  scrollbarTrack: 'rgba(168,85,247,0.08)',
  panelShadow: '0 20px 60px rgba(30,10,60,0.6)',
};

// ── Standard: LIGHT theme — exact WRVault Standard palette ──
const STANDARD_TOKENS: ThemeTokens = {
  panelBg: '#f8f9fb',
  panelBgStyle: '#f8f9fb',
  headerBg: '#ffffff',
  accentGradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
  accentColor: '#6366f1',
  text: '#0f1419',
  textMuted: '#536471',
  border: '#e1e8ed',
  inputBg: '#f1f3f5',
  inputBorder: '#d1d9e0',
  cardBg: '#ffffff',
  tabBg: '#f1f3f5',
  tabActiveBg: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(15,20,25,0.60)',
  closeBg: 'rgba(15,20,25,0.08)',
  closeHoverBg: 'rgba(15,20,25,0.15)',
  success: '#16a34a',
  error: '#dc2626',
  warning: '#d97706',
  info: '#6366f1',
  scrollbarThumb: '#d1d9e0',
  scrollbarTrack: '#f1f3f5',
  panelShadow: '0 20px 60px rgba(15,23,42,0.12)',
};

// ── Dark: deep slate — exact WRVault Dark palette ──
const DARK_TOKENS: ThemeTokens = {
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
  cardBg: 'rgba(30,41,59,0.5)',
  tabBg: 'rgba(30,41,59,0.5)',
  tabActiveBg: 'linear-gradient(135deg, #818cf8 0%, #6366f1 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(0,0,0,0.90)',
  closeBg: 'rgba(148,163,184,0.15)',
  closeHoverBg: 'rgba(148,163,184,0.25)',
  success: '#4ade80',
  error: '#ef4444',
  warning: '#fbbf24',
  info: '#818cf8',
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
 * Uses 100% of available space (minus a small margin) for a full-screen feel.
 */
export function panelStyle(t: ThemeTokens): React.CSSProperties {
  return {
    flex: 1,
    margin: '12px',
    background: t.panelBgStyle,
    borderRadius: '16px',
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
 * Standard (light) theme uses border-bottom instead of coloured background.
 */
export function headerStyle(t: ThemeTokens): React.CSSProperties {
  const isLight = t.panelBgStyle === '#f8f9fb';
  return {
    padding: '18px 24px',
    background: t.headerBg,
    color: isLight ? t.text : '#ffffff',
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
 * Inherits color from headerStyle so it adapts to light/dark themes.
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
  const isLight = t && t.panelBgStyle === '#f8f9fb';
  return {
    fontSize: '12px',
    color: isLight ? t.textMuted : 'rgba(255,255,255,0.75)',
    margin: '2px 0 0 0',
    lineHeight: 1.3,
  };
}

/**
 * Returns inline styles for the close (×) button.
 */
export function closeButtonStyle(t: ThemeTokens): React.CSSProperties {
  const isLight = t.panelBgStyle === '#f8f9fb';
  return {
    background: t.closeBg,
    border: isLight ? `1px solid ${t.border}` : 'none',
    color: isLight ? t.text : '#ffffff',
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
    color: isActive ? t.tabActiveText : t.text,
    fontSize: '13px',
    fontWeight: isActive ? 600 : 500,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.45 : 1,
    transition: 'all 0.18s',
    boxShadow: isActive ? '0 4px 14px rgba(139, 92, 246, 0.3)' : 'none',
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
    color: t.text,
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
    boxShadow: '0 4px 14px rgba(139, 92, 246, 0.35)',
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
 */
export function notificationStyle(type: 'success' | 'error' | 'info' | 'warning'): React.CSSProperties {
  const colors = {
    success: { bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)', text: '#4ade80' },
    error: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)', text: '#f87171' },
    info: { bg: 'rgba(129,140,248,0.15)', border: 'rgba(129,140,248,0.4)', text: '#818cf8' },
    warning: { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.4)', text: '#fbbf24' },
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
