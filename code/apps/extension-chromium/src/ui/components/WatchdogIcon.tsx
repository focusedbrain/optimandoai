import React from 'react'

/** Service dog — use when the SVG cannot render (plain text, notifications). */
export const WATCHDOG_EMOJI = '🐕‍🦺'

export interface WatchdogIconProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

/**
 * Minimal friendly Rottweiler face — black & tan, readable at ~16–20px.
 */
export default function WatchdogIcon({ size = 18, className, style }: WatchdogIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden
    >
      {/* Head */}
      <circle cx="12" cy="13" r="9" fill="#1a1a1a" />
      {/* Floppy ears */}
      <ellipse cx="4.2" cy="9" rx="2.4" ry="3.6" fill="#1a1a1a" transform="rotate(-28 4.2 9)" />
      <ellipse cx="19.8" cy="9" rx="2.4" ry="3.6" fill="#1a1a1a" transform="rotate(28 19.8 9)" />
      {/* Tan markings — brows */}
      <ellipse cx="8.8" cy="8.2" rx="3" ry="1.3" fill="#c4813d" />
      <ellipse cx="15.2" cy="8.2" rx="3" ry="1.3" fill="#c4813d" />
      {/* Tan cheeks */}
      <ellipse cx="6.8" cy="14.2" rx="2.2" ry="2.8" fill="#c4813d" />
      <ellipse cx="17.2" cy="14.2" rx="2.2" ry="2.8" fill="#c4813d" />
      {/* Eyes */}
      <circle cx="9" cy="11" r="1.25" fill="#f5f5f5" />
      <circle cx="15" cy="11" r="1.25" fill="#f5f5f5" />
      <circle cx="9" cy="11" r="0.55" fill="#1a1a1a" />
      <circle cx="15" cy="11" r="0.55" fill="#1a1a1a" />
      {/* Nose */}
      <ellipse cx="12" cy="14.3" rx="1.35" ry="1.05" fill="#0d0d0d" />
      {/* Tongue */}
      <ellipse cx="12" cy="16.2" rx="1.4" ry="0.95" fill="#e07a72" />
    </svg>
  )
}
