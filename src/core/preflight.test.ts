import assert from 'node:assert/strict';
import test from 'node:test';
import type { MaintenancePlan } from './maintenance.js';
import { evaluatePreflight } from './preflight.js';

function maintenance(overrides: Partial<MaintenancePlan['metrics']> = {}, posture: MaintenancePlan['posture'] = 'green'): MaintenancePlan {
  return {
    timestamp: '2026-07-11T00:00:00.000Z',
    hostname: 'test-host',
    posture,
    swarmPosture: posture === 'green' ? 'expand' : posture === 'watch' ? 'steady' : posture === 'constrain' ? 'pause-new-swarms' : 'drain-and-handoff',
    summary: 'test',
    metrics: {
      score: 90,
      grade: 'A',
      ramUsedPct: 45,
      ramFreeMB: 18_000,
      diskFreeGB: 200,
      uptimeHours: 12,
      totalProcesses: 250,
      nodeCount: 20,
      namedAgentCount: 1,
      codexTaskRuntimeCount: 2,
      aiProcessCount: 2,
      localModelCount: 0,
      mcpCount: 8,
      mcpProcessCount: 20,
      mcpMemoryMB: 1_000,
      duplicateMcpProcesses: 2,
      agentTreeMemoryMB: 2_000,
      devServerCount: 0,
      buildCount: 0,
      reviewableCount: 80,
      cpuLoadPct: 20,
      cpuSystemLoadPct: 5,
      recentCrashCount: 0,
      crashLoopApp: '',
      crashLoopCount: 0,
      ...overrides,
    },
    reasons: [],
    actions: [],
    protectedRoles: {},
    reviewableRoles: {},
    relatedWorkItems: [],
  };
}

test('admits normal interactive work without unnecessary restrictions', () => {
  const result = evaluatePreflight(maintenance({ crashLoopApp: 'test.exe', crashLoopCount: 20 }, 'maintenance'), 'interactive');
  assert.equal(result.decision, 'allow');
  assert.equal(result.requirements.receiptRequired, false);
});

test('bounds a build during maintenance instead of blocking normal work', () => {
  const result = evaluatePreflight(maintenance({ crashLoopApp: 'test.exe', crashLoopCount: 20 }, 'maintenance'), 'build');
  assert.equal(result.decision, 'bounded');
  assert.equal(result.hardBlocks.length, 0);
  assert.match(result.constraints.join(' '), /one bounded workload/);
});

test('holds a local model when RAM reserve and task budget are insufficient', () => {
  const result = evaluatePreflight(maintenance({
    ramFreeMB: 9_000,
    codexTaskRuntimeCount: 12,
    crashLoopApp: 'test.exe',
    crashLoopCount: 20,
  }, 'maintenance'), 'local-model');

  assert.equal(result.decision, 'hold');
  assert.match(result.hardBlocks.join(' '), /RAM reserve is short/);
  assert.match(result.hardBlocks.join(' '), /crash-looping/);
  assert.match(result.hardBlocks.join(' '), /task runtimes/);
});

test('uses an explicit local-model reserve when provided', () => {
  const result = evaluatePreflight(maintenance({ ramFreeMB: 14_500 }), 'local-model', 8_192);
  assert.equal(result.budget.workloadReserveMB, 8_192);
  assert.equal(result.budget.requiredFreeMB, 12_288);
  assert.equal(result.decision, 'allow');
});

test('holds unattended work under restart-soon posture', () => {
  const result = evaluatePreflight(maintenance({}, 'restart-soon'), 'overnight');
  assert.equal(result.decision, 'hold');
  assert.match(result.hardBlocks.join(' '), /restart-soon/);
});
