import assert from 'node:assert/strict';
import test from 'node:test';
import type { CrashLoopInfo, ProcessInfo } from '../core/probes.js';
import { scoreCpuGpu, scoreProcesses } from './scoring.js';

function processInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    totalProcesses: 180,
    nodeCount: 6,
    claudeCount: 0,
    cursorCount: 0,
    codexCount: 1,
    vscodeCount: 0,
    edgeChromeTabs: 4,
    protectedCount: 20,
    codexTaskRuntimeCount: 1,
    mcpCount: 5,
    mcpProcessCount: 10,
    mcpMemoryMB: 350,
    duplicateMcpProcesses: 0,
    agentTreeMemoryMB: 1_200,
    processes: [],
    topConsumers: [],
    ...overrides,
  };
}

const noCrashes: CrashLoopInfo = {
  windowMinutes: 15,
  totalCrashes: 0,
  topApp: '',
  topAppCrashes: 0,
  apps: [],
};

test('CPU gate treats kernel-heavy saturation as degraded', () => {
  const result = scoreCpuGpu({
    model: 'test',
    cores: 8,
    logicalCores: 16,
    loadPct: 82,
    systemLoadPct: 53,
    sampleMs: 350,
  }, null);

  assert.equal(result.score, 4);
  assert.equal(result.status, 'WARN');
  assert.equal(result.metrics.systemLoadPct, 53);
});

test('process gate becomes critical for an application crash loop', () => {
  const crashes: CrashLoopInfo = {
    windowMinutes: 15,
    totalCrashes: 44,
    topApp: 'YB9.UserCenter.exe',
    topAppCrashes: 44,
    apps: [{ name: 'YB9.UserCenter.exe', count: 44 }],
  };

  const result = scoreProcesses(processInfo(), crashes);

  assert.equal(result.score, 1);
  assert.equal(result.status, 'CRIT');
  assert.match(result.detail, /44 crashes\/15m/);
});

test('process gate accounts for hidden task runtimes and duplicate MCP servers', () => {
  const result = scoreProcesses(processInfo({
    totalProcesses: 557,
    nodeCount: 111,
    codexTaskRuntimeCount: 17,
    mcpCount: 86,
    mcpProcessCount: 205,
    mcpMemoryMB: 7_034,
    duplicateMcpProcesses: 80,
  }), noCrashes);

  assert.equal(result.score, 0);
  assert.equal(result.status, 'CRIT');
  assert.equal(result.metrics.taskRuntimes, 17);
  assert.equal(result.metrics.duplicateMcp, 80);
});

test('healthy process footprint retains a perfect gate', () => {
  const result = scoreProcesses(processInfo(), noCrashes);
  assert.equal(result.score, 10);
  assert.equal(result.status, 'PERFECT');
});
