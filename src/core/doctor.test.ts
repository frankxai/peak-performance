import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuditResult, GateScore } from '../types.js';
import { diagnose } from './doctor.js';

function result(gates: GateScore[]): AuditResult {
  return { timestamp: 'fixture', hostname: 'fixture', platform: 'linux', totalScore: null,
    rawScore: null, grade: 'UNKNOWN', scoreCaps: [], gates, recommendations: [] };
}
test('doctor reports missing evidence without diagnosing null as overload or critical disk', () => {
  const gates: GateScore[] = (['disk', 'memory', 'processes', 'agents', 'cpu'] as const).map(id => ({
    id, score: null, status: 'UNKNOWN', detail: 'fixture', metrics: {},
  }));
  const diagnoses = diagnose(result(gates));
  assert.equal(diagnoses.length, 1);
  assert.equal(diagnoses[0].rootCause, 'Incomplete health evidence');
  assert.deepEqual(diagnoses[0].affectedGates, gates.map(g => g.id));
  assert.equal(diagnoses[0].actions[0].estimatedImpact, 'Unknown until measured');
  assert.equal(diagnoses[0].actions[0].command, undefined);
});
test('doctor retains an actual measured low-disk diagnosis', () => {
  const diagnoses = diagnose(result([{ id: 'disk', score: 2, status: 'CRIT', detail: 'fixture', metrics: { freeGB: 5 } }]));
  assert.equal(diagnoses[0].rootCause, 'Disk space critical');
});
