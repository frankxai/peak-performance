#!/usr/bin/env node
/**
 * Peak Performance CLI
 * Usage:
 *   pp audit           Full system audit
 *   pp audit --json    JSON output
 *   pp audit --md      Markdown output
 *   pp audit --plain   Use plain names instead of Arcanea gates
 *   pp trend           Show score history
 *   pp fix             Run auto-fixes
 *   pp compact         One-line status for hooks/statusline
 */
import { runAudit } from './core/audit.js';
import { TrendTracker } from './history/tracker.js';
import { runAllFixes } from './fixes/autofix.js';
import { formatAudit, formatTrend, formatCompact, formatJson, formatMarkdown } from './format/terminal.js';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const command = args[0] || 'audit';
const flags = new Set(args.slice(1));

const theme = flags.has('--plain') ? 'plain' as const : 'arcanea' as const;
const historyPath = resolve(process.cwd(), '.pp', 'history.json');

switch (command) {
  case 'audit': {
    const audit = runAudit({ cwd: process.cwd() });
    const tracker = new TrendTracker(historyPath);
    tracker.record(audit);

    if (flags.has('--json')) {
      console.log(formatJson(audit));
    } else if (flags.has('--md')) {
      console.log(formatMarkdown(audit, theme));
    } else {
      console.log(formatAudit(audit, theme));

      // Show trend if we have history
      const delta = tracker.getDelta();
      if (delta) {
        const arrow = delta.delta > 0 ? '↑' : delta.delta < 0 ? '↓' : '→';
        const color = delta.delta > 0 ? '\x1b[32m' : delta.delta < 0 ? '\x1b[31m' : '\x1b[90m';
        console.log(`  ${color}${arrow} ${Math.abs(delta.delta)} points (${delta.trend})\x1b[0m from last audit\n`);
      }
    }
    break;
  }

  case 'trend': {
    const tracker = new TrendTracker(historyPath);
    const n = parseInt(args[1], 10) || 10;
    console.log(formatTrend(tracker.getLast(n), theme));
    break;
  }

  case 'fix': {
    const audit = runAudit({ cwd: process.cwd() });
    const fixable = audit.recommendations.filter(r => r.autoFixable);

    if (fixable.length === 0) {
      console.log('\n  No auto-fixable issues found.\n');
      break;
    }

    console.log(`\n  Running ${fixable.length} auto-fixes...\n`);
    const results = runAllFixes(audit.recommendations);

    for (const r of results) {
      const icon = r.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`  ${icon} ${r.recommendation.message}`);
      if (r.output) console.log(`    \x1b[90m${r.output.slice(0, 100)}\x1b[0m`);
    }

    // Re-audit after fixes
    console.log('\n  Re-auditing...\n');
    const after = runAudit({ cwd: process.cwd() });
    const delta = after.totalScore - audit.totalScore;
    const color = delta > 0 ? '\x1b[32m' : '\x1b[90m';
    console.log(`  Before: ${audit.totalScore}/${audit.grade} → After: ${color}${after.totalScore}/${after.grade}\x1b[0m (+${delta} points)\n`);
    break;
  }

  case 'compact': {
    const audit = runAudit({ cwd: process.cwd() });
    console.log(formatCompact(audit, theme));
    break;
  }

  default:
    console.log(`
  Peak Performance — System health for AI-powered machines

  Commands:
    pp audit [--json|--md|--plain]   Full system audit
    pp trend [N]                     Show last N score entries
    pp fix                           Run auto-fixes
    pp compact                       One-line status
`);
}
