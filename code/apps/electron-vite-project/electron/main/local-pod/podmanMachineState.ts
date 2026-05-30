/**
 * Podman machine list probe — leaf module (no recovery / setup imports).
 */

export type PodmanMachineProbeState = 'not_applicable' | 'none' | 'stopped' | 'running'

export type PodmanMachineExecFileFn = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>

interface PodmanMachineRow {
  Running?: boolean
  running?: boolean
}

export async function probePodmanMachineStateWithBin(
  execFile: PodmanMachineExecFileFn,
  podmanBin: string | null,
): Promise<PodmanMachineProbeState> {
  if (!podmanBin) return 'none'
  try {
    const { stdout } = await execFile(podmanBin, ['machine', 'list', '--format', 'json'])
    const trimmed = stdout.trim()
    if (!trimmed || trimmed === '[]') return 'none'

    const parsed = JSON.parse(trimmed) as PodmanMachineRow[] | PodmanMachineRow
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    if (rows.length === 0) return 'none'
    if (rows.some((row) => row.Running === true || row.running === true)) return 'running'
    return 'stopped'
  } catch {
    return 'none'
  }
}
