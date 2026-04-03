/**
 * Snapshot — captures system state + screenshots as an archival bundle.
 * Saves to docs/ops/snapshots/{date}/
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { runAudit } from './audit.js';
import type { AuditResult } from '../types.js';

function run(cmd: string, timeout = 15_000): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

export interface SnapshotResult {
  dir: string;
  audit: AuditResult;
  screenshots: string[];
  snapshotFile: string;
}

export function takeSnapshot(cwd: string, notes?: string): SnapshotResult {
  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toISOString().slice(11, 16).replace(':', '');
  const dir = join(cwd, 'docs', 'ops', 'snapshots', date);

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Run PP audit
  const audit = runAudit({ cwd });

  // Take screenshots (Windows only for now)
  const screenshots: string[] = [];
  if (os.platform() === 'win32') {
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
foreach ($i in 0..($screens.Count-1)) {
  $s = $screens[$i]
  $b = $s.Bounds
  $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size)
  $path = "${dir.replace(/\\/g, '\\\\')}\\\\screen-$i-${time}.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "$path|$($b.Width)x$($b.Height)"
}`.trim();

    const out = run(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`);
    for (const line of out.split('\n')) {
      if (line.includes('|')) {
        screenshots.push(line.split('|')[0]);
      }
    }
  }

  // Count agents
  const agentCensus: Record<string, number> = {};
  if (os.platform() === 'win32') {
    const tasklist = run('tasklist /fo csv /nh');
    const names = tasklist.split('\n').map(l => l.match(/"([^"]+)"/)?.[1]?.toLowerCase() || '');
    agentCensus['claude'] = names.filter(n => n.includes('claude')).length;
    agentCensus['codex'] = names.filter(n => n.includes('codex')).length;
    agentCensus['comet'] = names.filter(n => n.includes('comet')).length;
    agentCensus['node'] = names.filter(n => n.includes('node')).length;
    agentCensus['total'] = names.length;
  }

  // Build snapshot JSON
  const snapshot = {
    timestamp: new Date().toISOString(),
    device: os.hostname(),
    platform: os.platform(),
    screens: screenshots.map((s, i) => ({ id: i, file: s.split(/[/\\]/).pop() })),
    agents: agentCensus,
    system: {
      ram_total_mb: Math.round(os.totalmem() / 1024 / 1024),
      ram_free_mb: Math.round(os.freemem() / 1024 / 1024),
      uptime_hours: Math.round(os.uptime() / 3600 * 10) / 10,
    },
    pp_score: audit.totalScore,
    pp_grade: audit.grade,
    gates: Object.fromEntries(audit.gates.map(g => [g.id, { score: g.score, status: g.status }])),
    notes: notes || '',
  };

  const snapshotFile = join(dir, `snapshot-${time}.json`);
  writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));

  return { dir, audit, screenshots, snapshotFile };
}
