/**
 * Canonical guest port constants for Windows Home isolation appliance.
 * Keep in sync with build/guest/wrdesk-guest-ports.json and tree sources.
 */
export const WRDESK_COORDINATION_PORT = 51249;
export const WRDESK_P2P_INGEST_PORT = 51250;

export const WRDESK_GUEST_PORTS = {
  coordination: WRDESK_COORDINATION_PORT,
  p2pIngest: WRDESK_P2P_INGEST_PORT,
} as const;

export const UBUNTU_CLOUD_IMAGE_MANIFEST = {
  officialSourcePrefix: 'https://cloud-images.ubuntu.com/',
  filename: 'ubuntu-24.04-server-cloudimg-amd64.img',
} as const;

export type HypervisorKind = 'virtualbox' | 'vmware' | 'none';

/** Mirrors detect-hypervisor.ps1 resolution order (VirtualBox first, then VMware). */
export function resolveHypervisorFromPaths(paths: {
  vboxManage?: string | null;
  vmrun?: string | null;
}): HypervisorKind {
  if (paths.vboxManage) return 'virtualbox';
  if (paths.vmrun) return 'vmware';
  return 'none';
}

/** Idempotent provision: second run should converge, not fail. */
export function shouldCreateVm(existingVm: boolean): boolean {
  return !existingVm;
}

export function shouldReconvergePortForwards(existingVm: boolean): boolean {
  return existingVm;
}
