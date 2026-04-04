/**
 * Auto-fix recipes — safe, reversible fixes for common issues.
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import type { Recommendation } from '../types.js';

export interface FixResult {
  recommendation: Recommendation;
  success: boolean;
  output: string;
}

/** Safe command execution — no shell, array args only */
function runSafe(cmd: string, args: string[], timeout = 30_000): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout, windowsHide: true }).trim();
  } catch (e: unknown) {
    return `Error: ${e instanceof Error ? e.message : 'unknown'}`;
  }
}

/** Known safe fix operations — allowlisted, never arbitrary shell execution */
const FIX_REGISTRY: Record<string, () => string> = {
  'npm-cache-clean': () => runSafe('npm', ['cache', 'clean', '--force']),
  'temp-clean-win': () => runSafe('powershell', ['-NoProfile', '-Command',
    'Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-3) } | ' +
    'Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Write-Output done']),
  'temp-clean-unix': () => runSafe('find', [os.tmpdir(), '-type', 'f', '-mtime', '+3', '-delete']),
};

export function applyFix(rec: Recommendation): FixResult {
  if (!rec.autoFixable || !rec.fix) {
    return { recommendation: rec, success: false, output: 'Not auto-fixable' };
  }

  const fixFn = FIX_REGISTRY[rec.fix];
  if (!fixFn) {
    return { recommendation: rec, success: false, output: `Unknown fix: ${rec.fix}` };
  }

  const output = fixFn();
  return {
    recommendation: rec,
    success: !output.startsWith('Error'),
    output,
  };
}

export function cleanNpmCache(): FixResult {
  const output = runSafe('npm', ['cache', 'clean', '--force']);
  return {
    recommendation: { priority: 'medium', gate: 'disk', message: 'Clean npm cache', fix: 'npm-cache-clean', autoFixable: true },
    success: !output.startsWith('Error'),
    output: output || 'npm cache cleaned',
  };
}

export function cleanTempFiles(): FixResult {
  const fixKey = os.platform() === 'win32' ? 'temp-clean-win' : 'temp-clean-unix';
  const output = FIX_REGISTRY[fixKey]();
  return {
    recommendation: { priority: 'medium', gate: 'workspace', message: 'Clean temp files older than 3 days', fix: fixKey, autoFixable: true },
    success: !output.startsWith('Error'),
    output,
  };
}

/** Run all safe auto-fixes */
export function runAllFixes(recommendations: Recommendation[]): FixResult[] {
  return recommendations
    .filter(r => r.autoFixable && r.fix)
    .map(applyFix);
}
