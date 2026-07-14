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
      maxBuffer: 32 * 1024 * 1024,
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

function sleepSync(milliseconds: number): void {
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(signal, 0, 0, milliseconds);
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
  systemLoadPct: number; // kernel + interrupt share of sampled CPU time
  sampleMs: number;
}

export function probeCpu(): CpuInfo {
  const cpus = os.cpus();
  const logicalCores = cpus.length;

  // Physical cores: platform-specific
  let cores = Math.ceil(logicalCores / 2); // default: assume HT
  if (os.platform() === 'darwin') {
    const out = runFile('sysctl', ['-n', 'hw.physicalcpu']);
    if (out) cores = safeInt(out);
  } else if (os.platform() === 'linux') {
    // Linux: count unique core ids
    const out = runFile('grep', ['-c', '^processor', '/proc/cpuinfo']);
    if (out) cores = Math.ceil(safeInt(out) / 2);
  }

  // A short os.cpus() delta is fast, cross-platform, and avoids deprecated WMIC timeouts.
  const sampleMs = 350;
  const before = os.cpus();
  sleepSync(sampleMs);
  const after = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;
  let systemDelta = 0;
  for (let index = 0; index < Math.min(before.length, after.length); index++) {
    const start = before[index].times;
    const end = after[index].times;
    const idle = Math.max(0, end.idle - start.idle);
    const system = Math.max(0, end.sys - start.sys) + Math.max(0, end.irq - start.irq);
    const total = Math.max(0,
      (end.user - start.user) +
      (end.nice - start.nice) +
      (end.sys - start.sys) +
      (end.idle - start.idle) +
      (end.irq - start.irq)
    );
    idleDelta += idle;
    systemDelta += system;
    totalDelta += total;
  }
  const loadPct = totalDelta > 0 ? Math.min(100, Math.max(0, Math.round((1 - idleDelta / totalDelta) * 100))) : 0;
  const systemLoadPct = totalDelta > 0 ? Math.min(100, Math.max(0, Math.round(systemDelta / totalDelta * 100))) : 0;

  return {
    model: cpus[0]?.model ?? 'unknown',
    cores,
    logicalCores,
    loadPct,
    systemLoadPct,
    sampleMs,
  };
}

// ─── RECENT APPLICATION CRASHES ───────────────────────────────
export interface CrashLoopInfo {
  windowMinutes: number;
  totalCrashes: number;
  topApp: string;
  topAppCrashes: number;
  apps: Array<{ name: string; count: number }>;
}

export function probeCrashLoops(windowMinutes = 15): CrashLoopInfo {
  const boundedMinutes = Math.max(1, Math.min(120, Math.round(windowMinutes)));
  const empty: CrashLoopInfo = {
    windowMinutes: boundedMinutes,
    totalCrashes: 0,
    topApp: '',
    topAppCrashes: 0,
    apps: [],
  };
  if (os.platform() !== 'win32') return empty;

  const script = [
    '$ErrorActionPreference = "SilentlyContinue";',
    `$events = @(Get-WinEvent -FilterHashtable @{LogName="Application"; Id=1000; StartTime=(Get-Date).AddMinutes(-${boundedMinutes})});`,
    '$apps = @();',
    'foreach ($event in $events) { if ($event.Message -match "Faulting application name:\\s*([^,\\r\\n]+)") { $apps += $Matches[1].Trim() } };',
    '$groups = @($apps | Group-Object | Sort-Object Count -Descending | Select-Object -First 10 @{n="name";e={$_.Name}},@{n="count";e={$_.Count}});',
    '$top = $groups | Select-Object -First 1;',
    `[pscustomobject]@{windowMinutes=${boundedMinutes};totalCrashes=$apps.Count;topApp=if($top){$top.name}else{""};topAppCrashes=if($top){$top.count}else{0};apps=$groups} | ConvertTo-Json -Compress -Depth 4`,
  ].join(' ');

  const raw = runPS(script, 8_000);
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<CrashLoopInfo>;
    return {
      windowMinutes: boundedMinutes,
      totalCrashes: Number(parsed.totalCrashes ?? 0),
      topApp: String(parsed.topApp ?? ''),
      topAppCrashes: Number(parsed.topAppCrashes ?? 0),
      apps: Array.isArray(parsed.apps)
        ? parsed.apps.map(app => ({ name: String(app.name ?? ''), count: Number(app.count ?? 0) }))
        : [],
    };
  } catch {
    return empty;
  }
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
  protectedCount: number;
  codexTaskRuntimeCount: number;
  mcpCount: number;
  mcpProcessCount: number;
  mcpMemoryMB: number;
  duplicateMcpProcesses: number;
  agentTreeMemoryMB: number;
  processes: ProcessConsumer[];
  topConsumers: ProcessConsumer[];
}

export type ProcessRole =
  | 'ai-agent'
  | 'local-model'
  | 'node'
  | 'mcp'
  | 'dev-server'
  | 'build'
  | 'browser'
  | 'editor'
  | 'shell'
  | 'system'
  | 'other';

export interface ProcessConsumer {
  pid: number;
  parentPid: number;
  name: string;
  memMB: number;
  role: ProcessRole;
  protected: boolean;
  protectionReason?: string;
  reasoning: string;
  actionHint: string;
  command: string;
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

const WINDOWS_PROTECTED_NAMES = new Set([
  'audiodg.exe',
  'conhost.exe',
  'csrss.exe',
  'ctfmon.exe',
  'dwm.exe',
  'explorer.exe',
  'fontdrvhost.exe',
  'lsass.exe',
  'memory compression',
  'msmpeng.exe',
  'registry',
  'runtimebroker.exe',
  'searchhost.exe',
  'securityhealthservice.exe',
  'securityhealthsystray.exe',
  'services.exe',
  'shellexperiencehost.exe',
  'shellhost.exe',
  'sihost.exe',
  'smss.exe',
  'spoolsv.exe',
  'startmenuexperiencehost.exe',
  'svchost.exe',
  'system',
  'system idle process',
  'taskhostw.exe',
  'textinputhost.exe',
  'wininit.exe',
  'winlogon.exe',
  'wlanext.exe',
  'wudfhost.exe',
]);

interface WinProcessRow {
  ProcessId?: number | string;
  ParentProcessId?: number | string;
  Name?: string;
  CommandLine?: string | null;
  WorkingSetSize?: number | string | null;
}

function parseJsonArray<T>(raw: string): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as T | T[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function redactCommandLine(command: string): string {
  return command
    .replace(/(["']?(?:api[_-]?key|token|secret|password|passwd|pwd|authorization)["']?\s*:\s*["'])[^"']+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key|token|secret|password|passwd|pwd|authorization)(=|\s+)[^\s"']+/gi, '$1$2[REDACTED]')
    .replace(/(--(?:api-key|token|secret|password|authorization)\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]');
}

function classifyProcess(name: string, command: string): Pick<ProcessConsumer, 'role' | 'protected' | 'protectionReason'> {
  const n = name.toLowerCase();
  const cmd = command.toLowerCase();
  const canHostOrLaunchMcp = new Set([
    'node.exe', 'node', 'python.exe', 'python', 'pythonw.exe', 'pythonw',
    'bun.exe', 'bun', 'deno.exe', 'deno', 'railway.exe', 'railway',
    'cmd.exe', 'cmd', 'bash.exe', 'bash', 'sh.exe', 'sh',
  ]).has(n);
  const looksLikeMcpServer = canHostOrLaunchMcp && (
    cmd.includes('modelcontextprotocol') ||
    /(^|[\s"'\\/])(mcp|mcp-server|mcpserver)([\s"'\\/]|$)/.test(cmd) ||
    /(^|[\s"'\\/])(serve|server)\s+mcp([\s"']|$)/.test(cmd) ||
    /(^|[\s"'])(--mcp|-mcp)([\s"']|$)/.test(cmd) ||
    cmd.includes('agentic-ops/server.js --mcp') ||
    cmd.includes('agentic-ops\\server.js --mcp') ||
    cmd.includes('railway.js" mcp') ||
    cmd.includes("railway.js' mcp") ||
    cmd.includes('railway.exe mcp') ||
    cmd.includes('mcp-server.js') ||
    cmd.includes('starlight-mcp.js') ||
    cmd.includes('mcp-obsidian') ||
    cmd.includes('/packages/mcp/') ||
    cmd.includes('\\packages\\mcp\\') ||
    cmd.includes('headroom mcp serve')
  );

  if (n.includes('antigravity') || cmd.includes('antigravity')) {
    return { role: 'ai-agent', protected: true, protectionReason: 'active coding-agent workspace' };
  }
  if (PROCESS_MATCHERS.claude(n) || PROCESS_MATCHERS.codex(n) || PROCESS_MATCHERS.cursor(n)) {
    return { role: 'ai-agent', protected: true, protectionReason: 'active AI agent session' };
  }
  if ((n === 'node_repl.exe' || n === 'node_repl') && cmd.includes('openai') && cmd.includes('codex')) {
    return { role: 'ai-agent', protected: true, protectionReason: 'Codex task runtime' };
  }
  if (n.includes('lmstudio') || n.includes('llmster') || cmd.includes('.lmstudio') || n === 'ollama.exe' || n === 'ollama') {
    return { role: 'local-model', protected: true, protectionReason: 'local model runtime' };
  }
  if (PROCESS_MATCHERS.vscode(n)) {
    return { role: 'editor', protected: true, protectionReason: 'editor workspace' };
  }
  if (PROCESS_MATCHERS.browser(n)) {
    return { role: 'browser', protected: false };
  }
  if (cmd.includes('hermes_cli.main gateway run') || cmd.includes('hermes-cli') || cmd.includes('hermes gateway')) {
    return { role: 'mcp', protected: true, protectionReason: 'Hermes/Starlight orchestration gateway' };
  }
  if (looksLikeMcpServer) {
    return { role: 'mcp', protected: true, protectionReason: 'agent/tooling server' };
  }
  if (
    /\b(next|vite|astro|remix)\s+(build|export)\b/.test(cmd) ||
    /[\\/]next[\\/]dist[\\/]bin[\\/]next["']?\s+build\b/.test(cmd) ||
    /[\\/]\.next[\\/]build[\\/]/.test(cmd) ||
    /\bnpm(?:\.cmd)?\s+run\s+(gen|build|prebuild|export|compile|render)\b/.test(cmd) ||
    cmd.includes('generate_')
  ) {
    return { role: 'build', protected: false };
  }
  if (
    /\b(next|vite|astro|remix)\s+(dev|start|preview)\b/.test(cmd) ||
    /[\\/]next[\\/]dist[\\/]bin[\\/]next["']?\s+(dev|start)/.test(cmd) ||
    /[\\/]next[\\/]dist[\\/]server[\\/]lib[\\/]start-server\.js\b/.test(cmd) ||
    /[\\/]node_modules[\\/]\.bin[\\/].*(next|vite|astro|remix)(?:["']?\s+(dev|start|preview)\b)?/.test(cmd) ||
    /\bnpm(?:\.cmd)?\s+run\s+(dev|start|preview)\b/.test(cmd) ||
    /\b(pnpm|yarn|bun)(?:\.cmd)?(?:\s+--dir\s+\S+)?\s+(dev|start|preview)\b/.test(cmd) ||
    cmd.includes('tsx watch')
  ) {
    return { role: 'dev-server', protected: true, protectionReason: 'dev server; stop through project supervisor' };
  }
  if (cmd.includes('next build')) {
    return { role: 'build', protected: false };
  }
  if (PROCESS_MATCHERS.node(n)) {
    return { role: 'node', protected: false };
  }
  if (n === 'bash.exe' || n === 'bash' || n === 'powershell.exe' || n === 'pwsh.exe' || n === 'cmd.exe') {
    return { role: 'shell', protected: false };
  }
  if (WINDOWS_PROTECTED_NAMES.has(n) || n.includes('system')) {
    return { role: 'system', protected: true, protectionReason: 'operating system process' };
  }
  return { role: 'other', protected: false };
}

function processReasoning(classification: Pick<ProcessConsumer, 'role' | 'protected' | 'protectionReason'>): string {
  if (classification.protected) {
    return `Protected ${classification.role}: ${classification.protectionReason ?? 'requires coordination before action'}.`;
  }

  switch (classification.role) {
    case 'build':
      return 'Reviewable build/generation job: usually resumable, but capture repo, command, and recovery path before stopping.';
    case 'node':
      return 'Reviewable node process: inspect parent command and repo before deciding whether it is an orphan.';
    case 'browser':
      return 'Reviewable user-facing browser process: prefer manual close unless clearly abandoned.';
    case 'shell':
      return 'Reviewable shell process: may own a child job; inspect the process tree before action.';
    default:
      return 'Reviewable unknown process: inspect purpose and owner before action.';
  }
}

function processActionHint(classification: Pick<ProcessConsumer, 'role' | 'protected'>): string {
  if (classification.protected) return 'Do not terminate without explicit coordination or a supervisor-specific stop path.';

  switch (classification.role) {
    case 'build':
      return 'Can be reduced only after recording a receipt and confirming regeneration/resume command.';
    case 'node':
      return 'Candidate for reduction only if orphaned, duplicate, idle, or owned by a stopped task.';
    case 'browser':
      return 'Reduce by closing tabs/windows manually when user confirms.';
    case 'shell':
      return 'Reduce by stopping the child job or closing the owning terminal after confirmation.';
    default:
      return 'No automatic action; classify purpose first.';
  }
}

function addProcessCounts(info: ProcessInfo, name: string): void {
  const n = name.toLowerCase();
  if (PROCESS_MATCHERS.node(n)) info.nodeCount++;
  if (PROCESS_MATCHERS.claude(n)) info.claudeCount++;
  if (PROCESS_MATCHERS.cursor(n)) info.cursorCount++;
  if (PROCESS_MATCHERS.codex(n)) info.codexCount++;
  if (PROCESS_MATCHERS.vscode(n)) info.vscodeCount++;
  if (PROCESS_MATCHERS.browser(n)) info.edgeChromeTabs++;
}

function finalizeProcessInfo(info: ProcessInfo): void {
  const mcpProcesses = info.processes.filter(proc => proc.role === 'mcp');
  info.codexTaskRuntimeCount = info.processes.filter(proc => {
    const name = proc.name.toLowerCase();
    const command = proc.command.toLowerCase();
    return (name === 'node_repl.exe' || name === 'node_repl') && command.includes('openai') && command.includes('codex');
  }).length;
  info.mcpProcessCount = mcpProcesses.length;
  info.mcpMemoryMB = Math.round(mcpProcesses.reduce((sum, proc) => sum + proc.memMB, 0) * 10) / 10;

  const mcpPids = new Set(mcpProcesses.map(proc => proc.pid));
  const mcpParentPids = new Set(mcpProcesses.filter(proc => mcpPids.has(proc.parentPid)).map(proc => proc.parentPid));
  const mcpServers = mcpProcesses.filter(proc => !mcpParentPids.has(proc.pid));
  info.mcpCount = mcpServers.length;

  const commandCounts = new Map<string, number>();
  for (const proc of mcpServers) {
    const signature = proc.command.toLowerCase().replace(/\s+/g, ' ').trim();
    commandCounts.set(signature, (commandCounts.get(signature) ?? 0) + 1);
  }
  info.duplicateMcpProcesses = [...commandCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  const children = new Map<number, number[]>();
  for (const proc of info.processes) {
    const siblings = children.get(proc.parentPid) ?? [];
    siblings.push(proc.pid);
    children.set(proc.parentPid, siblings);
  }
  const agentRoots = info.processes.filter(proc => proc.role === 'ai-agent' && (proc.name.toLowerCase() !== 'node_repl.exe' && proc.name.toLowerCase() !== 'node_repl'));
  const agentTreePids = new Set<number>();
  const queue = agentRoots.map(proc => proc.pid);
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || agentTreePids.has(pid)) continue;
    agentTreePids.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  info.agentTreeMemoryMB = Math.round(info.processes
    .filter(proc => agentTreePids.has(proc.pid))
    .reduce((sum, proc) => sum + proc.memMB, 0) * 10) / 10;
}

function probeWindowsProcesses(info: ProcessInfo): boolean {
  const ps = [
    '$ErrorActionPreference = "SilentlyContinue";',
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize |',
    'ConvertTo-Json -Compress -Depth 2',
  ].join(' ');
  const rows = parseJsonArray<WinProcessRow>(runPS(ps, 15_000));
  if (rows.length === 0) return false;

  info.totalProcesses = rows.length;

  const consumers: ProcessConsumer[] = [];
  for (const row of rows) {
    const name = String(row.Name ?? '').trim();
    if (!name) continue;

    addProcessCounts(info, name);

    const command = redactCommandLine(String(row.CommandLine ?? name));
    const memMB = Math.round((Number(row.WorkingSetSize ?? 0) / 1024 / 1024) * 10) / 10;
    const classification = classifyProcess(name, command);
    if (classification.protected) info.protectedCount++;

    const reasoning = processReasoning(classification);
    const actionHint = processActionHint(classification);

    consumers.push({
      pid: safeInt(String(row.ProcessId ?? 0)),
      parentPid: safeInt(String(row.ParentProcessId ?? 0)),
      name,
      memMB,
      command,
      reasoning,
      actionHint,
      ...classification,
    });
  }

  info.processes = consumers.sort((a, b) => b.memMB - a.memMB);
  info.topConsumers = info.processes.slice(0, 20);
  finalizeProcessInfo(info);

  return true;
}

export function probeProcesses(): ProcessInfo {
  const info: ProcessInfo = {
    totalProcesses: 0,
    nodeCount: 0,
    claudeCount: 0,
    cursorCount: 0,
    codexCount: 0,
    vscodeCount: 0,
    edgeChromeTabs: 0,
    protectedCount: 0,
    codexTaskRuntimeCount: 0,
    mcpCount: 0,
    mcpProcessCount: 0,
    mcpMemoryMB: 0,
    duplicateMcpProcesses: 0,
    agentTreeMemoryMB: 0,
    processes: [],
    topConsumers: [],
  };

  if (os.platform() === 'win32') {
    if (probeWindowsProcesses(info)) return info;

    const tasklist = runFile('tasklist', ['/fo', 'csv', '/nh']);
    const lines = tasklist.split('\n').filter(l => l.trim());
    info.totalProcesses = lines.length;

    for (const line of lines) {
      const match = line.match(/"([^"]+)"/);
      if (!match) continue;
      addProcessCounts(info, match[1]);
    }
  } else {
    const ps = runFile('ps', ['-eo', 'pid=,ppid=,rss=,comm=,args=']);
    const lines = ps.split('\n').filter(l => l.trim());
    info.totalProcesses = lines.length;

    for (const line of lines) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
      if (!match) continue;
      const [, pid, ppid, rssKB, comm, args] = match;
      const name = comm.split('/').pop() ?? comm;
      const command = redactCommandLine(args || comm);
      addProcessCounts(info, name);
      const classification = classifyProcess(name, command);
      if (classification.protected) info.protectedCount++;
      info.processes.push({
        pid: safeInt(pid),
        parentPid: safeInt(ppid),
        name,
        memMB: Math.round((safeInt(rssKB) / 1024) * 10) / 10,
        command,
        reasoning: processReasoning(classification),
        actionHint: processActionHint(classification),
        ...classification,
      });
    }

    info.processes = info.processes
      .sort((a, b) => b.memMB - a.memMB);
    info.topConsumers = info.processes.slice(0, 20);
    finalizeProcessInfo(info);
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
