import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// `pp prep --help` once ran the full checkpoint across every repository (2026-10-26),
// so asking for help must never reach runPrepHandover.
const cli = join(__dirname, 'cli.ts');

for (const flag of ['--help', '-h']) {
  test(`pp prep ${flag} prints usage without checkpointing`, () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', cli, 'prep', flag], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /pp prep/);
    assert.doesNotMatch(run.stdout, /Running Agent State Preservation/);
  });
}
