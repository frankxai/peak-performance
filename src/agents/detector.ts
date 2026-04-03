/**
 * AI Agent Detector — identifies which coding agents are running.
 */
import type { ProcessInfo } from '../core/probes.js';

export interface AgentProfile {
  name: string;
  processName: string;
  count: number;
  estimatedMemMB: number; // per instance
  category: 'ide' | 'cli' | 'cloud' | 'extension';
}

const AGENT_SIGNATURES: Omit<AgentProfile, 'count'>[] = [
  { name: 'Claude Code', processName: 'claude', estimatedMemMB: 450, category: 'cli' },
  { name: 'Cursor', processName: 'cursor', estimatedMemMB: 300, category: 'ide' },
  { name: 'Codex CLI', processName: 'codex', estimatedMemMB: 200, category: 'cli' },
  { name: 'VS Code', processName: 'code', estimatedMemMB: 250, category: 'ide' },
  { name: 'Windsurf', processName: 'windsurf', estimatedMemMB: 300, category: 'ide' },
  { name: 'Copilot', processName: 'copilot', estimatedMemMB: 150, category: 'extension' },
];

export function detectAgents(procs: ProcessInfo): AgentProfile[] {
  const agents: AgentProfile[] = [];

  const countMap: Record<string, number> = {
    claude: procs.claudeCount,
    cursor: procs.cursorCount,
    codex: procs.codexCount,
    code: procs.vscodeCount,
  };

  for (const sig of AGENT_SIGNATURES) {
    const count = countMap[sig.processName] ?? 0;
    if (count > 0) {
      agents.push({ ...sig, count });
    }
  }

  return agents;
}

export function agentLoadSummary(agents: AgentProfile[]): {
  totalAgents: number;
  totalEstMemMB: number;
  breakdown: string;
} {
  const totalAgents = agents.reduce((sum, a) => sum + a.count, 0);
  const totalEstMemMB = agents.reduce((sum, a) => sum + a.count * a.estimatedMemMB, 0);
  const breakdown = agents.map(a => `${a.name}: ${a.count}`).join(', ');

  return { totalAgents, totalEstMemMB, breakdown };
}
