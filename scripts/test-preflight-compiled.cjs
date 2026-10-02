// Requires pnpm build. Real emitted CLI/MCP code runs in bounded child processes.
// Machine metrics are synthetic; audit and remediation are denied before execution.
const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');

test('real emitted admission builder skips full audit and preserves evidence holds', () => {
  const script = String.raw`
    const assert = require('node:assert/strict');
    const root = process.argv[1];
    const { join } = require('node:path');
    const probes = require(join(root, 'dist/core/probes.js'));
    const audit = require(join(root, 'dist/core/audit.js'));
    const storage = require(join(root, 'dist/core/storage.js'));
    const calls = [];
    const snapshot = {
      mem: { totalMB: 32768, freeMB: 18000, usedPct: 45 },
      disk: { totalGB: 1000, freeGB: 200, usedPct: 80 }, uptime: { uptimeHours: 12 },
      cpu: { status: 'measured', loadPct: 20, systemLoadPct: 5 },
      crashes: { status: 'measured', topApp: '', topAppCrashes: 0, totalCrashes: 0, windowMinutes: 15 },
      procs: { status: 'measured', processes: [], totalProcesses: 100, nodeCount: 0, claudeCount: 0, cursorCount: 0, codexCount: 0, codexTaskRuntimeCount: 0, mcpCount: 0, mcpProcessCount: 0, mcpMemoryMB: 0, duplicateMcpProcesses: 0, agentTreeMemoryMB: 0 },
    };
    let allowFullAudit = false;
    audit.runAuditWithProbes = () => {
      assert.ok(allowFullAudit, 'Admission must not run the full audit');
      calls.push('full-audit');
      return { audit: { totalScore: 90, grade: 'A' }, snapshot };
    };
    for (const [name, key] of Object.entries({ probeMemory: 'mem', probeCpu: 'cpu', probeDisk: 'disk', probeProcesses: 'procs', probeUptime: 'uptime', probeCrashLoops: 'crashes' })) {
      probes[name] = cwd => { if (name === 'probeDisk') assert.equal(cwd, root); calls.push(name); return snapshot[key]; };
    }
    for (const name of ['probeGpu', 'probeGit', 'probeSecrets', 'probeTemp']) probes[name] = () => { throw new Error('Forbidden admission probe ' + name); };
    storage.probeStorage = cwd => {
      assert.equal(cwd, root); calls.push('probeStorage');
      return { sampledAt: new Date().toISOString(), readings: ['system', 'target', 'temp'].map(scope => ({ scope, status: 'measured', totalBytes: '1000000', availableBytes: '200000' })) };
    };
    const maintenance = require(join(root, 'dist/core/maintenance.js'));
    const preflight = require(join(root, 'dist/core/preflight.js'));
    const plan = (workload = 'review-lite', reserveMB = 2048) => preflight.buildPreflightPlan(workload, { cwd: root, reserveMB });
    assert.equal(plan().decision, 'allow');
    assert.deepEqual(calls.slice().sort(), ['probeMemory', 'probeCpu', 'probeDisk', 'probeProcesses', 'probeUptime', 'probeCrashLoops', 'probeStorage'].sort());
    const lean = maintenance.buildAdmissionMaintenancePlan(root);
    assert.equal(lean.metrics.score, null);
    assert.equal(lean.metrics.grade, 'UNKNOWN');
    assert.match(lean.summary, /Ten Gate score not collected/);
    for (const [key, field, value] of [['mem', 'totalMB', 0], ['disk', 'totalGB', 0], ['cpu', 'status', 'unknown'], ['procs', 'status', 'unknown'], ['crashes', 'status', 'unknown'], ['crashes', 'status', 'unsupported']]) {
      const saved = snapshot[key][field]; snapshot[key][field] = value;
      try {
        assert.equal(plan().decision, 'hold', key + '/' + value);
        assert.equal(plan('interactive', 0).decision, 'allow');
      } finally { snapshot[key][field] = saved; }
    }
    calls.length = 0; allowFullAudit = true;
    const full = maintenance.buildMaintenancePlan(root);
    assert.equal(full.metrics.score, 90);
    assert.equal(full.metrics.grade, 'A');
    assert.deepEqual(calls, ['full-audit']);
    process.stdout.write(JSON.stringify({ actualEmittedAdmission: true, fullAuditPreserved: true, unknownCases: 6 }));
  `;
  const result = spawnSync(process.execPath, ['-e', script, root], {
    cwd: root, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { actualEmittedAdmission: true, fullAuditPreserved: true, unknownCases: 6 });
});

// Exercise the emitted adapter and host-native path implementation with all
// filesystem checks intercepted. Never contact a share or run machine probes.
function rejectedPathFixture(defaultCwd, inputs, names = inputs.map(() => 'pp_preflight')) {
  const adapter = join(root, 'dist/integrations/mcp-server/index.js');
  const script = `
    const fs = require('node:fs');
    const maintenance = require(${JSON.stringify(join(root, 'dist/core/maintenance.js'))});
    let dispatches = 0;
    const deny = () => { dispatches++; throw new Error('Fixture denies machine operations'); };
    maintenance.buildMaintenancePlan = deny;
    maintenance.buildAdmissionMaintenancePlan = deny;
    require(${JSON.stringify(join(root, 'dist/core/audit.js'))}).runAudit = deny;
    require(${JSON.stringify(join(root, 'dist/fixes/autofix.js'))}).runAllFixes = deny;
    require(${JSON.stringify(join(root, 'dist/history/tracker.js'))}).TrendTracker = function () { deny(); };
    require(${JSON.stringify(join(root, 'dist/core/preflight.js'))});
    const stats = [];
    fs.statSync = path => { stats.push(String(path)); return { isDirectory: () => true }; };
    process.cwd = () => ${JSON.stringify(defaultCwd)};
    process.stdin.on('end', () => process.stdout.write(JSON.stringify({ fixtureStats: stats, fixtureDispatches: dispatches }) + '\\n'));
    require(${JSON.stringify(adapter)});
  `;
  const messages = inputs.flatMap((cwd, index) => [
    call(index, names[index], cwd === undefined ? { workload: 'interactive' } : { workload: 'interactive', cwd }),
    list('recover-' + index),
  ]);
  const result = spawnSync(process.execPath, ['-e', script], {
    input: messages.map(x => JSON.stringify(x)).join('\n') + '\n',
    encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  const metadata = responses.pop();
  assert.deepEqual(metadata, { fixtureStats: [], fixtureDispatches: 0 }, 'Unsupported paths must be rejected before filesystem checks or dispatch');
  assert.equal(responses.length, inputs.length * 2);
  inputs.forEach((_, index) => {
    assert.equal(responses[index * 2].id, index);
    assert.equal(responses[index * 2].result.isError, true);
    assert.equal(responses[index * 2 + 1].id, 'recover-' + index);
    assert.ok(responses[index * 2 + 1].result.tools.length);
  });
}

test('compiled MCP rejects network/device/ambiguous explicit paths before any filesystem check', () => {
  const unsafe = process.platform === 'win32'
    ? ['\\\\fixture.invalid\\share', '//fixture.invalid/share', '\\/fixture.invalid/share', '/\\fixture.invalid/share', '\\\\?\\C:\\fixture', '\\\\.\\C:\\fixture', '\\??\\C:\\fixture', '\\fixture', '/fixture', 'C:fixture']
    : ['//fixture.invalid/share', '///fixture', 'relative'];
  rejectedPathFixture(root, unsafe);
});

for (const cwd of ['//fixture.invalid/share', '\\\\fixture.invalid\\share', '\\\\?\\C:\\fixture']) {
  test(`compiled MCP checks inherited cwd before filesystem access: ${cwd}`, () => {
    rejectedPathFixture(cwd, [undefined]);
  });
}

test('compiled MCP cannot bypass the server-directory gate through a valid explicit target for any tool', () => {
  rejectedPathFixture('//fixture.invalid/share', [root, root, root, root], ['pp_audit', 'pp_preflight', 'pp_trend', 'pp_fix']);
});

function run(entry, args = [], input, freeMB = 2419, sensorFailure = false, freePct = 20, evidenceStatus = 'measured', capacityEvidence = true) {
  const directory = mkdtempSync(join(tmpdir(), 'pp-compiled-test-'));
  const preload = join(directory, 'sensors.cjs');
  try {
    const maintenance = join(root, 'dist/core/maintenance.js');
    writeFileSync(preload, `
      const maintenance = require(${JSON.stringify(maintenance)});
      const deny = () => { throw new Error('Fixture refuses audit or remediation'); };
      require(${JSON.stringify(join(root, 'dist/core/audit.js'))}).runAudit = deny;
      require(${JSON.stringify(join(root, 'dist/core/audit.js'))}).runAuditWithProbes = deny;
      require(${JSON.stringify(join(root, 'dist/fixes/autofix.js'))}).runAllFixes = deny;
      require(${JSON.stringify(join(root, 'dist/core/storage.js'))}).probeStorage = () => ({ sampledAt: new Date().toISOString(), readings: ['system', 'target', 'temp'].map(scope => ({ scope, status: 'measured', totalBytes: '1000000', availableBytes: String(${freePct} * 10000) })) });
      maintenance.buildMaintenancePlan = deny;
      maintenance.buildAdmissionMaintenancePlan = () => {
        if (${JSON.stringify(sensorFailure)}) throw new Error('Fixture sensor failure');
        return ({
        hostname: 'fixture', posture: 'green', swarmPosture: 'expand',
        probeEvidence: { sampledAt: new Date().toISOString(), ...(${capacityEvidence} ? { memory: ${JSON.stringify(evidenceStatus)}, disk: ${JSON.stringify(evidenceStatus)} } : {}), cpu: ${JSON.stringify(evidenceStatus)}, processes: ${JSON.stringify(evidenceStatus)}, crashes: ${JSON.stringify(evidenceStatus)} },
        metrics: {
          ramFreeMB: ${freeMB}, ramUsedPct: 50, cpuLoadPct: 20, cpuSystemLoadPct: 5,
          codexTaskRuntimeCount: 0, mcpMemoryMB: 0, localModelCount: 0,
          devServerCount: 0, crashLoopApp: '', crashLoopCount: 0
        }
        });
      };
    `);
    const result = spawnSync(process.execPath, ['--require', preload, join(root, entry), ...args], {
      cwd: directory, input, encoding: 'utf8', timeout: 10000,
      killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'Child must exit normally');
    assert.equal(result.stderr, '', 'Unexpected child stderr');
    return result;
  } finally {
    // Delete only the exact file and empty directory created by this invocation.
    if (existsSync(preload)) unlinkSync(preload);
    if (existsSync(directory)) rmdirSync(directory);
  }
}

const cliCases = [
  { name: 'positive interactive reserve retains floor and hold exit', reserve: ['--reserve-gb', '0.5'], decision: 'hold', code: 2, required: 4608 },
  { name: 'exact positive reserve boundary admits', reserve: ['--reserve-gb=0.5'], freeMB: 4608, decision: 'allow', code: 0, required: 4608 },
  { name: 'explicit interactive zero retains reading exemption', reserve: ['--reserve-gb', '0'], decision: 'allow', code: 0, required: 0 },
  { name: 'invalid CLI reserve holds', reserve: ['--reserve-gb', 'bad'], decision: 'hold', code: 2, invalid: true },
  { name: 'repeated CLI zero cannot erase positive reserve', reserve: ['--reserve-gb', '0.5', '--reserve-gb', '0'], decision: 'hold', code: 2, required: 4608 },
  { name: 'build zero still requires safety floor', workload: 'build', reserve: ['--reserve-gb', '0'], decision: 'hold', code: 2, required: 4096 },
];

for (const free of [3, 5, 10, 15]) for (const workload of ['build', 'local-model', 'swarm', 'overnight']) {
  test(`compiled storage floor: ${free}% ${workload}`, () => {
    const result = run('dist/cli.js', ['preflight', '--workload', workload, '--reserve-gb', '12', '--json'], undefined, 40000, false, free);
    const plan = JSON.parse(result.stdout);
    const expected = free < 8 || free < 15 && workload !== 'build' ? 'hold' : free < 15 ? 'bounded' : 'allow';
    assert.equal(plan.decision, expected);
    assert.equal(result.status, expected === 'hold' ? 2 : 0);
  });
}

test('compiled CLI does not admit unknown machine evidence', () => {
  const result = run('dist/cli.js', ['preflight', '--workload', 'build', '--json'], undefined, 40000, false, 20, 'unknown');
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).decision, 'hold');
});

test('compiled CLI holds a legacy reserved-work plan missing capacity evidence', () => {
  const result = run('dist/cli.js', ['preflight', '--workload', 'review-lite', '--reserve-gb', '2', '--json'], undefined, 40000, false, 20, 'measured', false);
  assert.equal(result.status, 2);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.decision, 'hold');
  assert.match(plan.hardBlocks.join(' '), /Memory, disk, CPU, process and crash evidence/);
});

test('compiled MCP signals hold for a legacy plan missing capacity evidence', () => {
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pp_preflight', arguments: { workload: 'review-lite', reserveGB: 2 } } }) + '\n';
  const result = run('dist/integrations/mcp-server/index.js', [], input, 40000, false, 20, 'measured', false);
  assert.equal(result.status, 0);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, true);
  assert.equal(JSON.parse(response.result.content[0].text).decision, 'hold');
});

for (const free of [3, 5, 10, 15]) test(`compiled MCP storage decision and error flag: ${free}%`, () => {
  const input = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pp_preflight', arguments: { workload: 'build', reserveGB: 12 } } }) + '\n';
  const result = run('dist/integrations/mcp-server/index.js', [], input, 40000, false, free);
  assert.equal(result.status, 0);
  const response = JSON.parse(result.stdout);
  assert.equal(response.result.isError, free < 8);
  assert.equal(JSON.parse(response.result.content[0].text).decision, free < 8 ? 'hold' : free < 15 ? 'bounded' : 'allow');
});

for (const c of cliCases) test(`compiled CLI: ${c.name}`, () => {
  const result = run('dist/cli.js', ['preflight', '--workload', c.workload || 'interactive', ...c.reserve, '--json'], undefined, c.freeMB);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.hostname, 'fixture');
  assert.equal(result.status, c.code);
  assert.equal(plan.decision, c.decision);
  assert.equal(plan.budget.ramGated, c.required !== 0);
  if (c.invalid) assert.ok(plan.hardBlocks.some(message => message.includes('finite, non-negative')));
  else assert.equal(plan.budget.requiredFreeMB, c.required);
});

test('compiled MCP: initialization, listing, admission and invalid requests over stdio', () => {
  const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
  const call = (id, args) => request(id, 'tools/call', { name: 'pp_preflight', arguments: args });
  const messages = [
    request(0, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } }),
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    request(1, 'tools/list'),
    call(2, { workload: 'interactive', reserveGB: 0.5 }),
    call(3, { workload: 'interactive', reserveGB: 0 }),
    call(4, { workload: 'interactive', reserveGB: null }),
    call(5, { workload: 'interactive', reserveGB: 'bad' }),
    call(6, { workload: 'build', reserveGB: 0 }),
    call(7, { workload: 'unknown' }),
    request(8, 'tools/call', { name: 'unknown', arguments: {} }),
  ];
  const result = run('dist/integrations/mcp-server/index.js', [], messages.map(x => JSON.stringify(x)).join('\n') + '\n');
  assert.equal(result.status, 0);
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(responses.map(x => x.id), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(responses.every(x => x.jsonrpc === '2.0'));
  assert.equal(responses[0].result.serverInfo.name, 'peak-performance');
  assert.equal(responses[0].result.protocolVersion, '2024-11-05');
  const tool = responses[1].result.tools.find(x => x.name === 'pp_preflight');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['workload']);
  for (const [id, decision, required] of [[2, 'hold', 4608], [3, 'allow', 0], [4, 'hold', null], [5, 'hold', null], [6, 'hold', 4096]]) {
    const plan = JSON.parse(responses[id].result.content[0].text);
    assert.equal(plan.hostname, 'fixture');
    assert.equal(plan.decision, decision);
    assert.equal(plan.budget.ramGated, id !== 3);
    assert.equal(plan.budget.requiredFreeMB, required);
    if (id === 4 || id === 5) assert.ok(plan.hardBlocks.some(message => message.includes('finite, non-negative')));
  }
  assert.equal(responses[7].error.code, -32602);
  assert.equal(responses[8].error.code, -32601);
});

test('compiled MCP: unknown method responds to ID zero and ignores notifications', () => {
  const messages = [
    { jsonrpc: '2.0', id: 0, method: 'unknown' },
    { jsonrpc: '2.0', method: 'unknown' },
  ];
  const result = run('dist/integrations/mcp-server/index.js', [], messages.map(x => JSON.stringify(x)).join('\n') + '\n');
  assert.equal(result.status, 0);
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses.length, 1);
  assert.equal(responses[0].jsonrpc, '2.0');
  assert.equal(responses[0].id, 0);
  assert.equal(responses[0].error.code, -32601);
});

function stdio(messages, entry = 'dist/integrations/mcp-server/index.js', args = [], sensorFailure = false) {
  const input = messages.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n') + '\n';
  const result = run(entry, args, input, 2419, sensorFailure);
  assert.equal(result.status, 0);
  return result.stdout.trim().split('\n').map(line => JSON.parse(line));
}
const list = id => ({ jsonrpc: '2.0', id, method: 'tools/list' });
const call = (id, name, argumentsValue) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: argumentsValue } });

for (const command of ['--mcp', 'mcp']) test(`compiled CLI launcher: ${command}`, () => {
  const responses = stdio([
    { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    call('admit', 'pp_preflight', { workload: 'interactive', reserveGB: 0.5 }),
  ], 'dist/cli.js', [command]);
  assert.deepEqual(responses.map(x => x.id), ['init', 'admit']);
  assert.equal(responses[0].result.serverInfo.name, 'peak-performance');
  const plan = JSON.parse(responses[1].result.content[0].text);
  assert.equal(plan.hostname, 'fixture');
  assert.equal(plan.decision, 'hold');
  assert.equal(plan.budget.requiredFreeMB, 4608);
});

for (const cwd of [null, false, 0, true, 123, {}, []]) test(`compiled MCP rejects cwd ${JSON.stringify(cwd)}`, () => {
  const responses = stdio([call(20, 'pp_preflight', { workload: 'interactive', cwd }), list(21)]);
  assert.deepEqual(responses.map(x => x.id), [20, 21]);
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /cwd must be a string/);
  assert.ok(responses[1].result.tools.some(x => x.name === 'pp_preflight'));
});

for (const args of [null, false, 42, []]) test(`compiled MCP rejects argument container ${JSON.stringify(args)}`, () => {
  const responses = stdio([call(22, 'pp_fix', args), list(23)]);
  assert.deepEqual(responses.map(x => x.id), [22, 23]);
  assert.equal(responses[0].error.code, -32602);
  assert.ok(responses[1].result.tools);
});

const badEnvelopes = [
  { value: { jsonrpc: '1.0', id: 30, method: 'tools/list' }, id: 30 },
  { value: [], id: undefined },
  { value: null, id: undefined },
  { value: 42, id: undefined },
  { value: { jsonrpc: '2.0', id: 31, method: 'tools/list', params: [] }, id: 31 },
  { value: { jsonrpc: '2.0', id: null, method: 'tools/list' }, id: undefined },
  { value: { jsonrpc: '2.0', id: 1.5, method: 'tools/list' }, id: undefined },
  { value: { jsonrpc: '2.0', id: 32, method: 42 }, id: 32 },
  { value: { jsonrpc: '2.0', id: 33, method: 'tools/list', params: null }, id: 33 },
  { value: { id: 34, method: 'tools/list' }, id: 34 },
];
for (const [index, c] of badEnvelopes.entries()) test(`compiled MCP rejects envelope ${index} and preserves readable ID`, () => {
  const responses = stdio([c.value, list(35)]);
  assert.equal(responses.length, 2);
  assert.equal(responses[0].id, c.id);
  assert.equal(responses[0].error.code, -32600);
  assert.equal(responses[1].id, 35);
  assert.ok(responses[1].result.tools);
});

test('compiled MCP recovers after malformed JSON', () => {
  const responses = stdio(['{broken', list(36)]);
  assert.equal(responses.length, 2);
  assert.equal(responses[0].error.code, -32700);
  assert.equal(responses[0].id, undefined);
  assert.equal(responses[1].id, 36);
});

test('compiled MCP never dispatches notification tool calls', () => {
  const responses = stdio([
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'pp_fix', arguments: {} } },
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'pp_preflight', arguments: { workload: 'interactive' } } },
    list(37),
  ]);
  assert.deepEqual(responses.map(x => x.id), [37]);
});

test('compiled MCP bounds an oversized line and recovers at its delimiter', () => {
  const responses = stdio([{ ...list(38), padding: 'x'.repeat(65536) }, list(39)]);
  assert.equal(responses.length, 2);
  assert.equal(responses[0].error.code, -32600);
  assert.match(responses[0].error.message, /65536/);
  assert.equal(responses[1].id, 39);
});

test('compiled MCP correlates unexpected failures without leaking diagnostics', () => {
  const responses = stdio([call(40, 'pp_preflight', { workload: 'interactive' }), list(41)], undefined, [], true);
  assert.equal(responses.length, 2);
  assert.equal(responses[0].id, 40);
  assert.deepEqual(responses[0].error, { code: -32603, message: 'Internal server error' });
  assert.equal(responses[1].id, 41);
});

test('compiled MCP rejects non-boolean dryRun before audit or remediation', () => {
  const responses = stdio([call(42, 'pp_fix', { dryRun: 'false' }), list(43)]);
  assert.equal(responses[0].id, 42);
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /dryRun must be a boolean/);
  assert.equal(responses[1].id, 43);
});

test('compiled MCP rejects a non-string tool name', () => {
  const responses = stdio([call(44, 123, {}), list(45)]);
  assert.equal(responses[0].id, 44);
  assert.equal(responses[0].error.code, -32602);
  assert.equal(responses[1].id, 45);
});

for (const cwd of ['', '.', join(root, 'missing-fixture-directory'), join(root, 'package.json')]) test(`compiled MCP rejects explicit invalid directory ${cwd}`, () => {
  const responses = stdio([call(46, 'pp_preflight', { workload: 'interactive', cwd }), list(47)]);
  assert.equal(responses[0].id, 46);
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /existing absolute directory/);
  assert.equal(responses[1].id, 47);
});

test('compiled MCP accepts an existing absolute directory', () => {
  const responses = stdio([call(48, 'pp_preflight', { workload: 'interactive', cwd: root })]);
  assert.equal(responses[0].id, 48);
  assert.equal(JSON.parse(responses[0].result.content[0].text).hostname, 'fixture');
});

test('compiled Windows Git-size probe passes path as encoded literal data', () => {
  const probes = join(root, 'dist/core/probes.js');
  const script = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const cp = require('node:child_process');
    const os = require('node:os');
    const { join } = require('node:path');
    const cwd = "C:/fixture/O'Brien-\\u2018\\u2019-[$value]";
    let ps;
    fs.existsSync = path => path === join(cwd, '.git');
    os.platform = () => 'win32';
    cp.execFileSync = (command, args) => {
      if (command === 'git') {
        assert.equal(args[0], '-C'); assert.equal(args[1], cwd);
        if (args[2] === 'rev-parse') return 'true';
        if (args[2] === 'branch') return 'fixture';
        if (args[2] === 'status') return '';
        if (args[2] === 'log') return 'fix(fixture): test';
      }
      if (command === 'powershell') { ps = args[3]; return '7'; }
      throw new Error('Unexpected subprocess');
    };
    const info = require(${JSON.stringify(probes)}).probeGit(cwd);
    assert.equal(info.isRepo, true); assert.equal(info.repoSizeMB, 7);
    assert.ok(ps.includes('-LiteralPath $gitDirectory'));
    const encoded = /FromBase64String\\('([A-Za-z0-9+/=]+)'\\)/.exec(ps)[1];
    assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), join(cwd, '.git'));
    assert.ok(!ps.includes(cwd));
    if (process.platform === 'win32') {
      const marker = ps.indexOf('(Get-ChildItem');
      assert.ok(marker > 0, 'Decode prefix delimiter must be present');
      const prefix = ps.slice(0, marker);
      assert.ok(!prefix.includes('Get-ChildItem'));
      assert.equal(prefix, "$gitDirectory = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "')); ");
      const decoded = cp.spawnSync('powershell', ['-NoProfile', '-Command', prefix + '[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($gitDirectory)))'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      assert.ifError(decoded.error); assert.equal(decoded.status, 0);
      assert.equal(decoded.stderr, ''); assert.equal(decoded.stdout, encoded);
    }
    process.stdout.write(JSON.stringify({ interceptedProbe: true, noLiveGitOrSizeProbe: true, nativePowerShellDecode: process.platform === 'win32' }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).interceptedProbe, true);
});

test('compiled MCP rejects IDs on notification methods and answers ping', () => {
  const responses = stdio([
    { jsonrpc: '2.0', id: 0, method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 'ping', method: 'ping' },
  ]);
  assert.deepEqual(responses.map(x => x.id), [0, 'ping']);
  assert.equal(responses[0].error.code, -32600);
  assert.deepEqual(responses[1].result, {});
});

for (const args of [{ format: 'invalid' }, { format: 42 }, { theme: 'invalid' }, { theme: null }]) test(`compiled MCP validates audit choices ${JSON.stringify(args)}`, () => {
  const responses = stdio([call(50, 'pp_audit', args), list(51)]);
  assert.equal(responses[0].id, 50);
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /format must be/);
  assert.equal(responses[1].id, 51);
});

for (const count of ['10', null, 0, -1, 0.5]) test(`compiled MCP validates trend count ${JSON.stringify(count)}`, () => {
  const responses = stdio([call(52, 'pp_trend', { count }), list(53)]);
  assert.equal(responses[0].id, 52);
  assert.equal(responses[0].result.isError, true);
  assert.match(responses[0].result.content[0].text, /positive safe integer/);
  assert.equal(responses[1].id, 53);
});
