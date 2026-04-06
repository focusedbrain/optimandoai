/**
 * Static lists for the custom mode wizard (providers, icons, session presets).
 */

export const WIZARD_MODE_ICONS = ['⚡', '🎯', '✨', '🔧', '📌', '🧠', '💡', '🛠️'] as const

export const WIZARD_MODEL_PROVIDERS: { value: string; label: string }[] = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'azure', label: 'Azure OpenAI' },
]
