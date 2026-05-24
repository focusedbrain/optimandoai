import type http from 'node:http';

import type { DiagnosticContainerRole, DiagnosticStage } from '@repo/beap-cert';

import { BeapPodError } from './beapPodError.js';
import {
  beginMessageProcessing,
  clearMessageProcessing,
  hasWatchdogFired,
  isMessageProcessingStuck,
  markWatchdogFired,
  type MessageProcessingContext,
} from './messageWatchdog.js';
import {
  buildAndWriteReport,
  type BuildAndWriteReportArgs,
  type ReportGeneratorDeps,
} from './reportGenerator.js';

export type ProcessExitFn = (code: number) => never;

export interface RoleDiagnosticRuntime {
  role: DiagnosticContainerRole;
  containerStartedAt: Date;
  deps?: ReportGeneratorDeps;
  exitProcess?: ProcessExitFn;
}

let activeWatchdogRole: DiagnosticContainerRole | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

export function getRoleContainerStartedAt(): Date {
  return roleContainerStartedAt;
}

const roleContainerStartedAt = new Date();

export function startRoleMessageWatchdog(runtime: RoleDiagnosticRuntime): void {
  if (watchdogTimer !== null) {
    return;
  }
  activeWatchdogRole = runtime.role;
  watchdogTimer = setInterval(() => {
    if (!activeWatchdogRole || hasWatchdogFired()) {
      return;
    }
    if (!isMessageProcessingStuck(activeWatchdogRole)) {
      return;
    }
    markWatchdogFired();
    void failRoleClosed({
      runtime,
      exception: new BeapPodError('StuckHealthProbeError'),
      stage: 'pod_internal',
      sourceFile: 'roleDiagnostic.ts',
      sourceLine: 48,
      messageContext: null,
    });
  }, 500);
  watchdogTimer.unref?.();
}

export function stopRoleMessageWatchdogForTests(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  activeWatchdogRole = null;
}

export function healthResponseForRole(
  runtime: RoleDiagnosticRuntime,
  version: string,
  extra: Record<string, unknown> = {},
): { statusCode: number; body: Record<string, unknown> } {
  const stuck = hasWatchdogFired() || isMessageProcessingStuck(runtime.role);
  if (stuck) {
    return {
      statusCode: 503,
      body: {
        status: 'stuck',
        role: runtime.role,
        version,
        stuck_health_probe: true,
        ...extra,
      },
    };
  }
  return {
    statusCode: 200,
    body: {
      status: 'ok',
      role: runtime.role,
      version,
      ...extra,
    },
  };
}

export async function failRoleClosed(
  args: {
    runtime: RoleDiagnosticRuntime;
    exception: unknown;
    stage: DiagnosticStage;
    sourceFile: string;
    sourceLine: number;
    messageContext?: MessageProcessingContext | null;
  },
): Promise<never> {
  const reportArgs: BuildAndWriteReportArgs = {
    role: args.runtime.role,
    exception: args.exception,
    stage: args.stage,
    sourceFile: args.sourceFile,
    sourceLine: args.sourceLine,
    messageContext: args.messageContext ?? null,
    containerStartedAt: args.runtime.containerStartedAt,
  };

  try {
    await buildAndWriteReport(reportArgs, args.runtime.deps);
  } catch {
    // Fail-closed: exit even when report write/signing fails.
  }

  const exitFn = args.runtime.exitProcess ?? process.exit.bind(process);
  exitFn(1);
  return undefined as never;
}

export function wrapRoleRequestListener(
  runtime: RoleDiagnosticRuntime,
  listener: http.RequestListener,
): http.RequestListener {
  return (req, res) => {
    try {
      void Promise.resolve(listener(req, res)).catch((exception: unknown) => {
        void failRoleClosed({
          runtime,
          exception,
          stage: 'pod_internal',
          sourceFile: 'roleDiagnostic.ts',
          sourceLine: 139,
        });
      });
    } catch (exception: unknown) {
      void failRoleClosed({
        runtime,
        exception,
        stage: 'pod_internal',
        sourceFile: 'roleDiagnostic.ts',
        sourceLine: 148,
      });
    }
  };
}

export function trackMessageProcessing(context: MessageProcessingContext): void {
  beginMessageProcessing(context);
}

export function untrackMessageProcessing(): void {
  clearMessageProcessing();
}

export function createRoleDiagnosticRuntime(
  role: DiagnosticContainerRole,
  options: {
    containerStartedAt?: Date;
    deps?: ReportGeneratorDeps;
    exitProcess?: ProcessExitFn;
    startWatchdog?: boolean;
  } = {},
): RoleDiagnosticRuntime {
  const runtime: RoleDiagnosticRuntime = {
    role,
    containerStartedAt: options.containerStartedAt ?? roleContainerStartedAt,
    deps: options.deps,
    exitProcess: options.exitProcess,
  };
  if (options.startWatchdog !== false) {
    startRoleMessageWatchdog(runtime);
  }
  return runtime;
}
