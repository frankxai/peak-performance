/**
 * Terminal formatter — renders audit results as beautiful CLI output.
 * Supports both Arcanea theme (gate names) and plain theme.
 */
import { GATE_NAMES, type GateId } from '../types.js';
import type { AuditResult, TrendEntry } from '../types.js';

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
