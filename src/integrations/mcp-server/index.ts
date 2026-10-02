#!/usr/bin/env node
/**
 * Peak Performance MCP Server
 * Exposes PP audit, preflight, fix, and trend tools.
 * Any AI agent with MCP support (Claude, Cursor, Codex, etc.) can use this.
 *
 * Usage:
 *   claude mcp add peak-performance -- node /absolute/path/to/dist/cli.js --mcp
 *   OR in .mcp.json:
 *   { "peak-performance": { "command": "node", "args": ["/absolute/path/to/dist/cli.js", "--mcp"] } }
 */
import { runAudit } from '../../core/audit.js';
import { buildMaintenancePlan } from '../../core/maintenance.js';
import { buildPreflightPlan, isWorkloadType, WORKLOADS } from '../../core/preflight.js';
import { TrendTracker } from '../../history/tracker.js';
import { runAllFixes } from '../../fixes/autofix.js';
import { formatMaintenanceCompact, formatMarkdown } from '../../format/terminal.js';
import { resolve, isAbsolute } from 'node:path';
import { statSync } from 'node:fs';

// MCP stdio protocol (simplified — for full SDK, use @modelcontextprotocol/sdk)
const respond = (id: string | number | undefined, result: unknown) => {
  if (id === undefined) return; // Don't respond to notifications
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
};

const respondError = (id: string | number | undefined, code: number, message: string) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

const TOOLS = [
  {
    name: 'pp_audit',
    description: 'Run a full system health audit. Returns scores for disk, memory, CPU/GPU, processes, git, security, workspace, knowledge, agent load, and overall system health.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'markdown', 'compact'], default: 'markdown' },
        theme: { type: 'string', enum: ['arcanea', 'plain'], default: 'arcanea' },
        cwd: { type: 'string', description: 'Existing fully qualified directory (default: current). UNC/device, Windows root-relative and POSIX double-slash paths are unsupported; the server directory must also be supported.' },
      },
    },
  },
  {
    name: 'pp_preflight',
    description: 'Return an allow, bounded, or hold decision before CPU/RAM-intensive local work. Read-only admission probe; never starts workloads or stops running processes.',
    inputSchema: {
      type: 'object',
      required: ['workload'],
      properties: {
        workload: { type: 'string', enum: WORKLOADS },
        reserveGB: { type: 'number', minimum: 0, description: 'Optional explicit workload peak reserve, especially for local models.' },
        cwd: { type: 'string', description: 'Existing fully qualified directory (default: current). UNC/device, Windows root-relative and POSIX double-slash paths are unsupported; the server directory must also be supported.' },
      },
    },
  },
  {
    name: 'pp_trend',
    description: 'Show score history and trend direction.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, default: 10, description: 'Number of entries to show' },
      },
    },
  },
  {
    name: 'pp_fix',
    description: 'Permanently delete eligible cache/temp files. Use dryRun: true to inspect first; omitted or false performs remediation. Returns before/after comparison.',
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false, description: 'Show what would be fixed without doing it' },
      },
    },
  },
];

/** Reject ambiguous/network namespace spellings before filesystem access.
 * This is a spelling gate, not a sandbox for mapped drives, mounts or junctions.
 */
function supportedCwd(target: string): string {
  if (!isAbsolute(target) ||
      (process.platform === 'win32' ? !/^[A-Za-z]:[\\/]/.test(target) : target.startsWith('//'))) {
    throw new Error('cwd must use a fully qualified supported path.');
  }
  return resolve(target);
}

function safeCwd(input: string | undefined): string {
  // Server-scoped history, trend and remediation must not bypass the spelling
  // gate through an explicit target. Validate both spellings before either stat.
  const server = supportedCwd(process.cwd());
  const target = input === undefined ? server : supportedCwd(input);
  if (!statSync(server).isDirectory() ||
      (target !== server && !statSync(target).isDirectory())) {
    throw new Error('cwd must be a directory.');
  }
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolInputError(id: string | number | undefined, message: string): void {
  respond(id, { content: [{ type: 'text', text: message }], isError: true });
}

function handleRequest(method: string, params: Record<string, unknown> | undefined, id: string | number | undefined) {
  switch (method) {
    case 'ping':
      respond(id, {});
      break;

    case 'initialize':
      if (id !== undefined) respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'peak-performance', version: '0.1.0' },
      });
      break;

    // MCP notifications — silently ignore (no id, no response expected)
    case 'notifications/initialized':
    case 'notifications/cancelled':
      break;

    case 'tools/list':
      if (id !== undefined) respond(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      if (!params || typeof params.name !== 'string' ||
          (params.arguments !== undefined && !isRecord(params.arguments))) {
        respondError(id, -32602, 'Tool call requires a string name and object arguments.');
        break;
      }
      const toolName = params.name;
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (args.cwd !== undefined && typeof args.cwd !== 'string') {
        toolInputError(id, 'cwd must be a string when provided.');
        break;
      }
      let cwd: string;
      try {
        cwd = safeCwd(args.cwd as string | undefined);
      } catch {
        toolInputError(id, 'Server and target cwd must name an existing absolute directory using a supported fully qualified path; UNC/device, Windows root-relative and POSIX double-slash paths are unsupported.');
        break;
      }
      if (toolName === 'pp_fix' && args.dryRun !== undefined && typeof args.dryRun !== 'boolean') {
        toolInputError(id, 'dryRun must be a boolean when provided.');
        break;
      }
      if (toolName === 'pp_audit' &&
          ((args.format !== undefined && !['json', 'markdown', 'compact'].includes(args.format as string)) ||
           (args.theme !== undefined && !['arcanea', 'plain'].includes(args.theme as string)))) {
        toolInputError(id, 'format must be json, markdown or compact; theme must be arcanea or plain.');
        break;
      }
      if (toolName === 'pp_trend' && args.count !== undefined &&
          (typeof args.count !== 'number' || !Number.isSafeInteger(args.count) || args.count < 1)) {
        toolInputError(id, 'count must be a positive safe integer when provided.');
        break;
      }

      switch (toolName) {
        case 'pp_preflight': {
          const workload = typeof args.workload === 'string' ? args.workload : undefined;
          if (!isWorkloadType(workload)) {
            if (id !== undefined) respondError(id, -32602, `Invalid workload. Use one of: ${WORKLOADS.join(', ')}`);
            break;
          }
          const reserveMB = args.reserveGB === undefined
            ? undefined
            : typeof args.reserveGB === 'number' ? args.reserveGB * 1_024 : Number.NaN;
          const plan = buildPreflightPlan(workload, {
            cwd,
            reserveMB,
          });
          respond(id, { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }], isError: plan.decision === 'hold' });
          break;
        }

        case 'pp_audit': {
          let content: string;
          if (args.format === 'compact') {
            content = formatMaintenanceCompact(buildMaintenancePlan(cwd), { color: false });
          } else {
            const audit = runAudit({ cwd });
            const tracker = new TrendTracker(resolve(process.cwd(), '.pp', 'history.json'));
            tracker.record(audit);
            if (args.format === 'json') content = JSON.stringify(audit, null, 2);
            else content = formatMarkdown(audit, (args.theme as 'arcanea' | 'plain') || 'arcanea');
          }

          respond(id, { content: [{ type: 'text', text: content }] });
          break;
        }

        case 'pp_trend': {
          const tracker = new TrendTracker(resolve(process.cwd(), '.pp', 'history.json'));
          const entries = tracker.getLast(Number(args.count) || 10);
          const delta = tracker.getDelta();

          let text = entries.map(e =>
            `${e.timestamp.slice(0, 16)} — ${e.score === null ? 'Unknown' : `${e.score}/100`} ${e.grade}${e.trigger ? ` (${e.trigger})` : ''}`
          ).join('\n');

          if (delta) {
            text += `\n\nTrend: ${delta.trend} (${delta.delta > 0 ? '+' : ''}${delta.delta} points)`;
          }

          respond(id, { content: [{ type: 'text', text: text || 'No history yet.' }] });
          break;
        }

        case 'pp_fix': {
          const before = runAudit({ cwd: process.cwd() });

          if (args.dryRun) {
            const fixable = before.recommendations.filter(r => r.autoFixable);
            const text = fixable.length > 0
              ? fixable.map(r => `Would fix: ${r.message}\n  $ ${r.fix}`).join('\n\n')
              : 'No auto-fixable issues found.';
            respond(id, { content: [{ type: 'text', text }] });
            break;
          }

          const results = runAllFixes(before.recommendations);
          const after = runAudit({ cwd: process.cwd() });
          const delta = after.totalScore === null || before.totalScore === null ? null : after.totalScore - before.totalScore;

          const text = [
            `Fixed ${results.filter(r => r.success).length}/${results.length} issues`,
            `Before: ${before.totalScore ?? 'Unknown'}/${before.grade}`,
            `After: ${after.totalScore ?? 'Unknown'}/${after.grade}`,
            `Delta: ${delta === null ? 'unknown; incomplete evidence' : `${delta > 0 ? '+' : ''}${delta} points`}`,
          ].join('\n');

          respond(id, { content: [{ type: 'text', text }] });
          break;
        }

        default:
          if (id !== undefined) respondError(id, -32601, `Unknown tool: ${toolName}`);
      }
      break;
    }

    default:
      if (id !== undefined) respondError(id, -32601, `Unknown method: ${method}`);
  }
}

// Bound partial lines and drain oversized messages to the next delimiter.
const MAX_MESSAGE_LENGTH = 65_536; // UTF-16 code units
let buffer = '';
let discarding = false;

function receiveLine(line: string): void {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    respondError(undefined, -32700, 'Parse error');
    return;
  }
  const rawId = isRecord(msg) ? msg.id : undefined;
  const id = typeof rawId === 'string' ||
    (typeof rawId === 'number' && Number.isInteger(rawId)) ? rawId : undefined;
  if (!isRecord(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string' ||
      (msg.params !== undefined && !isRecord(msg.params)) ||
      (rawId !== undefined && id === undefined)) {
    respondError(id, -32600, 'Invalid request');
    return;
  }
  // Tool invocations are requests. Never execute one disguised as a notification.
  if (id === undefined) return;
  if (msg.method.startsWith('notifications/')) {
    respondError(id, -32600, 'Notifications must not include a request ID.');
    return;
  }
  try {
    handleRequest(msg.method, msg.params as Record<string, unknown> | undefined, id);
  } catch {
    respondError(id, -32603, 'Internal server error');
  }
}

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  let start = 0;
  for (;;) {
    const newline = chunk.indexOf('\n', start);
    const fragment = chunk.slice(start, newline === -1 ? undefined : newline);
    if (!discarding) {
      if (buffer.length + fragment.length > MAX_MESSAGE_LENGTH) {
        buffer = '';
        discarding = true;
        respondError(undefined, -32600, 'Message exceeds 65536 UTF-16 code units.');
      } else {
        buffer += fragment;
      }
    }
    if (newline === -1) break;
    if (!discarding && buffer.trim()) receiveLine(buffer);
    buffer = '';
    discarding = false;
    start = newline + 1;
  }
});
