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

const PRO_TOKENS: ThemeTokens = {
  panelBg: '#1a0533',
  panelBgStyle: 'linear-gradient(160deg, #1a0533 0%, #2d1052 40%, #1a0533 100%)',
  headerBg: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)',
  accentGradient: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)',
  accentColor: '#a855f7',
  text: '#f5f3ff',
  textMuted: 'rgba(245,243,255,0.65)',
  border: 'rgba(168,85,247,0.25)',
  inputBg: 'rgba(255,255,255,0.07)',
  inputBorder: 'rgba(168,85,247,0.35)',
  cardBg: 'rgba(168,85,247,0.08)',
  tabBg: 'rgba(255,255,255,0.06)',
  tabActiveBg: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(10,0,25,0.80)',
  closeBg: 'rgba(255,255,255,0.15)',
  closeHoverBg: 'rgba(255,255,255,0.25)',
  success: '#4ade80',
  error: '#f87171',
  warning: '#fbbf24',
  info: '#818cf8',
  scrollbarThumb: 'rgba(168,85,247,0.4)',
  scrollbarTrack: 'rgba(168,85,247,0.08)',
  panelShadow: '0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(168,85,247,0.2)',
};

const STANDARD_TOKENS: ThemeTokens = {
  panelBg: '#faf5ff',
  panelBgStyle: 'linear-gradient(160deg, #faf5ff 0%, #f3e8ff 60%, #faf5ff 100%)',
  headerBg: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)',
  accentGradient: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)',
  accentColor: '#9333ea',
  text: '#0f172a',
  textMuted: '#475569',
  border: 'rgba(147,51,234,0.15)',
  inputBg: '#ffffff',
  inputBorder: 'rgba(147,51,234,0.25)',
  cardBg: '#ffffff',
  tabBg: 'rgba(147,51,234,0.06)',
  tabActiveBg: 'linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #9333ea 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(15,7,26,0.55)',
  closeBg: 'rgba(255,255,255,0.35)',
  closeHoverBg: 'rgba(255,255,255,0.55)',
  success: '#16a34a',
  error: '#dc2626',
  warning: '#d97706',
  info: '#4f46e5',
  scrollbarThumb: 'rgba(147,51,234,0.35)',
  scrollbarTrack: 'rgba(147,51,234,0.06)',
  panelShadow: '0 32px 80px rgba(147,51,234,0.18), 0 0 0 1px rgba(147,51,234,0.12)',
};

const DARK_TOKENS: ThemeTokens = {
  panelBg: '#0b1220',
  panelBgStyle: 'linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
  headerBg: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  accentGradient: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  accentColor: '#8b5cf6',
  text: '#e2e8f0',
  textMuted: 'rgba(226,232,240,0.55)',
  border: 'rgba(255,255,255,0.10)',
  inputBg: 'rgba(255,255,255,0.05)',
  inputBorder: 'rgba(255,255,255,0.15)',
  cardBg: 'rgba(255,255,255,0.04)',
  tabBg: 'rgba(255,255,255,0.05)',
  tabActiveBg: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  tabActiveText: '#ffffff',
  overlay: 'rgba(0,0,0,0.75)',
  closeBg: 'rgba(255,255,255,0.10)',
  closeHoverBg: 'rgba(255,255,255,0.20)',
  success: '#4ade80',
  error: '#f87171',
  warning: '#fbbf24',
  info: '#818cf8',
  scrollbarThumb: 'rgba(139,92,246,0.4)',
  scrollbarTrack: 'rgba(255,255,255,0.04)',
  panelShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.07)',
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
 */
export function headerStyle(t: ThemeTokens): React.CSSProperties {
  return {
    padding: '18px 24px',
    background: t.headerBg,
    color: '#ffffff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
    gap: '12px',
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
 */
export function headerMainTitleStyle(): React.CSSProperties {
  return {
    fontSize: '17px',
    fontWeight: 700,
    color: '#ffffff',
    lineHeight: 1.2,
    margin: 0,
  };
}

/**
 * Returns inline styles for the subtitle/description in the header.
 */
export function headerSubtitleStyle(): React.CSSProperties {
  return {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.80)',
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
    border: 'none',
    color: '#ffffff',
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
