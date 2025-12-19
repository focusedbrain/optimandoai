import { useState } from 'react';

interface BackendSwitcherInlineProps {
  theme?: 'default' | 'dark' | 'professional';
}

export function BackendSwitcherInline({ theme = 'default' }: BackendSwitcherInlineProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  const textColor = theme === 'default' ? '#fff' : theme === 'dark' ? '#fff' : '#0f172a';
  const mutedColor = theme === 'professional' ? 'rgba(15,23,42,0.6)' : 'rgba(255,255,255,0.7)';
  const accentColor = theme === 'professional' ? '#6366f1' : '#a78bfa';
  const cardBg = theme === 'professional' ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.06)';
  const borderColor = theme === 'professional' ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.1)';

  const features = [
    { icon: '🔗', text: 'One automation layer across email, messaging, files, streams and systems' },
    { icon: '🛡️', text: 'BEAP capsules can be received even from compromised email or transport layers' },
    { icon: '🔐', text: 'Capsules carry their own security, integrity and policy enforcement' },
    { icon: '🚨', text: 'WRGuard protects enterprise inboxes and entry points by default' },
    { icon: '✓', text: 'Only sanitized, safe content is allowed to pass into the network' },
    { icon: '📦', text: 'Original artifacts remain sealed and inaccessible inside the network' },
    { icon: '🔓', text: 'Sensitive originals can be accessed only outside controlled environments' },
    { icon: '👁️', text: 'Documents are processed without exposure' },
    { icon: '🤖', text: 'AI agents operate on verified context, not assumptions' },
    { icon: '📋', text: 'Workflows remain verifiable, auditable and controlled across boundaries' },
    { icon: '⚛️', text: 'Post-quantum encryption is built into capsules by design' },
    { icon: '🏗️', text: 'Security and policy enforcement are native, not bolted on' },
  ];

  const examples = [
    { label: 'Invoices', desc: 'automated intake & approval' },
    { label: 'Contracts', desc: 'controlled review & routing' },
    { label: 'Support', desc: 'classification & workflow triggers' },
    { label: 'Incidents', desc: 'structured intake & response' },
    { label: 'Onboarding', desc: 'verification & follow-ups' },
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
            gap: '20px'
          }}>
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
                fontSize: '17px',
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
                fontSize: '13px',
                fontWeight: '500',
                color: textColor,
                margin: '0 0 10px 0',
                lineHeight: '1.4',
                letterSpacing: '-0.01em',
                opacity: 0.9
              }}>
                Transport-agnostic automation for enterprise communication, documents and actions.
              </h2>
              <p style={{
                fontSize: '11px',
                color: mutedColor,
                margin: 0,
                lineHeight: '1.5'
              }}>
                WR Code enables automation that works across any channel, without relying on transport security.
              </p>
            </div>

            {/* Divider */}
            <div style={{
              height: '1px',
              background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)`,
              margin: '0 20px'
            }} />

            {/* Features Grid */}
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
                    fontSize: '12px', 
                    flexShrink: 0,
                    width: '18px',
                    textAlign: 'center',
                    filter: 'grayscale(1)',
                    opacity: 0.7
                  }}>
                    {feature.icon}
                  </span>
                  <span style={{ 
                    fontSize: '11px', 
                    color: textColor,
                    lineHeight: '1.4',
                    opacity: 0.85
                  }}>
                    {feature.text}
                  </span>
                </div>
              ))}
            </div>

            {/* Examples Section */}
            <div style={{ marginTop: '8px' }}>
              <div style={{
                fontSize: '10px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: accentColor,
                marginBottom: '10px',
                opacity: 0.9
              }}>
                Examples
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
                      fontSize: '10px',
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
              margin: '12px 20px'
            }} />

            {/* How it works Section */}
            <div style={{ marginTop: '4px' }}>
              <div style={{
                fontSize: '12px',
                fontWeight: '600',
                color: textColor,
                marginBottom: '12px',
                opacity: 0.95
              }}>
                How it works
              </div>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                fontSize: '11px',
                color: textColor,
                lineHeight: '1.6',
                opacity: 0.85
              }}>
                <p style={{ margin: 0 }}>
                  Modern cybersecurity is undergoing a structural transition. Emails, messages, links, documents, and attachments have historically operated as implicitly executable processing pathways across both enterprise infrastructures and individual workstations, encompassing private as well as professional computing environments. With the rise of large-scale automation and AI-driven systems, these execution paths are activated more frequently and with less human oversight, significantly expanding the effective attack surface beyond what perimeter-based or transport-layer security models can reliably control.
                </p>
                <p style={{ margin: 0, padding: '12px 14px', background: cardBg, borderRadius: '6px', border: `1px solid ${borderColor}`, fontWeight: '500' }}>
                  WR Code establishes a transport-agnostic automation protocol that makes workflows verifiable, deterministic, and secure across untrusted systems and execution environments.
                </p>
                <p style={{ margin: 0 }}>
                  Original artifacts are sealed, encrypted, and cryptographically inaccessible inside the protected environment. They are not opened, rendered, or executed in their original form. Instead, incoming content is transformed into a deterministic, text-based semantic representation, which is the only surface exposed to automation, workflows, and AI agents.
                </p>
                <p style={{ margin: 0 }}>
                  Where reconstruction is required, it is performed through deterministic, policy-bound reconstruction processes that do not reintroduce executable interpretation, dynamic behavior, or uncontrolled side effects.
                </p>
                <p style={{ margin: 0 }}>
                  For regulatory and audit purposes, original artifacts may be archived in sealed form and cryptographically linked to their reconstructed representations using deterministic proofs. The applicable encryption and access path is determined by the capsule policy, allowing integrity and provenance to be verified without reopening execution paths.
                </p>
                <p style={{ margin: 0, padding: '12px 14px', background: cardBg, borderRadius: '6px', border: `1px solid ${borderColor}`, fontWeight: '500' }}>
                  BEAP represents one of the earliest examples of a post-quantum–ready, transport-agnostic enterprise communication and automation protocol, designed to be transport-agnostic and transferable across channels such as email, messaging systems, file transfer mechanisms.
                </p>
                <p style={{ margin: 0 }}>
                  Video, voice, and streaming content are handled under a separate model and only within hardware‑attested, enterprise‑grade orchestrator environments that enforce a strict, deterministic, source‑available architecture. At scale, enterprise automation increasingly depends on technical standards that eliminate implicit execution paths and enable deterministic cybersecurity across communication, automation, and AI-driven systems.
                </p>
              </div>
            </div>

            {/* Divider */}
            <div style={{
              height: '1px',
              background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)`,
              margin: '12px 20px'
            }} />

            {/* Why BEAP Is Different Section */}
            <div style={{ marginTop: '4px' }}>
              <div style={{
                fontSize: '12px',
                fontWeight: '600',
                color: textColor,
                marginBottom: '12px',
                opacity: 0.95
              }}>
                Why BEAP Is Different
              </div>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                fontSize: '11px',
                color: textColor,
                lineHeight: '1.6',
                opacity: 0.85
              }}>
                <p style={{ margin: 0 }}>
                  Most communication systems focus on encrypting messages in transit. What happens after delivery, and whether rules are actually respected, remains largely unverifiable.
                </p>
                <p style={{ margin: 0, padding: '12px 14px', background: cardBg, borderRadius: '6px', border: `1px solid ${borderColor}`, fontWeight: '500' }}>
                  BEAP takes a different approach.
                </p>
                <p style={{ margin: 0 }}>
                  Instead of exchanging messages, BEAP models communication as capsule-based, policy-bound state transitions. Each capsule cryptographically binds intent, policy, and validity conditions. If these conditions are not met, the capsule is invalid — correct handling can be verified, not just trusted, without access to message content or application-level communication metadata.
                </p>
                <p style={{ margin: 0 }}>
                  Real-time audio and video streams remain ephemeral by nature. BEAP does not encapsulate the media itself, but cryptographically governs how streams are established, secured, and terminated, eliminating avoidable application-level metadata while preserving real-time performance.
                </p>
                <p style={{ margin: 0, padding: '12px 14px', background: cardBg, borderRadius: '6px', border: `1px solid ${borderColor}`, fontWeight: '500' }}>
                  The result is not just encrypted communication, but a structurally verifiable communication model — designed for environments where trust assumptions are no longer sufficient.
                </p>
              </div>
            </div>

            {/* Footer tagline */}
            <div style={{
              textAlign: 'center',
              marginTop: '8px',
              padding: '12px 16px',
              background: `linear-gradient(135deg, ${theme === 'professional' ? 'rgba(99,102,241,0.06)' : 'rgba(167,139,250,0.12)'} 0%, ${theme === 'professional' ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.12)'} 100%)`,
              borderRadius: '8px',
              border: `1px solid ${theme === 'professional' ? 'rgba(99,102,241,0.12)' : 'rgba(167,139,250,0.2)'}`
            }}>
              <span style={{
                fontSize: '11px',
                fontWeight: '500',
                color: accentColor,
                letterSpacing: '0.02em'
              }}>
                Enterprise-grade security by design
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

