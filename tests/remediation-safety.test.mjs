import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { test } from 'node:test';

// The legacy implementation must fail safely too: intercept its process runner.
// No test may invoke the real npm, shell, find or Remove-Item cleanup path.
const attempted = [];
globalThis.__ppRemediationAttempts = attempted;
const stub = 'data:text/javascript;base64,' + Buffer.from(`
  export function execFileSync(...args) {
    globalThis.__ppRemediationAttempts.push(args);
    return 'legacy cleanup would have executed';
  }
`).toString('base64');
const source = readFileSync(new URL('../src/fixes/autofix.ts', import.meta.url), 'utf8');
const stripped = nodeModule.stripTypeScriptTypes
  ? nodeModule.stripTypeScriptTypes(source, { mode: 'strip' })
  : (await import('typescript')).default.transpileModule(source, {
    compilerOptions: { target: 99, module: 99 },
  }).outputText;
const javascript = stripped.replaceAll("from 'node:child_process'", `from '${stub}'`);
const subject = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
const recommendation = (fix, autoFixable = true) => ({
  priority: 'high', gate: 'workspace', message: 'Synthetic cleanup proposal', fix, autoFixable,
});
function held(result) {
  assert.equal(result.success, false, 'Planning cannot claim a successful mutation');
  assert.equal(result.disposition, 'held');
  assert.equal(result.executionPermitted, false);
  assert.equal(attempted.length, 0, 'A cleanup process must never be invoked');
}

for (const fix of ['npm-cache-clean', 'temp-clean-win', 'temp-clean-unix']) {
  test(`${fix} is held even when a recommendation calls it auto-fixable`, () => {
    attempted.length = 0;
    const result = subject.applyFix(recommendation(fix));
    held(result);
    assert.match(result.output, /approval|review/i);
  });
}
test('legacy npm-cache entrypoint produces a plan without a process call', () => {
  attempted.length = 0;
  held(subject.cleanNpmCache());
});
test('legacy temp entrypoint produces a plan without age-based deletion', () => {
  attempted.length = 0;
  held(subject.cleanTempFiles());
});
test('batch planning preserves manual cleanup proposals while permitting no execution', () => {
  attempted.length = 0;
  const proposals = [recommendation('npm-cache-clean', false), recommendation('temp-clean-win'),
    { priority: 'low', gate: 'workspace', message: 'Observation only', autoFixable: false }];
  const results = subject.runAllFixes(proposals);
  assert.equal(results.length, 2);
  for (const result of results) held(result);
});
test('missing and unrecognized remediation cannot grant execution', () => {
  attempted.length = 0;
  for (const fix of [undefined, '', 'unknown-fix', 'temp-clean-win; unsafe']) {
    held(subject.applyFix(recommendation(fix)));
  }
});
