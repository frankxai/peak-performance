import os from 'node:os';
import { buildMaintenancePlan } from './maintenance.js';
import type { MaintenancePlan, MaintenancePosture } from './maintenance.js';

export const WORKLOADS = [
  'interactive',
  'build',
  'browser-qa',
  'local-model',
  'swarm',
  'overnight',
] as const;

export type WorkloadType = typeof WORKLOADS[number];
export type PreflightDecision = 'allow' | 'bounded' | 'hold';

interface WorkloadProfile {
  reserveMB: number;
  cpuCeilingPct: number;
  maxTaskRuntimes: number;
  maxParallelism: number;
  timeoutMinutes: number;
  requiresSds: boolean;
  cloudPreferred: boolean;
  heavy: boolean;
  unattended: boolean;
}

export interface PreflightOptions {
  cwd?: string;
  reserveMB?: number;
}

export interface PreflightPlan {
  timestamp: string;
  hostname: string;
  workload: WorkloadType;
  decision: PreflightDecision;
  summary: string;
  posture: MaintenancePosture;
  swarmPosture: MaintenancePlan['swarmPosture'];
  current: {
    ramFreeMB: number;
    ramUsedPct: number;
    cpuLoadPct: number;
    cpuSystemLoadPct: number;
    codexTaskRuntimes: number;
    mcpMemoryMB: number;
    localModels: number;
    devServers: number;
    crashLoopApp: string;
    crashLoopCount: number;
  };
  budget: {
    workloadReserveMB: number;
    safetyFloorMB: number;
    requiredFreeMB: number;
    projectedFreeMB: number;
    cpuCeilingPct: number;
    maxTaskRuntimes: number;
    maxParallelism: number;
    timeoutMinutes: number;
  };
  requirements: {
    sdsRequired: boolean;
    cloudPreferred: boolean;
    receiptRequired: boolean;
    stopAfterWork: boolean;
    explicitModelReserveRecommended: boolean;
  };
  hardBlocks: string[];
  constraints: string[];
  actions: string[];
}

const SAFETY_FLOOR_MB = 4_096;

const PROFILES: Record<WorkloadType, WorkloadProfile> = {
  interactive: {
    reserveMB: 0,
    cpuCeilingPct: 90,
    maxTaskRuntimes: 16,
    maxParallelism: 1,
    timeoutMinutes: 0,
    requiresSds: false,
    cloudPreferred: false,
    heavy: false,
    unattended: false,
  },
  build: {
    reserveMB: 4_096,
    cpuCeilingPct: 80,
    maxTaskRuntimes: 12,
    maxParallelism: 1,
    timeoutMinutes: 45,
    requiresSds: false,
    cloudPreferred: false,
    heavy: true,
    unattended: false,
  },
  'browser-qa': {
    reserveMB: 4_096,
    cpuCeilingPct: 75,
    maxTaskRuntimes: 8,
    maxParallelism: 1,
    timeoutMinutes: 30,
    requiresSds: true,
    cloudPreferred: true,
    heavy: true,
    unattended: false,
  },
  'local-model': {
    reserveMB: 12_288,
    cpuCeilingPct: 65,
    maxTaskRuntimes: 4,
    maxParallelism: 1,
    timeoutMinutes: 120,
    requiresSds: false,
    cloudPreferred: false,
    heavy: true,
    unattended: false,
  },
  swarm: {
    reserveMB: 6_144,
    cpuCeilingPct: 70,
    maxTaskRuntimes: 8,
    maxParallelism: 2,
    timeoutMinutes: 90,
    requiresSds: false,
    cloudPreferred: false,
    heavy: true,
    unattended: false,
  },
  overnight: {
    reserveMB: 6_144,
    cpuCeilingPct: 60,
    maxTaskRuntimes: 6,
    maxParallelism: 1,
    timeoutMinutes: 480,
    requiresSds: false,
    cloudPreferred: true,
    heavy: true,
    unattended: true,
  },
};

export function isWorkloadType(value: string | undefined): value is WorkloadType {
  return WORKLOADS.includes(value as WorkloadType);
}

function postureRequiresHold(posture: MaintenancePosture, workload: WorkloadType): boolean {
  if (posture === 'restart-soon') return workload !== 'interactive';
  return posture === 'maintenance' && ['local-model', 'swarm', 'overnight'].includes(workload);
}

function addUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

export function evaluatePreflight(
  maintenance: MaintenancePlan,
  workload: WorkloadType,
  reserveMB?: number,
): PreflightPlan {
  const profile = PROFILES[workload];
  const requestedReserveMB = Math.max(0, Math.round(reserveMB ?? profile.reserveMB));
  const requiredFreeMB = requestedReserveMB + SAFETY_FLOOR_MB;
  const projectedFreeMB = maintenance.metrics.ramFreeMB - requestedReserveMB;
  const hardBlocks: string[] = [];
  const constraints: string[] = [];
  const actions: string[] = [];

  if (workload !== 'interactive' && maintenance.metrics.ramFreeMB < requiredFreeMB) {
    addUnique(hardBlocks, `RAM reserve is short: ${maintenance.metrics.ramFreeMB}MB free, ${requiredFreeMB}MB required.`);
    addUnique(actions, 'Archive inactive agent tasks and stop completed SDS-owned servers, then rerun preflight.');
  }

  if (postureRequiresHold(maintenance.posture, workload)) {
    addUnique(hardBlocks, `PP posture is ${maintenance.posture}; ${workload} work must wait for pressure to drain.`);
  } else if (workload !== 'interactive' && (maintenance.posture === 'constrain' || maintenance.posture === 'maintenance')) {
    addUnique(constraints, `PP posture is ${maintenance.posture}; run one bounded workload with no new parallel agents.`);
  }

  if (maintenance.metrics.cpuLoadPct > profile.cpuCeilingPct) {
    const reason = `CPU is ${maintenance.metrics.cpuLoadPct}%, above the ${profile.cpuCeilingPct}% ${workload} ceiling.`;
    if (profile.unattended || workload === 'local-model' || maintenance.metrics.cpuLoadPct >= 95) addUnique(hardBlocks, reason);
    else addUnique(constraints, reason);
    addUnique(actions, 'Wait for active CPU work to finish and identify sustained kernel/I/O pressure before retrying.');
  }

  if (maintenance.metrics.crashLoopCount >= 10) {
    const reason = `${maintenance.metrics.crashLoopApp} is crash-looping (${maintenance.metrics.crashLoopCount} recent crashes).`;
    if (['local-model', 'swarm', 'overnight'].includes(workload)) addUnique(hardBlocks, reason);
    else if (profile.heavy) addUnique(constraints, reason);
    addUnique(actions, 'Contain or repair the owning crash-loop source; do not kill Defender or Windows Error Reporting.');
  }

  if (maintenance.metrics.codexTaskRuntimeCount > profile.maxTaskRuntimes) {
    const reason = `${maintenance.metrics.codexTaskRuntimeCount} Codex task runtimes exceed the ${workload} budget of ${profile.maxTaskRuntimes}.`;
    if (workload === 'local-model' || workload === 'overnight') addUnique(hardBlocks, reason);
    else addUnique(constraints, reason);
    addUnique(actions, 'Archive inactive Codex tasks through the UI so their complete MCP trees exit coherently.');
  }

  if (maintenance.metrics.mcpMemoryMB > 4_096 && profile.heavy) {
    addUnique(constraints, `MCP trees already use ${maintenance.metrics.mcpMemoryMB}MB; preserve ownership and reduce them through task closure.`);
  }

  if (maintenance.metrics.localModelCount > 0 && workload === 'local-model') {
    addUnique(hardBlocks, 'A local model runtime is already active; do not start a second model workload without an explicit capacity plan.');
  }

  if (maintenance.metrics.devServerCount > 0) {
    if (workload === 'local-model' || workload === 'overnight') {
      addUnique(constraints, `${maintenance.metrics.devServerCount} dev-server processes are active; stop completed servers before this workload.`);
    } else if (workload === 'browser-qa') {
      addUnique(constraints, `${maintenance.metrics.devServerCount} dev-server processes are active; reuse or adopt through SDS instead of starting another.`);
    }
  }

  if (profile.requiresSds) addUnique(actions, 'Run `sds status -IncludeUnmanaged` first and use an SDS TTL for any required localhost server.');
  if (profile.cloudPreferred) addUnique(actions, 'Prefer a Vercel preview or cloud runner when the verification must outlive this local loop.');
  if (profile.timeoutMinutes > 0) addUnique(actions, `Apply a ${profile.timeoutMinutes}-minute workload timeout and stop child processes at completion.`);
  if (workload === 'local-model' && reserveMB === undefined) {
    addUnique(constraints, 'The default 12GB model reserve is conservative; pass `--reserve-gb` using the model runtime documented peak for a precise decision.');
  }

  const decision: PreflightDecision = hardBlocks.length > 0 ? 'hold' : constraints.length > 0 ? 'bounded' : 'allow';
  const summary = decision === 'allow'
    ? `${workload} workload is admitted within the current machine budget.`
    : decision === 'bounded'
      ? `${workload} workload may run once with the listed limits and cleanup requirements.`
      : `${workload} workload is held until the blocking conditions are resolved.`;

  return {
    timestamp: new Date().toISOString(),
    hostname: maintenance.hostname || os.hostname(),
    workload,
    decision,
    summary,
    posture: maintenance.posture,
    swarmPosture: maintenance.swarmPosture,
    current: {
      ramFreeMB: maintenance.metrics.ramFreeMB,
      ramUsedPct: maintenance.metrics.ramUsedPct,
      cpuLoadPct: maintenance.metrics.cpuLoadPct,
      cpuSystemLoadPct: maintenance.metrics.cpuSystemLoadPct,
      codexTaskRuntimes: maintenance.metrics.codexTaskRuntimeCount,
      mcpMemoryMB: maintenance.metrics.mcpMemoryMB,
      localModels: maintenance.metrics.localModelCount,
      devServers: maintenance.metrics.devServerCount,
      crashLoopApp: maintenance.metrics.crashLoopApp,
      crashLoopCount: maintenance.metrics.crashLoopCount,
    },
    budget: {
      workloadReserveMB: requestedReserveMB,
      safetyFloorMB: SAFETY_FLOOR_MB,
      requiredFreeMB,
      projectedFreeMB,
      cpuCeilingPct: profile.cpuCeilingPct,
      maxTaskRuntimes: profile.maxTaskRuntimes,
      maxParallelism: profile.maxParallelism,
      timeoutMinutes: profile.timeoutMinutes,
    },
    requirements: {
      sdsRequired: profile.requiresSds,
      cloudPreferred: profile.cloudPreferred,
      receiptRequired: workload !== 'interactive',
      stopAfterWork: workload !== 'interactive',
      explicitModelReserveRecommended: workload === 'local-model',
    },
    hardBlocks,
    constraints,
    actions,
  };
}

export function buildPreflightPlan(workload: WorkloadType, options: PreflightOptions = {}): PreflightPlan {
  const maintenance = buildMaintenancePlan(options.cwd ?? process.cwd());
  return evaluatePreflight(maintenance, workload, options.reserveMB);
}
