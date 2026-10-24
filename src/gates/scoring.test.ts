import { test, describe } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  scoreDisk,
  scoreMemory,
  scoreCpuGpu,
  scoreProcesses,
  scoreSystem,
  grade
} from './scoring.js';

describe('Scoring Engine', () => {
  test('grade returns correct letter grade', () => {
    assert.equal(grade(98), 'S');
    assert.equal(grade(95), 'S');
    assert.equal(grade(92), 'A+');
    assert.equal(grade(87), 'A');
    assert.equal(grade(82), 'A-');
    assert.equal(grade(77), 'B+');
    assert.equal(grade(72), 'B');
    assert.equal(grade(67), 'B-');
    assert.equal(grade(62), 'C+');
    assert.equal(grade(57), 'C');
    assert.equal(grade(52), 'C-');
    assert.equal(grade(47), 'D+');
    assert.equal(grade(42), 'D');
    assert.equal(grade(30), 'F');
  });

  test('scoreDisk assigns scores correctly based on freeGB', () => {
    const perfectDisk = { drive: 'C:', freeGB: 200, totalGB: 500, usedPct: 60 };
    assert.equal(scoreDisk(perfectDisk).score, 10);
    assert.equal(scoreDisk(perfectDisk).status, 'PERFECT');

    const okDisk = { drive: 'C:', freeGB: 75, totalGB: 500, usedPct: 85 };
    assert.equal(scoreDisk(okDisk).score, 8);
    assert.equal(scoreDisk(okDisk).status, 'OK');

    const warnDisk = { drive: 'C:', freeGB: 40, totalGB: 500, usedPct: 92 };
    assert.equal(scoreDisk(warnDisk).score, 6);
    assert.equal(scoreDisk(warnDisk).status, 'WARN');

    const highWarnDisk = { drive: 'C:', freeGB: 15, totalGB: 500, usedPct: 97 };
    assert.equal(scoreDisk(highWarnDisk).score, 4);
    assert.equal(scoreDisk(highWarnDisk).status, 'WARN');

    const critDisk = { drive: 'C:', freeGB: 5, totalGB: 500, usedPct: 99 };
    assert.equal(scoreDisk(critDisk).score, 2);
    assert.equal(scoreDisk(critDisk).status, 'CRIT');
  });

  test('scoreMemory assigns scores correctly based on usedPct', () => {
    const perfectMem = { freeMB: 16000, totalMB: 32000, usedPct: 50 };
    assert.equal(scoreMemory(perfectMem).score, 10);

    const okMem = { freeMB: 8000, totalMB: 32000, usedPct: 75 };
    assert.equal(scoreMemory(okMem).score, 8);

    const warnMem1 = { freeMB: 6000, totalMB: 32000, usedPct: 82 };
    assert.equal(scoreMemory(warnMem1).score, 6);

    const warnMem2 = { freeMB: 4000, totalMB: 32000, usedPct: 88 };
    assert.equal(scoreMemory(warnMem2).score, 5);

    const critMem1 = { freeMB: 2000, totalMB: 32000, usedPct: 92 };
    assert.equal(scoreMemory(critMem1).score, 3);

    const critMem2 = { freeMB: 500, totalMB: 32000, usedPct: 98 };
    assert.equal(scoreMemory(critMem2).score, 1);
  });

  test('scoreCpuGpu assigns scores correctly', () => {
    const perfectCpu = { loadPct: 20, model: 'M1', logicalCores: 8, cores: 8, idlePct: 80 };
    assert.equal(scoreCpuGpu(perfectCpu, null).score, 10);

    const highCpu = { loadPct: 85, model: 'M1', logicalCores: 8, cores: 8, idlePct: 15 };
    assert.equal(scoreCpuGpu(highCpu, null).score, 8);

    const critCpu = { loadPct: 98, model: 'M1', logicalCores: 8, cores: 8, idlePct: 2 };
    assert.equal(scoreCpuGpu(critCpu, null).score, 7);

    const perfectGpu = { name: 'GPU', tempC: 50, utilPct: 30, memUsedMB: 1000, memTotalMB: 4000, driverVersion: '1.0' };
    assert.equal(scoreCpuGpu(perfectCpu, perfectGpu).score, 10);

    const hotGpu = { name: 'GPU', tempC: 85, utilPct: 95, memUsedMB: 3000, memTotalMB: 4000, driverVersion: '1.0' };
    // cpu 10, hotGpu temp > 80 (-2), util > 90 (-2) -> 6
    assert.equal(scoreCpuGpu(perfectCpu, hotGpu).score, 6);
  });

  test('scoreProcesses assigns scores correctly', () => {
    const perfectProcs = {
      claudeCount: 1,
      cursorCount: 0,
      codexCount: 0,
      vscodeCount: 1,
      nodeCount: 4,
      totalProcesses: 200,
      protectedCount: 10,
      edgeChromeTabs: 5,
      topConsumers: [],
      processes: []
    };
    assert.equal(scoreProcesses(perfectProcs).score, 10);

    const tooManyAgents = {
      ...perfectProcs,
      claudeCount: 8,
      nodeCount: 30 // ~4 per agent
    };
    assert.equal(scoreProcesses(tooManyAgents).score, 8); // claudeCount > 6 => -2

    const tooManyNode = {
      ...perfectProcs,
      claudeCount: 1,
      nodeCount: 20 // 20 per agent
    };
    assert.equal(scoreProcesses(tooManyNode).score, 7); // node/agent > 15 => -3
  });

  test('scoreSystem composite scoring works', () => {
    const perfectDisk = { drive: 'C:', freeGB: 200, totalGB: 500, usedPct: 60 };
    const perfectMem = { freeMB: 16000, totalMB: 32000, usedPct: 50 };

    assert.equal(scoreSystem(perfectDisk, perfectMem, 10).score, 10);
    assert.equal(scoreSystem(perfectDisk, perfectMem, 100).score, 9); // > 72h uptime
    assert.equal(scoreSystem(perfectDisk, perfectMem, 200).score, 8); // > 168h uptime

    const lowDisk = { drive: 'C:', freeGB: 15, totalGB: 500, usedPct: 97 };
    const highMem = { freeMB: 2000, totalMB: 32000, usedPct: 90 };
    assert.equal(scoreSystem(lowDisk, highMem, 10).score, 6); // disk < 20 and mem > 85 => -4
  });
});
