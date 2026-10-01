// Requires pnpm build. Real emitted CLI/MCP code runs in bounded child processes.
// Only the machine sensor builder is replaced; no live audit or remediation runs.
const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');

function run(entry, args = [], input, freeMB = 2419) {
  const directory = mkdtempSync(join(tmpdir(), 'pp-compiled-test-'));
  const preload = join(directory, 'sensors.cjs');
  try {
    const maintenance = join(root, 'dist/core/maintenance.js');
    writeFileSync(preload, `
      const maintenance = require(${JSON.stringify(maintenance)});
      maintenance.buildMaintenancePlan = () => ({
        hostname: 'fixture', posture: 'green', swarmPosture: 'expand',
        metrics: {
          ramFreeMB: ${freeMB}, ramUsedPct: 50, cpuLoadPct: 20, cpuSystemLoadPct: 5,
          codexTaskRuntimeCount: 0, mcpMemoryMB: 0, localModelCount: 0,
          devServerCount: 0, crashLoopApp: '', crashLoopCount: 0
        }
      });
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
    unlinkSync(preload);
    rmdirSync(directory);
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
