import type { DiagnosticExceptionKind } from '@repo/beap-cert';

/** Typed internal error — classifier reads `.kind` only, never `.message`. */
export class BeapPodError extends Error {
  readonly kind: DiagnosticExceptionKind;

  constructor(kind: DiagnosticExceptionKind) {
    super(kind);
    this.name = 'BeapPodError';
    this.kind = kind;
  }
}
