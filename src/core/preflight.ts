import os from 'node:os';
import { buildAdmissionMaintenancePlan } from './maintenance.js';
import type { MaintenancePlan, MaintenancePosture } from './maintenance.js';
import { freshEvidence, probeStorage, STORAGE_SCOPES, storageState } from './storage.js';
import type { StorageEvidence, StorageState } from './storage.js';

export const WORKLOADS = [
  'interactive',
  'review-lite',
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
  storage: { state: StorageState; evidence?: StorageEvidence };
  probeEvidence?: MaintenancePlan['probeEvidence'];
  storageLimits: {
    noDependencyInstall: boolean;
    noWorktreeAdditions: boolean;
    noBuildFanout: boolean;
    noMediaModelRun: boolean;
    noUnattendedWork: boolean;
  };
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
    ramGated: boolean;
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
    strictMcpRecommended: boolean;
    diskGrowthPermitted: boolean;
    storageRecheckBeforeGrowth: boolean;
    storageCleanupRequired: boolean;
    escalationRequired: boolean;
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
  'review-lite': {
    reserveMB: 2_048,
    cpuCeilingPct: 85,
    maxTaskRuntimes: 12,
    maxParallelism: 1,
    timeoutMinutes: 45,
    requiresSds: false,
    cloudPreferred: true,
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

// Undefined means absent; NaN means explicitly supplied but invalid/missing.
export function readPreflightReserveMB(args: readonly string[]): number | undefined {
  let reserveMB: number | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg !== '--reserve-gb' && !arg.startsWith('--reserve-gb=')) continue;
    const raw = arg === '--reserve-gb' ? args[index + 1] : arg.slice('--reserve-gb='.length);
    if (raw === undefined || raw.trim() === '') return Number.NaN;
    const decimal = raw.trim();
    if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(decimal)) return Number.NaN;
    const parsedMB = Number(decimal) * 1_024;
    if (!Number.isFinite(parsedMB) || parsedMB < 0) return Number.NaN;
    if (parsedMB === 0 && /[1-9]/.test(decimal)) return Number.NaN;
    reserveMB = Math.max(reserveMB ?? 0, parsedMB);
  }
  return reserveMB;
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
  storage?: StorageEvidence,
): PreflightPlan {
  const profile = PROFILES[workload];
  const reserveValue = reserveMB ?? profile.reserveMB;
  const reserveIsValid = Number.isFinite(reserveValue) && reserveValue >= 0;
  // Round up so a positive fractional reserve cannot become the reading exemption.
  const requestedReserveMB = reserveIsValid ? Math.ceil(reserveValue) : Number.NaN;
  const requiresRamBudget = workload !== 'interactive' || !reserveIsValid || reserveValue > 0;
  const requiredFreeMB = requiresRamBudget ? requestedReserveMB + SAFETY_FLOOR_MB : 0;
  const projectedFreeMB = maintenance.metrics.ramFreeMB - requestedReserveMB;
  const hardBlocks: string[] = [];
  const constraints: string[] = [];
  const actions: string[] = [];

  const ramIsValid = Number.isFinite(maintenance.metrics.ramFreeMB) && maintenance.metrics.ramFreeMB >= 0;
  const readingOnly = workload === 'interactive' && reserveIsValid && reserveValue === 0;
  const diskGrowing = !['interactive', 'review-lite'].includes(workload);
  const readings = Array.isArray(storage?.readings) ? storage.readings : [];
  const states = readings.map(storageState);
  const storageIsValid = freshEvidence(storage?.sampledAt) && readings.length === 3 && STORAGE_SCOPES.every(scope => readings.filter(r => r?.scope === scope).length === 1) && !states.includes('unknown');
  const storagePosture: StorageState = !storageIsValid ? 'unknown' : states.includes('freeze') ? 'freeze' : states.includes('hold') ? 'hold' : states.includes('bounded') ? 'bounded' : 'normal';
  // A known freeze on any fresh volume wins even when another volume failed.
  const freeze = freshEvidence(storage?.sampledAt) && states.includes('freeze');
  const effectiveStoragePosture = freeze ? 'freeze' : storagePosture;
  if (freeze) {
    addUnique(hardBlocks, 'Storage FREEZE: a required volume has less than 4% available; only approved reclaim may proceed.');
    addUnique(actions, 'Escalate to the operator immediately and record the floor breach through the owning supervisor. Preflight does not delete data or send notifications.');
  } else if (!readingOnly && !storageIsValid) {
    addUnique(hardBlocks, 'Storage evidence is missing, invalid or stale; measure system, target and temporary volumes before admission.');
  } else if (storagePosture === 'hold' && diskGrowing) {
    addUnique(hardBlocks, 'Storage HOLD: a required volume has less than 8% available; no disk-growing workload may start.');
  } else if (storagePosture === 'bounded' && diskGrowing) {
    if (workload === 'build') {
      addUnique(constraints, 'Storage BOUNDED (8–15%): one coherent interactive build only, with post-run cleanup; no dependency installs, worktree adds, build fanout, media/model or unattended work.');
    } else {
      addUnique(hardBlocks, `Storage BOUNDED (8–15%): ${workload} disk growth is prohibited; use an existing cloud runner or reclaim approved space.`);
    }
  }
  if (!freeze && !readingOnly && ['interactive', 'review-lite'].includes(workload)) {
    addUnique(actions, 'This admission covers reading and a bounded review only. Select the actual build, browser, model, swarm or overnight workload before any disk-growing step.');
  }
  if (requiresRamBudget) {
    const evidence = maintenance.probeEvidence;
    if (!freshEvidence(evidence?.sampledAt) || evidence?.memory !== 'measured' || evidence?.disk !== 'measured' || evidence?.cpu !== 'measured' || evidence?.processes !== 'measured' || evidence?.crashes !== 'measured') {
      addUnique(hardBlocks, 'Memory, disk, CPU, process and crash evidence must be measured and fresh; failed, partial or unsupported probes cannot establish workload headroom.');
    }
    const m = maintenance.metrics;
    if (![m.ramUsedPct, m.cpuLoadPct, m.cpuSystemLoadPct].every(x => Number.isFinite(x) && x >= 0 && x <= 100)
      || ![m.codexTaskRuntimeCount, m.localModelCount, m.devServerCount, m.crashLoopCount].every(x => Number.isInteger(x) && x >= 0)
      || !Number.isFinite(m.mcpMemoryMB) || m.mcpMemoryMB < 0 || m.cpuSystemLoadPct > m.cpuLoadPct) {
      addUnique(hardBlocks, 'Machine metrics are invalid; unknown numeric evidence cannot establish workload headroom.');
    }
  }

  if (!reserveIsValid) {
    addUnique(hardBlocks, 'Workload reserve must be a finite, non-negative number of MB.');
  }
  if (requiresRamBudget && !ramIsValid) {
    addUnique(hardBlocks, 'RAM evidence must be a finite, non-negative number of MB; rerun the machine probe.');
  }
  if (reserveIsValid && requiresRamBudget && ramIsValid && maintenance.metrics.ramFreeMB < requiredFreeMB) {
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
  if (workload === 'review-lite') {
    addUnique(actions, 'Use a frozen diff plus strict empty MCP/tool configuration; the read-only checker must not inherit desktop MCP trees.');
  }
  if (workload === 'local-model' && reserveMB === undefined) {
    addUnique(constraints, 'The default 12GB model reserve is conservative; pass `--reserve-gb` using the model runtime documented peak for a precise decision.');
  }

  const decision: PreflightDecision = hardBlocks.length > 0 ? 'hold' : constraints.length > 0 ? 'bounded' : 'allow';
  const summary = decision === 'allow'
    ? requiresRamBudget
      ? `${workload} workload is admitted within the current machine budget.`
      : 'Ordinary zero-reserve interactive work is admitted; the RAM admission gate is not applied.'
    : decision === 'bounded'
      ? `${workload} workload may run once with the listed limits and cleanup requirements.`
      : `${workload} workload is held until the blocking conditions are resolved.`;

  return {
    storage: { state: effectiveStoragePosture, evidence: storage },
    probeEvidence: maintenance.probeEvidence,
    storageLimits: {
      noDependencyInstall: effectiveStoragePosture !== 'normal',
      noWorktreeAdditions: effectiveStoragePosture !== 'normal',
      noBuildFanout: effectiveStoragePosture !== 'normal',
      noMediaModelRun: effectiveStoragePosture !== 'normal',
      noUnattendedWork: effectiveStoragePosture !== 'normal',
    },
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
      ramGated: requiresRamBudget,
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
      receiptRequired: requiresRamBudget,
      stopAfterWork: requiresRamBudget,
      explicitModelReserveRecommended: workload === 'local-model',
      strictMcpRecommended: workload === 'review-lite',
      diskGrowthPermitted: diskGrowing && hardBlocks.length === 0,
      storageRecheckBeforeGrowth: diskGrowing,
      storageCleanupRequired: diskGrowing && storagePosture === 'bounded' && hardBlocks.length === 0,
      escalationRequired: freeze,
    },
    hardBlocks,
    constraints,
    actions,
  };
}

export function buildPreflightPlan(workload: WorkloadType, options: PreflightOptions = {}): PreflightPlan {
  const maintenance = buildAdmissionMaintenancePlan(options.cwd ?? process.cwd());
  const storage = probeStorage(options.cwd ?? process.cwd());
  return evaluatePreflight(maintenance, workload, options.reserveMB, storage);
}
