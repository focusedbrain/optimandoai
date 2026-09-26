/**
 * Optirando branding mark — thin wrapper over official raster assets.
 * - wordmarkSm: compact horizontal logo for app chrome / header
 * - wordmark: larger horizontal logo when space allows
 * - symbol: swirl only for tray-sized / compact marks
 */

type BrandLogoVariant = 'wordmark' | 'wordmarkSm' | 'symbol'

export type BrandLogoProps = {
  variant?: BrandLogoVariant
  /** Width in CSS pixels (height follows via object-fit). */
  size?: number
  className?: string
  decorative?: boolean
  alt?: string
}

/** Intrinsic aspect ratios (width / height) of the official PNG assets. */
const ASPECT: Record<BrandLogoVariant, number> = {
  wordmarkSm: 200 / 41,
  wordmark: 1024 / 211,
  symbol: 1,
}

function resolveSrc(variant: BrandLogoVariant): string {
  const base = import.meta.env.BASE_URL || './'
  if (variant === 'wordmarkSm') {
    return `${base}optirando-wordmark-sm.png`
  }
  if (variant === 'wordmark') {
    return `${base}optirando-wordmark.png`
  }
  // Prefer dedicated symbol; legacy wrdesk-logo.png is the same Optirando mark.
  return `${base}optirando-symbol.png`
}

/**
 * @example
 * <BrandLogo variant="wordmarkSm" size={150} />
 * <BrandLogo variant="wordmark" size={220} />
 * <BrandLogo variant="symbol" size={28} />
 */
export function BrandLogo({
  variant = 'wordmarkSm',
  size = 160,
  className,
  decorative = false,
  alt = 'Optirando',
}: BrandLogoProps) {
  const height = Math.round(size / ASPECT[variant])
  return (
    <img
      src={resolveSrc(variant)}
      alt={decorative ? '' : alt}
      aria-hidden={decorative ? true : undefined}
      className={className}
      style={{
        width: size,
        height,
        objectFit: 'contain',
        display: 'block',
      }}
    />
  )
}
