/**
 * @arcanea/peak-performance
 *
 * System health auditor for AI-powered development machines.
 * Ten Gate scoring framework maps machine metrics to creative capacity.
 *
 * Usage as library:
 *   import { runAudit, formatMarkdown, TrendTracker } from '@arcanea/peak-performance';
 *   const result = runAudit();
 *   console.log(formatMarkdown(result));
 *
 * Usage as CLI:
 *   npx @arcanea/pp audit
 *   npx @arcanea/pp trend
 *   npx @arcanea/pp fix
 *
 * Usage as MCP server:
 *   claude mcp add peak-performance -- npx @arcanea/pp --mcp
 */

// Core
export { runAudit } from './core/audit.js';

// Probes
export {
  probeMemory, probeCpu, probeDisk, probeGpu,
  probeProcesses, probeGit, probeSecrets, probeTemp, probeUptime,
} from './core/probes.js';

// Gates
export {
  scoreDisk, scoreMemory, scoreCpuGpu, scoreProcesses,
  scoreGit, scoreSecrets, scoreWorkspace, scoreKnowledge,
  scoreAgentLoad, scoreSystem, grade,
} from './gates/scoring.js';

// Agent detection
export { detectAgents, agentLoadSummary } from './agents/detector.js';

// History
export { TrendTracker } from './history/tracker.js';

// Fixes
export { runAllFixes, cleanNpmCache, cleanTempFiles, applyFix } from './fixes/autofix.js';

// Formatters
export {
  formatAudit, formatTrend, formatCompact,
  formatJson, formatMarkdown,
} from './format/terminal.js';

// Types
export type {
  AuditResult, GateScore, GateId, Recommendation,
  TrendEntry, PPConfig,
} from './types.js';
export { GATE_NAMES, DEFAULT_CONFIG } from './types.js';
