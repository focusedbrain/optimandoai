import type { DiagnosticContainerRole } from '@repo/beap-cert';

import { ROLE_MESSAGE_TIMEOUT_MS, STUCK_MESSAGE_GLOBAL_MAX_MS } from './diagnosticConstants.js';

export interface MessageProcessingContext {
  hash: string;
  size: number;
  envelopeFrom: string;
  envelopeTo: string;
  envelopeDate: string;
  envelopeSubject: string;
}

let currentMessage: MessageProcessingContext | null = null;
let processingStartedAtMs: number | null = null;
let watchdogFired = false;

export function beginMessageProcessing(context: MessageProcessingContext): void {
  currentMessage = context;
  processingStartedAtMs = Date.now();
  watchdogFired = false;
}

export function clearMessageProcessing(): void {
  currentMessage = null;
  processingStartedAtMs = null;
}

export function getMessageProcessingContext(): MessageProcessingContext | null {
  return currentMessage;
}

export function markWatchdogFired(): void {
  watchdogFired = true;
}

export function hasWatchdogFired(): boolean {
  return watchdogFired;
}

export function messageProcessingElapsedMs(nowMs = Date.now()): number | null {
  if (processingStartedAtMs === null) {
    return null;
  }
  return nowMs - processingStartedAtMs;
}

export function isMessageProcessingStuck(
  role: DiagnosticContainerRole,
  nowMs = Date.now(),
): boolean {
  const elapsed = messageProcessingElapsedMs(nowMs);
  if (elapsed === null) {
    return false;
  }
  const roleBudget = ROLE_MESSAGE_TIMEOUT_MS[role];
  return elapsed > roleBudget || elapsed > STUCK_MESSAGE_GLOBAL_MAX_MS;
}

export function resetMessageWatchdogStateForTests(): void {
  currentMessage = null;
  processingStartedAtMs = null;
  watchdogFired = false;
}
