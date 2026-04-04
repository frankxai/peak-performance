/**
 * OS-agnostic system probes.
 * Each probe returns raw metrics — scoring happens in gates/.
 * Works on Windows, macOS, and Linux.
 *
 * Security: All subprocess calls use execFileSync (array args) to prevent
 * shell injection. No user-supplied strings are interpolated into shell commands.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

/** Safe integer parser — never returns NaN */
function safeInt(s: string): number {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Run a command safely with execFileSync (no shell injection) */
function runFile(cmd: string, args: string[], timeout = 10_000): string {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf-8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch {
    return '';
  }
}

/** Run PowerShell command safely */
function runPS(script: string, timeout = 10_000): string {
  return runFile('powershell', ['-NoProfile', '-NoLogo', '-Command', script], timeout);
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
  const usedPct = totalMB > 0 ? Math.round((1 - freeMB / totalMB) * 100) : 0;
  return { totalMB, freeMB, usedPct };
}

// ─── CPU ────────────────────────────────────────────────────────
export interface CpuInfo {
  model: string;
  cores: number;
  logicalCores: number;
  loadPct: number; // 0-100 CPU usage percentage
}

export function probeCpu(): CpuInfo {
  const cpus = os.cpus();
  const logicalCores = cpus.length;

  // Physical cores: platform-specific
  let cores = Math.ceil(logicalCores / 2); // default: assume HT
  if (os.platform() === 'win32') {
    const wmicOut = runFile('wmic', ['cpu', 'get', 'NumberOfCores', '/format:list']);
    const match = wmicOut.match(/NumberOfCores=(\d+)/);
    if (match) cores = safeInt(match[1]);
  } else if (os.platform() === 'darwin') {
    const out = runFile('sysctl', ['-n', 'hw.physicalcpu']);
    if (out) cores = safeInt(out);
  } else {
    // Linux: count unique core ids
    const out = runFile('grep', ['-c', '^processor', '/proc/cpuinfo']);
    if (out) cores = Math.ceil(safeInt(out) / 2);
  }

  // CPU load: os.loadavg() returns [0,0,0] on Windows — use wmic instead
  let loadPct = 0;
  if (os.platform() === 'win32') {
    const wmicLoad = runFile('wmic', ['cpu', 'get', 'LoadPercentage', '/format:list']);
    const loadMatch = wmicLoad.match(/LoadPercentage=(\d+)/);
    if (loadMatch) loadPct = safeInt(loadMatch[1]);
  } else {
    const avg = os.loadavg()[0] ?? 0;
    loadPct = Math.min(100, Math.round((avg / logicalCores) * 100));
  }

  return {
    model: cpus[0]?.model ?? 'unknown',
    cores,
    logicalCores,
    loadPct,
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
    // Detect drive letter safely (only allow single alpha char)
    let driveLetter = 'C';
    const winMatch = cwd.match(/^([A-Za-z]):/);
    const gitBashMatch = cwd.match(/^\/([a-z])\//i);
    if (winMatch) driveLetter = winMatch[1].toUpperCase();
    else if (gitBashMatch) driveLetter = gitBashMatch[1].toUpperCase();

    // Validate drive letter is single alpha
    if (!/^[A-Z]$/.test(driveLetter)) driveLetter = 'C';
    const drive = `${driveLetter}:`;

    const psOut = runPS(`(Get-PSDrive ${driveLetter}).Free,(Get-PSDrive ${driveLetter}).Used`);
    const psLines = psOut.split(/\r?\n/).filter(l => /^\d+$/.test(l.trim()));
    if (psLines.length >= 2) {
      const freeSpace = safeInt(psLines[0].trim());
      const usedSpace = safeInt(psLines[1].trim());
      const totalSize = freeSpace + usedSpace;
      return {
        drive,
        totalGB: totalSize > 0 ? Math.round(totalSize / 1024 / 1024 / 1024 * 10) / 10 : 0,
        freeGB: freeSpace > 0 ? Math.round(freeSpace / 1024 / 1024 / 1024 * 10) / 10 : 0,
        usedPct: totalSize > 0 ? Math.round((1 - freeSpace / totalSize) * 100) : 0,
      };
    }
  } else {
    const out = runFile('df', ['-BG', cwd]);
    const lines = out.split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 4) {
        const total = safeInt(parts[1]);
        const free = safeInt(parts[3]);
        return {
          drive: parts[0],
          totalGB: total,
          freeGB: free,
          usedPct: total > 0 ? Math.round((1 - free / total) * 100) : 0,
        };
      }
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
  const csv = runFile('nvidia-smi', [
    '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,driver_version',
    '--format=csv,noheader,nounits',
  ]);
  if (!csv) return null;

  const parts = csv.split(',').map(s => s.trim());
  if (parts.length < 6) return null;

  const tempC = safeInt(parts[1]);
  const utilPct = safeInt(parts[2]);
  const memUsedMB = safeInt(parts[3]);
  const memTotalMB = safeInt(parts[4]);

  // Validate: if all numeric fields are 0, nvidia-smi likely returned garbage
  if (tempC === 0 && utilPct === 0 && memUsedMB === 0 && memTotalMB === 0) return null;

  return { name: parts[0], tempC, utilPct, memUsedMB, memTotalMB, driverVersion: parts[5] };
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

/** Exact process name matching to avoid false positives */
const PROCESS_MATCHERS: Record<string, (name: string) => boolean> = {
  node: (n) => n === 'node.exe' || n === 'node',
  claude: (n) => n === 'claude.exe' || n === 'claude',
  cursor: (n) => n === 'cursor.exe' || n === 'cursor',
  codex: (n) => n === 'codex.exe' || n === 'codex',
  vscode: (n) => n === 'code.exe' || n === 'code',
  browser: (n) => n === 'msedge.exe' || n === 'chrome.exe' || n === 'msedge' || n === 'chrome',
};

export function probeProcesses(): ProcessInfo {
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

  if (os.platform() === 'win32') {
    const tasklist = runFile('tasklist', ['/fo', 'csv', '/nh']);
    const lines = tasklist.split('\n').filter(l => l.trim());
    info.totalProcesses = lines.length;

    for (const line of lines) {
      const match = line.match(/"([^"]+)"/);
      if (!match) continue;
      const name = match[1].toLowerCase();
      if (PROCESS_MATCHERS.node(name)) info.nodeCount++;
      if (PROCESS_MATCHERS.claude(name)) info.claudeCount++;
      if (PROCESS_MATCHERS.cursor(name)) info.cursorCount++;
      if (PROCESS_MATCHERS.codex(name)) info.codexCount++;
      if (PROCESS_MATCHERS.vscode(name)) info.vscodeCount++;
      if (PROCESS_MATCHERS.browser(name)) info.edgeChromeTabs++;
    }
  } else {
    const ps = runFile('ps', ['aux', '--no-headers']);
    const lines = ps.split('\n').filter(l => l.trim());
    info.totalProcesses = lines.length;

    for (const line of lines) {
      // Extract the command name (last column, basename only)
      const parts = line.trim().split(/\s+/);
      const cmd = (parts[10] ?? '').split('/').pop()?.toLowerCase() ?? '';
      if (PROCESS_MATCHERS.node(cmd)) info.nodeCount++;
      if (PROCESS_MATCHERS.claude(cmd)) info.claudeCount++;
      if (PROCESS_MATCHERS.cursor(cmd)) info.cursorCount++;
      if (PROCESS_MATCHERS.codex(cmd)) info.codexCount++;
      if (PROCESS_MATCHERS.vscode(cmd)) info.vscodeCount++;
      if (PROCESS_MATCHERS.browser(cmd)) info.edgeChromeTabs++;
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

  // Support both .git directory and .git file (worktrees)
  const gitPath = join(cwd, '.git');
  if (!existsSync(gitPath)) return info;

  // Verify it's actually a git repo
  const isGit = runFile('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree']);
  if (isGit !== 'true') return info;
  info.isRepo = true;

  info.branch = runFile('git', ['-C', cwd, 'branch', '--show-current']);

  const status = runFile('git', ['-C', cwd, 'status', '--porcelain']);
  const statusLines = status.split('\n').filter(l => l.trim());
  info.uncommittedFiles = statusLines.filter(l => !l.startsWith('??')).length;
  info.untrackedFiles = statusLines.filter(l => l.startsWith('??')).length;

  info.hasLockFiles = existsSync(join(cwd, '.git', 'index.lock'));

  const log = runFile('git', ['-C', cwd, 'log', '--oneline', '-5', '--format=%s']);
  const conventionalPattern = /^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)\(/;
  const commits = log.split('\n').filter(l => l.trim());
  const conventionalCount = commits.filter(c => conventionalPattern.test(c)).length;
  if (commits.length > 0) {
    info.recentCommitStyle = conventionalCount >= 3 ? 'conventional' : 'freeform';
  }

  // Repo size — platform-aware
  if (os.platform() === 'win32') {
    const sizeOut = runPS(
      `(Get-ChildItem -Recurse -Force '${cwd}\\.git' -ErrorAction SilentlyContinue | ` +
      `Measure-Object -Property Length -Sum).Sum / 1MB`
    );
    info.repoSizeMB = Math.round(safeInt(sizeOut));
  } else {
    const sizeStr = runFile('du', ['-sm', join(cwd, '.git')]);
    info.repoSizeMB = safeInt(sizeStr.split(/\s/)[0]);
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

  let gitignored = false;
  if (envFiles.length > 0) {
    const check = runFile('git', ['-C', cwd, 'check-ignore', '.env']);
    gitignored = check.includes('.env');
  }

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
}

export function probeTemp(): TempInfo {
  const tempDir = os.tmpdir();
  let fileCount = 0;

  try {
    if (os.platform() === 'win32') {
      const countStr = runPS(
        '(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count'
      );
      fileCount = safeInt(countStr);
    } else {
      const countStr = runFile('find', [tempDir, '-maxdepth', '2', '-type', 'f']);
      fileCount = countStr.split('\n').filter(l => l.trim()).length;
    }
  } catch {
    fileCount = 0;
  }

  return { tempDir, fileCount };
}

// ─── UPTIME ─────────────────────────────────────────────────────
export function probeUptime(): { uptimeHours: number } {
  return { uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10 };
}
