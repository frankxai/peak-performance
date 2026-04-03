/**
 * Trend history — stores audit results as JSON for before/after comparisons.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AuditResult, TrendEntry, GateId } from '../types.js';

export class TrendTracker {
  private entries: TrendEntry[] = [];
  private filePath: string;
  private maxEntries: number;

  constructor(historyPath: string, maxEntries = 100) {
    this.filePath = resolve(historyPath);
    this.maxEntries = maxEntries;
    this.load();
  }

  private load(): void {
    if (existsSync(this.filePath)) {
      try {
        this.entries = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      } catch {
        this.entries = [];
      }
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  record(audit: AuditResult, trigger?: string): void {
    const entry: TrendEntry = {
      timestamp: audit.timestamp,
      score: audit.totalScore,
      grade: audit.grade,
      gates: Object.fromEntries(audit.gates.map(g => [g.id, g.score])) as Record<GateId, number>,
      trigger,
    };

    this.entries.push(entry);

    // Trim to max
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    this.save();
  }

  getAll(): TrendEntry[] {
    return [...this.entries];
  }

  getLast(n = 5): TrendEntry[] {
    return this.entries.slice(-n);
  }

  getDelta(): { current: number; previous: number; delta: number; trend: 'improving' | 'declining' | 'stable' } | null {
    if (this.entries.length < 2) return null;

    const current = this.entries[this.entries.length - 1];
    const previous = this.entries[this.entries.length - 2];
    const delta = current.score - previous.score;

    return {
      current: current.score,
      previous: previous.score,
      delta,
      trend: delta > 2 ? 'improving' : delta < -2 ? 'declining' : 'stable',
    };
  }

  getBestWorst(): { best: TrendEntry; worst: TrendEntry } | null {
    if (this.entries.length === 0) return null;
    const sorted = [...this.entries].sort((a, b) => a.score - b.score);
    return { worst: sorted[0], best: sorted[sorted.length - 1] };
  }
}
