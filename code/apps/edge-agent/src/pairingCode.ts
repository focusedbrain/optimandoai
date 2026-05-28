import { randomInt } from 'node:crypto'

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000

export function generatePairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function formatPairingCodeDisplay(code: string): string {
  const digits = code.replace(/\D/g, '').padStart(6, '0').slice(-6)
  return `${digits.slice(0, 3)}-${digits.slice(3)}`
}

export function normalizePairingCodeInput(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (digits.length !== 6) return null
  return digits
}
