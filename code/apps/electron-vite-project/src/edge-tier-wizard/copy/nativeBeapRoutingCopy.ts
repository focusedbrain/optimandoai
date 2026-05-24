/**
 * Native BEAP routing copy — wizard verify step and dashboard settings.
 */

export type NativeBeapRoutingOption = 'require_edge' | 'direct'

export const NATIVE_BEAP_ROUTING_COPY: Record<
  NativeBeapRoutingOption,
  { readonly label: string; readonly description: string }
> = {
  direct: {
    label: 'Allow direct native BEAP',
    description:
      'P2P native BEAP capsules are validated locally without routing through the Edge Ingestor. Email and other edge-required routes still use the VPS.',
  },
  require_edge: {
    label: 'Require Edge Ingestor for native BEAP',
    description:
      'P2P native BEAP capsules must be depackaged and validated on the Edge Ingestor first. The local app accepts only capsules accompanied by a valid Edge certificate.',
  },
} as const
