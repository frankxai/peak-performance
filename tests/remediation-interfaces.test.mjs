import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

async function javascript(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  return nodeModule.stripTypeScriptTypes
    ? nodeModule.stripTypeScriptTypes(source, { mode: 'strip' })
    : (await import('typescript')).default.transpileModule(source, {
      compilerOptions: { target: 99, module: 99 },
    }).outputText;
}
const plans = await import('data:text/javascript;base64,' + Buffer.from(
  await javascript('../src/fixes/autofix.ts'),
).toString('base64'));
const fixtures = [
  { priority: 'high', gate: 'disk', message: 'Review cache ownership', fix: 'npm-cache-clean', autoFixable: false },
  { priority: 'medium', gate: 'workspace', message: 'Review temp ownership', fix: 'temp-clean-win', autoFixable: false },
];
const withoutImports = source => source.replace(/^import\s+.*?;\s*$/gm, '');
function fixture() {
  const output = [], errors = [], input = {};
  let audits = 0;
  const context = vm.createContext({
    runAudit: () => { audits++; return { recommendations: fixtures, totalScore: 60, grade: 'C' }; },
    runAllFixes: plans.runAllFixes,
    resolve: () => '/fixture/.pp/history.json',
    console: { log: (...args) => output.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')) },
    process: {
      argv: ['node', 'pp', 'fix'], env: {}, cwd: () => '/fixture', exitCode: 0,
      stdout: { write: text => output.push(text) }, stderr: { write: text => errors.push(text) },
      stdin: { setEncoding() {}, on: (event, callback) => { input[event] = callback; } },
    },
  });
  return { context, output, errors, input, auditCount: () => audits };
}

test('actual CLI reviews manual cleanup plans once without claiming execution or score gains', async () => {
  const f = fixture();
  const code = withoutImports(await javascript('../src/cli.ts'))
    .replace('void (async () => {', 'globalThis.done = (async () => {');
  vm.runInContext(code, f.context, { timeout: 1000 });
  await f.context.done;
  assert.equal(f.errors.length, 0, f.errors.join('\n'));
  assert.equal(f.auditCount(), 1);
  assert.match(f.output.join('\n'), /reviewing 2 cleanup plans/i);
  assert.match(f.output.join('\n'), /held/i);
  assert.doesNotMatch(f.output.join('\n'), /running.*auto.fix|re-auditing|before:.*after:|\+\d+ points/i);
});

for (const dryRun of [false, true]) {
  test(`actual MCP pp_fix remains read-only for dryRun=${dryRun}`, async () => {
    const f = fixture();
    vm.runInContext(withoutImports(await javascript('../src/integrations/mcp-server/index.ts')),
      f.context, { timeout: 1000 });
    assert.equal(typeof f.input.data, 'function');
    f.input.data(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'pp_fix', arguments: { dryRun } } }) + '\n');
    assert.equal(f.errors.length, 0, f.errors.join('\n'));
    assert.equal(f.auditCount(), 1);
    const reply = JSON.parse(f.output.at(-1));
    assert.equal(reply.id, 1);
    const content = JSON.parse(reply.result.content[0].text);
    assert.equal(content.executionPermitted, false);
    assert.equal(content.mode, 'review-only');
    assert.equal(content.plans.length, 2);
    assert.ok(content.plans.every(p => p.disposition === 'held' && p.success === false));
    assert.equal(content.after, undefined);
  });
}

test('actual doctor uses only read-only review commands and does not infer orphan ownership from counts', async () => {
  const doctor = await import('data:text/javascript;base64,' + Buffer.from(
    await javascript('../src/core/doctor.ts'),
  ).toString('base64'));
  const audit = { gates: [
    { id: 'disk', score: 2, metrics: { freeGB: 12 } },
    { id: 'workspace', score: 2, metrics: { tempFiles: 6000 } },
    { id: 'agents', score: 2, metrics: { agents: 10, estAgentMB: 4500, agentPct: 50 } },
    { id: 'memory', score: 2, metrics: {} },
    { id: 'processes', score: 2, metrics: { node: 200, claude: 1, cursor: 0, codex: 1 } },
  ] };
  const diagnoses = doctor.diagnose(audit);
  assert.ok(diagnoses.length >= 3);
  const commands = diagnoses.flatMap(d => d.actions.map(a => a.command).filter(Boolean));
  assert.ok(commands.includes('pp fix'));
  assert.ok(commands.includes('pp inspect --all --json'));
  const readOnly = new Set(['pp fix', 'pp inspect --all --json']);
  assert.ok(commands.every(command => readOnly.has(command)), 'Every suggested command must be read-only');
  assert.ok(diagnoses.every(d => !/orphan/i.test(d.rootCause)), 'A count is not proof of orphan ownership');
});
