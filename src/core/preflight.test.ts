import assert from 'node:assert/strict';
import test from 'node:test';
import type { MaintenancePlan } from './maintenance.js';
import { evaluatePreflight as evaluateActualPreflight, readPreflightReserveMB } from './preflight.js';

import type { StorageEvidence } from './storage.js';

function measuredStorage(free = 20): StorageEvidence {
  return { sampledAt: new Date().toISOString(), readings: ['system', 'target', 'temp'].map(scope => ({ scope: scope as 'system' | 'target' | 'temp', status: 'measured', totalBytes: '1000000', availableBytes: String(free * 10000) })) };
}
function evaluatePreflight(maintenance: MaintenancePlan, workload: Parameters<typeof evaluateActualPreflight>[1], reserve?: number, storage = measuredStorage()) {
  return evaluateActualPreflight(maintenance, workload, reserve, storage);
}

function maintenance(overrides: Partial<MaintenancePlan['metrics']> = {}, posture: MaintenancePlan['posture'] = 'green'): MaintenancePlan {
  return {
    timestamp: '2026-07-11T00:00:00.000Z',
    probeEvidence: { sampledAt: new Date().toISOString(), memory: 'measured', disk: 'measured', cpu: 'measured', processes: 'measured', crashes: 'measured' },
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

test('unknown or missing capacity evidence holds reserved work while ordinary reading remains available', () => {
  for (const key of ['memory', 'disk'] as const) {
    for (const status of ['unknown', undefined] as const) {
      const plan = maintenance();
      if (status === undefined) delete (plan.probeEvidence as Partial<NonNullable<MaintenancePlan['probeEvidence']>>)[key];
      else plan.probeEvidence![key] = status;
      assert.equal(evaluatePreflight(plan, 'review-lite', 2048).decision, 'hold');
      assert.equal(evaluatePreflight(plan, 'interactive', 0).decision, 'allow');
    }
  }
});

test('storage floors bind the reproduced model/swarm/overnight/build cases independently of RAM', () => {
  for (const free of [3, 5, 10, 15]) for (const workload of ['build', 'local-model', 'swarm', 'overnight'] as const) {
    const result = evaluatePreflight(maintenance({ ramFreeMB: 40_000 }), workload, 12_288, measuredStorage(free));
    assert.equal(result.decision, free < 8 || free < 15 && workload !== 'build' ? 'hold' : free < 15 ? 'bounded' : 'allow', `${free}% ${workload}`);
    assert.equal(result.requirements.diskGrowthPermitted, result.decision !== 'hold');
    assert.equal(result.requirements.storageRecheckBeforeGrowth, true);
    assert.equal(result.requirements.storageCleanupRequired, free === 10 && workload === 'build');
    assert.ok(Object.values(result.storageLimits).every(prohibited => prohibited === (free < 15)));
  }
});

test('target and temp floor breaches override a healthy system volume', () => {
  for (const scope of ['system', 'target', 'temp']) {
    const storage = measuredStorage();
    storage.readings.find(r => r.scope === scope)!.availableBytes = '79999';
    const result = evaluatePreflight(maintenance(), 'build', undefined, storage);
    assert.equal(result.decision, 'hold', scope);
    assert.equal(result.storage.state, 'hold');
  }
});

test('missing, duplicate, stale and malformed storage evidence never admits growing work', () => {
  const malformed = measuredStorage(); malformed.readings[0].availableBytes = '1000001';
  const duplicate = measuredStorage(); duplicate.readings[1].scope = 'system';
  const stale = measuredStorage(); stale.sampledAt = new Date(Date.now() - 15 * 60_000).toISOString();
  const unknown = measuredStorage(); unknown.readings[0].status = 'unknown';
  for (const storage of [undefined, malformed, duplicate, stale, unknown]) {
    assert.equal(evaluateActualPreflight(maintenance(), 'build', undefined, storage).decision, 'hold');
  }
});

test('freeze holds reading and demands escalation without performing remediation', () => {
  const storage = measuredStorage(3);
  storage.readings[1].status = 'unknown';
  const result = evaluatePreflight(maintenance(), 'interactive', 0, storage);
  assert.equal(result.decision, 'hold');
  assert.equal(result.storage.state, 'freeze');
  assert.equal(result.requirements.escalationRequired, true);
});

test('reading stays permitted above freeze; declaring interactive never grants disk growth', () => {
  for (const free of [4, 7, 8, 10, 15]) {
    const result = evaluatePreflight(maintenance(), 'interactive', 0, measuredStorage(free));
    assert.equal(result.decision, 'allow');
    assert.equal(result.requirements.diskGrowthPermitted, false);
  }
  const noProof = maintenance(); delete noProof.probeEvidence;
  assert.equal(evaluateActualPreflight(noProof, 'interactive', 0).decision, 'allow');
  assert.equal(evaluatePreflight(maintenance(), 'interactive', 2048, measuredStorage(10)).requirements.diskGrowthPermitted, false);
});

test('probe failure, partial data, unsupported crashes and stale evidence hold budgeted work', () => {
  for (const key of ['cpu', 'processes', 'crashes'] as const) {
    const current = maintenance(); current.probeEvidence![key] = 'unknown';
    assert.equal(evaluatePreflight(current, 'build').decision, 'hold', key);
  }
  const unsupported = maintenance(); unsupported.probeEvidence!.crashes = 'unsupported';
  assert.equal(evaluatePreflight(unsupported, 'overnight').decision, 'hold');
  const missing = maintenance(); delete missing.probeEvidence;
  assert.equal(evaluatePreflight(missing, 'interactive', 1).decision, 'hold');
  const stale = maintenance(); stale.probeEvidence!.sampledAt = '2000-01-01T00:00:00Z';
  assert.equal(evaluatePreflight(stale, 'build').decision, 'hold');
  assert.equal(evaluatePreflight(maintenance({ cpuLoadPct: Number.NaN }), 'build').decision, 'hold');
  assert.equal(evaluatePreflight(maintenance({ codexTaskRuntimeCount: -1 }), 'build').decision, 'hold');
});

test('admits normal interactive work without unnecessary restrictions', () => {
  const result = evaluatePreflight(maintenance({ crashLoopApp: 'test.exe', crashLoopCount: 20 }, 'maintenance'), 'interactive');
  assert.equal(result.decision, 'allow');
  assert.equal(result.requirements.receiptRequired, false);
});

test('admits a lightweight reviewer when full swarm RAM remains held', () => {
  const current = maintenance({ ramFreeMB: 7_000 });
  const review = evaluatePreflight(current, 'review-lite');
  const swarm = evaluatePreflight(current, 'swarm');

  assert.equal(review.decision, 'allow');
  assert.equal(review.budget.requiredFreeMB, 6_144);
  assert.equal(review.budget.maxParallelism, 1);
  assert.equal(review.requirements.strictMcpRecommended, true);
  assert.match(review.actions.join(' '), /strict empty MCP/i);
  assert.equal(swarm.decision, 'hold');
  assert.match(swarm.hardBlocks.join(' '), /RAM reserve is short/i);
});

test('bounds review-lite under maintenance instead of blocking deterministic review', () => {
  const result = evaluatePreflight(maintenance({}, 'maintenance'), 'review-lite');
  assert.equal(result.decision, 'bounded');
  assert.equal(result.hardBlocks.length, 0);
  assert.match(result.constraints.join(' '), /one bounded workload/i);
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

test('keeps zero-reserve interactive reading available below the safety floor', () => {
  const current = maintenance({ ramFreeMB: 2_419 }, 'maintenance');
  for (const reserve of [undefined, 0]) {
    const result = evaluatePreflight(current, 'interactive', reserve);
    assert.equal(result.decision, 'allow');
    assert.equal(result.budget.ramGated, false);
    assert.equal(result.budget.requiredFreeMB, 0);
    assert.match(result.summary, /RAM admission gate is not applied/);
  }
});

test('holds an interactive workload that explicitly reserves RAM below the floor', () => {
  const result = evaluatePreflight(maintenance({ ramFreeMB: 2_419 }), 'interactive', 512);
  assert.equal(result.decision, 'hold');
  assert.equal(result.budget.requiredFreeMB, 4_608);
  assert.equal(result.budget.ramGated, true);
  assert.equal(result.requirements.receiptRequired, true);
  assert.equal(result.requirements.stopAfterWork, true);
  assert.match(result.hardBlocks.join(' '), /RAM reserve is short/);
});

test('admits an explicit interactive reserve only at the floor plus reserve boundary', () => {
  assert.equal(evaluatePreflight(maintenance({ ramFreeMB: 4_607 }), 'interactive', 512).decision, 'hold');
  assert.equal(evaluatePreflight(maintenance({ ramFreeMB: 4_608 }), 'interactive', 512).decision, 'allow');
});

test('rounds a positive fractional reserve up and preserves the safety floor', () => {
  const held = evaluatePreflight(maintenance({ ramFreeMB: 4_096 }), 'interactive', 0.1);
  assert.equal(held.decision, 'hold');
  assert.equal(held.budget.workloadReserveMB, 1);
  assert.equal(evaluatePreflight(maintenance({ ramFreeMB: 4_097 }), 'interactive', 0.1).decision, 'allow');
});

test('holds invalid reserve inputs instead of admitting them', () => {
  for (const reserve of [NaN, Infinity, -Infinity, -1]) {
    const result = evaluatePreflight(maintenance(), 'interactive', reserve);
    assert.equal(result.decision, 'hold', `reserve ${reserve}`);
    assert.match(result.hardBlocks.join(' '), /reserve.*finite.*non-negative/i);
  }
  assert.equal(evaluatePreflight(maintenance({ ramFreeMB: 100 }), 'build', NaN).decision, 'hold');
});

test('holds budgeted workloads when RAM evidence is invalid', () => {
  for (const ramFreeMB of [NaN, Infinity, -Infinity, -1]) {
    for (const [workload, reserve] of [['build', undefined], ['interactive', 512]] as const) {
      const result = evaluatePreflight(maintenance({ ramFreeMB }), workload, reserve);
      assert.equal(result.decision, 'hold', `${workload}, RAM ${ramFreeMB}`);
      assert.match(result.hardBlocks.join(' '), /RAM.*finite.*non-negative/i);
    }
  }
});

test('parses reserve flags without discarding invalid explicit values', () => {
  assert.equal(readPreflightReserveMB(['preflight', '--workload', 'interactive']), undefined);
  assert.equal(readPreflightReserveMB(['--reserve-gb', '0.5']), 512);
  assert.equal(readPreflightReserveMB(['--reserve-gb=0.5']), 512);
  assert.equal(readPreflightReserveMB(['--reserve-gb', '0']), 0);
  for (const args of [
    ['--reserve-gb'], ['--reserve-gb='], ['--reserve-gb', ' '],
    ['--reserve-gb', '--json'], ['--reserve-gb=NaN'],
    ['--reserve-gb=Infinity'], ['--reserve-gb=-1'], ['--reserve-gb=bad'],
    ['--reserve-gb=0x10'], ['--reserve-gb=0b1'], ['--reserve-gb=1e-400'],
    ['--reserve-gb=0.' + '0'.repeat(400) + '1'],
  ]) {
    const reserve = readPreflightReserveMB(args);
    assert.notEqual(reserve, undefined, JSON.stringify(args));
    assert.equal(evaluatePreflight(maintenance(), 'interactive', reserve).decision, 'hold', JSON.stringify(args));
  }
});

test('uses the largest repeated reserve and holds if any repeated value is invalid', () => {
  for (const args of [
    ['--reserve-gb', '0', '--reserve-gb', '8'],
    ['--reserve-gb=8', '--reserve-gb=0'],
    ['--reserve-gb=0', '--reserve-gb', '8'],
  ]) {
    const reserve = readPreflightReserveMB(args);
    assert.equal(reserve, 8_192);
    assert.equal(evaluatePreflight(maintenance({ ramFreeMB: 7_000 }), 'interactive', reserve).decision, 'hold');
  }
  for (const args of [
    ['--reserve-gb=0', '--reserve-gb=bad'],
    ['--reserve-gb=bad', '--reserve-gb=8'],
    ['--reserve-gb=8', '--reserve-gb'],
  ]) {
    assert.equal(evaluatePreflight(maintenance(), 'interactive', readPreflightReserveMB(args)).decision, 'hold');
  }
});

test('zero-reserve reading stays available with unknown RAM and reserved work holds at zero RAM', () => {
  assert.equal(evaluatePreflight(maintenance({ ramFreeMB: NaN }), 'interactive').decision, 'allow');
  assert.equal(evaluatePreflight(maintenance({ ramFreeMB: 0 }), 'interactive', 512).decision, 'hold');
});

test('non-interactive work enforces the safety floor even with zero reserve', () => {
  const result = evaluatePreflight(maintenance({ ramFreeMB: 2_419 }), 'build', 0);
  assert.equal(result.decision, 'hold');
  assert.equal(result.budget.ramGated, true);
  assert.equal(result.budget.requiredFreeMB, 4_096);
  assert.equal(evaluatePreflight(maintenance({ ramFreeMB: 4_096 }), 'build', 0).decision, 'allow');
});
