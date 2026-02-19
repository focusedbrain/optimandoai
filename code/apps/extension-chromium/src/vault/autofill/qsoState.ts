// ============================================================================
// WRVault Autofill — QSO State Machine
// ============================================================================
//
// Defines the 4-state matrix for QSO (Quick Sign-On) behavior:
//
//   MatchStatus × AutoMode → UiState
//
//   State A: NO_MATCH  + AUTO_OFF → Grey icon, popover fills via preview
//   State B: NO_MATCH  + AUTO_ON  → Grey icon, popover fills + guarded submit
//   State C: MATCH     + AUTO_OFF → Green icon, popover fills via preview
//   State D: MATCH     + AUTO_ON  → Green icon + QSO button, guarded submit
//
// ============================================================================

// ============================================================================
// §1  Enums
// ============================================================================

export const QsoMatchStatus = {
  NO_MATCH: 'NO_MATCH',
  MATCH_FOUND: 'MATCH_FOUND',
} as const
export type QsoMatchStatus = (typeof QsoMatchStatus)[keyof typeof QsoMatchStatus]

export const QsoAutoMode = {
  AUTO_OFF: 'AUTO_OFF',
  AUTO_ON: 'AUTO_ON',
} as const
export type QsoAutoMode = (typeof QsoAutoMode)[keyof typeof QsoAutoMode]

/**
 * Visual UI state derived from the match × auto mode matrix.
 *
 *   GREY_ICON       – no match; icon opens search popover
 *   GREEN_ICON      – match found, manual mode; icon opens popover, fill via preview
 *   GREEN_ICON_QSO  – match found, auto mode; QSO button visible for 1-click fill+submit
 */
export const QsoUiState = {
  GREY_ICON: 'GREY_ICON',
  GREEN_ICON: 'GREEN_ICON',
  GREEN_ICON_QSO: 'GREEN_ICON_QSO',
} as const
export type QsoUiState = (typeof QsoUiState)[keyof typeof QsoUiState]

// ============================================================================
// §2  State Resolution
// ============================================================================

/**
 * Pure function: resolve the UI state from match status and auto mode.
 */
export function resolveQsoUiState(
  hasMatch: boolean,
  autoConsented: boolean,
): QsoUiState {
  if (!hasMatch) {
    return QsoUiState.GREY_ICON
  }
  return autoConsented ? QsoUiState.GREEN_ICON_QSO : QsoUiState.GREEN_ICON
}

/**
 * Whether the QSO button should be visible for the given UI state.
 * True only for State D (MATCH + AUTO_ON).
 */
export function shouldShowQsoButton(state: QsoUiState): boolean {
  return state === QsoUiState.GREEN_ICON_QSO
}

/**
 * Whether auto-submit should be attempted for the given UI state.
 * True only when auto mode is on (States B and D).
 *
 * Note: even when this returns true, security guards may still block
 * the actual submit. Callers must use `safeSubmitAfterFill` and
 * degrade to fill-only if guards fail.
 */
export function shouldAutoSubmit(
  hasMatch: boolean,
  autoConsented: boolean,
): boolean {
  return autoConsented
}
