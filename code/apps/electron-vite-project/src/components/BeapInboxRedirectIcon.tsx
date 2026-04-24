/**
 * Forward/redirect (BEAP to another recipient). Bold “forward” chevron; size from `.beap-action-icon svg`.
 */
export function BeapInboxRedirectIcon() {
  return (
    <svg
      className="beap-redirect-icon-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 12h12" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}
