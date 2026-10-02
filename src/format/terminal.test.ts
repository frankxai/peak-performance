import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuditResult, TrendEntry } from '../types.js';
import { formatAudit, formatCompact, formatMarkdown, formatTrend, formatJson, formatMaintenanceCompact, formatMaintenancePlan } from './terminal.js';
import type { MaintenancePlan } from '../core/maintenance.js';

test('unknown audit renders explicitly across terminal, compact, markdown and JSON', () => {
  const audit: AuditResult = { timestamp: '2026-10-02T00:00:00Z', hostname: 'fixture', platform: 'linux',
    totalScore: null, rawScore: null, scoreCaps: ['Incomplete probe evidence: cpu'], grade: 'UNKNOWN',
    gates: [{ id: 'cpu', score: null, status: 'UNKNOWN', detail: 'Unknown CPU', metrics: {} }], recommendations: [] };
  for (const text of [formatAudit(audit), formatCompact(audit), formatMarkdown(audit)]) {
    assert.match(text, /Unknown/);
    assert.doesNotMatch(text, /null|NaN|0\/100|Critical cap/);
  }
  assert.equal(JSON.parse(formatJson(audit)).totalScore, null);
});
test('trend output never calculates a delta across an unknown reading', () => {
  const entry = (score: number | null): TrendEntry => ({ timestamp: '2026-10-02T00:00:00Z', score,
    grade: score === null ? 'UNKNOWN' : 'A+', gates: {} as TrendEntry['gates'] });
  const text = formatTrend([entry(90), entry(null)]);
  assert.match(text, /Change unknown/);
  assert.doesNotMatch(text, /90 points|null|NaN/);
  assert.match(formatTrend([entry(90), entry(94)]), /4 points/);
});

test('maintenance displays qualify unknown capacity rather than printing failed probes as zero', () => {
  const plan = { summary: 'Unknown health', posture: 'constrain', swarmPosture: 'pause-new-swarms',
    probeEvidence: { sampledAt: 'fixture', memory: 'unknown', disk: 'unknown', cpu: 'unknown', processes: 'unknown', crashes: 'unsupported' },
    metrics: { score: null, grade: 'UNKNOWN', ramUsedPct: 0, ramFreeMB: 0, diskFreeGB: 0, cpuLoadPct: 0, totalProcesses: 0, uptimeHours: 1 },
    reasons: [], actions: [], protectedRoles: {}, reviewableRoles: {}, relatedWorkItems: [],
  } as unknown as MaintenancePlan;
  for (const text of [formatMaintenanceCompact(plan), formatMaintenancePlan(plan)]) {
    assert.match(text, /Unknown/);
    assert.doesNotMatch(text, /CPU:? 0%|RAM:? 0%|Disk:? 0GB|Processes: 0|null/);
  }
});
