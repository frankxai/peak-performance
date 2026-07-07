import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { probeProcesses, type ProcessConsumer } from './probes.js';

export type ProcessLedgerEventType = 'start' | 'stop';

export interface ProcessLedgerEvent {
  timestamp: string;
  type: ProcessLedgerEventType;
  source: 'peak-performance';
  orchestration: {
    layer: 'SO';
    queen: 'starlight-process-oversight-queen';
    workItems: string[];
  };
  process: ProcessConsumer;
}

export interface ProcessWatchOptions {
  seconds?: number;
  intervalMs?: number;
  logPath?: string;
  summaryPath?: string;
}

export interface ProcessWatchSessionSummary {
  startedAt: string;
  endedAt: string;
  source: 'peak-performance';
  seconds: number;
  intervalMs: number;
  samples: number;
  started: number;
  stopped: number;
  baselineProcessCount: number;
  finalProcessCount: number;
  logPath: string;
  orchestration: ProcessLedgerEvent['orchestration'];
}

export interface ProcessWatchResult {
  started: number;
  stopped: number;
  samples: number;
  events: ProcessLedgerEvent[];
  logPath: string;
  summaryPath: string;
  summary: ProcessWatchSessionSummary;
}

export function defaultProcessLedgerPath(): string {
  return join(os.homedir(), '.starlight', 'process-ledger', 'process-events.jsonl');
}

export function defaultProcessWatchSummaryPath(): string {
  return join(os.homedir(), '.starlight', 'process-ledger', 'watch-latest.json');
}

function processMap(processes: ProcessConsumer[]): Map<number, ProcessConsumer> {
  return new Map(processes.map(proc => [proc.pid, proc]));
}

function createEvent(type: ProcessLedgerEventType, proc: ProcessConsumer): ProcessLedgerEvent {
  return {
    timestamp: new Date().toISOString(),
    type,
    source: 'peak-performance',
    orchestration: orchestrationContext(),
    process: proc,
  };
}

function appendEvents(logPath: string, events: ProcessLedgerEvent[]): void {
  if (events.length === 0) return;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, events.map(event => JSON.stringify(event)).join('\n') + '\n', 'utf8');
}

function orchestrationContext(): ProcessLedgerEvent['orchestration'] {
  return {
    layer: 'SO',
    queen: 'starlight-process-oversight-queen',
    workItems: ['ops-jarvisops-desktop-control-plane', 'ops-agent-run-ledger-calendar'],
  };
}

function writeWatchSummary(summaryPath: string, summary: ProcessWatchSessionSummary): void {
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
}

export async function runProcessWatch(options: ProcessWatchOptions = {}): Promise<ProcessWatchResult> {
  const seconds = Math.max(1, Math.min(options.seconds ?? 60, 60 * 60));
  const intervalMs = Math.max(500, Math.min(options.intervalMs ?? 2_000, 60_000));
  const logPath = options.logPath ?? defaultProcessLedgerPath();
  const summaryPath = options.summaryPath ?? defaultProcessWatchSummaryPath();
  const startedAt = new Date().toISOString();
  const endAt = Date.now() + seconds * 1_000;

  let previous = processMap(probeProcesses().processes);
  const baselineProcessCount = previous.size;
  const events: ProcessLedgerEvent[] = [];
  let started = 0;
  let stopped = 0;
  let samples = 1;

  while (Date.now() < endAt) {
    await sleep(intervalMs);
    const current = processMap(probeProcesses().processes);
    const batch: ProcessLedgerEvent[] = [];

    for (const [pid, proc] of current) {
      if (!previous.has(pid)) {
        batch.push(createEvent('start', proc));
        started++;
      }
    }

    for (const [pid, proc] of previous) {
      if (!current.has(pid)) {
        batch.push(createEvent('stop', proc));
        stopped++;
      }
    }

    appendEvents(logPath, batch);
    events.push(...batch);
    previous = current;
    samples++;
  }

  const endedAt = new Date().toISOString();
  const summary: ProcessWatchSessionSummary = {
    startedAt,
    endedAt,
    source: 'peak-performance',
    seconds,
    intervalMs,
    samples,
    started,
    stopped,
    baselineProcessCount,
    finalProcessCount: previous.size,
    logPath,
    orchestration: orchestrationContext(),
  };
  writeWatchSummary(summaryPath, summary);

  return { started, stopped, samples, events, logPath, summaryPath, summary };
}
