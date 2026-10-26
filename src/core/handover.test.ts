import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { checkpointModeFor, escapeHtml, findStashSha, isAsphWipLine } from './handover.js';

test('agent and codex branches get a commit checkpoint', () => {
  for (const b of ['agent/claude/asph-main-guard', 'agent/antigravity/x-20261026', 'codex/rova']) {
    assert.equal(checkpointModeFor(b), 'commit', b);
  }
});

test('every other branch gets a stash, never a commit', () => {
  for (const b of ['main', 'master', '', 'unknown', 'release/1.2', 'feature/x', 'agent', 'agent/claude', 'codexx/y', 'my-agent/claude/x']) {
    assert.equal(checkpointModeFor(b), 'stash', b);
  }
});

test('findStashSha picks the entry with this checkpoint tag, not the newest one', () => {
  const list = [
    'aaa111\tOn main: asph-2026-10-26T12-00-00-ffffffff',
    'bbb222\tOn main: asph-2026-10-26T12-00-00-1234abcd',
    'ccc333\tWIP on main: 9f3df0a unrelated',
  ].join('\n');
  assert.equal(findStashSha(list, 'asph-2026-10-26T12-00-00-1234abcd'), 'bbb222');
  assert.equal(findStashSha(list, 'asph-2026-10-26T12-00-00-00000000'), '');
});

test('escapeHtml neutralises markup from prompts and commit subjects', () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('x')">&`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;');
});

test('isAsphWipLine matches only the top-level .asph-wip folder', () => {
  for (const l of ['?? .asph-wip/', ' M .asph-wip/patch.diff', 'M .asph-wip/a', 'A  ".asph-wip/x y"', 'R  .asph-wip/a -> .asph-wip/b']) {
    assert.equal(isAsphWipLine(l), true, l);
  }
  for (const l of [' M notes.asph-wip.txt', '?? docs/.asph-wip/', ' M src/app.ts', '?? .asph-wipe/', 'R  .asph-wip/a -> notes.txt']) {
    assert.equal(isAsphWipLine(l), false, l);
  }
});
