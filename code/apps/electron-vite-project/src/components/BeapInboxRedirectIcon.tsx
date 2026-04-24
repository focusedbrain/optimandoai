/**
 * Forward/redirect (BEAP to another recipient). Icon-only; label from parent `aria-label` / `title`.
 */
export function BeapInboxRedirectIcon() {
  return (
    <svg
      className="beap-redirect-icon-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h10.5a3.5 3.5 0 0 0 3.5-3.5V5" />
      <path d="M16 3l3 3-3 3" />
    </svg>
  )
}
