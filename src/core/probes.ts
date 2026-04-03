/**
 * OS-agnostic system probes.
 * Each probe returns raw metrics — scoring happens in gates/.
 * Works on Windows, macOS, and Linux.
 */
import { execSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

function run(cmd: string, timeout = 10_000): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

// ─── MEMORY ─────────────────────────────────────────────────────
export interface MemoryInfo {
  totalMB: number;
  freeMB: number;
  usedPct: number;
}

export function probeMemory(): MemoryInfo {
  const totalMB = Math.round(os.totalmem() / 1024 / 1024);
  const freeMB = Math.round(os.freemem() / 1024 / 1024);
  const usedPct = Math.round((1 - freeMB / totalMB) * 100);
  return { totalMB, freeMB, usedPct };
}

// ─── CPU ────────────────────────────────────────────────────────
export interface CpuInfo {
  model: string;
  cores: number;
  logicalCores: number;
  loadAvg1m: number;
}

export function probeCpu(): CpuInfo {
  const cpus = os.cpus();
  return {
    model: cpus[0]?.model ?? 'unknown',
    cores: new Set(cpus.map((_, i) => Math.floor(i / 2))).size,
    logicalCores: cpus.length,
    loadAvg1m: os.loadavg()[0] ?? 0,
  };
}

// ─── DISK ───────────────────────────────────────────────────────
export interface DiskInfo {
  drive: string;
  totalGB: number;
  freeGB: number;
  usedPct: number;
}

export function probeDisk(cwd: string): DiskInfo {
  const platform = os.platform();

  if (platform === 'win32') {
    // Detect drive letter from various path formats (C:\..., /c/..., etc.)
    let driveLetter = 'C';
    const winMatch = cwd.match(/^([A-Za-z]):/);
    const gitBashMatch = cwd.match(/^\/([a-z])\//i);
    if (winMatch) driveLetter = winMatch[1].toUpperCase();
    else if (gitBashMatch) driveLetter = gitBashMatch[1].toUpperCase();
    const drive = `${driveLetter}:`;

    // Use PowerShell — more reliable than wmic on modern Windows
    const psOut = run(`powershell -NoProfile -Command "(Get-PSDrive ${driveLetter}).Free,(Get-PSDrive ${driveLetter}).Used" `);
    const psLines = psOut.split(/\r?\n/).filter(l => l.trim());
    if (psLines.length >= 2) {
      const freeSpace = parseInt(psLines[0].trim(), 10);
      const usedSpace = parseInt(psLines[1].trim(), 10);
      const totalSize = freeSpace + usedSpace;
      return {
        drive,
        totalGB: Math.round(totalSize / 1024 / 1024 / 1024 * 10) / 10,
        freeGB: Math.round(freeSpace / 1024 / 1024 / 1024 * 10) / 10,
        usedPct: totalSize > 0 ? Math.round((1 - freeSpace / totalSize) * 100) : 0,
      };
    }

    // Fallback: wmic
    const out = run(`wmic logicaldisk where "DeviceID='${drive}'" get Size,FreeSpace /format:csv`);
    const lines = out.split('\n').filter(l => l.includes(','));
    if (lines.length > 0) {
      const parts = lines[lines.length - 1].split(',');
      const freeSpace = parseInt(parts[1] || '0', 10);
      const totalSize = parseInt(parts[2] || '0', 10);
      return {
        drive,
        totalGB: Math.round(totalSize / 1024 / 1024 / 1024 * 10) / 10,
        freeGB: Math.round(freeSpace / 1024 / 1024 / 1024 * 10) / 10,
        usedPct: totalSize > 0 ? Math.round((1 - freeSpace / totalSize) * 100) : 0,
      };
    }
  } else {
    const out = run(`df -BG "${cwd}" | tail -1`);
    const parts = out.split(/\s+/);
    if (parts.length >= 4) {
      const total = parseInt(parts[1], 10);
      const free = parseInt(parts[3], 10);
      return {
        drive: parts[0],
        totalGB: total,
        freeGB: free,
        usedPct: total > 0 ? Math.round((1 - free / total) * 100) : 0,
      };
    }
  }

  return { drive: '?', totalGB: 0, freeGB: 0, usedPct: 0 };
}

// ─── GPU ────────────────────────────────────────────────────────
export interface GpuInfo {
  name: string;
  tempC: number;
  utilPct: number;
  memUsedMB: number;
  memTotalMB: number;
  driverVersion: string;
}

export function probeGpu(): GpuInfo | null {
  const csv = run('nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,driver_version --format=csv,noheader,nounits');
  if (!csv) return null;

  const parts = csv.split(',').map(s => s.trim());
  if (parts.length < 6) return null;

  return {
    name: parts[0],
    tempC: parseInt(parts[1], 10),
    utilPct: parseInt(parts[2], 10),
    memUsedMB: parseInt(parts[3], 10),
    memTotalMB: parseInt(parts[4], 10),
    driverVersion: parts[5],
  };
}

// ─── PROCESSES ──────────────────────────────────────────────────
export interface ProcessInfo {
  totalProcesses: number;
  nodeCount: number;
  claudeCount: number;
  cursorCount: number;
  codexCount: number;
  vscodeCount: number;
  edgeChromeTabs: number;
  topConsumers: { name: string; memMB: number }[];
}

export function probeProcesses(): ProcessInfo {
  const platform = os.platform();
  const info: ProcessInfo = {
    totalProcesses: 0,
    nodeCount: 0,
    claudeCount: 0,
    cursorCount: 0,
    codexCount: 0,
    vscodeCount: 0,
    edgeChromeTabs: 0,
    topConsumers: [],
  };

  if (platform === 'win32') {
    const tasklist = run('tasklist /fo csv /nh');
    const lines = tasklist.split('\n').filter(l => l.trim());
    info.totalProcesses = lines.length;

    const counts: Record<string, number> = {};
    for (const line of lines) {
      const match = line.match(/"([^"]+)"/);
      if (!match) continue;
      const name = match[1].toLowerCase();
      if (name.includes('node')) info.nodeCount++;
      if (name.includes('claude')) info.claudeCount++;
      if (name.includes('cursor')) info.cursorCount++;
      if (name.includes('codex')) info.codexCount++;
      if (name.includes('code.exe')) info.vscodeCount++;
      if (name.includes('msedge') || name.includes('chrome')) info.edgeChromeTabs++;
    }
  } else {
    const ps = run('ps aux --no-headers');
    const lines = ps.split('\n').filter(l => l.trim());
    info.totalProcesses = lines.length;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (lower.includes('node')) info.nodeCount++;
      if (lower.includes('claude')) info.claudeCount++;
      if (lower.includes('cursor')) info.cursorCount++;
      if (lower.includes('codex')) info.codexCount++;
      if (lower.includes('code ')) info.vscodeCount++;
      if (lower.includes('chrome') || lower.includes('msedge')) info.edgeChromeTabs++;
    }
  }

  return info;
}

// ─── GIT ────────────────────────────────────────────────────────
export interface GitInfo {
  isRepo: boolean;
  repoSizeMB: number;
  branch: string;
  uncommittedFiles: number;
  untrackedFiles: number;
  hasLockFiles: boolean;
  recentCommitStyle: 'conventional' | 'freeform' | 'unknown';
}

export function probeGit(cwd: string): GitInfo {
  const info: GitInfo = {
    isRepo: false,
    repoSizeMB: 0,
    branch: '',
    uncommittedFiles: 0,
    untrackedFiles: 0,
    hasLockFiles: false,
    recentCommitStyle: 'unknown',
  };

  if (!existsSync(join(cwd, '.git'))) return info;
  info.isRepo = true;

  info.branch = run(`git -C "${cwd}" branch --show-current`);

  const status = run(`git -C "${cwd}" status --porcelain`);
  const statusLines = status.split('\n').filter(l => l.trim());
  info.uncommittedFiles = statusLines.filter(l => !l.startsWith('??')).length;
  info.untrackedFiles = statusLines.filter(l => l.startsWith('??')).length;

  // Check for lock files
  info.hasLockFiles = existsSync(join(cwd, '.git', 'index.lock'));

  // Check commit style
  const log = run(`git -C "${cwd}" log --oneline -5 --format="%s"`);
  const conventionalPattern = /^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)\(/;
  const commits = log.split('\n').filter(l => l.trim());
  const conventionalCount = commits.filter(c => conventionalPattern.test(c)).length;
  if (commits.length > 0) {
    info.recentCommitStyle = conventionalCount >= 3 ? 'conventional' : 'freeform';
  }

  // Repo size
  const gitDir = join(cwd, '.git');
  try {
    const sizeStr = run(`du -sm "${gitDir}" 2>/dev/null | cut -f1`);
    info.repoSizeMB = parseInt(sizeStr, 10) || 0;
  } catch {
    info.repoSizeMB = 0;
  }

  return info;
}

// ─── SECRETS ────────────────────────────────────────────────────
export interface SecretsInfo {
  envFilesFound: string[];
  envFilesGitignored: boolean;
  suspiciousFiles: string[];
}

export function probeSecrets(cwd: string): SecretsInfo {
  const envFiles: string[] = [];
  const suspicious: string[] = [];

  const envNames = ['.env', '.env.local', '.env.production', '.env.development'];
  for (const name of envNames) {
    if (existsSync(join(cwd, name))) envFiles.push(name);
  }

  // Check if .env is gitignored
  let gitignored = false;
  if (envFiles.length > 0) {
    const check = run(`git -C "${cwd}" check-ignore .env`);
    gitignored = check.includes('.env');
  }

  // Check for common secret patterns in tracked files
  const keyPatterns = ['credentials.json', 'service-account.json', 'id_rsa', '.pem'];
  for (const pattern of keyPatterns) {
    if (existsSync(join(cwd, pattern))) suspicious.push(pattern);
  }

  return {
    envFilesFound: envFiles,
    envFilesGitignored: gitignored || envFiles.length === 0,
    suspiciousFiles: suspicious,
  };
}

// ─── TEMP FILES ─────────────────────────────────────────────────
export interface TempInfo {
  tempDir: string;
  fileCount: number;
  estimatedSizeMB: number;
}

export function probeTemp(): TempInfo {
  const tempDir = os.tmpdir();
  let fileCount = 0;

  try {
    if (os.platform() === 'win32') {
      const countStr = run(`powershell -NoProfile -Command "(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count"`);
      fileCount = parseInt(countStr, 10) || 0;
    } else {
      const countStr = run(`find "${tempDir}" -maxdepth 2 -type f 2>/dev/null | wc -l`);
      fileCount = parseInt(countStr, 10) || 0;
    }
  } catch {
    fileCount = 0;
  }

  return { tempDir, fileCount, estimatedSizeMB: 0 };
}

// ─── UPTIME ─────────────────────────────────────────────────────
export function probeUptime(): { uptimeHours: number } {
  return { uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10 };
}
