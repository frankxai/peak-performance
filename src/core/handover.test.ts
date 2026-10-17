import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runPrepHandover } from './handover.js';

const sourcePath = join(process.cwd(), 'src', 'core', 'handover.ts');

test('prep handover records porcelain and grok resume lines without committing', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(source, /git add/);
  assert.doesNotMatch(source, /git commit/);
  assert.doesNotMatch(source, /git tag/);
  assert.doesNotMatch(source, /git notes/);
  assert.doesNotMatch(source, /--no-verify/);
  assert.doesNotMatch(source, /git reset HEAD~1/);

  const root = mkdtempSync(join(tmpdir(), 'pp-asph-'));
  try {
    const reposRoot = join(root, 'repos');
    const dirty = join(reposRoot, 'aaa-dirty');
    const clean = join(reposRoot, 'zzz-clean');
    const desktopDir = join(root, 'desktop');
    const grokRoot = join(root, 'grok');
    const sessionsRoot = join(grokRoot, 'sessions');
    const cwdFolder = join(sessionsRoot, 'cwd-one');
    mkdirSync(join(dirty, '.git'), { recursive: true });
    mkdirSync(join(clean, '.git'), { recursive: true });
    mkdirSync(desktopDir, { recursive: true });
    mkdirSync(join(cwdFolder, 'main-111'), { recursive: true });
    mkdirSync(join(cwdFolder, 'sub-222'), { recursive: true });
    mkdirSync(join(cwdFolder, 'fork-333'), { recursive: true });
    mkdirSync(join(cwdFolder, 'bad-555'), { recursive: true });
    mkdirSync(join(cwdFolder, 'main-111', 'subagents', 'hidden'), { recursive: true });

    writeFileSync(join(grokRoot, 'active_sessions.json'), JSON.stringify([
      { session_id: 'bad-555' },
      { session_id: 'sub-222' },
      { session_id: 'main-111', cwd: 'C:\\Users\\frank' },
      { session_id: 'fork-333' },
      { session_id: 'gone-444' },
    ]));
    writeFileSync(join(cwdFolder, 'bad-555', 'summary.json'), '{not json');
    writeFileSync(join(cwdFolder, 'sub-222', 'summary.json'), JSON.stringify({
      session_kind: 'subagent',
      generated_title: 'SKIP-SUBAGENT',
      last_turn_summary: 'skip subagent',
    }));
    writeFileSync(join(cwdFolder, 'fork-333', 'summary.json'), JSON.stringify({
      session_kind: 'subagent_fork',
      generated_title: 'SKIP-FORK',
      last_turn_summary: 'skip fork',
    }));
    writeFileSync(join(cwdFolder, 'main-111', 'summary.json'), JSON.stringify({
      generated_title: 'Census handover',
      last_turn_summary: 'Leave dirty repos uncommitted',
    }));
    writeFileSync(join(cwdFolder, 'main-111', 'subagents', 'hidden', 'summary.json'), JSON.stringify({
      generated_title: 'SKIP-DEEP-WALK',
      last_turn_summary: 'must not be read',
    }));

    const calls: string[] = [];
    const result = runPrepHandover(dirty, {
      reposRoot,
      desktopDir,
      historyFiles: [],
      grokActiveSessionsPath: join(grokRoot, 'active_sessions.json'),
      grokSessionsRoot: sessionsRoot,
      exec(cmd, repoCwd) {
        calls.push(`${repoCwd} :: ${cmd}`);
        if (/\bgit\s+(add|commit|tag|notes)\b/.test(cmd) || cmd.includes('--no-verify')) {
          throw new Error(`refused ${cmd}`);
        }
        if (cmd === 'git status --porcelain') {
          if (repoCwd === dirty) return ' M src/kept.ts\n?? notes/untracked.txt\n';
          return '';
        }
        if (cmd === 'git branch --show-current') return 'agent/grok/asph-readonly-census';
        if (cmd === 'git log -1 --oneline') return 'abc1234 docs';
        throw new Error(`unexpected ${cmd}`);
      },
    });

    assert.equal(calls.length, 6);
    for (const call of calls) {
      assert.match(call, /git (status --porcelain|branch --show-current|log -1 --oneline)$/);
    }

    assert.equal(result.success, true);
    assert.equal(result.txtFile, join(desktopDir, 'handover-reboot.txt'));
    assert.equal(result.htmlFile, join(desktopDir, 'handover-reboot.html'));
    const txt = readFileSync(result.txtFile, 'utf8');
    const html = readFileSync(result.htmlFile, 'utf8');

    for (const body of [txt, html]) {
      assert.match(body, /grok --resume main-111/);
      assert.match(body, /Census handover/);
      assert.match(body, /Leave dirty repos uncommitted/);
      assert.ok(body.includes(' M src/kept.ts'));
      assert.ok(body.includes('?? notes/untracked.txt'));
      assert.equal(body.includes('SKIP-SUBAGENT'), false);
      assert.equal(body.includes('SKIP-FORK'), false);
      assert.equal(body.includes('SKIP-DEEP-WALK'), false);
      assert.equal(body.includes('sub-222'), false);
      assert.equal(body.includes('fork-333'), false);
      assert.equal(body.includes('gone-444'), false);
      assert.equal(body.includes('bad-555'), false);
      assert.equal(body.includes('git reset'), false);
      assert.equal(body.includes('--no-verify'), false);
      assert.equal(body.includes('Saved to WIP'), false);
    }
    assert.equal(txt.split('grok --resume main-111').length - 1, 1);
    assert.match(txt, /left uncommitted; not committed, tagged, or noted/);
    assert.match(txt, /REPOSITORY: zzz-clean/);
    assert.match(html, /2 uncommitted/);
    assert.match(html, />Clean</);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
