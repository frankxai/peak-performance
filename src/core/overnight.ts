import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { buildMaintenancePlan, type MaintenancePlan } from './maintenance.js';
import { probeProcesses, type ProcessConsumer } from './probes.js';
import { defaultProcessLedgerPath, defaultProcessWatchSummaryPath } from './process-ledger.js';

export type OvernightDirectiveLevel = 'expand' | 'steady' | 'hold' | 'drain';

export interface OvernightProcessRow {
  pid: number;
  parentPid: number;
  name: string;
  memMB: number;
  role: string;
  protected: boolean;
  reasoning: string;
  actionHint: string;
  command: string;
}

export interface OvernightGuardPlan {
  timestamp: string;
  hostname: string;
  mode: 'overnight-swarm-guard';
  directive: {
    level: OvernightDirectiveLevel;
    allowNewSwarms: boolean;
    summary: string;
    queenInstructions: string[];
    agentInstructions: string[];
  };
  maintenance: MaintenancePlan;
  processSnapshot: {
    totalProcesses: number;
    protectedCount: number;
    reviewableCount: number;
    nodeCount: number;
    topReviewable: OvernightProcessRow[];
    topProtectedAgents: OvernightProcessRow[];
  };
  watch: {
    command: string;
    seconds: number;
    intervalSeconds: number;
    logPath: string;
    summaryPath: string;
  };
  sds: {
    statusCommand: string;
    reapCommand: string;
    guidance: string;
  };
  commandCenter: {
    workItems: string[];
    evidencePaths: string[];
  };
  noTouch: string[];
  reviewBeforeStop: string[];
  nextChecks: string[];
}

export interface OvernightGuardWriteResult {
  dir: string;
  jsonFile: string;
  markdownFile: string;
}

function rowFor(proc: ProcessConsumer): OvernightProcessRow {
  return {
    pid: proc.pid,
    parentPid: proc.parentPid,
    name: proc.name,
    memMB: proc.memMB,
    role: proc.role,
    protected: proc.protected,
    reasoning: proc.reasoning,
    actionHint: proc.actionHint,
    command: proc.command,
  };
}

function chooseDirective(plan: MaintenancePlan): OvernightGuardPlan['directive'] {
  if (plan.swarmPosture === 'drain-and-handoff') {
    return {
      level: 'drain',
      allowNewSwarms: false,
      summary: 'Let current swarms finish, request handoffs, and avoid launching new parallel work overnight.',
      queenInstructions: [
        'Stop adding workers unless Frank explicitly approves a new bounded task.',
        'Ask active agents to preserve handoff state before any cleanup or restart decision.',
        'Route dev-server cleanup through SDS and ambiguous process reduction through human confirmation.',
      ],
      agentInstructions: [
        'Finish the current task or write a handoff before starting another.',
        'Do not start new localhost servers unless the active task truly requires it.',
        'Do not stop AI agents, local models, MCP servers, editors, or unknown user processes.',
      ],
    };
  }

  if (plan.swarmPosture === 'pause-new-swarms') {
    return {
      level: 'hold',
      allowNewSwarms: false,
      summary: 'Hold new swarms; allow only current bounded work and cleanup proposals.',
      queenInstructions: [
        'Keep the queue in pause-new-swarms mode.',
        'Prefer one active agent per repo and require evidence paths for any follow-up.',
        'Use PP inspect and SDS status before proposing reductions.',
      ],
      agentInstructions: [
        'Avoid speculative broad scans or extra model-heavy work.',
        'Record receipts for processes, ports, and generated artifacts.',
        'Use cloud previews for review handoff instead of leaving localhost running.',
      ],
    };
  }

  if (plan.swarmPosture === 'steady') {
    return {
      level: 'steady',
      allowNewSwarms: true,
      summary: 'Proceed with bounded high-value work; avoid casual expansion.',
      queenInstructions: [
        'Allow only clearly scoped queued work with time limits.',
        'Prefer workflow or router patterns before full swarms.',
        'Recheck PP maintain before adding local models or visual QA loops.',
      ],
      agentInstructions: [
        'Keep changes scoped and run local fast gates before cloud work.',
        'Do not leave dev servers running after the loop.',
        'Write evidence paths and next actions before handoff.',
      ],
    };
  }

  return {
    level: 'expand',
    allowNewSwarms: true,
    summary: 'Machine posture is healthy enough for bounded parallel work.',
    queenInstructions: [
      'Prefer small swarms with one lead plus two to four specialists.',
      'Set a stopping condition and evidence path before dispatch.',
      'Recheck PP maintain before long local model or build work.',
    ],
    agentInstructions: [
      'Use the smallest sufficient orchestration pattern.',
      'Keep server lifecycle under SDS.',
      'Preserve receipts for tools, processes, ports, and artifacts.',
    ],
  };
}

export function buildOvernightGuardPlan(cwd = process.cwd()): OvernightGuardPlan {
  const maintenance = buildMaintenancePlan(cwd);
  const processes = probeProcesses();
  const reviewable = processes.processes
    .filter(proc => !proc.protected)
    .sort((a, b) => b.memMB - a.memMB)
    .slice(0, 12)
    .map(rowFor);

  const protectedAgents = processes.processes
    .filter(proc => proc.protected && ['ai-agent', 'local-model', 'mcp', 'dev-server', 'editor'].includes(proc.role))
    .sort((a, b) => b.memMB - a.memMB)
    .slice(0, 12)
    .map(rowFor);

  return {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    mode: 'overnight-swarm-guard',
    directive: chooseDirective(maintenance),
    maintenance,
    processSnapshot: {
      totalProcesses: processes.totalProcesses,
      protectedCount: processes.protectedCount,
      reviewableCount: processes.processes.filter(proc => !proc.protected).length,
      nodeCount: processes.nodeCount,
      topReviewable: reviewable,
      topProtectedAgents: protectedAgents,
    },
    watch: {
      command: 'pp watch --seconds 300 --interval 5',
      seconds: 300,
      intervalSeconds: 5,
      logPath: defaultProcessLedgerPath(),
      summaryPath: defaultProcessWatchSummaryPath(),
    },
    sds: {
      statusCommand: 'sds status -IncludeUnmanaged',
      reapCommand: 'sds reap',
      guidance: 'Use SDS for local dev-server lifecycle. Reap only when the server is stale, unmanaged, or no longer needed by an active review loop.',
    },
    commandCenter: {
      workItems: maintenance.relatedWorkItems,
      evidencePaths: [
        'C:/Users/frank/starlight/repos/starlight-agent-config/core/tasks/global-progress-ledger.json',
        'C:/Users/frank/starlight/repos/starlight-agent-config/core/policies/starlight-agent-orchestration-best-practices-2026-07-04.md',
        'C:/Users/frank/starlight/repos/peak-performance/docs/starlight-process-oversight.md',
        'C:/Users/frank/starlight/repos/peak-performance/docs/starlight-agent-action-policy.md',
        defaultProcessLedgerPath(),
        defaultProcessWatchSummaryPath(),
      ],
    },
    noTouch: [
      'Claude, Codex, Antigravity, Cursor, and active coding-agent workspaces.',
      'Local model runtimes, including LM Studio, llmster, Ollama, and model-serving workers.',
      'MCP/tooling servers, Hermes gateway, Starlight bridges, editors, and Windows system processes.',
      'Supervised or unmanaged dev servers without SDS status and owner review.',
    ],
    reviewBeforeStop: [
      'Build/generation jobs.',
      'Generic node processes.',
      'Shell processes with child jobs.',
      'Browsers and WebViews.',
      'Unknown processes without a repo, owner, purpose, and recovery command.',
    ],
    nextChecks: [
      'Run pp maintain before adding any new overnight swarm.',
      'Run pp inspect --all --json before any cleanup proposal.',
      'Run sds status -IncludeUnmanaged before starting or stopping web servers.',
      'Use pp prep before restart, sleep, or aggressive cleanup.',
    ],
  };
}

export function defaultOvernightGuardDir(): string {
  return join(os.homedir(), '.starlight', 'overnight-guard');
}

function stampFor(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

export function formatOvernightGuardMarkdown(plan: OvernightGuardPlan): string {
  const lines: string[] = [];
  lines.push(`# Peak Performance Overnight Guard - ${plan.timestamp}`);
  lines.push('');
  lines.push(`Host: ${plan.hostname}`);
  lines.push(`Directive: ${plan.directive.level}`);
  lines.push(`Allow new swarms: ${plan.directive.allowNewSwarms ? 'yes' : 'no'}`);
  lines.push(`Summary: ${plan.directive.summary}`);
  lines.push('');
  lines.push('## Maintenance');
  lines.push('');
  lines.push(`- ${plan.maintenance.summary}`);
  lines.push(`- RAM: ${plan.maintenance.metrics.ramUsedPct}% used (${plan.maintenance.metrics.ramFreeMB}MB free)`);
  lines.push(`- Disk: ${plan.maintenance.metrics.diskFreeGB}GB free`);
  lines.push(`- Processes: ${plan.maintenance.metrics.totalProcesses} total, ${plan.maintenance.metrics.nodeCount} node, ${plan.maintenance.metrics.namedAgentCount} named agents, ${plan.maintenance.metrics.reviewableCount} reviewable`);
  lines.push('');
  lines.push('## Queen Instructions');
  lines.push('');
  for (const item of plan.directive.queenInstructions) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Agent Instructions');
  lines.push('');
  for (const item of plan.directive.agentInstructions) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Watch And SDS');
  lines.push('');
  lines.push(`- Watch: \`${plan.watch.command}\``);
  lines.push(`- Watch log: \`${plan.watch.logPath}\``);
  lines.push(`- Watch summary: \`${plan.watch.summaryPath}\``);
  lines.push(`- SDS status: \`${plan.sds.statusCommand}\``);
  lines.push(`- SDS guidance: ${plan.sds.guidance}`);
  lines.push('');
  lines.push('## Top Reviewable Processes');
  lines.push('');
  lines.push('| PID | MB | Role | Name | Action |');
  lines.push('|---:|---:|---|---|---|');
  for (const proc of plan.processSnapshot.topReviewable) {
    lines.push(`| ${proc.pid} | ${proc.memMB} | ${proc.role} | ${proc.name} | ${proc.actionHint.replace(/\|/g, '/')} |`);
  }
  lines.push('');
  lines.push('## No Touch Without Coordination');
  lines.push('');
  for (const item of plan.noTouch) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Review Before Stop');
  lines.push('');
  for (const item of plan.reviewBeforeStop) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Evidence Paths');
  lines.push('');
  for (const path of plan.commandCenter.evidencePaths) lines.push(`- \`${path}\``);
  lines.push('');
  return lines.join('\n');
}

export function writeOvernightGuardPlan(plan: OvernightGuardPlan, dir = defaultOvernightGuardDir()): OvernightGuardWriteResult {
  mkdirSync(dir, { recursive: true });
  const stamp = stampFor(plan.timestamp);
  const jsonFile = join(dir, `overnight-guard-${stamp}.json`);
  const markdownFile = join(dir, `overnight-guard-${stamp}.md`);
  writeFileSync(jsonFile, JSON.stringify(plan, null, 2), 'utf8');
  writeFileSync(markdownFile, formatOvernightGuardMarkdown(plan), 'utf8');
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(plan, null, 2), 'utf8');
  writeFileSync(join(dir, 'latest.md'), formatOvernightGuardMarkdown(plan), 'utf8');
  return { dir, jsonFile, markdownFile };
}
