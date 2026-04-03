#!/usr/bin/env node
/**
 * Peak Performance MCP Server
 * Exposes pp_audit, pp_fix, pp_trend as MCP tools.
 * Any AI agent with MCP support (Claude, Cursor, Codex, etc.) can use this.
 *
 * Usage:
 *   claude mcp add peak-performance -- npx @arcanea/pp --mcp
 *   OR in .mcp.json:
 *   { "peak-performance": { "command": "npx", "args": ["@arcanea/pp", "--mcp"] } }
 */
import { runAudit } from '../../core/audit.js';
import { TrendTracker } from '../../history/tracker.js';
import { runAllFixes } from '../../fixes/autofix.js';
import { formatMarkdown } from '../../format/terminal.js';
import { resolve } from 'node:path';

// MCP stdio protocol (simplified — for full SDK, use @modelcontextprotocol/sdk)
const respond = (id: string | number, result: unknown) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');

const respondError = (id: string | number, code: number, message: string) =>
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
        cwd: { type: 'string', description: 'Working directory to audit (default: current)' },
      },
    },
  },
  {
    name: 'pp_trend',
    description: 'Show score history and trend direction.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', default: 10, description: 'Number of entries to show' },
      },
    },
  },
  {
    name: 'pp_fix',
    description: 'Run auto-fixable remediation (clean npm cache, temp files, etc). Returns before/after comparison.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false, description: 'Show what would be fixed without doing it' },
      },
    },
  },
];

function handleRequest(method: string, params: any, id: string | number) {
  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'peak-performance', version: '0.1.0' },
      });
      break;

    case 'tools/list':
      respond(id, { tools: TOOLS });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      switch (toolName) {
        case 'pp_audit': {
          const audit = runAudit({ cwd: args.cwd || process.cwd() });
          const tracker = new TrendTracker(resolve(process.cwd(), '.pp', 'history.json'));
          tracker.record(audit);

          let content: string;
          if (args.format === 'json') content = JSON.stringify(audit, null, 2);
          else if (args.format === 'compact') content = `PP ${audit.totalScore}/${audit.grade}`;
          else content = formatMarkdown(audit, args.theme || 'arcanea');

          respond(id, { content: [{ type: 'text', text: content }] });
          break;
        }

        case 'pp_trend': {
          const tracker = new TrendTracker(resolve(process.cwd(), '.pp', 'history.json'));
          const entries = tracker.getLast(args.count || 10);
          const delta = tracker.getDelta();

          let text = entries.map(e =>
            `${e.timestamp.slice(0, 16)} — ${e.score}/100 ${e.grade}${e.trigger ? ` (${e.trigger})` : ''}`
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

          const text = [
            `Fixed ${results.filter(r => r.success).length}/${results.length} issues`,
            `Before: ${before.totalScore}/${before.grade}`,
            `After: ${after.totalScore}/${after.grade}`,
            `Delta: ${after.totalScore - before.totalScore > 0 ? '+' : ''}${after.totalScore - before.totalScore} points`,
          ].join('\n');

          respond(id, { content: [{ type: 'text', text }] });
          break;
        }

        default:
          respondError(id, -32601, `Unknown tool: ${toolName}`);
      }
      break;
    }

    default:
      if (id) respondError(id, -32601, `Unknown method: ${method}`);
  }
}

// STDIO transport
let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      handleRequest(msg.method, msg.params, msg.id);
    } catch (e: any) {
      process.stderr.write(`Parse error: ${e.message}\n`);
    }
  }
});
