/**
 * Fixed periodic-scan intervals for custom modes (seconds). UI maps these to human labels.
 */

export const CUSTOM_MODE_INTERVAL_PRESET_SECONDS = [
  15, 30, 60, 300, 600, 900, 3600, 43200, 86400,
] as const

export type CustomModeIntervalPresetSeconds = (typeof CUSTOM_MODE_INTERVAL_PRESET_SECONDS)[number]

export const CUSTOM_MODE_INTERVAL_PRESET_OPTIONS: ReadonlyArray<{
  value: CustomModeIntervalPresetSeconds
  label: string
}> = [
  { value: 15, label: '15 sec' },
  { value: 30, label: '30 sec' },
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 900, label: '15 min' },
  { value: 3600, label: '1 h' },
  { value: 43200, label: '12 h' },
  { value: 86400, label: '24 h' },
]

const LABEL_BY_SECONDS = new Map<number, string>(
  CUSTOM_MODE_INTERVAL_PRESET_OPTIONS.map((o) => [o.value, o.label]),
)

export function formatCustomModeIntervalPresetLabel(seconds: number): string {
  return LABEL_BY_SECONDS.get(seconds) ?? `${seconds} sec`
}

export function isCustomModeIntervalPresetSeconds(n: number): boolean {
  return Number.isFinite(n) && (CUSTOM_MODE_INTERVAL_PRESET_SECONDS as readonly number[]).includes(n)
}

/** Map arbitrary positive seconds to the nearest allowed preset (for legacy migration). */
export function snapSecondsToIntervalPreset(sec: number): number | null {
  if (!Number.isFinite(sec) || sec <= 0) return null
  const x = Math.round(sec)
  const presets = CUSTOM_MODE_INTERVAL_PRESET_SECONDS as readonly number[]
  if (presets.includes(x)) return x
  let best = presets[0]
  let bestDist = Math.abs(best - x)
  for (const p of presets) {
    const d = Math.abs(p - x)
    if (d < bestDist) {
      best = p
      bestDist = d
    }
  }
  return best
}
