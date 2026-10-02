// Run the real TypeScript admission tests without installs or machine probes.
// API introduced in Node 22.13; verified on 24.16.0. This is not typechecking.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { SourceTextModule, SyntheticModule, createContext } = require('node:vm');

if (typeof stripTypeScriptTypes !== 'function' || typeof SourceTextModule !== 'function') {
  throw new Error('Use --experimental-vm-modules and the stripping API; verified on Node 24.16.0.');
}

function builtin(name) {
  return new SyntheticModule(['default'], function () {
    this.setExport('default', require(name));
  }, { identifier: name });
}

function source(relative, context) {
  const path = join(__dirname, '..', relative);
  return new SourceTextModule(stripTypeScriptTypes(readFileSync(path, 'utf8')), {
    identifier: path,
    context,
  });
}

const preflight = source('src/core/preflight.ts');
const tests = source('src/core/preflight.test.ts');
const storage = source('src/core/storage.ts');
const sensors = new SyntheticModule(['buildAdmissionMaintenancePlan'], function () {
  this.setExport('buildAdmissionMaintenancePlan', () => {
    throw new Error('Pure admission tests must not invoke machine sensors.');
  });
});

async function link(name) {
  if (name === './preflight.js') return preflight;
  if (name === './storage.js') return storage;
  if (name === 'node:child_process') return new SyntheticModule(['execFileSync'], function () { this.setExport('execFileSync', () => { throw new Error('Pure fixture denies storage probes'); }); });
  if (name === './maintenance.js') return sensors;
  if (['node:os', 'node:assert/strict', 'node:test'].includes(name)) return builtin(name);
  throw new Error(`Unexpected admission-test import: ${name}`);
}

async function adapterTest() {
  const assert = require('node:assert/strict');
  const test = require('node:test');
  const responses = [];
  let receive;
  const storageFixture = { sampledAt: new Date().toISOString(), readings: ['system', 'target', 'temp'].map(scope => ({ scope, status: 'measured', totalBytes: '100', availableBytes: '20' })) };
  const fixture = {
    probeEvidence: { sampledAt: new Date().toISOString(), memory: 'measured', disk: 'measured', cpu: 'measured', processes: 'measured', crashes: 'measured' },
    hostname: 'fixture', posture: 'green', swarmPosture: 'expand',
    metrics: {
      ramFreeMB: 2_419, ramUsedPct: 50, cpuLoadPct: 20, cpuSystemLoadPct: 5,
      codexTaskRuntimeCount: 0, mcpMemoryMB: 0, localModelCount: 0,
      devServerCount: 0, crashLoopApp: '', crashLoopCount: 0,
    },
  };
  const context = createContext({ process: {
    cwd: () => __dirname,
    platform: process.platform,
    stdout: { write: line => responses.push(JSON.parse(line)) },
    stderr: { write: line => { throw new Error(line); } },
    stdin: { setEncoding() {}, on(event, listener) {
      assert.equal(event, 'data'); receive = listener;
    } },
  } });
  const admission = source('src/core/preflight.ts', context);
  const adapter = source('src/integrations/mcp-server/index.ts', context);
  const unused = () => { throw new Error('Unexpected non-preflight tool or sensor invocation.'); };
  const exportsByImport = {
    '../../core/maintenance.js': { buildMaintenancePlan: () => fixture },
    './maintenance.js': { buildAdmissionMaintenancePlan: () => fixture },
    './storage.js': { ...storage.namespace, probeStorage: () => storageFixture },
    '../../core/audit.js': { runAudit: unused },
    '../../history/tracker.js': { TrendTracker: unused },
    '../../fixes/autofix.js': { runAllFixes: unused },
    '../../format/terminal.js': { formatMaintenanceCompact: unused, formatMarkdown: unused },
    'node:path': { resolve: require('node:path').resolve, isAbsolute: require('node:path').isAbsolute },
    'node:fs': { statSync: require('node:fs').statSync },
    'node:os': { default: require('node:os') },
  };
  await adapter.link(async name => {
    if (name === '../../core/preflight.js') return admission;
    const values = exportsByImport[name];
    if (!values) throw new Error(`Unexpected MCP fixture import: ${name}`);
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context, identifier: name });
  });
  await adapter.evaluate();
  test('actual MCP preflight dispatch preserves invalid reserves and the RAM floor', () => {
    function request(args) {
      const id = responses.length + 1;
      receive(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call',
        params: { name: 'pp_preflight', arguments: args } }) + '\n');
      assert.equal(responses.length, id);
      assert.equal(responses.at(-1).id, id);
      const plan = JSON.parse(responses.at(-1).result.content[0].text);
      assert.equal(responses.at(-1).result.isError, plan.decision === 'hold');
      return plan;
    }
    for (const reserveGB of [-1, 'bad', null, 0.5]) {
      assert.equal(request({ workload: 'interactive', reserveGB }).decision, 'hold', String(reserveGB));
    }
    assert.equal(request({ workload: 'interactive', reserveGB: 0 }).decision, 'allow');
    assert.equal(request({ workload: 'interactive' }).decision, 'allow');
    assert.equal(request({ workload: 'build', reserveGB: 0 }).decision, 'hold');
    fixture.metrics.ramFreeMB = 4_608;
    assert.equal(request({ workload: 'interactive', reserveGB: 0.5 }).decision, 'allow');
  });
}

async function maintenanceEvidenceTest() {
  const assert = require('node:assert/strict');
  const test = require('node:test');
  const snapshot = {
    mem: { totalMB: 32768, freeMB: 18000, usedPct: 45 }, disk: { totalGB: 1000, freeGB: 200, usedPct: 80 }, uptime: { uptimeHours: 12 },
    cpu: { status: 'measured', loadPct: 20, systemLoadPct: 5 },
    crashes: { status: 'measured', topApp: '', topAppCrashes: 0, totalCrashes: 0, windowMinutes: 15 },
    procs: { status: 'measured', processes: [], totalProcesses: 100, nodeCount: 0, claudeCount: 0, cursorCount: 0, codexCount: 0, codexTaskRuntimeCount: 0, mcpCount: 0, mcpProcessCount: 0, mcpMemoryMB: 0, duplicateMcpProcesses: 0, agentTreeMemoryMB: 0 },
  };
  const maintenance = source('src/core/maintenance.ts');
  await maintenance.link(async name => {
    if (name === 'node:os') return builtin(name);
    if (name === './audit.js') return new SyntheticModule(['runAuditWithProbes'], function () { this.setExport('runAuditWithProbes', () => ({ audit: { totalScore: 90, grade: 'A' }, snapshot })); });
    if (name === './probes.js') return new SyntheticModule(['probeMemory', 'probeCpu', 'probeDisk', 'probeProcesses', 'probeUptime', 'probeCrashLoops'], function () {
      for (const key of ['probeMemory', 'probeCpu', 'probeDisk', 'probeProcesses', 'probeUptime', 'probeCrashLoops']) {
        this.setExport(key, () => { throw new Error('Full maintenance must reuse its audit snapshot'); });
      }
    });
    throw new Error('Unexpected maintenance fixture import: ' + name);
  });
  await maintenance.evaluate();
  test('actual maintenance cannot advertise expansion with unknown probe capacity', () => {
    assert.equal(maintenance.namespace.buildMaintenancePlan().swarmPosture, 'expand');
    for (const key of ['cpu', 'crashes', 'procs']) {
      snapshot[key].status = 'unknown';
      const plan = maintenance.namespace.buildMaintenancePlan();
      assert.equal(plan.posture, 'constrain', key);
      assert.equal(plan.swarmPosture, 'pause-new-swarms', key);
      assert.match(plan.reasons.join(' '), /Headroom is unknown/);
      snapshot[key].status = 'measured';
    }
    for (const key of ['mem', 'disk']) {
      const totalKey = key === 'mem' ? 'totalMB' : 'totalGB';
      const saved = snapshot[key][totalKey]; snapshot[key][totalKey] = 0;
      const plan = maintenance.namespace.buildMaintenancePlan();
      assert.notEqual(plan.swarmPosture, 'expand');
      assert.match(plan.reasons.join(' '), /capacity is unknown/);
      assert.doesNotMatch(plan.reasons.join(' '), key === 'mem' ? /RAM is workable/ : /Disk is critical/);
      assert.ok(!plan.actions.some(action => action.id === 'safe-cache-cleanup'));
      snapshot[key][totalKey] = saved;
    }
  });
}

async function admissionOnlyTest() {
  const assert = require('node:assert/strict');
  const test = require('node:test');
  const calls = [];
  const snapshot = {
    mem: { totalMB: 32768, freeMB: 18000, usedPct: 45 },
    disk: { totalGB: 1000, freeGB: 200, usedPct: 80 },
    uptime: { uptimeHours: 12 },
    cpu: { status: 'measured', loadPct: 20, systemLoadPct: 5 },
    crashes: { status: 'measured', topApp: '', topAppCrashes: 0, totalCrashes: 0, windowMinutes: 15 },
    procs: { status: 'measured', processes: [], totalProcesses: 100, nodeCount: 0, claudeCount: 0, cursorCount: 0, codexCount: 0, codexTaskRuntimeCount: 0, mcpCount: 0, mcpProcessCount: 0, mcpMemoryMB: 0, duplicateMcpProcesses: 0, agentTreeMemoryMB: 0 },
  };
  let availableBytes = 200000;
  const maintenance = source('src/core/maintenance.ts');
  const admission = source('src/core/preflight.ts');
  const probes = {};
  for (const [name, key] of Object.entries({ probeMemory: 'mem', probeCpu: 'cpu', probeDisk: 'disk', probeProcesses: 'procs', probeUptime: 'uptime', probeCrashLoops: 'crashes' })) {
    probes[name] = (...args) => { calls.push({ name, args }); return snapshot[key]; };
  }
  for (const name of ['probeGpu', 'probeGit', 'probeSecrets', 'probeTemp']) {
    probes[name] = () => { throw new Error('Admission must not collect ' + name); };
  }
  const synthetic = (values, identifier) => new SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { identifier });
  const audit = synthetic({ runAuditWithProbes: () => {
    calls.push({ name: 'full-audit' });
    return { audit: { totalScore: 90, grade: 'A' }, snapshot };
  } }, './audit.js');
  await admission.link(async name => {
    if (name === './maintenance.js') return maintenance;
    if (name === './audit.js') return audit;
    if (name === './probes.js') return synthetic(probes, name);
    if (name === 'node:os') return builtin(name);
    if (name === './storage.js') return synthetic({ ...storage.namespace, probeStorage: cwd => {
      calls.push({ name: 'probeStorage', args: [cwd] });
      return { sampledAt: new Date().toISOString(), readings: ['system', 'target', 'temp'].map(scope => ({ scope, status: 'measured', totalBytes: '1000000', availableBytes: String(availableBytes) })) };
    } }, name);
    throw new Error('Unexpected admission collection import: ' + name);
  });
  await admission.evaluate();
  const plan = (workload = 'review-lite', reserveMB = 2048) => admission.namespace.buildPreflightPlan(workload, { cwd: __dirname, reserveMB });
  test('actual preflight collects only admission evidence, without a full audit', () => {
    calls.length = 0;
    assert.equal(plan().decision, 'allow');
    assert.deepEqual(calls.map(x => x.name).sort(), ['probeMemory', 'probeCpu', 'probeDisk', 'probeProcesses', 'probeUptime', 'probeCrashLoops', 'probeStorage'].sort());
    assert.equal(calls.find(x => x.name === 'probeDisk').args[0], __dirname);
    assert.equal(calls.find(x => x.name === 'probeStorage').args[0], __dirname);
  });
  test('admission maintenance does not invent a Ten Gate score; full maintenance keeps its audit', () => {
    calls.length = 0;
    const lean = maintenance.namespace.buildAdmissionMaintenancePlan(__dirname);
    assert.equal(lean.metrics.score, null);
    assert.equal(lean.metrics.grade, 'UNKNOWN');
    assert.match(lean.summary, /Ten Gate score not collected/);
    assert.ok(!calls.some(x => x.name === 'full-audit'));
    calls.length = 0;
    const full = maintenance.namespace.buildMaintenancePlan(__dirname);
    assert.equal(full.metrics.score, 90);
    assert.equal(full.metrics.grade, 'A');
    assert.deepEqual(calls, [{ name: 'full-audit' }]);
  });
  test('actual admission collector preserves unknown and unsupported holds for every required probe', () => {
    for (const [key, field, value] of [['mem', 'totalMB', 0], ['disk', 'totalGB', 0], ['cpu', 'status', 'unknown'], ['procs', 'status', 'unknown'], ['crashes', 'status', 'unknown'], ['crashes', 'status', 'unsupported']]) {
      const saved = snapshot[key][field]; snapshot[key][field] = value;
      try {
        const held = plan();
        assert.equal(held.decision, 'hold', key + '/' + value);
        assert.equal(held.requirements.diskGrowthPermitted, false);
        assert.equal(plan('interactive', 0).decision, 'allow');
      } finally { snapshot[key][field] = saved; }
    }
  });
  test('actual lean collection preserves the RAM floor, exact storage boundaries and freeze on reading', () => {
    assert.equal(plan('interactive', 32 * 1024).decision, 'hold');
    const saved = snapshot.mem.freeMB; snapshot.mem.freeMB = 4095;
    try {
      assert.equal(plan('build', 0).decision, 'hold');
      assert.equal(plan('interactive', 0).decision, 'allow');
    } finally { snapshot.mem.freeMB = saved; }
    try {
      availableBytes = 100000;
      assert.equal(plan('build', 0).decision, 'bounded');
      assert.equal(plan('swarm', 0).decision, 'hold');
      availableBytes = 30000;
      const frozen = plan('interactive', 0);
      assert.equal(frozen.decision, 'hold');
      assert.equal(frozen.requirements.escalationRequired, true);
      for (const [bytes, state] of [[39999, 'freeze'], [40000, 'hold'], [79999, 'hold'], [80000, 'bounded'], [149999, 'bounded'], [150000, 'normal']]) {
        availableBytes = bytes;
        const reading = plan('interactive', 0);
        assert.equal(reading.storage.state, state, String(bytes));
        assert.equal(reading.decision, state === 'freeze' ? 'hold' : 'allow');
        assert.equal(plan('build', 0).decision, bytes < 80000 ? 'hold' : bytes < 150000 ? 'bounded' : 'allow');
        assert.equal(plan('swarm', 0).decision, bytes < 150000 ? 'hold' : 'allow');
      }
    } finally { availableBytes = 200000; }
  });
}

tests.link(link).then(() => tests.evaluate()).then(adapterTest).then(maintenanceEvidenceTest).then(admissionOnlyTest).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
