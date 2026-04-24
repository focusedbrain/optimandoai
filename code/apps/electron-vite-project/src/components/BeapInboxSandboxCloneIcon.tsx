/**
 * Visual for Host → Sandbox clone: three rays from a branch point (3-arrow / route metaphor).
 * Icon-only; label comes from `aria-label` / `title` on the parent control.
 */
export function BeapInboxSandboxCloneIcon() {
  return (
    <svg
      className="beap-sandbox-clone-icon-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 21V15" />
      <path d="M12 15L5.5 4.5" />
      <path d="M12 15L12 2.5" />
      <path d="M12 15L18.5 4.5" />
    </svg>
  )
}
