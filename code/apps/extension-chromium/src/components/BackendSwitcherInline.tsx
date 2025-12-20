import { useState } from 'react';

interface BackendSwitcherInlineProps {
  theme?: 'default' | 'dark' | 'professional';
}

type TextSize = 'small' | 'normal' | 'large';

const TEXT_SCALES: Record<TextSize, number> = {
  small: 0.9,
  normal: 1,
  large: 1.3
};

export function BackendSwitcherInline({ theme = 'default' }: BackendSwitcherInlineProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [textSize, setTextSize] = useState<TextSize>('small');

  // Helper to scale font sizes
  const scaledSize = (baseSize: number) => `${Math.round(baseSize * TEXT_SCALES[textSize])}px`;

  const textColor = theme === 'default' ? '#fff' : theme === 'dark' ? '#fff' : '#0f172a';
  const mutedColor = theme === 'professional' ? 'rgba(15,23,42,0.6)' : 'rgba(255,255,255,0.7)';
  const accentColor = theme === 'professional' ? '#6366f1' : '#a78bfa';
  const cardBg = theme === 'professional' ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.06)';
  const borderColor = theme === 'professional' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.1)';

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
        borderBottom: theme === 'professional' ? '1px solid rgba(15,23,42,0.1)' : '1px solid rgba(255,255,255,0.15)',
        background: theme === 'professional' ? 'rgba(248,250,252,0.8)' : theme === 'dark' ? 'rgba(15,23,42,0.6)' : 'rgba(118,75,162,0.4)'
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
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: theme === 'professional' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.25)',
                borderRadius: '4px',
                color: textColor,
                fontSize: '11px',
                fontWeight: '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                opacity: 0.8
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme === 'professional' ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.opacity = '0.8';
              }}
            >
              Log in
            </button>
            <button
              style={{
                padding: '4px 10px',
                background: 'transparent',
                border: theme === 'professional' ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.25)',
                borderRadius: '4px',
                color: textColor,
                fontSize: '11px',
                fontWeight: '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                opacity: 0.8
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme === 'professional' ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)';
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.opacity = '0.8';
              }}
            >
              Create account
            </button>
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
                      ? (theme === 'professional' ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.15)')
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
              {/* Logo Box */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '56px',
                height: '56px',
                background: theme === 'professional' ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${theme === 'professional' ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: '12px',
                marginBottom: '12px'
              }}>
                <svg width="36" height="40" viewBox="0 0 36 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Shield shape */}
                  <path 
                    d="M18 2L4 8V18C4 27.5 10 34.5 18 38C26 34.5 32 27.5 32 18V8L18 2Z" 
                    stroke={textColor}
                    strokeWidth="2"
                    fill="none"
                  />
                  {/* WR text */}
                  <text x="18" y="18" textAnchor="middle" fontSize="10" fontWeight="700" fill={textColor} fontFamily="system-ui, sans-serif">WR</text>
                  {/* CODE text */}
                  <text x="18" y="27" textAnchor="middle" fontSize="7" fontWeight="600" fill={textColor} fontFamily="system-ui, sans-serif">CODE</text>
                  {/* Lock icon */}
                  <circle cx="18" cy="33" r="3" stroke={textColor} strokeWidth="1" fill="none"/>
                  <rect x="16" y="31" width="4" height="3" fill={textColor} rx="0.5"/>
                  {/* Checkmark */}
                  <circle cx="26" cy="8" r="4" fill={theme === 'professional' ? '#22c55e' : '#4ade80'}/>
                  <path d="M24 8L25.5 9.5L28 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
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
                Workflow-Ready Code
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
                WR Code enables automation across heterogeneous channels without relying on transport-layer trust.
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
                      background: theme === 'professional' ? 'rgba(99,102,241,0.08)' : 'rgba(167,139,250,0.15)',
                      border: `1px solid ${theme === 'professional' ? 'rgba(99,102,241,0.2)' : 'rgba(167,139,250,0.25)'}`,
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
                  background: theme === 'professional' 
                    ? 'linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%)' 
                    : 'linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(51,65,85,0.9) 100%)',
                  borderRadius: '10px',
                  border: theme === 'professional' 
                    ? '1px solid rgba(148,163,184,0.4)' 
                    : '1px solid rgba(100,116,139,0.5)',
                  boxShadow: theme === 'professional'
                    ? '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)'
                    : '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                  lineHeight: '1.6'
                }}>
                  <div style={{ 
                    fontSize: scaledSize(13), 
                    fontWeight: '600', 
                    color: theme === 'professional' ? '#0f172a' : '#f1f5f9',
                    letterSpacing: '-0.01em',
                    marginBottom: '10px',
                    lineHeight: '1.35'
                  }}>
                    BEAP - Bidirectional Email Automation Protocol
                  </div>
                  <div style={{ 
                    fontSize: scaledSize(11),
                    fontWeight: '500',
                    color: theme === 'professional' ? '#475569' : '#94a3b8'
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
                  background: theme === 'professional' 
                    ? 'linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%)' 
                    : 'linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(51,65,85,0.9) 100%)',
                  borderRadius: '10px',
                  border: theme === 'professional' 
                    ? '1px solid rgba(148,163,184,0.4)' 
                    : '1px solid rgba(100,116,139,0.5)',
                  boxShadow: theme === 'professional'
                    ? '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)'
                    : '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                  lineHeight: '1.6'
                }}>
                  <div style={{ 
                    fontSize: scaledSize(13), 
                    fontWeight: '600', 
                    color: theme === 'professional' ? '#0f172a' : '#f1f5f9',
                    letterSpacing: '-0.01em',
                    marginBottom: '10px',
                    lineHeight: '1.35'
                  }}>
                    Post-Quantum–Ready, Channel-Independent Communication
                  </div>
                  <div style={{ 
                    fontSize: scaledSize(11),
                    fontWeight: '500',
                    color: theme === 'professional' ? '#475569' : '#94a3b8'
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
              background: theme === 'professional' 
                ? 'linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%)' 
                : 'linear-gradient(145deg, rgba(30,41,59,0.95) 0%, rgba(51,65,85,0.9) 100%)',
              borderRadius: '12px',
              border: theme === 'professional' 
                ? '1px solid rgba(148,163,184,0.4)' 
                : '1px solid rgba(100,116,139,0.5)',
              boxShadow: theme === 'professional'
                ? '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)'
                : '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)'
            }}>
              <div style={{
                fontSize: scaledSize(13),
                fontWeight: '600',
                color: theme === 'professional' ? '#0f172a' : '#f1f5f9',
                letterSpacing: '-0.01em',
                marginBottom: '10px',
                lineHeight: '1.35'
              }}>
                Enterprise-Grade Security by Design — for Enterprises and Individual Users
              </div>
              <p style={{
                fontSize: scaledSize(11),
                color: theme === 'professional' ? '#475569' : '#94a3b8',
                margin: 0,
                lineHeight: '1.65'
              }}>
                As automation becomes pervasive, security can no longer be retrofitted; it must be embedded at the level where workflows, documents, and actions are defined. While WR Code and BEAP are designed to meet enterprise-grade requirements, the same architecture enables equivalent security guarantees for individual users, independent of automation or business workflows.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

