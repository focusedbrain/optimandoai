/**
 * Dev / support logs for model selector composition (orchestrator + WR Chat). No prompt text.
 */
export function logModelSelectorTargets(args: {
  localCount: number
  hostInternalCount: number
  finalCount: number
  selectedTarget: string
  surface: 'orchestrator' | 'wr_chat'
}): void {
  const { localCount, hostInternalCount, finalCount, selectedTarget, surface } = args
  const prefix = '[MODEL_SELECTOR_TARGETS]'
  console.log(prefix, 'local_count', localCount, surface)
  console.log(prefix, 'host_internal_count', hostInternalCount, surface)
  console.log(prefix, 'final_count', finalCount, surface)
  console.log(prefix, 'selected_target', selectedTarget || '(none)', surface)
}
