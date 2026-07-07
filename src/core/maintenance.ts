import os from 'node:os';
import type { AuditResult } from '../types.js';
import { runAudit } from './audit.js';
import { probeDisk, probeMemory, probeProcesses, probeUptime } from './probes.js';
import type { ProcessInfo, ProcessRole } from './probes.js';

export type MaintenancePosture = 'green' | 'watch' | 'constrain' | 'maintenance' | 'restart-soon';
export type SwarmPosture = 'expand' | 'steady' | 'pause-new-swarms' | 'drain-and-handoff';
export type ActionPermission = 'observe' | 'safe-auto' | 'supervisor' | 'confirm' | 'handoff';

export interface MaintenanceAction {
  id: string;
  priority: 'now' | 'next' | 'watch';
  permission: ActionPermission;
  owner: 'PP' | 'SDS' | 'Starlight Queen' | 'JarvisOps' | 'Human';
  command?: string;
  reason: string;
  expectedImpact: string;
  risk: 'low' | 'medium' | 'high';
  requiresReceipt: boolean;
}

export interface MaintenancePlan {
  timestamp: string;
  hostname: string;
  posture: MaintenancePosture;
  swarmPosture: SwarmPosture;
  summary: string;
  metrics: {
    score: number;
    grade: string;
    ramUsedPct: number;
    ramFreeMB: number;
    diskFreeGB: number;
    uptimeHours: number;
    totalProcesses: number;
    nodeCount: number;
    namedAgentCount: number;
    aiProcessCount: number;
    localModelCount: number;
    mcpCount: number;
    devServerCount: number;
    buildCount: number;
    reviewableCount: number;
  };
  reasons: string[];
  actions: MaintenanceAction[];
  protectedRoles: Record<string, number>;
  reviewableRoles: Record<string, number>;
  relatedWorkItems: string[];
}

function countRoles(processes: ProcessInfo['processes'], protectedOnly: boolean): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const proc of processes) {
    if (proc.protected !== protectedOnly) continue;
    counts[proc.role] = (counts[proc.role] ?? 0) + 1;
  }
  return counts;
}

function roleCount(procs: ProcessInfo, role: ProcessRole): number {
  return procs.processes.filter(proc => proc.role === role).length;
}

function choosePosture(plan: Pick<MaintenancePlan, 'metrics' | 'reasons'>): MaintenancePosture {
  const m = plan.metrics;
  if (m.ramUsedPct >= 94 || m.ramFreeMB < 2_000 || (m.uptimeHours > 168 && m.ramUsedPct >= 82)) return 'restart-soon';
  if (m.diskFreeGB < 20 || m.ramUsedPct >= 88 || m.totalProcesses > 850 || m.nodeCount > 140) return 'maintenance';
  if (m.ramUsedPct >= 82 || m.totalProcesses > 700 || m.nodeCount > 90 || m.namedAgentCount > 25) return 'constrain';
  if (m.ramUsedPct >= 72 || m.uptimeHours > 72 || m.nodeCount > 60 || m.namedAgentCount > 12) return 'watch';
  return 'green';
}

function swarmPostureFor(posture: MaintenancePosture): SwarmPosture {
  switch (posture) {
    case 'green': return 'expand';
    case 'watch': return 'steady';
    case 'constrain': return 'pause-new-swarms';
    case 'maintenance':
    case 'restart-soon':
      return 'drain-and-handoff';
  }
}

function addAction(actions: MaintenanceAction[], action: MaintenanceAction): void {
  if (!actions.some(existing => existing.id === action.id)) actions.push(action);
}

export function buildMaintenancePlan(cwd = process.cwd()): MaintenancePlan {
  const audit: AuditResult = runAudit({ cwd });
  const mem = probeMemory();
  const disk = probeDisk(cwd);
  const uptime = probeUptime();
  const procs = probeProcesses();
  const namedAgentCount = procs.claudeCount + procs.cursorCount + procs.codexCount;
  const aiProcessCount = roleCount(procs, 'ai-agent');
  const localModelCount = roleCount(procs, 'local-model');
  const mcpCount = roleCount(procs, 'mcp');
  const devServerCount = roleCount(procs, 'dev-server');
  const buildCount = roleCount(procs, 'build');
  const reviewableCount = procs.processes.filter(proc => !proc.protected).length;

  const reasons: string[] = [];
  if (mem.usedPct >= 88) reasons.push(`RAM is high at ${mem.usedPct}% used (${mem.freeMB}MB free).`);
  else if (mem.usedPct >= 82) reasons.push(`RAM is elevated at ${mem.usedPct}% used; avoid launching large swarms until pressure drops.`);
  else reasons.push(`RAM is workable at ${mem.usedPct}% used (${mem.freeMB}MB free).`);

  if (disk.freeGB < 20) reasons.push(`Disk is critical at ${disk.freeGB}GB free.`);
  else reasons.push(`Disk has ${disk.freeGB}GB free.`);

  if (uptime.uptimeHours > 168) reasons.push(`Uptime is ${uptime.uptimeHours}h; schedule a restart after handoff.`);
  else if (uptime.uptimeHours > 72) reasons.push(`Uptime is ${uptime.uptimeHours}h; watch for stale agent/process state.`);

  if (namedAgentCount > 25) reasons.push(`${namedAgentCount} named AI-agent processes are active; new swarms should be gated.`);
  if (procs.nodeCount > 90) reasons.push(`${procs.nodeCount} node processes are active; inspect for orphaned build/dev/MCP processes.`);
  if (localModelCount > 0) reasons.push(`${localModelCount} local model processes are protected; ask before stopping local LLM work.`);
  if (devServerCount > 0) reasons.push(`${devServerCount} dev-server processes should be managed through SDS.`);
  if (buildCount > 0) reasons.push(`${buildCount} build/generator processes are reviewable and require receipts before termination.`);

  const metrics = {
    score: audit.totalScore,
    grade: audit.grade,
    ramUsedPct: mem.usedPct,
    ramFreeMB: mem.freeMB,
    diskFreeGB: disk.freeGB,
    uptimeHours: uptime.uptimeHours,
    totalProcesses: procs.totalProcesses,
    nodeCount: procs.nodeCount,
    namedAgentCount,
    aiProcessCount,
    localModelCount,
    mcpCount,
    devServerCount,
    buildCount,
    reviewableCount,
  };

  const posture = choosePosture({ metrics, reasons });
  const swarmPosture = swarmPostureFor(posture);
  const actions: MaintenanceAction[] = [];

  addAction(actions, {
    id: 'pp-inspect-full-map',
    priority: posture === 'green' ? 'watch' : 'now',
    permission: 'observe',
    owner: 'PP',
    command: 'pp inspect --all --json',
    reason: 'Keep a full redacted process map before making cleanup decisions.',
    expectedImpact: 'Preserves reasoning chain and reduces accidental process disruption.',
    risk: 'low',
    requiresReceipt: false,
  });

  if (mem.usedPct >= 82 || procs.nodeCount > 90 || namedAgentCount > 25) {
    addAction(actions, {
      id: 'pause-new-swarms',
      priority: 'now',
      permission: 'handoff',
      owner: 'Starlight Queen',
      reason: 'Machine pressure is high enough that new parallel agents could crowd RAM and confuse ownership.',
      expectedImpact: 'Prevents runaway agent/process growth while current work drains.',
      risk: 'low',
      requiresReceipt: false,
    });
  }

  if (devServerCount > 0 || procs.nodeCount > 70) {
    addAction(actions, {
      id: 'sds-reap-dev-servers',
      priority: procs.nodeCount > 90 ? 'now' : 'next',
      permission: 'supervisor',
      owner: 'SDS',
      command: 'sds status -IncludeUnmanaged; sds reap',
      reason: 'Local dev servers should be stopped through the supervisor so review URLs, TTL, owner, and ports stay coherent.',
      expectedImpact: 'Reduces duplicate localhost servers without breaking active review loops.',
      risk: 'low',
      requiresReceipt: false,
    });
  }

  if (buildCount > 0 || reviewableCount > 200) {
    addAction(actions, {
      id: 'review-reducible-processes',
      priority: posture === 'maintenance' || posture === 'restart-soon' ? 'now' : 'next',
      permission: 'confirm',
      owner: 'Human',
      reason: 'Reviewable build/node/shell processes may be safe to reduce, but only after their purpose and recovery command are documented.',
      expectedImpact: 'Can free RAM while protecting active agents, model workers, and user work.',
      risk: 'medium',
      requiresReceipt: true,
    });
  }

  if (mem.usedPct >= 88 || posture === 'restart-soon') {
    addAction(actions, {
      id: 'handoff-before-restart',
      priority: posture === 'restart-soon' ? 'now' : 'next',
      permission: 'handoff',
      owner: 'Starlight Queen',
      command: 'pp prep',
      reason: 'High RAM pressure or stale uptime means restart may be the cleanest recovery, but agent state must be preserved first.',
      expectedImpact: 'Reduces crash risk and preserves current work before restart.',
      risk: 'medium',
      requiresReceipt: false,
    });
  }

  if (disk.freeGB < 50) {
    addAction(actions, {
      id: 'safe-cache-cleanup',
      priority: disk.freeGB < 20 ? 'now' : 'next',
      permission: 'safe-auto',
      owner: 'PP',
      command: 'pp fix',
      reason: 'Disk free space is low enough that safe cache cleanup may prevent build failures.',
      expectedImpact: 'Frees cache/temp space without touching project files.',
      risk: 'low',
      requiresReceipt: false,
    });
  }

  const summary = `${posture} maintenance posture; ${swarmPosture} swarm posture; score ${audit.totalScore}/${audit.grade}.`;

  return {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    posture,
    swarmPosture,
    summary,
    metrics,
    reasons,
    actions,
    protectedRoles: countRoles(procs.processes, true),
    reviewableRoles: countRoles(procs.processes, false),
    relatedWorkItems: ['ops-jarvisops-desktop-control-plane', 'ops-agent-run-ledger-calendar'],
  };
}
