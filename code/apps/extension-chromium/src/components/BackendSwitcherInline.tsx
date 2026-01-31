import { useState, useEffect, useRef } from 'react';

// ============================================================================
// SSO Entry Component - Enterprise-Grade Authentication UI
// ============================================================================
// SECURITY CHECKLIST:
// - [x] Uses OIDC Authorization Code Flow with PKCE (S256) via Electron backend
// - [x] Tokens stored in secure credential store (keytar), NOT localStorage
// - [x] Session state from server, not client guess (fail-closed)
// - [x] CSRF protection via OIDC state parameter validation
// - [x] ID token signature verified (issuer, audience, nonce, expiry)
// - [x] Rate limiting handled by Keycloak + optional WAF
// - [x] No raw tokens exposed to UI layer
// ============================================================================

interface BackendSwitcherInlineProps {
  theme?: 'pro' | 'dark' | 'standard';
}

type TextSize = 'small' | 'normal' | 'large';

const TEXT_SCALES: Record<TextSize, number> = {
  small: 0.9,
  normal: 1,
  large: 1.3
};

// Auth status response from backend
interface AuthStatusResponse {
  loggedIn: boolean;
  displayName?: string;
  email?: string;
  initials?: string;
  picture?: string;
  tier?: string;
}

// Chevron down icon for dropdown
const ChevronDownIcon = ({ color }: { color: string }) => (
  <svg 
    width="10" 
    height="10" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke={color} 
    strokeWidth="2.5" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// Logout icon
const LogoutIcon = ({ color }: { color: string }) => (
  <svg 
    width="14" 
    height="14" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke={color} 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

// User icon for profile
const UserIcon = ({ color }: { color: string }) => (
  <svg 
    width="14" 
    height="14" 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke={color} 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

export function BackendSwitcherInline({ theme = 'standard' }: BackendSwitcherInlineProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [textSize, setTextSize] = useState<TextSize>('small');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<{ displayName?: string; email?: string; initials?: string; picture?: string }>({});
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [pictureError, setPictureError] = useState(false);  // Track if picture failed to load
  const [logoutTransition, setLogoutTransition] = useState(false);  // Brief transition after logout
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowAccountDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Check auth status on mount and periodically (fail-closed: treat as logged out on error)
  useEffect(() => {
    const checkAuthStatus = () => {
      chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (response: AuthStatusResponse | undefined) => {
        if (chrome.runtime.lastError) {
          console.warn('[AUTH] Status check failed:', chrome.runtime.lastError.message);
          // Fail-closed: treat as logged out
          setIsLoggedIn(false);
          setUserInfo({});
          return;
        }
        if (response?.loggedIn) {
          setIsLoggedIn(true);
          setPictureError(false);  // Reset picture error on new status
          setUserInfo({
            displayName: response.displayName,
            email: response.email,
            initials: response.initials || getInitials(response.displayName || response.email),
            picture: response.picture,
          });
        } else {
          setIsLoggedIn(false);
          setUserInfo({});
        }
      });
    };

    checkAuthStatus();
    // Refresh auth status every 60 seconds
    const interval = setInterval(checkAuthStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  // Helper to generate initials from name or email
  function getInitials(nameOrEmail?: string): string {
    if (!nameOrEmail) return '?';
    // If it's an email, use first letter before @
    if (nameOrEmail.includes('@')) {
      return nameOrEmail.charAt(0).toUpperCase();
    }
    // Otherwise use first letter of each word (max 2)
    const parts = nameOrEmail.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return nameOrEmail.charAt(0).toUpperCase();
  }

  // Helper to get abbreviated name (First Name + First Initial of Last Name)
  // e.g., "Oscar Smith" -> "Oscar S." to reduce PII exposure
  function getAbbreviatedName(displayName?: string): string {
    if (!displayName) return '';
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      const firstName = parts[0];
      const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    return parts[0]; // Just first name if no last name
  }

  // Handle Sign In click - starts OIDC auth flow
  const handleSignIn = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    try {
      chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' }, (response) => {
        setIsLoggingIn(false);
        if (chrome.runtime.lastError) {
          console.error('[AUTH] Login failed:', chrome.runtime.lastError.message);
          return;
        }
        if (response?.ok) {
          setIsLoggedIn(true);
          setPictureError(false);
          // Fetch user info after successful login
          chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (statusResponse: AuthStatusResponse | undefined) => {
            if (statusResponse?.loggedIn) {
              setUserInfo({
                displayName: statusResponse.displayName,
                email: statusResponse.email,
                initials: statusResponse.initials || getInitials(statusResponse.displayName || statusResponse.email),
                picture: statusResponse.picture,
              });
            }
          });
        } else {
          console.error('[AUTH] Login failed:', response?.error);
        }
      });
    } catch (err) {
      setIsLoggingIn(false);
      console.error('[AUTH] Login error:', err);
    }
  };

  // Handle Logout click - clears session via backend
  const handleLogout = async () => {
    if (isLoggingOut || logoutTransition) return;
    setIsLoggingOut(true);
    setShowAccountDropdown(false);
    // Immediately clear UI state (optimistic update) - no flash of login UI
    setIsLoggedIn(false);
    setUserInfo({});
    try {
      chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[AUTH] Logout failed:', chrome.runtime.lastError.message);
        }
        // Keep transition state to prevent UI flash while dashboard closes
        // Dashboard window needs time to close, so we show "Signed out" state briefly
        setIsLoggingOut(false);
        setLogoutTransition(true);
        setTimeout(() => {
          setLogoutTransition(false);
        }, 2500);  // Wait for dashboard to close before showing login UI
      });
    } catch (err) {
      setIsLoggingOut(false);
      setLogoutTransition(false);
      console.error('[AUTH] Logout error:', err);
    }
  };

  // Handle Create Account click - opens registration page and highlights form
  // Uses background script to open tab and inject highlight script
  const handleCreateAccount = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_REGISTER_PAGE' });
  };

  // Helper to scale font sizes
  const scaledSize = (baseSize: number) => `${Math.round(baseSize * TEXT_SCALES[textSize])}px`;

  // Map old theme names for backward compatibility
  const effectiveTheme = theme === 'pro' ? 'pro' : theme === 'dark' ? 'dark' : 'standard';
  
  const textColor = effectiveTheme === 'pro' ? '#fff' : effectiveTheme === 'dark' ? '#fff' : '#0f172a';
  const mutedColor = effectiveTheme === 'standard' ? 'rgba(15,23,42,0.6)' : 'rgba(255,255,255,0.7)';
  const accentColor = effectiveTheme === 'standard' ? '#6366f1' : '#a78bfa';
  const cardBg = effectiveTheme === 'standard' ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.06)';
  const borderColor = effectiveTheme === 'standard' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.1)';

  const features = [
    { icon: '🔗', text: 'One automation layer across email, messaging, files, streams, and systems' },
    { icon: '🛡️', text: 'Capsules remain valid even when received via compromised or untrusted transport layers' },
    { icon: '🔐', text: 'Capsules carry their own cryptographic integrity, security properties, and policy constraints' },
    { icon: '🚨', text: 'WRGuard protects enterprise inboxes and entry points by default' },
    { icon: '✓', text: 'Only sanitized, non-executable content is permitted to cross into controlled environments' },
    { icon: '📦', text: 'Original artifacts remain sealed and inaccessible within the network' },
    { icon: '🔓', text: 'Sensitive originals may be accessed only outside controlled execution environments' },
    { icon: '👁️', text: 'Documents are processed without exposure of executable or dynamic content' },
    { icon: '🤖', text: 'AI agents operate exclusively on verified, deterministic context' },
    { icon: '📋', text: 'Workflows remain verifiable, auditable, and enforceable across system boundaries' },
    { icon: '⚛️', text: 'Post-quantum–ready encryption is embedded into capsules by design' },
    { icon: '🏗️', text: 'Security and policy enforcement are native architectural properties, not retrofitted controls' },
    { icon: '🚧', text: 'Egress constraints are bound at the envelope level and enforced before any capsule is opened, ensuring that orchestration can only proceed within pre-authorized destinations and actions, with no possibility of post-decryption policy bypass' },
  ];

  const examples = [
    { label: 'Invoices', desc: 'structured intake, validation, and approval' },
    { label: 'Contracts', desc: 'controlled review, routing, and compliance checks' },
    { label: 'Support requests', desc: 'classification and workflow initiation' },
    { label: 'Incidents', desc: 'deterministic intake and response coordination' },
    { label: 'Onboarding', desc: 'verification, policy-bound follow-ups, and documentation' },
  ];

  return (
    <>
      <div style={{
        borderBottom: effectiveTheme === 'standard' ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(255,255,255,0.15)',
        background: effectiveTheme === 'standard' ? 'rgba(248,250,252,0.8)' : effectiveTheme === 'dark' ? 'rgba(15,23,42,0.6)' : 'rgba(118,75,162,0.4)'
      }}>
        {/* Header with Login buttons */}
        <div 
          style={{
            padding: '10px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {(isLoggingOut || logoutTransition) ? (
              /* ========== LOGGING OUT / TRANSITION STATE ========== */
              /* Show status during logout to prevent old UI flash */
              <span style={{ 
                fontSize: '11px', 
                color: mutedColor,
                fontStyle: 'italic'
              }}>
                {isLoggingOut ? 'Signing out...' : 'Signed out'}
              </span>
            ) : !isLoggedIn ? (
              /* ========== LOGGED-OUT STATE ========== */
              /* SSO is required - prompt user to sign in via SSO */
              <span style={{ 
                fontSize: '11px', 
                color: mutedColor
              }}>
                {isLoggingIn ? 'Signing in...' : 'Not signed in'}
              </span>
            ) : (
              /* ========== LOGGED-IN STATE ========== */
              /* Avatar/initials + visible Logout link + dropdown for more options */
              <>
                <div ref={dropdownRef} style={{ position: 'relative' }}>
                  {/* Account Button with Avatar/Picture */}
                  <button
                    onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                    disabled={isLoggingOut}
                    style={{
                      padding: '4px 10px 4px 4px',
                      background: showAccountDropdown 
                        ? (effectiveTheme === 'standard' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.12)')
                        : 'transparent',
                      border: effectiveTheme === 'standard' ? '1px solid rgba(15,23,42,0.15)' : '1px solid rgba(255,255,255,0.2)',
                      borderRadius: '6px',
                      color: textColor,
                      fontSize: '11px',
                      fontWeight: '400',
                      cursor: isLoggingOut ? 'wait' : 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      opacity: isLoggingOut ? 0.6 : 1
                    }}
                    onMouseEnter={(e) => {
                      if (!isLoggingOut) {
                        e.currentTarget.style.background = effectiveTheme === 'standard' ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.1)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!showAccountDropdown) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    {/* Avatar: Show picture if available, otherwise show initials */}
                    {userInfo.picture && !pictureError ? (
                      <img
                        src={userInfo.picture}
                        alt=""
                        onError={() => setPictureError(true)}
                        style={{
                          width: '22px',
                          height: '22px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: effectiveTheme === 'standard' 
                            ? '1px solid rgba(15,23,42,0.1)'
                            : '1px solid rgba(255,255,255,0.2)'
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '50%',
                        background: effectiveTheme === 'standard' 
                          ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
                          : 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
                        color: '#fff',
                        fontSize: '10px',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textTransform: 'uppercase'
                      }}>
                        {userInfo.initials || '?'}
                      </div>
                    )}
                    <span style={{ maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getAbbreviatedName(userInfo.displayName) || userInfo.email || 'Account'}
                    </span>
                    <ChevronDownIcon color={textColor} />
                  </button>

                  {/* Dropdown Menu */}
                  {showAccountDropdown && (
                    <div style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: '0',
                      minWidth: '170px',
                      background: effectiveTheme === 'standard' ? '#fff' : '#1e293b',
                      border: effectiveTheme === 'standard' ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(255,255,255,0.15)',
                      borderRadius: '8px',
                      boxShadow: effectiveTheme === 'standard' 
                        ? '0 4px 12px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.05)'
                        : '0 4px 12px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)',
                      padding: '4px',
                      zIndex: 1000
                    }}>
                      {/* User Info Header */}
                      <div style={{
                        padding: '8px 10px',
                        borderBottom: effectiveTheme === 'standard' ? '1px solid rgba(15,23,42,0.08)' : '1px solid rgba(255,255,255,0.1)',
                        marginBottom: '4px'
                      }}>
                        <div style={{ fontSize: '11px', fontWeight: '500', color: textColor }}>
                          {userInfo.displayName || 'User'}
                        </div>
                        {userInfo.email && (
                          <div style={{ fontSize: '10px', color: mutedColor, marginTop: '2px' }}>
                            {userInfo.email}
                          </div>
                        )}
                      </div>

                      {/* Profile / Account Settings Option */}
                      <button
                        onClick={() => {
                          setShowAccountDropdown(false);
                          window.open('https://auth.wrdesk.com/realms/wrdesk/account', '_blank');
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: '4px',
                          color: textColor,
                          fontSize: '11px',
                          fontWeight: '400',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          textAlign: 'left'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = effectiveTheme === 'standard' ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <UserIcon color={mutedColor} />
                        Profile
                      </button>

                      {/* Divider */}
                      <div style={{
                        height: '1px',
                        background: effectiveTheme === 'standard' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.1)',
                        margin: '4px 0'
                      }} />

                      {/* Logout Option */}
                      <button
                        onClick={handleLogout}
                        disabled={isLoggingOut}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: '4px',
                          color: '#ef4444',
                          fontSize: '11px',
                          fontWeight: '400',
                          cursor: isLoggingOut ? 'wait' : 'pointer',
                          transition: 'all 0.15s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          textAlign: 'left',
                          opacity: isLoggingOut ? 0.6 : 1
                        }}
                        onMouseEnter={(e) => {
                          if (!isLoggingOut) {
                            e.currentTarget.style.background = 'rgba(239,68,68,0.08)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <LogoutIcon color="#ef4444" />
                        {isLoggingOut ? 'Signing out...' : 'Sign out'}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div 
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{ 
              fontSize: '12px', 
              opacity: 0.5,
              transition: 'transform 0.2s ease',
              transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              cursor: 'pointer',
              padding: '4px',
              userSelect: 'none'
            }}
          >
            ▼
          </div>
        </div>

        {/* Expandable Landing Page Content */}
        {!isCollapsed && (
          <div style={{
            padding: '20px 16px 28px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {/* Text Size Controls */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '2px',
              marginBottom: '-8px'
            }}>
              {(['small', 'normal', 'large'] as TextSize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setTextSize(size)}
                  style={{
                    background: textSize === size 
                      ? (effectiveTheme === 'standard' ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.15)')
                      : 'transparent',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 6px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'center',
                    minWidth: size === 'small' ? '22px' : size === 'normal' ? '26px' : '30px'
                  }}
                  title={`${size.charAt(0).toUpperCase() + size.slice(1)} text`}
                >
                  <span style={{
                    fontSize: size === 'small' ? '10px' : size === 'normal' ? '13px' : '16px',
                    fontWeight: textSize === size ? '700' : '500',
                    color: textColor,
                    opacity: textSize === size ? 1 : 0.5,
                    fontFamily: 'system-ui, sans-serif',
                    letterSpacing: '-0.02em'
                  }}>
                    A
                  </span>
                </button>
              ))}
            </div>

            {/* Hero Section with Logo */}
            <div style={{ textAlign: 'center', marginBottom: '4px' }}>
              {/* Original WR Desk Logo */}
              <div style={{
                display: 'inline-block',
                marginBottom: '12px'
              }}>
                <img 
                  src={chrome.runtime.getURL('wrdesk-logo.png')}
                  alt="WR Desk Logo"
                  style={{
                    width: '256px',
                    height: 'auto',
                    maxWidth: '100%'
                  }}
                />
              </div>
              
              {/* Main Title */}
              <h1 style={{
                fontSize: scaledSize(17),
                fontWeight: '700',
                color: textColor,
                margin: '0 0 6px 0',
                lineHeight: '1.3',
                letterSpacing: '-0.02em'
              }}>
                Workflow-Ready Desk
              </h1>
              
              {/* Subtitle */}
              <h2 style={{
                fontSize: scaledSize(13),
                fontWeight: '500',
                color: textColor,
                margin: '0 0 10px 0',
                lineHeight: '1.4',
                letterSpacing: '-0.01em',
                opacity: 0.9
              }}>
                Transport-agnostic automation for communication, documents, and actions.
              </h2>
              <p style={{
                fontSize: scaledSize(11),
                color: mutedColor,
                margin: '0 0 6px 0',
                lineHeight: '1.5'
              }}>
                WR Desk enables automation across heterogeneous channels without relying on transport-layer trust.
              </p>
              <p style={{
                fontSize: scaledSize(11),
                color: mutedColor,
                margin: 0,
                lineHeight: '1.5'
              }}>
                Security, integrity, and policy enforcement are embedded at the protocol level, not delegated to infrastructure assumptions.
              </p>
            </div>

            {/* Divider */}
            <div style={{
              height: '1px',
              background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)`,
              margin: '0 20px'
            }} />

            {/* Core Capabilities Section */}
            <div>
              <div style={{
                fontSize: scaledSize(12),
                fontWeight: '600',
                color: textColor,
                marginBottom: '12px',
                opacity: 0.95
              }}>
                Core Capabilities
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: '8px'
              }}>
                {features.map((feature, idx) => (
                  <div 
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '8px 10px',
                      background: cardBg,
                      borderRadius: '6px',
                      border: `1px solid ${borderColor}`,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ 
                      fontSize: scaledSize(12), 
                      flexShrink: 0,
                      width: '18px',
                      textAlign: 'center',
                      filter: 'grayscale(1)',
                      opacity: 0.7
                    }}>
                      {feature.icon}
                    </span>
                    <span style={{ 
                      fontSize: scaledSize(11), 
                      color: textColor,
                      lineHeight: '1.4',
                      opacity: 0.85
                    }}>
                      {feature.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Representative Use Cases Section */}
            <div style={{ marginTop: '8px' }}>
              <div style={{
                fontSize: scaledSize(12),
                fontWeight: '600',
                color: textColor,
                marginBottom: '12px',
                opacity: 0.95
              }}>
                Representative Use Cases
              </div>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '6px'
              }}>
                {examples.map((example, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '6px 10px',
                      background: effectiveTheme === 'standard' ? 'rgba(99,102,241,0.08)' : 'rgba(167,139,250,0.15)',
                      border: `1px solid ${effectiveTheme === 'standard' ? 'rgba(99,102,241,0.2)' : 'rgba(167,139,250,0.25)'}`,
                      borderRadius: '4px',
                      fontSize: scaledSize(10),
                      color: textColor
                    }}
                  >
                    <span style={{ fontWeight: '600' }}>{example.label}</span>
                    <span style={{ opacity: 0.7 }}> → {example.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div style={{
              height: '1px',
              background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)`,
              margin: '0 20px'
            }} />

            {/* How It Works Section */}
            <div>
              <div style={{
                  padding: '14px 16px',
                  background: cardBg,
                  borderRadius: '6px',
                  border: `1px solid ${borderColor}`,
                  fontSize: scaledSize(11),
                  color: textColor,
                  lineHeight: '1.6',
                  opacity: 0.85,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{
                    fontSize: scaledSize(12),
                    fontWeight: '600',
                    opacity: 1,
                    marginBottom: '2px'
                  }}>
                    How It Works
                  </div>
                  <p style={{ margin: 0 }}>
                    Modern cybersecurity is undergoing a structural transition. Emails, messages, links, documents, and attachments have historically functioned as implicitly executable processing pathways across enterprise infrastructures and individual workstations alike.
                  </p>
                  <p style={{ margin: 0 }}>
                    As large-scale automation and AI-driven workflows become the default operational mode, these implicit execution paths are activated more frequently and with reduced human oversight. This expands the effective attack surface beyond what perimeter-based, endpoint-centric, or transport-layer security models can reliably control.
                  </p>
                  <div style={{ 
                    fontSize: scaledSize(12), 
                    fontWeight: '600', 
                    marginTop: '8px',
                    marginBottom: '4px',
                    opacity: 0.95
                  }}>
                    Execution Path Elimination by Design
                  </div>
                  <p style={{ margin: 0 }}>
                    Original artifacts are sealed, encrypted, and cryptographically inaccessible within protected environments. They are not opened, rendered, or executed in their original form.
                  </p>
                  <p style={{ margin: 0 }}>
                    Instead, incoming content is transformed into a deterministic, text-based semantic representation. This representation is the only surface exposed to automation logic, workflows, and AI agents.
                  </p>
                  <p style={{ margin: 0 }}>
                    Where reconstruction is required, it is performed through policy-bound, deterministic reconstruction processes that do not reintroduce executable interpretation, dynamic behavior, or uncontrolled side effects.
                  </p>
                  <p style={{ margin: 0 }}>
                    For regulatory, compliance, and audit purposes, original artifacts may be archived in sealed form and cryptographically linked to their reconstructed representations using deterministic proofs. The applicable encryption and access path is defined by the capsule policy, allowing integrity and provenance to be verified without reopening execution paths.
                  </p>
                </div>
                <div style={{
                  marginTop: '12px',
                  padding: '14px 16px',
                  background: effectiveTheme === 'standard' 
                    ? 'linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%)' 
                    : 'linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(51,65,85,0.9) 100%)',
                  borderRadius: '10px',
                  border: effectiveTheme === 'standard' 
                    ? '1px solid rgba(148,163,184,0.4)' 
                    : '1px solid rgba(100,116,139,0.5)',
                  boxShadow: effectiveTheme === 'standard'
                    ? '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)'
                    : '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                  lineHeight: '1.6'
                }}>
                  <div style={{ 
                    fontSize: scaledSize(13), 
                    fontWeight: '600', 
                    color: effectiveTheme === 'standard' ? '#0f172a' : '#f1f5f9',
                    letterSpacing: '-0.01em',
                    marginBottom: '10px',
                    lineHeight: '1.35'
                  }}>
                    BEAP - Bidirectional Email Automation Protocol
                  </div>
                  <div style={{ 
                    fontSize: scaledSize(11),
                    fontWeight: '500',
                    color: effectiveTheme === 'standard' ? '#475569' : '#94a3b8'
                  }}>
                    BEAP establishes a transport-agnostic automation protocol that enables workflows to remain deterministic, verifiable, and secure, even when operating across untrusted systems and execution environments.
                  </div>
                </div>
            </div>

            {/* BEAP Capsules & Streaming Section */}
            <div>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <div style={{
                  padding: '14px 16px',
                  background: cardBg,
                  borderRadius: '6px',
                  border: `1px solid ${borderColor}`,
                  fontSize: scaledSize(11),
                  color: textColor,
                  lineHeight: '1.6',
                  opacity: 0.85,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{
                    fontSize: scaledSize(12),
                    fontWeight: '600',
                    opacity: 1,
                    marginBottom: '2px'
                  }}>
                    BEAP Capsules
                  </div>
                  <p style={{ margin: 0 }}>
                    BEAP (Bidirectional Email Automation Protocol) defines a capsule-based communication and automation model in which intent, policy, integrity, and validity conditions are cryptographically bound.
                  </p>
                  <p style={{ margin: 0 }}>
                    Rather than exchanging messages, communication is modeled as policy-constrained state transitions. A capsule is valid only if its conditions are satisfied. Correct handling can be verified rather than assumed, without relying on message content inspection or application-level metadata.
                  </p>
                  <div style={{ 
                    fontSize: scaledSize(12), 
                    fontWeight: '600', 
                    marginTop: '8px',
                    marginBottom: '4px',
                    opacity: 0.95
                  }}>
                    Streaming and Real-Time Media
                  </div>
                  <p style={{ margin: 0 }}>
                    Video, voice, and real-time streaming content are handled under a dedicated model. The protocol does not encapsulate media streams themselves, but cryptographically governs how streams are established, secured, and terminated.
                  </p>
                  <p style={{ margin: 0 }}>
                    Such streams are permitted only within hardware-attested, enterprise-grade orchestrator environments enforcing a strict, deterministic, source-available architecture. This preserves real-time performance while eliminating avoidable application-level metadata and uncontrolled execution semantics.
                  </p>
                </div>
                <div style={{
                  padding: '14px 16px',
                  background: effectiveTheme === 'standard' 
                    ? 'linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%)' 
                    : 'linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(51,65,85,0.9) 100%)',
                  borderRadius: '10px',
                  border: effectiveTheme === 'standard' 
                    ? '1px solid rgba(148,163,184,0.4)' 
                    : '1px solid rgba(100,116,139,0.5)',
                  boxShadow: effectiveTheme === 'standard'
                    ? '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)'
                    : '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                  lineHeight: '1.6'
                }}>
                  <div style={{ 
                    fontSize: scaledSize(13), 
                    fontWeight: '600', 
                    color: effectiveTheme === 'standard' ? '#0f172a' : '#f1f5f9',
                    letterSpacing: '-0.01em',
                    marginBottom: '10px',
                    lineHeight: '1.35'
                  }}>
                    Post-Quantum–Ready, Channel-Independent Communication
                  </div>
                  <div style={{ 
                    fontSize: scaledSize(11),
                    fontWeight: '500',
                    color: effectiveTheme === 'standard' ? '#475569' : '#94a3b8'
                  }}>
                    BEAP represents an early class of post-quantum–ready automation protocols designed to remain transport-independent, channel-independent, and transferable across heterogeneous and untrusted delivery environments, including email, messaging systems, and file-based mechanisms.
                  </div>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div style={{
              height: '1px',
              background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)`,
              margin: '0 20px'
            }} />

            {/* Why BEAP Is Different Section */}
            <div>
              <div style={{
                padding: '14px 16px',
                background: cardBg,
                borderRadius: '6px',
                border: `1px solid ${borderColor}`,
                fontSize: scaledSize(11),
                color: textColor,
                lineHeight: '1.6',
                opacity: 0.85,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{
                  fontSize: scaledSize(12),
                  fontWeight: '600',
                  opacity: 1,
                  marginBottom: '2px'
                }}>
                  Why BEAP Is Different
                </div>
                <p style={{ margin: 0 }}>
                  Most communication systems focus on encrypting data in transit. What occurs after delivery — and whether policies are actually respected — remains largely unverifiable.
                </p>
                <p style={{ margin: 0 }}>
                  This approach embeds security, policy enforcement, and execution constraints directly at the protocol level. Trust assumptions are replaced by cryptographic verifiability.
                </p>
                <p style={{ margin: 0 }}>
                  The result is not merely encrypted communication, but a structurally verifiable automation and communication model, designed for environments in which implicit execution paths are no longer acceptable.
                </p>
              </div>
            </div>

            {/* Footer - Modern Gray Box */}
            <div style={{
              textAlign: 'left',
              padding: '14px 16px',
              background: effectiveTheme === 'standard' 
                ? 'linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%)' 
                : 'linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(51,65,85,0.9) 100%)',
              borderRadius: '12px',
              border: effectiveTheme === 'standard' 
                ? '1px solid rgba(148,163,184,0.4)' 
                : '1px solid rgba(100,116,139,0.5)',
              boxShadow: effectiveTheme === 'standard'
                ? '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)'
                : '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)'
            }}>
              <div style={{
                fontSize: scaledSize(13),
                fontWeight: '600',
                color: effectiveTheme === 'standard' ? '#0f172a' : '#f1f5f9',
                letterSpacing: '-0.01em',
                marginBottom: '10px',
                lineHeight: '1.35'
              }}>
                Enterprise-Grade Security by Design — for Enterprises and Individual Users
              </div>
              <p style={{
                fontSize: scaledSize(11),
                color: effectiveTheme === 'standard' ? '#475569' : '#94a3b8',
                margin: 0,
                lineHeight: '1.65'
              }}>
                As automation becomes pervasive, security can no longer be retrofitted; it must be embedded at the level where workflows, documents, and actions are defined. While WR Desk and BEAP are designed to meet enterprise-grade requirements, the same architecture enables equivalent security guarantees for individual users, independent of automation or business workflows.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

