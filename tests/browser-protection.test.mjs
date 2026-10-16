import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

// Exercise the actual source without dependencies or invoking machine probes.
const source = readFileSync(new URL('../src/core/probes.ts', import.meta.url), 'utf8');
const javascript = nodeModule.stripTypeScriptTypes
  ? nodeModule.stripTypeScriptTypes(source, { mode: 'strip' })
  : (await import('typescript')).default.transpileModule(source, {
    compilerOptions: { target: 99, module: 99 },
  }).outputText;
const subject = await import(`data:text/javascript;base64,${Buffer.from(
  javascript + '\nexport { classifyProcess, processReasoning, processActionHint, addProcessCounts };',
).toString('base64')}`);

test('personal browser roots and renderer children are protected', () => {
  for (const name of ['chrome.exe', 'msedge.exe', 'brave.exe', 'comet.exe']) {
    for (const command of [name, `${name} --type=renderer`, `${name} --type=utility`]) {
      const result = subject.classifyProcess(name, command);
      assert.equal(result.role, 'browser', `${name}: ${command}`);
      assert.equal(result.protected, true, `${name}: ${command}`);
      assert.match(result.protectionReason, /browser sessions/i);
    }
  }
});

test('extensionless names and Windows name casing retain protection', () => {
  for (const name of ['chrome', 'msedge', 'brave', 'comet', 'CHROME.EXE', 'Brave.EXE']) {
    assert.equal(subject.classifyProcess(name, name).protected, true, name);
  }
});

test('browser identity wins over agent and build words in a command line', () => {
  for (const command of ['chrome.exe --user-data-dir=C:/QA/antigravity', 'comet.exe next build']) {
    const result = subject.classifyProcess(command.split(' ')[0], command);
    assert.equal(result.role, 'browser');
    assert.equal(result.protected, true);
  }
});

test('unrelated executables and command arguments do not count as browsers', () => {
  for (const name of ['notchrome.exe', 'chrome-backup.exe', 'chrome-headless-shell.exe', 'comet-helper.exe', 'node.exe']) {
    assert.notEqual(subject.classifyProcess(name, `${name} chrome.exe`).role, 'browser', name);
  }
});

test('protected browser guidance preserves personal sessions', () => {
  const result = subject.classifyProcess('chrome.exe', 'chrome.exe');
  assert.match(subject.processReasoning(result), /protected browser/i);
  assert.match(subject.processActionHint(result), /leave personal browsers open/i);
});

test('browser counts include all four browser families and reject lookalikes', () => {
  const info = { nodeCount: 0, claudeCount: 0, cursorCount: 0, codexCount: 0, vscodeCount: 0, edgeChromeTabs: 0 };
  for (const name of ['chrome.exe', 'msedge.exe', 'brave.exe', 'comet.exe', 'Brave', 'notchrome.exe']) {
    subject.addProcessCounts(info, name);
  }
  assert.equal(info.edgeChromeTabs, 5);
});

test('Python tray counts the same browser families without importing the tray app', () => {
  const script = `
import ast, pathlib
tree = ast.parse(pathlib.Path('tray/pp_monitor.py').read_text(encoding='utf-8-sig'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'probe_processes')
names = ['chrome.exe', 'msedge.exe', 'brave.exe', 'comet.exe', 'Brave', 'notchrome.exe']
class Proc:
    def __init__(self, name): self.info = {'name': name}
class FakePsutil:
    NoSuchProcess = type('NoSuchProcess', (Exception,), {})
    AccessDenied = type('AccessDenied', (Exception,), {})
    @staticmethod
    def process_iter(fields): return [Proc(name) for name in names]
scope = {'psutil': FakePsutil}
exec(compile(ast.Module(body=[function], type_ignores=[]), '<tray-probe>', 'exec'), scope)
result = scope['probe_processes']()
assert result['edgeChromeTabs'] == 5, result
assert result['totalProcesses'] == 6, result
`;
  const result = spawnSync('python', ['-c', script], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
