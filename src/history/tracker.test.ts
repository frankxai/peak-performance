import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrendTracker } from './tracker.js';
import type { AuditResult } from '../types.js';

function audit(score: number | null): AuditResult {
  return { timestamp: new Date().toISOString(), hostname: 'fixture', platform: 'linux', totalScore: score,
    rawScore: score, scoreCaps: [], grade: score === null ? 'UNKNOWN' : 'A+',
    gates: [{ id: 'cpu', score: score === null ? null : 10, status: score === null ? 'UNKNOWN' : 'PERFECT', detail: 'fixture', metrics: {} }], recommendations: [] };
}
test('history persists unknown scores and excludes them from deltas and extrema', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pp-history-test-')), file = join(dir, 'history.json');
  try {
    const tracker = new TrendTracker(file);
    tracker.record(audit(null));
    assert.equal(tracker.getBestWorst(), null);
    tracker.record(audit(90));
    assert.equal(tracker.getDelta(), null);
    tracker.record(audit(94));
    assert.equal(tracker.getDelta()?.delta, 4);
    tracker.record(audit(null));
    const restored = new TrendTracker(file);
    assert.equal(restored.getDelta(), null);
    assert.equal(restored.getBestWorst()?.worst.score, 90);
    assert.equal(restored.getBestWorst()?.best.score, 94);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.at(-1).score, null);
    assert.equal(saved.at(-1).gates.cpu, null);
    assert.equal(restored.getLast(1)[0].grade, 'UNKNOWN');
  } finally { unlinkSync(file); rmdirSync(dir); }
});
