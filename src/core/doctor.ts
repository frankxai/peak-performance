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
        `and slows everything down. This is the #1 cause of AI dev machine crashes.`,
      actions: [
        {
          action: `Close ${Math.max(0, agentCount - 4)} agent instances (keep 4 max)`,
          estimatedImpact: `+${Math.round((agentCount - 4) * 450)}MB RAM, +${Math.round((agentCount - 4) * 0.5)}GB disk`,
          effort: '1min',
        },
        {
          action: 'Close browser tabs you\'re not actively using',
          estimatedImpact: '+200-500MB RAM',
          effort: 'instant',
        },
      ],
    });
  }

  // Pattern: Disk pressure
  if (disk && disk.score <= 4) {
    const freeGB = Number(disk.metrics['freeGB'] ?? 0);
    const actions: DiagnosticAction[] = [
      { action: 'Clean npm cache', estimatedImpact: '+2-5GB', effort: '1min', command: 'npm cache clean --force' },
    ];

    if (workspace && workspace.score < 10) {
      const tempCount = Number(workspace.metrics['tempFiles'] ?? 0);
      if (tempCount > 5000) {
        actions.push({
          action: `Clean ${tempCount} temp files (older than 3 days)`,
          estimatedImpact: '+0.5-2GB',
          effort: '1min',
          command: 'pp fix',
        });
      }
    }

    actions.push(
      { action: 'Delete .next build caches', estimatedImpact: '+1-3GB', effort: 'instant', command: 'rm -rf .next apps/web/.next' },
      { action: 'Run git gc', estimatedImpact: '+100-500MB', effort: '5min', command: 'git gc --aggressive --prune=now' },
    );

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
        rootCause: 'Orphan node processes',
        affectedGates: ['processes', 'memory'],
        severity: ratio > 20 ? 'serious' : 'moderate',
        explanation:
          `${nodeCount} node processes for ${agentCount} AI agents (${ratio}:1 ratio). ` +
          `Healthy ratio is 3-5:1. The excess are likely orphaned dev servers, MCP servers, ` +
          `or build watchers that didn't clean up when their parent agent closed.`,
        actions: [
          {
            action: 'Review and kill orphan node processes',
            estimatedImpact: `+${Math.round((nodeCount - agentCount * 5) * 20)}MB RAM`,
            effort: '5min',
            command: 'tasklist /fi "imagename eq node.exe" (Windows) | review and taskkill orphans',
          },
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
