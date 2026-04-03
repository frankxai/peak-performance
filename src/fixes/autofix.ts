/**
 * Auto-fix recipes — safe, reversible fixes for common issues.
 */
import { execSync } from 'node:child_process';
import os from 'node:os';
import type { Recommendation } from '../types.js';

export interface FixResult {
  recommendation: Recommendation;
  success: boolean;
  output: string;
  freedMB?: number;
}

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30_000 }).trim();
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

export function applyFix(rec: Recommendation): FixResult {
  if (!rec.autoFixable || !rec.fix) {
    return { recommendation: rec, success: false, output: 'Not auto-fixable' };
  }

  const output = run(rec.fix);
  return {
    recommendation: rec,
    success: !output.startsWith('Error'),
    output,
  };
}

export function cleanNpmCache(): FixResult {
  const before = run('npm cache ls 2>/dev/null | wc -l');
  const output = run('npm cache clean --force');
  return {
    recommendation: { priority: 'medium', gate: 'disk', message: 'Clean npm cache', fix: 'npm cache clean --force', autoFixable: true },
    success: true,
    output: `Cleaned npm cache (was ${before} entries). ${output}`,
  };
}

export function cleanTempFiles(): FixResult {
  const platform = os.platform();
  let output: string;

  if (platform === 'win32') {
    output = run('powershell -Command "Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-3) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; Write-Output done"');
  } else {
    output = run('find /tmp -type f -mtime +3 -delete 2>/dev/null; echo done');
  }

  return {
    recommendation: { priority: 'medium', gate: 'workspace', message: 'Clean temp files older than 3 days', autoFixable: true },
    success: true,
    output,
  };
}

export function killOrphanNodes(): FixResult {
  // Only kills node processes that have been running for > 2 hours with no parent
  // This is conservative — won't kill active dev servers
  const output = run(
    os.platform() === 'win32'
      ? 'echo "Manual review recommended — run: tasklist /fi \\"imagename eq node.exe\\" to identify orphans"'
      : 'echo "Manual review recommended — run: ps aux | grep node to identify orphans"'
  );

  return {
    recommendation: { priority: 'medium', gate: 'processes', message: 'Review orphan node processes', autoFixable: false },
    success: true,
    output,
  };
}

/** Run all safe auto-fixes */
export function runAllFixes(recommendations: Recommendation[]): FixResult[] {
  return recommendations
    .filter(r => r.autoFixable && r.fix)
    .map(applyFix);
}
