import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import os from 'node:os';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { probeCpu, probeCrashLoops, probeProcesses } from './probes.js';

function mockedProcesses(platform: NodeJS.Platform, output: (command: string, args: readonly string[]) => string) {
  const p = mock.method(os, 'platform', () => platform);
  const c = mock.method(childProcess, 'execFileSync', output);
  syncBuiltinESMExports();
  return () => { p.mock.restore(); c.mock.restore(); syncBuiltinESMExports(); };
}

test('Windows name-only fallback and missing runtime commands are unknown capacity evidence', () => {
  let restore = mockedProcesses('win32', command => command === 'powershell' ? '' : '"node.exe","1","Console","1","10 K"');
  try { assert.equal(probeProcesses().status, 'unknown'); }
  finally { restore(); }
  restore = mockedProcesses('win32', () => JSON.stringify([{ Name: 'node.exe', ProcessId: 1, ParentProcessId: 0, WorkingSetSize: 10, CommandLine: null }]));
  try { assert.equal(probeProcesses().status, 'unknown'); }
  finally { restore(); }
});

test('Windows protected OS command denial is distinct from denied agent runtime evidence', () => {
  const restore = mockedProcesses('win32', () => JSON.stringify([
    { Name: 'System', ProcessId: 4, ParentProcessId: 0, WorkingSetSize: 0, CommandLine: null },
    { Name: 'node.exe', ProcessId: 5, ParentProcessId: 4, WorkingSetSize: 100, CommandLine: 'node fixture.js' },
  ]));
  try { assert.equal(probeProcesses().status, 'measured'); }
  finally { restore(); }
});

test('empty and partially parsed POSIX process output remain unknown', () => {
  for (const raw of ['', '1 0 100 node node fixture.js\nunparsed-line', '1 0 100 node']) {
    const restore = mockedProcesses('linux', () => raw);
    try { assert.equal(probeProcesses().status, 'unknown', raw); }
    finally { restore(); }
  }
});

test('crash probes distinguish unsupported, failed, malformed and measured-zero evidence', () => {
  let restore = mockedProcesses('linux', () => { throw new Error('Unsupported collector must not execute'); });
  try { assert.equal(probeCrashLoops().status, 'unsupported'); }
  finally { restore(); }
  for (const raw of ['', '{}', '{"status":"measured","totalCrashes":-1,"topAppCrashes":0,"apps":[]}']) {
    restore = mockedProcesses('win32', () => raw);
    try { assert.equal(probeCrashLoops().status, 'unknown'); }
    finally { restore(); }
  }
  restore = mockedProcesses('win32', (_command, args) => {
    const script = args.at(-1)!;
    assert.match(script, /AppName/);
    assert.match(script, /NoMatchingEventsFound/);
    assert.match(script, /ProviderName="Application Error"/);
    assert.doesNotMatch(script, /\.Message/);
    return JSON.stringify({ status: 'measured', totalCrashes: 0, topAppCrashes: 0, topApp: '', apps: [] });
  });
  try { assert.equal(probeCrashLoops().status, 'measured'); }
  finally { restore(); }
});

test('CPU zero delta and counter rollback cannot be reported as measured idle', () => {
  const original = os.platform();
  const p = mock.method(os, 'platform', () => 'win32');
  for (const rollback of [false, true]) {
    let calls = 0;
    const c = mock.method(os, 'cpus', () => [{ model: 'fixture', speed: 1, times: {
      user: ++calls >= 3 && rollback ? 9 : 10, nice: 0, sys: 1, idle: 10, irq: 0,
    } }]);
    try { assert.equal(probeCpu().status, 'unknown', original); }
    finally { c.mock.restore(); }
  }
  p.mock.restore();
});

test('actual host crash collector returns measured Windows or explicit unsupported POSIX evidence', () => {
  const result = probeCrashLoops();
  assert.equal(result.status, os.platform() === 'win32' ? 'measured' : 'unsupported');
});

test('positive CPU delta is measured and reports actual busy time', () => {
  const p = mock.method(os, 'platform', () => 'win32');
  try {
    for (const [user, sys, idle, load, system] of [[20, 0, 0, 100, 0], [0, 1, 199, 1, 1]]) {
      let calls = 0;
      const c = mock.method(os, 'cpus', () => [{ model: 'fixture', speed: 1, times: { user: ++calls >= 3 ? user : 0, nice: 0, sys: calls >= 3 ? sys : 0, idle: calls >= 3 ? idle : 0, irq: 0 } }]);
      try {
        const result = probeCpu();
        assert.equal(result.status, 'measured');
        assert.equal(result.loadPct, load);
        assert.equal(result.systemLoadPct, system);
      } finally { c.mock.restore(); }
    }
  } finally { p.mock.restore(); }
});
