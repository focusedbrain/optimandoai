/**
 * Static lists for the custom mode wizard (providers, icons, session/run presets).
 */

import type { CustomRunMode, SessionMode } from '../../../shared/ui/customModeTypes'

export const WIZARD_MODE_ICONS = ['⚡', '🎯', '✨', '🔧', '📌', '🧠', '💡', '🛠️'] as const

export const WIZARD_MODEL_PROVIDERS: { value: string; label: string }[] = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'azure', label: 'Azure OpenAI' },
]

export const WIZARD_SESSION_MODES: { value: SessionMode; label: string; hint: string }[] = [
  { value: 'shared', label: 'Shared', hint: 'Use the default chat session' },
  { value: 'dedicated', label: 'Dedicated', hint: 'Isolated thread for this mode' },
  { value: 'fresh', label: 'Fresh', hint: 'Start a new session when selected' },
]

export const WIZARD_RUN_MODES: { value: CustomRunMode; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'chat_scan', label: 'Chat + scan' },
  { value: 'interval', label: 'Interval' },
]

export const SESSION_MODE_VALUES = WIZARD_SESSION_MODES.map((x) => x.value)
export const RUN_MODE_VALUES = WIZARD_RUN_MODES.map((x) => x.value)
