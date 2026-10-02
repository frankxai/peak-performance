import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scoreAuditSnapshot, type AuditProbeSnapshot } from './audit.js';

export function healthySnapshot(): AuditProbeSnapshot {
  return {
    mem: { totalMB: 10000, freeMB: 5000, usedPct: 50 },
    cpu: { status: 'measured', model: 'fixture', cores: 1, logicalCores: 1, loadPct: 20, systemLoadPct: 10, sampleMs: 350 },
    disk: { drive: 'fixture', totalGB: 1000, freeGB: 500, usedPct: 50 }, gpu: null,
    procs: { status: 'measured', totalProcesses: 100, nodeCount: 2, claudeCount: 0, cursorCount: 0, codexCount: 1,
      vscodeCount: 0, edgeChromeTabs: 0, protectedCount: 1, codexTaskRuntimeCount: 1,
      mcpCount: 0, mcpProcessCount: 0, mcpMemoryMB: 0, duplicateMcpProcesses: 0, agentTreeMemoryMB: 200, processes: [], topConsumers: [] },
    git: { isRepo: false, branch: '', repoSizeMB: 0, uncommittedFiles: 0, untrackedFiles: 0, hasLockFiles: false, recentCommitStyle: 'unknown' },
    secrets: { envFilesFound: [], envFilesGitignored: true, suspiciousFiles: [] },
    temp: { tempDir: 'fixture', fileCount: 0 }, uptime: { uptimeHours: 1 },
    crashes: { status: 'measured', windowMinutes: 15, totalCrashes: 0, topApp: '', topAppCrashes: 0, apps: [] },
  };
}

test('a failed CPU, process or unsupported crash reading makes the whole audit unknown', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pp-audit-test-'));
  try {
    const measured = scoreAuditSnapshot(healthySnapshot(), { cwd });
    assert.equal(measured.totalScore, 92);
    for (const field of ['cpu', 'procs', 'crashes'] as const) {
      const snapshot = healthySnapshot();
      snapshot[field].status = field === 'crashes' ? 'unsupported' : 'unknown';
      const audit = scoreAuditSnapshot(snapshot, { cwd });
      assert.equal(audit.totalScore, null);
      assert.equal(audit.rawScore, null);
      assert.equal(audit.grade, 'UNKNOWN');
      assert.match(audit.scoreCaps.join(' '), /Incomplete probe evidence/);
    }
    const invalid = healthySnapshot();
    invalid.mem = { totalMB: 0, freeMB: 0, usedPct: 0 };
    invalid.disk = { drive: 'fixture', totalGB: 0, freeGB: 0, usedPct: 0 };
    const audit = scoreAuditSnapshot(invalid, { cwd });
    assert.equal(audit.totalScore, null);
    assert.ok(!audit.recommendations.some(r => r.gate === 'disk' || r.gate === 'memory'));
  } finally { rmdirSync(cwd); }
});

test('measured saturation and crash loops retain numerical critical caps', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pp-audit-test-'));
  try {
    const saturated = healthySnapshot(); saturated.cpu.loadPct = 100;
    assert.equal(scoreAuditSnapshot(saturated, { cwd }).totalScore, 69);
    const crashing = healthySnapshot();
    crashing.crashes = { status: 'measured', windowMinutes: 15, totalCrashes: 10, topApp: 'fixture.exe', topAppCrashes: 10, apps: [{ name: 'fixture.exe', count: 10 }] };
    assert.equal(scoreAuditSnapshot(crashing, { cwd }).totalScore, 49);
  } finally { rmdirSync(cwd); }
});
