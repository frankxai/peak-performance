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
const sensors = new SyntheticModule(['buildMaintenancePlan'], function () {
  this.setExport('buildMaintenancePlan', () => {
    throw new Error('Pure admission tests must not invoke machine sensors.');
  });
});

async function link(name) {
  if (name === './preflight.js') return preflight;
  if (name === './maintenance.js') return sensors;
  if (['node:os', 'node:assert/strict', 'node:test'].includes(name)) return builtin(name);
  throw new Error(`Unexpected admission-test import: ${name}`);
}

async function adapterTest() {
  const assert = require('node:assert/strict');
  const test = require('node:test');
  const responses = [];
  let receive;
  const fixture = {
    hostname: 'fixture', posture: 'green', swarmPosture: 'expand',
    metrics: {
      ramFreeMB: 2_419, ramUsedPct: 50, cpuLoadPct: 20, cpuSystemLoadPct: 5,
      codexTaskRuntimeCount: 0, mcpMemoryMB: 0, localModelCount: 0,
      devServerCount: 0, crashLoopApp: '', crashLoopCount: 0,
    },
  };
  const context = createContext({ process: {
    cwd: () => 'C:/fixture',
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
    './maintenance.js': { buildMaintenancePlan: () => fixture },
    '../../core/audit.js': { runAudit: unused },
    '../../history/tracker.js': { TrendTracker: unused },
    '../../fixes/autofix.js': { runAllFixes: unused },
    '../../format/terminal.js': { formatMaintenanceCompact: unused, formatMarkdown: unused },
    'node:path': { resolve: require('node:path').resolve },
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
      return JSON.parse(responses.at(-1).result.content[0].text);
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

tests.link(link).then(() => tests.evaluate()).then(adapterTest).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
