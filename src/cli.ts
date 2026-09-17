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
 *   pp inspect         Process census and top memory consumers
 *   pp watch           Bounded process start/stop ledger
 *   pp maintain        Predictive maintenance and swarm posture
 *   pp preflight       Workload-aware admission decision
 *   pp overnight       Overnight swarm guard plan
 *   pp snapshot        Screenshot + audit bundle (archived)
 */
import { runAudit } from './core/audit.js';
import { diagnose, formatDiagnoses } from './core/doctor.js';
import { TrendTracker } from './history/tracker.js';
import { runAllFixes } from './fixes/autofix.js';
import { takeSnapshot } from './core/snapshot.js';
import { runPrepHandover } from './core/handover.js';
import { probeProcesses } from './core/probes.js';
import { runProcessWatch } from './core/process-ledger.js';
import { buildMaintenancePlan } from './core/maintenance.js';
import { buildPreflightPlan, isWorkloadType, WORKLOADS } from './core/preflight.js';
import { buildOvernightGuardPlan, formatOvernightGuardMarkdown, writeOvernightGuardPlan } from './core/overnight.js';
import { formatAudit, formatTrend, formatJson, formatMarkdown, formatProcessInspection, formatMaintenanceCompact, formatMaintenancePlan, formatOvernightGuardPlan, formatPreflightPlan } from './format/terminal.js';
import { resolve } from 'node:path';

// Respect NO_COLOR standard (https://no-color.org/)
if (process.env['NO_COLOR'] !== undefined) {
  // Strip ANSI codes by monkey-patching console.log
  const origLog = console.log;
  console.log = (...args: unknown[]) => origLog(...args.map(a =>
    typeof a === 'string' ? a.replace(/\x1b\[[0-9;]*m/g, '') : a
  ));
}

const args = process.argv.slice(2);
const command = args[0] || 'audit';
const flags = new Set(args.slice(1));

const theme = flags.has('--plain') ? 'plain' as const : 'arcanea' as const;
const historyPath = resolve(process.cwd(), '.pp', 'history.json');

function readNumberFlag(name: string, fallback: number): number {
  const inline = args.find(arg => arg.startsWith(`--${name}=`));
  if (inline) {
    const value = Number(inline.slice(name.length + 3));
    return Number.isFinite(value) ? value : fallback;
  }
  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1]) {
    const value = Number(args[index + 1]);
    return Number.isFinite(value) ? value : fallback;
  }
  return fallback;
}

function readStringFlag(name: string): string | undefined {
  const inline = args.find(arg => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

void (async () => {
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
    const plan = buildMaintenancePlan(process.cwd());
    console.log(formatMaintenanceCompact(plan));
    break;
  }

  case 'doctor': {
    const audit = runAudit({ cwd: process.cwd() });
    console.log(formatAudit(audit, theme));
    const diagnoses = diagnose(audit);
    console.log(formatDiagnoses(diagnoses));
    break;
  }

  case 'inspect': {
    const procs = probeProcesses();
    if (flags.has('--json')) {
      console.log(JSON.stringify(procs, null, 2));
    } else {
      console.log(formatProcessInspection(procs, flags.has('--all') ? procs.processes.length : 20));
    }
    break;
  }

  case 'watch': {
    const seconds = readNumberFlag('seconds', 60);
    const intervalSeconds = readNumberFlag('interval', 2);
    const logPath = readStringFlag('log');
    const summaryPath = readStringFlag('summary');
    const result = await runProcessWatch({
      seconds,
      intervalMs: Math.round(intervalSeconds * 1000),
      logPath,
      summaryPath,
    });

    if (flags.has('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('');
      console.log('  Peak Performance Process Watch');
      console.log(`  Samples: ${result.samples} | Started: ${result.started} | Stopped: ${result.stopped}`);
      console.log(`  Log: ${result.logPath}`);
      console.log(`  Summary: ${result.summaryPath}`);
      if (result.events.length > 0) {
        console.log('');
        for (const event of result.events.slice(-20)) {
          console.log(`  ${event.type.padEnd(5)} PID ${event.process.pid} ${event.process.name} ${event.process.memMB}MB ${event.process.role}`);
          console.log(`        ${event.process.reasoning}`);
        }
      }
      console.log('');
    }
    break;
  }

  case 'maintain':
  case 'forecast': {
    const plan = buildMaintenancePlan(process.cwd());
    if (flags.has('--json')) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(formatMaintenancePlan(plan));
    }
    break;
  }

  case 'preflight': {
    const workloadValue = readStringFlag('workload') ?? args[1] ?? 'interactive';
    if (!isWorkloadType(workloadValue)) {
      throw new Error(`Unknown workload "${workloadValue}". Use one of: ${WORKLOADS.join(', ')}.`);
    }
    const reserveGB = readNumberFlag('reserve-gb', Number.NaN);
    const plan = buildPreflightPlan(workloadValue, {
      cwd: process.cwd(),
      reserveMB: Number.isFinite(reserveGB) ? reserveGB * 1_024 : undefined,
    });
    if (flags.has('--json')) console.log(JSON.stringify(plan, null, 2));
    else console.log(formatPreflightPlan(plan));
    if (plan.decision === 'hold') process.exitCode = 2;
    break;
  }

  case 'overnight':
  case 'guard': {
    const plan = buildOvernightGuardPlan(process.cwd());
    const written = flags.has('--write') ? writeOvernightGuardPlan(plan, readStringFlag('dir')) : undefined;

    if (flags.has('--json')) {
      console.log(JSON.stringify(written ? { ...plan, written } : plan, null, 2));
    } else if (flags.has('--md')) {
      console.log(formatOvernightGuardMarkdown(plan));
      if (written) console.log(`\nSaved: ${written.markdownFile}\nJSON: ${written.jsonFile}\n`);
    } else {
      console.log(formatOvernightGuardPlan(plan));
      if (written) {
        console.log(`  Saved guard report: ${written.markdownFile}`);
        console.log(`  Saved guard JSON: ${written.jsonFile}`);
        console.log('');
      }
    }
    break;
  }

  case 'snapshot': {
    const notes = args.slice(1).join(' ') || undefined;
    console.log('\n  Taking snapshot (audit + screenshots)...\n');
    const result = takeSnapshot(process.cwd(), notes);
    console.log(formatAudit(result.audit, theme));
    console.log(`  Screenshots: ${result.screenshots.length} captured`);
    console.log(`  Saved to: ${result.dir}`);
    console.log(`  Bundle: ${result.snapshotFile}\n`);
    break;
  }

  case 'prep': {
    console.log('\n  Running Agent State Preservation & Handover (ASPH) Prep...\n');
    const result = runPrepHandover(process.cwd());
    console.log('  ✅ Repository checkpoints completed.');
    console.log('  ✅ Claude sessions analyzed.');
    console.log('  ✅ Handover prompt templates optimized.');
    console.log(`  Saved Plaintext Log: ${result.txtFile}`);
    console.log(`  Saved Interactive Dashboard: ${result.htmlFile}\n`);
    break;
  }

  default:
    console.log(`
  Peak Performance — System health for AI-powered machines

  Commands:
    pp audit [--json|--md|--plain]   Full system audit
    pp doctor                        Diagnose root causes + action plan
    pp trend [N]                     Show last N score entries
    pp fix                           Run auto-fixes
    pp compact                       One-line status
    pp inspect [--all|--json]        Process census + top memory consumers
    pp watch [--seconds N]           Bounded process start/stop ledger
    pp maintain [--json]             Predict maintenance + swarm posture
    pp preflight --workload TYPE     Admit or hold a workload within live resource budgets
    pp overnight [--write|--json]     Overnight swarm guard plan
    pp snapshot [notes]              Screenshot + audit archive bundle
    pp prep                          Preserve agent state and prepare reboot

  Environment:
    NO_COLOR=1                       Disable ANSI color codes
    PP_CWD=/path                     Override working directory

  Preflight workloads:
    ${WORKLOADS.join(', ')}
`);
}
})().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
