/**
 * Terminal formatter — renders audit results as beautiful CLI output.
 * Supports both Arcanea theme (gate names) and plain theme.
 */
import { GATE_NAMES, type GateId } from '../types.js';
import type { AuditResult, TrendEntry } from '../types.js';
import type { ProcessInfo } from '../core/probes.js';
import type { MaintenancePlan } from '../core/maintenance.js';
import type { OvernightGuardPlan } from '../core/overnight.js';

type Theme = 'arcanea' | 'plain';

function gateName(id: GateId, theme: Theme): string {
  const g = GATE_NAMES[id];
  return theme === 'arcanea' ? `${g.gate} (${g.guardian})` : g.plain;
}

function statusIcon(status: string): string {
  switch (status) {
    case 'PERFECT': return '\x1b[32m★\x1b[0m'; // green star
    case 'OK': return '\x1b[32m✓\x1b[0m';      // green check
    case 'WARN': return '\x1b[33m⚠\x1b[0m';    // yellow warning
    case 'CRIT': return '\x1b[31m✗\x1b[0m';     // red X
    default: return '?';
  }
}

function scoreBar(score: number): string {
  const filled = Math.round(score);
  const empty = 10 - filled;
  const color = score >= 7 ? '\x1b[32m' : score >= 4 ? '\x1b[33m' : '\x1b[31m';
  return `${color}${'█'.repeat(filled)}\x1b[90m${'░'.repeat(empty)}\x1b[0m`;
}

function gradeColor(grade: string): string {
  if (grade.startsWith('S') || grade.startsWith('A')) return '\x1b[32m';
  if (grade.startsWith('B')) return '\x1b[36m';
  if (grade.startsWith('C')) return '\x1b[33m';
  return '\x1b[31m';
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3))}...`;
}

export function formatAudit(audit: AuditResult, theme: Theme = 'arcanea'): string {
  const lines: string[] = [];
  const gc = gradeColor(audit.grade);

  lines.push('');
  lines.push(`\x1b[1m  Peak Performance Audit\x1b[0m`);
  lines.push(`  ${audit.timestamp} | ${audit.hostname} | ${audit.platform}`);
  lines.push('');
  lines.push(`  Score: ${gc}\x1b[1m${audit.totalScore}/100\x1b[0m | Grade: ${gc}\x1b[1m${audit.grade}\x1b[0m`);
  lines.push('');
  lines.push('  \x1b[90m─────────────────────────────────────────────────\x1b[0m');

  // Gate scores
  for (const gate of audit.gates) {
    const name = gateName(gate.id, theme).padEnd(28);
    const icon = statusIcon(gate.status);
    const bar = scoreBar(gate.score);
    const scoreStr = `${gate.score}/10`.padStart(5);
    lines.push(`  ${icon} ${name} ${bar} ${scoreStr}  ${gate.detail}`);
  }

  lines.push('  \x1b[90m─────────────────────────────────────────────────\x1b[0m');

  // Recommendations
  if (audit.recommendations.length > 0) {
    lines.push('');
    lines.push('  \x1b[1mRecommendations\x1b[0m');
    for (const rec of audit.recommendations) {
      const color = rec.priority === 'urgent' ? '\x1b[31m' : rec.priority === 'high' ? '\x1b[33m' : '\x1b[36m';
      const prefix = rec.priority === 'urgent' ? '!!!' : rec.priority === 'high' ? ' !!' : '  >';
      lines.push(`  ${color}${prefix}\x1b[0m ${rec.message}`);
      if (rec.fix) {
        lines.push(`      \x1b[90m$ ${rec.fix}\x1b[0m`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function formatTrend(entries: TrendEntry[], theme: Theme = 'arcanea'): string {
  if (entries.length === 0) return '  No history yet. Run `pp audit` to start tracking.\n';

  const lines: string[] = [];
  lines.push('');
  lines.push('  \x1b[1mTrend History\x1b[0m');
  lines.push('  \x1b[90m─────────────────────────────────────────────────\x1b[0m');

  for (const entry of entries) {
    const date = entry.timestamp.slice(0, 16).replace('T', ' ');
    const gc = gradeColor(entry.grade);
    const trigger = entry.trigger ? ` (${entry.trigger})` : '';
    lines.push(`  ${date}  ${gc}${entry.score}/100 ${entry.grade}\x1b[0m${trigger}`);
  }

  // Show delta if available
  if (entries.length >= 2) {
    const last = entries[entries.length - 1];
    const prev = entries[entries.length - 2];
    const delta = last.score - prev.score;
    const arrow = delta > 0 ? '\x1b[32m↑' : delta < 0 ? '\x1b[31m↓' : '\x1b[90m→';
    lines.push('');
    lines.push(`  ${arrow} ${Math.abs(delta)} points\x1b[0m since last audit`);
  }

  lines.push('');
  return lines.join('\n');
}

/** Compact one-line format for status bars and hooks */
export function formatCompact(audit: AuditResult, theme: Theme = 'arcanea'): string {
  const gc = gradeColor(audit.grade);
  const crits = audit.gates.filter(g => g.status === 'CRIT').length;
  const warns = audit.gates.filter(g => g.status === 'WARN').length;
  const critStr = crits > 0 ? ` \x1b[31m${crits}CRIT\x1b[0m` : '';
  const warnStr = warns > 0 ? ` \x1b[33m${warns}WARN\x1b[0m` : '';
  return `PP ${gc}${audit.totalScore}/${audit.grade}\x1b[0m${critStr}${warnStr}`;
}

/** Compact one-line maintenance format for overnight hooks and dashboards */
export function formatMaintenanceCompact(plan: MaintenancePlan, options: { color?: boolean } = {}): string {
  const color = options.color !== false;
  const gc = color ? gradeColor(plan.metrics.grade) : '';
  const reset = color ? '\x1b[0m' : '';
  const actionStr = plan.actions.length > 0 ? ` | ${plan.actions.length} actions` : '';
  return [
    `PP ${gc}${plan.metrics.score}/${plan.metrics.grade}${reset}`,
    `${plan.posture}`,
    `swarms ${plan.swarmPosture}`,
    `RAM ${plan.metrics.ramUsedPct}% (${plan.metrics.ramFreeMB}MB free)`,
    `proc ${plan.metrics.totalProcesses}`,
  ].join(' | ') + actionStr;
}

/** JSON output for piping to other tools */
export function formatJson(audit: AuditResult): string {
  return JSON.stringify(audit, null, 2);
}

/** Markdown output for memory files and reports */
export function formatMarkdown(audit: AuditResult, theme: Theme = 'arcanea'): string {
  const lines: string[] = [];

  lines.push(`# Peak Performance Audit — ${audit.timestamp.slice(0, 10)}`);
  lines.push('');
  lines.push(`**Score:** ${audit.totalScore}/100 | **Grade:** ${audit.grade}`);
  lines.push(`**Host:** ${audit.hostname} | **Platform:** ${audit.platform}`);
  lines.push('');
  lines.push('## Gate Scores');
  lines.push('');
  lines.push('| Gate | Score | Status | Detail |');
  lines.push('|------|-------|--------|--------|');

  for (const gate of audit.gates) {
    const name = gateName(gate.id, theme);
    lines.push(`| ${name} | ${gate.score}/10 | ${gate.status} | ${gate.detail} |`);
  }

  if (audit.recommendations.length > 0) {
    lines.push('');
    lines.push('## Recommendations');
    lines.push('');
    for (const rec of audit.recommendations) {
      lines.push(`- **[${rec.priority.toUpperCase()}]** ${rec.message}`);
      if (rec.fix) lines.push(`  - Fix: \`${rec.fix}\``);
    }
  }

  return lines.join('\n');
}

export function formatProcessInspection(procs: ProcessInfo, limit = 20): string {
  const agents = procs.claudeCount + procs.cursorCount + procs.codexCount;
  const rows = procs.processes.length > 0 ? procs.processes : procs.topConsumers;
  const visibleRows = rows.slice(0, Math.max(1, limit));
  const lines: string[] = [];

  lines.push('');
  lines.push('\x1b[1m  Peak Performance Process Inspection\x1b[0m');
  lines.push('');
  lines.push(`  Total: ${procs.totalProcesses} | Agents: ${agents} | Node: ${procs.nodeCount} | Protected: ${procs.protectedCount}`);
  lines.push(`  Browsers: ${procs.edgeChromeTabs} | Editors: ${procs.vscodeCount}`);
  lines.push(`  Showing: ${visibleRows.length}/${rows.length} process rows`);
  lines.push('');
  lines.push('  Top memory consumers');
  lines.push('  PID      MB       Role         Guard     Command');
  lines.push('  -------  -------  -----------  --------  ----------------------------------------------');

  for (const proc of visibleRows) {
    const guard = proc.protected ? 'guarded' : 'review';
    const role = proc.role.padEnd(11).slice(0, 11);
    const command = truncate(proc.command.replace(/\s+/g, ' '), 78);
    lines.push(
      `  ${String(proc.pid).padEnd(7)}  ${String(proc.memMB).padStart(7)}  ${role}  ${guard.padEnd(8)}  ${command}`
    );
    if (proc.protectionReason) {
      lines.push(`                                      reason: ${proc.protectionReason}`);
    }
  }

  lines.push('');
  lines.push('  Rule: inspect first, write a receipt, then ask before terminating user-owned processes.');
  lines.push('');

  return lines.join('\n');
}

export function formatMaintenancePlan(plan: MaintenancePlan): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('\x1b[1m  Peak Performance Maintenance Plan\x1b[0m');
  lines.push('');
  lines.push(`  ${plan.summary}`);
  lines.push(`  RAM: ${plan.metrics.ramUsedPct}% used (${plan.metrics.ramFreeMB}MB free) | Disk: ${plan.metrics.diskFreeGB}GB free | Uptime: ${plan.metrics.uptimeHours}h`);
  lines.push(`  Processes: ${plan.metrics.totalProcesses} total | ${plan.metrics.namedAgentCount} named agents | ${plan.metrics.nodeCount} node | ${plan.metrics.reviewableCount} reviewable`);
  lines.push('');
  lines.push('  Reasons');
  for (const reason of plan.reasons) lines.push(`  - ${reason}`);

  lines.push('');
  lines.push('  Actions');
  for (const action of plan.actions) {
    const receipt = action.requiresReceipt ? ' | receipt required' : '';
    lines.push(`  - [${action.priority}] ${action.id} (${action.owner}, ${action.permission}${receipt})`);
    lines.push(`    ${action.reason}`);
    if (action.command) lines.push(`    $ ${action.command}`);
  }

  lines.push('');
  lines.push('  Protected roles: ' + JSON.stringify(plan.protectedRoles));
  lines.push('  Reviewable roles: ' + JSON.stringify(plan.reviewableRoles));
  lines.push('');

  return lines.join('\n');
}

export function formatOvernightGuardPlan(plan: OvernightGuardPlan): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('\x1b[1m  Peak Performance Overnight Guard\x1b[0m');
  lines.push('');
  lines.push(`  Directive: ${plan.directive.level} | New swarms: ${plan.directive.allowNewSwarms ? 'allowed when bounded' : 'hold'}`);
  lines.push(`  ${plan.directive.summary}`);
  lines.push(`  ${plan.maintenance.summary}`);
  lines.push(`  RAM: ${plan.maintenance.metrics.ramUsedPct}% used (${plan.maintenance.metrics.ramFreeMB}MB free) | Disk: ${plan.maintenance.metrics.diskFreeGB}GB free | Uptime: ${plan.maintenance.metrics.uptimeHours}h`);
  lines.push(`  Processes: ${plan.processSnapshot.totalProcesses} total | ${plan.processSnapshot.nodeCount} node | ${plan.processSnapshot.reviewableCount} reviewable`);
  lines.push('');
  lines.push('  Queen instructions');
  for (const item of plan.directive.queenInstructions) lines.push(`  - ${item}`);
  lines.push('');
  lines.push('  Agent instructions');
  for (const item of plan.directive.agentInstructions) lines.push(`  - ${item}`);
  lines.push('');
  lines.push('  Watch');
  lines.push(`  - ${plan.watch.command}`);
  lines.push(`  - log: ${plan.watch.logPath}`);
  lines.push(`  - summary: ${plan.watch.summaryPath}`);
  lines.push('');
  lines.push('  SDS');
  lines.push(`  - ${plan.sds.statusCommand}`);
  lines.push(`  - ${plan.sds.guidance}`);

  if (plan.processSnapshot.topReviewable.length > 0) {
    lines.push('');
    lines.push('  Top reviewable processes');
    for (const proc of plan.processSnapshot.topReviewable.slice(0, 8)) {
      lines.push(`  - PID ${proc.pid} ${proc.name} ${proc.memMB}MB ${proc.role}: ${proc.actionHint}`);
    }
  }

  lines.push('');
  lines.push('  No-touch classes');
  for (const item of plan.noTouch) lines.push(`  - ${item}`);
  lines.push('');

  return lines.join('\n');
}
