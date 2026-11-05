/**
 * Doctor — intelligent diagnostic that explains WHY your score is low
 * and gives actionable, prioritized fixes specific to your situation.
 *
 * Unlike the basic audit which just shows numbers, doctor:
 * 1. Analyzes relationships between gates (e.g., high agent count → low RAM → low disk from swap)
 * 2. Identifies root causes vs symptoms
 * 3. Generates a prioritized action plan with estimated impact
 */
import type { AuditResult, GateScore, GateId } from '../types.js';

export interface Diagnosis {
  rootCause: string;
  affectedGates: GateId[];
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  explanation: string;
  actions: DiagnosticAction[];
}

export interface DiagnosticAction {
  action: string;
  estimatedImpact: string; // e.g., "+5 points" or "+2GB RAM"
  effort: 'instant' | '1min' | '5min' | '30min';
  command?: string;
}

export function diagnose(audit: AuditResult): Diagnosis[] {
  const gateMap = new Map(audit.gates.map(g => [g.id, g]));
  const diagnoses: Diagnosis[] = [];

  const disk = gateMap.get('disk');
  const mem = gateMap.get('memory');
  const procs = gateMap.get('processes');
  const agents = gateMap.get('agents');
  const workspace = gateMap.get('workspace');
  const system = gateMap.get('system');

  // Pattern: Agent overload cascade
  // Too many agents → RAM pressure → swap to disk → disk fills → everything degrades
  if (agents && mem && agents.score <= 6 && mem.score <= 6) {
    const agentCount = Number(agents.metrics['agents'] ?? 0);
    const estMB = Number(agents.metrics['estAgentMB'] ?? 0);
    diagnoses.push({
      rootCause: 'Agent overload cascade',
      affectedGates: ['agents', 'memory', 'system'],
      severity: agentCount > 10 ? 'critical' : 'serious',
      explanation:
        `${agentCount} AI agents are consuming ~${estMB}MB (${agents.metrics['agentPct']}% of RAM). ` +
        `When RAM exceeds 85%, Windows uses the page file (disk swap), which further reduces disk space ` +
        `and slows everything down. Confirm task ownership before closing any process.`,
      actions: [
        { action: 'Have owners checkpoint and close confirmed completed task trees; preserve unfinished work',
          estimatedImpact: 'Unmeasured until exact live ownership is established', effort: '5min', command: 'pp inspect --all --json' },
        { action: 'Keep signed-in browsers open; browser closure requires owner approval',
          estimatedImpact: 'Preserves active sessions and foreground work', effort: 'instant' },
      ],
    });
  }

  // Pattern: Disk pressure
  if (disk && disk.score <= 4) {
    const freeGB = Number(disk.metrics['freeGB'] ?? 0);
    const actions: DiagnosticAction[] = [
      { action: 'Review exact cache and generated-output ownership, current writers and recovery before proposing reclaim',
        estimatedImpact: 'Unmeasured until an exact inventory and approval', effort: '5min', command: 'pp fix' },
      { action: 'Preserve unfinished work and retained evidence; use the existing machine admission contract',
        estimatedImpact: 'Prevents unapproved or unsafe reclaim', effort: '5min' },
    ];

    diagnoses.push({
      rootCause: 'Disk space critical',
      affectedGates: ['disk', 'system'],
      severity: freeGB < 10 ? 'critical' : 'serious',
      explanation:
        `Only ${freeGB}GB free. Build tools (Next.js, TypeScript, npm) need 5-10GB working space. ` +
        `Below 10GB, builds start failing. Below 5GB, Windows becomes unstable.`,
      actions,
    });
  }

  // Pattern: Process bloat (orphan nodes)
  if (procs && procs.score <= 5) {
    const nodeCount = Number(procs.metrics['node'] ?? 0);
    const agentCount = Number(procs.metrics['claude'] ?? 0) +
                       Number(procs.metrics['cursor'] ?? 0) +
                       Number(procs.metrics['codex'] ?? 0);
    const ratio = agentCount > 0 ? Math.round(nodeCount / agentCount) : nodeCount;

    if (ratio > 10) {
      diagnoses.push({
        rootCause: 'Process fanout needs ownership review',
        affectedGates: ['processes', 'memory'],
        severity: ratio > 20 ? 'serious' : 'moderate',
        explanation:
          `${nodeCount} node processes for ${agentCount} named AI agents (${ratio}:1 ratio). ` +
          'Counts do not prove that a process is idle or abandoned. Inspect actual parents and task ownership.',
        actions: [
          { action: 'Have owners checkpoint and close only confirmed completed task trees; preserve unfinished tasks',
            estimatedImpact: 'Unmeasured until exact live ownership and working sets are checked', effort: '5min',
            command: 'pp inspect --all --json' },
        ],
      });
    }
  }

  // Pattern: GPU thermal throttling
  const cpu = gateMap.get('cpu');
  if (cpu && cpu.score < 8) {
    const gpuTemp = Number(cpu.metrics['gpuTemp'] ?? 0);
    if (gpuTemp > 80) {
      diagnoses.push({
        rootCause: 'GPU thermal stress',
        affectedGates: ['cpu'],
        severity: gpuTemp > 90 ? 'critical' : 'moderate',
        explanation:
          `GPU at ${gpuTemp}°C. Above 80°C, the GPU throttles performance. ` +
          `Above 90°C, risk of crashes and hardware damage. ` +
          `Common cause: gaming + AI agents simultaneously on a laptop.`,
        actions: [
          { action: 'Close GPU-intensive apps (games, video editors)', estimatedImpact: '-10-20°C', effort: 'instant' },
          { action: 'Ensure laptop ventilation (not on soft surface)', estimatedImpact: '-5-10°C', effort: 'instant' },
          { action: 'Check for dust in cooling vents', estimatedImpact: '-10-15°C', effort: '30min' },
        ],
      });
    }
  }

  // Pattern: Knowledge gap
  const knowledge = gateMap.get('knowledge');
  if (knowledge && knowledge.score < 8) {
    diagnoses.push({
      rootCause: 'Missing project intelligence',
      affectedGates: ['knowledge'],
      severity: 'minor',
      explanation:
        'Your project is missing some knowledge indicators (CLAUDE.md, .arcanea, docs, memory). ' +
        'These files help AI agents understand your project faster and produce better results.',
      actions: [
        { action: 'Create CLAUDE.md with project instructions', estimatedImpact: 'Better AI agent output', effort: '5min' },
      ],
    });
  }

  // Sort by severity
  const severityOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  diagnoses.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return diagnoses;
}

/** Format diagnoses for terminal output */
export function formatDiagnoses(diagnoses: Diagnosis[]): string {
  if (diagnoses.length === 0) return '\n  No issues detected. System is healthy.\n';

  const lines: string[] = ['', '  \x1b[1mDiagnosis\x1b[0m', ''];

  for (const d of diagnoses) {
    const color = d.severity === 'critical' ? '\x1b[31m' :
                  d.severity === 'serious' ? '\x1b[33m' :
                  d.severity === 'moderate' ? '\x1b[36m' : '\x1b[90m';
    const icon = d.severity === 'critical' ? '!!!' : d.severity === 'serious' ? ' !!' : '  >';

    lines.push(`  ${color}${icon} ${d.rootCause}\x1b[0m  [${d.affectedGates.join(', ')}]`);
    lines.push(`      ${d.explanation}`);
    lines.push('');

    for (const a of d.actions) {
      lines.push(`      \x1b[32m→\x1b[0m ${a.action}  \x1b[90m(${a.estimatedImpact}, ${a.effort})\x1b[0m`);
      if (a.command) lines.push(`        \x1b[90m$ ${a.command}\x1b[0m`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
