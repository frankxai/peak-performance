import os from 'node:os';
import type { AuditResult } from '../types.js';
import { runAuditWithProbes } from './audit.js';
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
    codexTaskRuntimeCount: number;
    aiProcessCount: number;
    localModelCount: number;
    mcpCount: number;
    mcpProcessCount: number;
    mcpMemoryMB: number;
    duplicateMcpProcesses: number;
    agentTreeMemoryMB: number;
    devServerCount: number;
    buildCount: number;
    reviewableCount: number;
    cpuLoadPct: number;
    cpuSystemLoadPct: number;
    recentCrashCount: number;
    crashLoopApp: string;
    crashLoopCount: number;
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
  if (m.diskFreeGB < 20 || m.ramUsedPct >= 88 || m.totalProcesses > 850 || m.nodeCount > 140 || m.crashLoopCount >= 10 || m.cpuLoadPct >= 95) return 'maintenance';
  if (m.ramUsedPct >= 82 || m.totalProcesses > 700 || m.nodeCount > 90 || m.namedAgentCount > 25 || m.codexTaskRuntimeCount > 8 || m.duplicateMcpProcesses > 20 || m.mcpMemoryMB > 4_096 || m.cpuLoadPct >= 70 || m.cpuSystemLoadPct >= 35) return 'constrain';
  if (m.ramUsedPct >= 72 || m.uptimeHours > 72 || m.nodeCount > 60 || m.namedAgentCount > 12 || m.codexTaskRuntimeCount > 4 || m.cpuLoadPct >= 55) return 'watch';
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
  const execution = runAuditWithProbes({ cwd });
  const audit: AuditResult = execution.audit;
  const { mem, disk, uptime, procs, cpu, crashes } = execution.snapshot;
  const namedAgentCount = procs.claudeCount + procs.cursorCount + procs.codexCount;
  const aiProcessCount = roleCount(procs, 'ai-agent');
  const localModelCount = roleCount(procs, 'local-model');
  const mcpCount = procs.mcpCount;
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
  if (procs.codexTaskRuntimeCount > 4) reasons.push(`${procs.codexTaskRuntimeCount} Codex task runtimes are active behind ${procs.codexCount} visible Codex process(es).`);
  if (procs.nodeCount > 90) reasons.push(`${procs.nodeCount} node processes are active; inspect for orphaned build/dev/MCP processes.`);
  if (procs.mcpCount > 20) reasons.push(`${procs.mcpCount} MCP servers (${procs.mcpProcessCount} tree processes) use ~${procs.mcpMemoryMB}MB; ${procs.duplicateMcpProcesses} are duplicate server-command copies across task runtimes.`);
  if (cpu.loadPct >= 70 || cpu.systemLoadPct >= 35) reasons.push(`CPU is ${cpu.loadPct}% busy with ${cpu.systemLoadPct}% kernel/interrupt time.`);
  if (crashes.topAppCrashes > 0) reasons.push(`${crashes.topApp || 'Applications'} recorded ${crashes.topAppCrashes} crashes in ${crashes.windowMinutes} minutes (${crashes.totalCrashes} total recent crashes).`);
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
    codexTaskRuntimeCount: procs.codexTaskRuntimeCount,
    aiProcessCount,
    localModelCount,
    mcpCount,
    mcpProcessCount: procs.mcpProcessCount,
    mcpMemoryMB: procs.mcpMemoryMB,
    duplicateMcpProcesses: procs.duplicateMcpProcesses,
    agentTreeMemoryMB: procs.agentTreeMemoryMB,
    devServerCount,
    buildCount,
    reviewableCount,
    cpuLoadPct: cpu.loadPct,
    cpuSystemLoadPct: cpu.systemLoadPct,
    recentCrashCount: crashes.totalCrashes,
    crashLoopApp: crashes.topApp,
    crashLoopCount: crashes.topAppCrashes,
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

  if (mem.usedPct >= 82 || procs.nodeCount > 90 || namedAgentCount > 25 || procs.codexTaskRuntimeCount > 8 || crashes.topAppCrashes >= 10 || cpu.loadPct >= 70) {
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

  if (devServerCount > 0) {
    addAction(actions, {
      id: 'sds-reap-dev-servers',
      priority: devServerCount > 2 ? 'now' : 'next',
      permission: 'supervisor',
      owner: 'SDS',
      command: 'sds status -IncludeUnmanaged; sds reap',
      reason: 'Local dev servers should be stopped through the supervisor so review URLs, TTL, owner, and ports stay coherent.',
      expectedImpact: 'Reduces duplicate localhost servers without breaking active review loops.',
      risk: 'low',
      requiresReceipt: false,
    });
  }

  if (crashes.topAppCrashes >= 3) {
    addAction(actions, {
      id: 'stop-application-crash-loop',
      priority: crashes.topAppCrashes >= 10 ? 'now' : 'next',
      permission: 'confirm',
      owner: 'Human',
      reason: `${crashes.topApp} is repeatedly crashing (${crashes.topAppCrashes} times/${crashes.windowMinutes}m). Use the owning app/service's reversible disable or repair path; do not kill Windows Error Reporting or Defender.`,
      expectedImpact: 'Stops repeated crash dumps, restart churn, kernel CPU, and antivirus rescans at the source.',
      risk: 'medium',
      requiresReceipt: true,
    });
  }

  if (procs.codexTaskRuntimeCount > 4 || procs.duplicateMcpProcesses > 20) {
    addAction(actions, {
      id: 'drain-inactive-codex-task-runtimes',
      priority: procs.codexTaskRuntimeCount > 8 ? 'now' : 'next',
      permission: 'confirm',
      owner: 'Human',
      reason: `${procs.codexTaskRuntimeCount} Codex task runtimes own ${procs.mcpCount} MCP servers (${procs.mcpProcessCount} tree processes). Archive or close inactive Codex tasks so their full process trees exit cleanly; never kill MCP children in isolation.`,
      expectedImpact: `Can reclaim up to ~${procs.mcpMemoryMB}MB of MCP working set while preserving active task ownership.`,
      risk: 'medium',
      requiresReceipt: true,
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
