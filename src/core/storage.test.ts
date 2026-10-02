import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import { probeStorage, storageState, freshEvidence, STORAGE_CHILD } from './storage.js';
import { runInNewContext } from 'node:vm';

test('exact storage floor boundaries do not round into a less restrictive state', () => {
  for (const [available, expected] of [['39999', 'freeze'], ['40000', 'hold'], ['79999', 'hold'], ['80000', 'bounded'], ['149999', 'bounded'], ['150000', 'normal']] as const) {
    assert.equal(storageState({ scope: 'system', status: 'measured', totalBytes: '1000000', availableBytes: available }), expected);
  }
  assert.equal(storageState({ scope: 'temp', status: 'measured', totalBytes: '10000000000000000000000', availableBytes: '799999999999999999999' }), 'hold');
  for (const availableBytes of ['-1', 'NaN', '1e6', '1000001', '', '1'.repeat(41)]) {
    assert.equal(storageState({ scope: 'system', status: 'measured', totalBytes: '1000000', availableBytes }), 'unknown');
  }
});

test('expired, future and missing evidence cannot establish freshness', () => {
  const now = Date.now();
  assert.equal(freshEvidence(new Date(now).toISOString(), now), true);
  assert.equal(freshEvidence(new Date(now - 900000).toISOString(), now), false);
  assert.equal(freshEvidence(new Date(now + 1).toISOString(), now), false);
  assert.equal(freshEvidence(undefined, now), false);
});

test('storage subprocess failure is explicit unknown for all required volumes', () => {
  const m = mock.method(childProcess, 'execFileSync', () => { throw new Error('timeout or denied'); });
  syncBuiltinESMExports();
  try { assert.ok(probeStorage(process.cwd()).readings.every(r => r.status === 'unknown')); }
  finally { m.mock.restore(); syncBuiltinESMExports(); }
});

test('real host filesystem readings include system, target and temp with available bytes', () => {
  const evidence = probeStorage(process.cwd());
  assert.deepEqual(evidence.readings.map(r => r.scope), ['system', 'target', 'temp']);
  assert.ok(freshEvidence(evidence.sampledAt));
  for (const reading of evidence.readings) assert.notEqual(storageState(reading), 'unknown', `${os.platform()} ${reading.scope}`);
});

test('actual storage child rejects unsafe and mapped Windows paths before filesystem access', () => {
  for (const path of ['\\\\fixture.invalid\\share', '//fixture.invalid/share', '\\\\?\\C:\\fixture', '\\\\.\\C:\\fixture', 'C:relative', 'Z:\\mapped', '/fixture', '\\fixture', 'C:\\nul\0']) {
    let output = '';
    let filesystemCalls = 0;
    const deny = () => { filesystemCalls++; throw new Error('Rejected paths must not call filesystem operations'); };
    runInNewContext(STORAGE_CHILD, {
      require: () => ({ realpathSync: { native: deny }, statSync: deny, statfsSync: deny }),
      process: { platform: 'win32', argv: ['unused', JSON.stringify({ paths: [{ scope: 'target', path }], localDrives: ['C:'] })], stdout: { write: (s: string) => { output = s; } } },
    });
    assert.equal(JSON.parse(output).readings[0].status, 'unknown', path);
    assert.equal(filesystemCalls, 0, path);
  }
});

test('actual storage child resolves mount paths and rejects a network junction before statfs', () => {
  for (const network of [false, true]) {
    let statfsCalls = 0; let output = '';
    const fs = {
      realpathSync: { native: () => network ? '\\\\fixture.invalid\\share' : 'D:\\volume\\target' },
      statSync: () => ({ isDirectory: () => true }),
      statfsSync: () => { statfsCalls++; return { bsize: 4096n, blocks: 1000000n, bavail: 50000n }; },
    };
    runInNewContext(STORAGE_CHILD, { require: () => fs, process: { platform: 'win32', argv: ['unused', JSON.stringify({ paths: [{ scope: 'target', path: 'C:\\mount' }], localDrives: ['C:', 'D:'] })], stdout: { write: (s: string) => { output = s; } } } });
    assert.equal(statfsCalls, network ? 0 : 1);
    assert.equal(storageState(JSON.parse(output).readings[0]), network ? 'unknown' : 'hold');
  }
});

test('Windows single-drive metadata is normalized and child argv remains data', () => {
  const p = mock.method(os, 'platform', () => 'win32');
  let calls = 0;
  const c = mock.method(childProcess, 'execFileSync', (_command: string, args: string[]) => {
    if (++calls === 1) { assert.match(args.at(-1)!, /DriveType=3/); return '"C:"'; }
    const request = JSON.parse(args.at(-1)!);
    assert.deepEqual(request.localDrives, ['C:']);
    assert.equal(request.paths[1].path, 'C:\\fixture$(echo nope)');
    return JSON.stringify({ sampledAt: new Date().toISOString(), readings: ['system', 'target', 'temp'].map(scope => ({ scope, status: 'measured', totalBytes: '100', availableBytes: '20' })) });
  });
  syncBuiltinESMExports();
  try { assert.ok(probeStorage('C:\\fixture$(echo nope)').readings.every(r => r.status === 'measured')); }
  finally { c.mock.restore(); p.mock.restore(); syncBuiltinESMExports(); }
});
