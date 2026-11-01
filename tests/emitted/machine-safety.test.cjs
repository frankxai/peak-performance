const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function emitted(relative) {
  const attempted = [];
  const module = { exports: {} };
  const file = path.resolve(__dirname, '../../dist', relative);
  const safeRequire = name => {
    if (name === 'node:child_process') return { execFileSync: (...args) => {
      attempted.push(args); throw new Error('A process command is forbidden in this fixture');
    } };
    if (name === 'node:fs') return { existsSync: () => false, statSync: () => { throw new Error('No filesystem probe admitted'); } };
    if (name === 'node:os' || name === 'node:path') return require(name);
    throw new Error('Unexpected module in compiled fixture: ' + name);
  };
  const source = fs.readFileSync(file, 'utf8');
  const expose = relative === 'core/probes.js' ? '\nexports.classifyForFixture = classifyProcess;' : '';
  vm.runInNewContext(source + expose, {
    module, exports: module.exports, require: safeRequire,
    process: { platform: process.platform },
  }, { filename: file, timeout: 1000 });
  return { subject: module.exports, attempted };
}

test('compiled cleanup exports cannot run a command or report a successful mutation', () => {
  const { subject, attempted } = emitted('fixes/autofix.js');
  const results = [subject.cleanNpmCache(), subject.cleanTempFiles(),
    subject.applyFix({ fix: 'temp-clean-win', autoFixable: true, gate: 'workspace', priority: 'high', message: 'Fixture' })];
  for (const result of results) {
    assert.equal(result.success, false);
    assert.equal(result.disposition, 'held');
    assert.equal(result.executionPermitted, false);
  }
  assert.equal(attempted.length, 0);
});

test('compiled browser classification preserves all four signed-in browser families', () => {
  const { subject, attempted } = emitted('core/probes.js');
  for (const name of ['chrome.exe', 'msedge.exe', 'brave.exe', 'comet.exe']) {
    const value = subject.classifyForFixture(name, name + ' --type=renderer');
    assert.equal(value.role, 'browser');
    assert.equal(value.protected, true);
  }
  assert.equal(attempted.length, 0);
});

test('compiled classifier retains protection without inventing vendor OS identity', () => {
  const { subject } = emitted('core/probes.js');
  const value = subject.classifyForFixture('LenovoVantage-(LenovoMachineFixSystemAddin).exe', '');
  assert.equal(value.role, 'other');
  assert.equal(value.protected, true);
  assert.equal(subject.classifyForFixture('svchost.exe', '').role, 'system');
});
