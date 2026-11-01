/** Read-only review plans. Cache and temp deletion is irreversible. */
import type { Recommendation } from '../types.js';

export interface FixResult {
  recommendation: Recommendation;
  success: boolean;
  disposition: 'held';
  executionPermitted: false;
  output: string;
}

const CLEANUP_IDS = new Set(['npm-cache-clean', 'temp-clean-win', 'temp-clean-unix']);

/** Legacy entry points remain callable, but never execute remediation. */
export function applyFix(rec: Recommendation): FixResult {
  return {
    recommendation: rec,
    success: false,
    disposition: 'held',
    executionPermitted: false,
    output: !rec.fix ? 'No remediation specified.'
      : CLEANUP_IDS.has(rec.fix) ? 'Cache/temp deletion requires an explicit owner-reviewed plan and approval; PP does not perform it.'
      : 'Unknown fix; requires review.',
  };
}

export function cleanNpmCache(): FixResult {
  return applyFix({ priority: 'medium', gate: 'disk', message: 'Review npm cache ownership and reclaim plan', fix: 'npm-cache-clean', autoFixable: false });
}

export function cleanTempFiles(): FixResult {
  return applyFix({ priority: 'medium', gate: 'workspace', message: 'Review temp-file ownership and reclaim plan',
    fix: process.platform === 'win32' ? 'temp-clean-win' : 'temp-clean-unix', autoFixable: false });
}

/** Produce held plans, including recommendations already marked manual. */
export function runAllFixes(recommendations: Recommendation[]): FixResult[] {
  return recommendations.filter(r => r.fix).map(applyFix);
}
