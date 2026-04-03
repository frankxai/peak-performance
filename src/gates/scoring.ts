/**
 * Ten Gate Scoring Engine.
 * Maps raw probe metrics → 0-10 scores per gate → total 0-100.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GateScore, GateId, Recommendation } from '../types.js';
import type {
  MemoryInfo, CpuInfo, DiskInfo, GpuInfo,
  ProcessInfo, GitInfo, SecretsInfo, TempInfo,
} from '../core/probes.js';

function status(score: number): GateScore['status'] {
  if (score >= 9) return 'PERFECT';
  if (score >= 7) return 'OK';
  if (score >= 4) return 'WARN';
  return 'CRIT';
}

// ─── Foundation (Disk) ──────────────────────────────────────────
export function scoreDisk(disk: DiskInfo): GateScore {
  const recs: Recommendation[] = [];
  let score = 10;

  if (disk.freeGB < 10) { score = 2; recs.push({ priority: 'urgent', gate: 'disk', message: `Only ${disk.freeGB}GB free — builds will fail`, fix: 'npm cache clean --force', autoFixable: true }); }
  else if (disk.freeGB < 20) { score = 4; recs.push({ priority: 'high', gate: 'disk', message: `${disk.freeGB}GB free — getting critical`, fix: 'npm cache clean --force', autoFixable: true }); }
  else if (disk.freeGB < 50) { score = 6; }
  else if (disk.freeGB < 100) { score = 8; }

  return {
    id: 'disk',
    score,
    status: status(score),
    detail: `${disk.freeGB}GB free / ${disk.totalGB}GB (${disk.usedPct}% used)`,
    metrics: { freeGB: disk.freeGB, totalGB: disk.totalGB, usedPct: disk.usedPct },
  };
}

// ─── Flow (Memory) ──────────────────────────────────────────────
export function scoreMemory(mem: MemoryInfo): GateScore {
  let score = 10;

  if (mem.usedPct > 95) score = 1;
  else if (mem.usedPct > 90) score = 3;
  else if (mem.usedPct > 85) score = 5;
  else if (mem.usedPct > 80) score = 6;
  else if (mem.usedPct > 70) score = 8;

  return {
    id: 'memory',
    score,
    status: status(score),
    detail: `${mem.freeMB}MB free / ${mem.totalMB}MB (${mem.usedPct}% used)`,
    metrics: { freeMB: mem.freeMB, totalMB: mem.totalMB, usedPct: mem.usedPct },
  };
}

// ─── Fire (CPU + GPU) ───────────────────────────────────────────
export function scoreCpuGpu(cpu: CpuInfo, gpu: GpuInfo | null): GateScore {
  let score = 10;
  let detail = `${cpu.model} (${cpu.logicalCores} threads)`;

  if (gpu) {
    detail += ` | ${gpu.name} ${gpu.tempC}°C`;
    if (gpu.tempC > 90) score -= 4;
    else if (gpu.tempC > 80) score -= 2;
    else if (gpu.tempC > 70) score -= 1;

    if (gpu.utilPct > 90) score -= 2;
  }

  // CPU load (relative to cores)
  const loadPerCore = cpu.loadAvg1m / cpu.logicalCores;
  if (loadPerCore > 2) score -= 3;
  else if (loadPerCore > 1) score -= 2;
  else if (loadPerCore > 0.7) score -= 1;

  score = Math.max(0, Math.min(10, score));

  return {
    id: 'cpu',
    score,
    status: status(score),
    detail,
    metrics: {
      cores: cpu.logicalCores,
      loadAvg: cpu.loadAvg1m,
      ...(gpu ? { gpuTemp: gpu.tempC, gpuUtil: gpu.utilPct, gpuMem: `${gpu.memUsedMB}/${gpu.memTotalMB}MB` } : {}),
    },
  };
}

// ─── Heart (Process Health) ─────────────────────────────────────
export function scoreProcesses(procs: ProcessInfo): GateScore {
  let score = 10;
  const agents = procs.claudeCount + procs.cursorCount + procs.codexCount;
  const nodePerAgent = agents > 0 ? Math.round(procs.nodeCount / agents) : procs.nodeCount;

  // Agent instance count
  if (procs.claudeCount > 10) score -= 3;
  else if (procs.claudeCount > 6) score -= 2;
  else if (procs.claudeCount > 4) score -= 1;

  // Node:Agent ratio (healthy is 3-5:1)
  if (nodePerAgent > 15) score -= 3;
  else if (nodePerAgent > 10) score -= 2;
  else if (nodePerAgent > 7) score -= 1;

  // Total process count
  if (procs.totalProcesses > 600) score -= 2;
  else if (procs.totalProcesses > 400) score -= 1;

  score = Math.max(0, Math.min(10, score));

  return {
    id: 'processes',
    score,
    status: status(score),
    detail: `${agents} AI agents, ${procs.nodeCount} node, ${procs.totalProcesses} total (${nodePerAgent}:1 node/agent)`,
    metrics: {
      claude: procs.claudeCount,
      cursor: procs.cursorCount,
      codex: procs.codexCount,
      vscode: procs.vscodeCount,
      node: procs.nodeCount,
      total: procs.totalProcesses,
    },
  };
}

// ─── Voice (Git Hygiene) ────────────────────────────────────────
export function scoreGit(git: GitInfo): GateScore {
  if (!git.isRepo) return { id: 'git', score: 5, status: 'WARN', detail: 'Not a git repo', metrics: {} };

  let score = 10;

  if (git.uncommittedFiles > 50) score -= 3;
  else if (git.uncommittedFiles > 20) score -= 2;
  else if (git.uncommittedFiles > 5) score -= 1;

  if (git.hasLockFiles) score -= 2;
  if (git.recentCommitStyle === 'conventional') score = Math.min(score + 1, 10);
  if (git.repoSizeMB > 500) score -= 1;

  score = Math.max(0, Math.min(10, score));

  return {
    id: 'git',
    score,
    status: status(score),
    detail: `${git.branch} | ${git.uncommittedFiles} uncommitted, ${git.untrackedFiles} untracked | ${git.repoSizeMB}MB .git`,
    metrics: {
      branch: git.branch,
      uncommitted: git.uncommittedFiles,
      untracked: git.untrackedFiles,
      repoSizeMB: git.repoSizeMB,
      commitStyle: git.recentCommitStyle,
    },
  };
}

// ─── Sight (Security) ───────────────────────────────────────────
export function scoreSecrets(secrets: SecretsInfo): GateScore {
  let score = 10;

  if (secrets.suspiciousFiles.length > 0) score -= 4;
  if (!secrets.envFilesGitignored) score -= 3;

  return {
    id: 'secrets',
    score: Math.max(0, score),
    status: status(Math.max(0, score)),
    detail: secrets.envFilesFound.length > 0
      ? `${secrets.envFilesFound.join(', ')} ${secrets.envFilesGitignored ? '(gitignored)' : 'NOT GITIGNORED!'}`
      : 'No .env files found',
    metrics: {
      envFiles: secrets.envFilesFound.length,
      gitignored: secrets.envFilesGitignored,
      suspicious: secrets.suspiciousFiles.length,
    },
  };
}

// ─── Crown (Workspace) ─────────────────────────────────────────
export function scoreWorkspace(temp: TempInfo): GateScore {
  let score = 10;

  if (temp.fileCount > 20000) score -= 4;
  else if (temp.fileCount > 10000) score -= 2;
  else if (temp.fileCount > 5000) score -= 1;

  return {
    id: 'workspace',
    score: Math.max(0, score),
    status: status(Math.max(0, score)),
    detail: `${temp.fileCount} temp files in ${temp.tempDir}`,
    metrics: { tempFiles: temp.fileCount },
  };
}

// ─── Starweave (Knowledge) ──────────────────────────────────────
export function scoreKnowledge(cwd: string): GateScore {
  let score = 10;
  const metrics: Record<string, string | number> = {};

  // Check for common knowledge indicators
  const indicators = [
    { path: '.claude', name: 'Claude config' },
    { path: 'CLAUDE.md', name: 'CLAUDE.md' },
    { path: '.arcanea', name: 'Arcanea substrate' },
    { path: 'docs', name: 'Documentation' },
  ];

  let found = 0;
  for (const { path, name } of indicators) {
    const exists = existsSync(join(cwd, path));
    metrics[name] = exists ? 'present' : 'missing';
    if (exists) found++;
  }

  // Memory files count
  const memoryDir = join(cwd, '.claude', 'memory');
  if (existsSync(memoryDir)) {
    try {
      const files = readdirSync(memoryDir).filter(f => f.endsWith('.md'));
      metrics['memoryFiles'] = files.length;
    } catch { /* skip */ }
  }

  if (found < 2) score -= 3;

  return {
    id: 'knowledge',
    score,
    status: status(score),
    detail: `${found}/${indicators.length} knowledge indicators present`,
    metrics,
  };
}

// ─── Unity (Agent Load) ─────────────────────────────────────────
export function scoreAgentLoad(mem: MemoryInfo, procs: ProcessInfo): GateScore {
  let score = 10;
  const agents = procs.claudeCount + procs.cursorCount + procs.codexCount;

  // Agent memory pressure: estimate agent RAM consumption
  const estAgentMB = procs.claudeCount * 450 + procs.cursorCount * 300 + procs.codexCount * 200;
  const agentPct = Math.round(estAgentMB / mem.totalMB * 100);

  if (agentPct > 40) score -= 4;
  else if (agentPct > 30) score -= 3;
  else if (agentPct > 20) score -= 1;

  // Combined system pressure
  if (mem.usedPct > 90 && agents > 3) score -= 2;

  score = Math.max(0, Math.min(10, score));

  return {
    id: 'agents',
    score,
    status: status(score),
    detail: `${agents} agents using ~${estAgentMB}MB (${agentPct}% of ${mem.totalMB}MB)`,
    metrics: { agents, estAgentMB, agentPct },
  };
}

// ─── Source (System Overall) ────────────────────────────────────
export function scoreSystem(disk: DiskInfo, mem: MemoryInfo, uptimeHours: number): GateScore {
  let score = 10;

  // Composite health
  if (disk.freeGB < 20 && mem.usedPct > 85) score -= 4;
  else if (disk.freeGB < 50 && mem.usedPct > 80) score -= 2;

  // Uptime (long uptime = stale state)
  if (uptimeHours > 168) score -= 2; // > 1 week
  else if (uptimeHours > 72) score -= 1; // > 3 days

  score = Math.max(0, Math.min(10, score));

  return {
    id: 'system',
    score,
    status: status(score),
    detail: `Uptime: ${uptimeHours}h | Disk: ${disk.freeGB}GB free | RAM: ${mem.usedPct}%`,
    metrics: { uptimeHours },
  };
}

// ─── GRADE ──────────────────────────────────────────────────────
export function grade(score: number): string {
  if (score >= 95) return 'S';
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'A-';
  if (score >= 75) return 'B+';
  if (score >= 70) return 'B';
  if (score >= 65) return 'B-';
  if (score >= 60) return 'C+';
  if (score >= 55) return 'C';
  if (score >= 50) return 'C-';
  if (score >= 45) return 'D+';
  if (score >= 40) return 'D';
  return 'F';
}
