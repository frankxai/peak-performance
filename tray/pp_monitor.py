"""
Peak Performance Tray — System probes.
Python port of core/probes.ts. Each probe returns raw metrics.
"""

import os
import json
import math
from collections import Counter
import re
import subprocess
import time

import psutil


def _run(cmd: str, timeout: int = 10) -> str:
    """Run a shell command and return stdout, or empty string on failure."""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding='utf-8',
            errors='replace',
        )
        return result.stdout.strip()
    except Exception:
        return ''


# ─── MEMORY ─────────────────────────────────────────────────────

def probe_memory() -> dict:
    vm = psutil.virtual_memory()
    total_mb = math.floor(vm.total / 1024 / 1024 + 0.5)
    free_mb = math.floor(vm.available / 1024 / 1024 + 0.5)
    used_pct = math.floor((1 - free_mb / total_mb) * 100 + 0.5) if total_mb > 0 else 0
    return {'totalMB': total_mb, 'freeMB': free_mb, 'usedPct': used_pct}


# ─── CPU ────────────────────────────────────────────────────────

def _cpu_delta(before, after, windows):
    """Use the same counters as Node os.cpus; Windows system includes IRQ/DPC."""
    if not before or len(before) != len(after):
        return None
    idle = total = system = 0.0
    for start, end in zip(before, after):
        def counters(row):
            return [row.user, getattr(row, 'nice', 0), row.system, row.idle,
                    getattr(row, 'irq', getattr(row, 'interrupt', 0))]
        a, b = counters(start), counters(end)
        if any(not math.isfinite(x) or x < 0 for x in a + b) or any(y < x for x, y in zip(a, b)):
            return None
        user, nice, sys, rest, irq = [y - x for x, y in zip(a, b)]
        irq = 0 if windows else irq
        total += user + nice + sys + rest + irq
        idle += rest
        system += sys + irq
    if total <= 0:
        return None
    return (math.floor((total - idle) / total * 100 + 0.5),
            math.floor(system / total * 100 + 0.5))


def probe_cpu() -> dict:
    result = {'status': 'unknown', 'model': 'unknown', 'cores': 0, 'logicalCores': 0,
              'loadPct': 0, 'systemLoadPct': 0, 'sampleMs': 350}
    try:
        before = psutil.cpu_times(percpu=True)
        time.sleep(0.350)
        after = psutil.cpu_times(percpu=True)
        sample = _cpu_delta(before, after, os.name == 'nt')
        result.update(cores=psutil.cpu_count(logical=False) or 0, logicalCores=len(after))
        if sample is not None:
            result.update(status='measured', loadPct=sample[0], systemLoadPct=sample[1])
    except (OSError, ValueError, TypeError, AttributeError, psutil.Error):
        pass
    return result


# ─── DISK ───────────────────────────────────────────────────────

def probe_disk(cwd: str) -> dict:
    # Detect drive letter
    drive = 'C:\\'
    match = re.match(r'^([A-Za-z]):', cwd)
    if match:
        drive = match.group(1).upper() + ':\\'

    try:
        usage = psutil.disk_usage(drive)
        total_gb = math.floor(usage.total / 1024 / 1024 / 1024 * 10 + 0.5) / 10
        free_gb = math.floor(usage.free / 1024 / 1024 / 1024 * 10 + 0.5) / 10
        used_pct = math.floor(usage.percent + 0.5)
        return {'drive': drive, 'totalGB': total_gb, 'freeGB': free_gb, 'usedPct': used_pct}
    except Exception:
        return {'drive': drive, 'totalGB': 0, 'freeGB': 0, 'usedPct': 0}


# ─── GPU ────────────────────────────────────────────────────────

def probe_gpu() -> dict | None:
    csv = _run(
        'nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,'
        'memory.used,memory.total,driver_version --format=csv,noheader,nounits'
    )
    if not csv:
        return None

    parts = [s.strip() for s in csv.split(',')]
    if len(parts) < 6:
        return None

    try:
        return {
            'name': parts[0],
            'tempC': int(parts[1]),
            'utilPct': int(parts[2]),
            'memUsedMB': int(parts[3]),
            'memTotalMB': int(parts[4]),
            'driverVersion': parts[5],
        }
    except (ValueError, IndexError):
        return None


# ─── PROCESSES ──────────────────────────────────────────────────

_COMMAND_REQUIRED = re.compile(r'^(node|node_repl|pythonw?[\d.]*|bun|deno|uvx?|npx|cmd|powershell|pwsh|bash|sh|railway|headroom|claude|codex)(\.exe|\.cmd)?$', re.I)


def _redact_command(command):
    command = re.sub(r'(["\x27]?(?:api[_-]?key|token|secret|password|passwd|pwd|authorization)["\x27]?\s*:\s*["\x27])[^"\x27]+', r'\1[REDACTED]', command, flags=re.I)
    command = re.sub(r'(api[_-]?key|token|secret|password|passwd|pwd|authorization)(=|\s+)[^\s"\x27]+', r'\1\2[REDACTED]', command, flags=re.I)
    command = re.sub(r'(--(?:api-key|token|secret|password|authorization)\s+)[^\s"\x27]+', r'\1[REDACTED]', command, flags=re.I)
    return re.sub(r'(Bearer\s+)[A-Za-z0-9._~+/=-]+', r'\1[REDACTED]', command, flags=re.I)


def _metric_role(name, command):
    # Classifications needed by the scorer; no command lines leave this probe.
    n, cmd = name.lower(), command.lower()
    if ('antigravity' in n or 'antigravity' in cmd
            or n in {'claude', 'claude.exe', 'codex', 'codex.exe', 'cursor', 'cursor.exe'}
            or n in {'node_repl', 'node_repl.exe'} and 'openai' in cmd and 'codex' in cmd):
        return 'ai-agent'
    if ('lmstudio' in n or 'llmster' in n or '.lmstudio' in cmd or n in {'ollama', 'ollama.exe'}
            or n in {'code', 'code.exe', 'chrome', 'chrome.exe', 'msedge', 'msedge.exe'}):
        return 'other'
    if any(marker in cmd for marker in ['hermes_cli.main gateway run', 'hermes-cli', 'hermes gateway']):
        return 'mcp'
    hosts = {'node', 'python', 'pythonw', 'bun', 'deno', 'railway', 'cmd', 'bash', 'sh'}
    host = n.removesuffix('.exe') in hosts
    markers = ['modelcontextprotocol', 'agentic-ops/server.js --mcp', 'agentic-ops\\server.js --mcp',
               'railway.js" mcp', "railway.js' mcp", 'railway.exe mcp', 'mcp-server.js',
               'starlight-mcp.js', 'mcp-obsidian', '/packages/mcp/', '\\packages\\mcp\\', 'headroom mcp serve']
    patterns = [r'(^|[\s\"\x27\\/])(mcp|mcp-server|mcpserver)([\s\"\x27\\/]|$)',
                r'(^|[\s\"\x27\\/])(serve|server)\s+mcp([\s\"\x27]|$)',
                r'(^|[\s\"\x27])(--mcp|-mcp)([\s\"\x27]|$)']
    if host and (any(marker in cmd for marker in markers) or any(re.search(p, cmd) for p in patterns)):
        return 'mcp'
    return 'other'


def _process_metrics(rows, complete=True):
    counts = {k: 0 for k in ['totalProcesses', 'nodeCount', 'claudeCount', 'cursorCount', 'codexCount',
                            'vscodeCount', 'edgeChromeTabs', 'codexTaskRuntimeCount', 'mcpCount',
                            'mcpProcessCount', 'mcpMemoryMB', 'duplicateMcpProcesses', 'agentTreeMemoryMB']}
    counts['status'] = 'measured' if rows and complete else 'unknown'
    processes = []
    pids = set()
    for row in rows:
        counts['totalProcesses'] += 1
        name, command = row.get('name'), row.get('command')
        pid, parent, memory = row.get('pid'), row.get('parentPid'), row.get('memMB')
        valid = (isinstance(name, str) and bool(name)
                 and isinstance(pid, int) and pid >= 0 and pid not in pids
                 and isinstance(parent, int) and parent >= 0
                 and isinstance(memory, (int, float)) and math.isfinite(memory) and memory >= 0)
        if not valid:
            counts['status'] = 'unknown'
            continue
        pids.add(pid)
        if _COMMAND_REQUIRED.fullmatch(name) and (not isinstance(command, str) or not command.strip()):
            counts['status'] = 'unknown'
        n, command = name.lower(), _redact_command(command if isinstance(command, str) else name)
        for key, names in [('nodeCount', {'node', 'node.exe'}), ('claudeCount', {'claude', 'claude.exe'}),
                           ('cursorCount', {'cursor', 'cursor.exe'}), ('codexCount', {'codex', 'codex.exe'}),
                           ('vscodeCount', {'code', 'code.exe'}), ('edgeChromeTabs', {'chrome', 'chrome.exe', 'msedge', 'msedge.exe'})]:
            if n in names: counts[key] += 1
        role = _metric_role(name, command)
        mem = math.floor(memory * 10 + 0.5) / 10
        processes.append(dict(pid=pid, parentPid=parent, name=n, command=command.lower(), role=role, memMB=mem))
        if n in {'node_repl', 'node_repl.exe'} and 'openai' in command.lower() and 'codex' in command.lower():
            counts['codexTaskRuntimeCount'] += 1
    mcps = [p for p in processes if p['role'] == 'mcp']
    counts['mcpProcessCount'] = len(mcps)
    counts['mcpMemoryMB'] = math.floor(sum(p['memMB'] for p in mcps) * 10 + 0.5) / 10
    mcp_ids = {p['pid'] for p in mcps}
    parents = {p['parentPid'] for p in mcps if p['parentPid'] in mcp_ids}
    leaves = [p for p in mcps if p['pid'] not in parents]
    counts['mcpCount'] = len(leaves)
    signatures = Counter(re.sub(r'\s+', ' ', p['command']).strip() for p in leaves)
    counts['duplicateMcpProcesses'] = sum(n - 1 for n in signatures.values())
    children = {}
    for p in processes: children.setdefault(p['parentPid'], []).append(p['pid'])
    queue = [p['pid'] for p in processes if p['role'] == 'ai-agent' and p['name'] not in {'node_repl', 'node_repl.exe'}]
    visited = set()
    while queue:
        pid = queue.pop()
        if pid in visited: continue
        visited.add(pid)
        queue.extend(children.get(pid, []))
    counts['agentTreeMemoryMB'] = math.floor(sum(p['memMB'] for p in processes if p['pid'] in visited) * 10 + 0.5) / 10
    return counts


def probe_processes() -> dict:
    rows, complete = [], True
    try:
        for proc in psutil.process_iter(['pid', 'ppid', 'name', 'cmdline', 'memory_info'], ad_value=None):
            try:
                info = proc.info
                args, memory = info.get('cmdline'), info.get('memory_info')
                rows.append({'pid': info.get('pid'), 'parentPid': info.get('ppid'), 'name': info.get('name'),
                             'command': ' '.join(args) if isinstance(args, list) and all(isinstance(a, str) for a in args) else None,
                             'memMB': memory.rss / 1024 / 1024 if memory is not None else None})
            except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError, TypeError):
                complete = False
    except (psutil.Error, OSError):
        complete = False
    return _process_metrics(rows, complete)


def probe_crashes(window_minutes=15):
    window = max(1, min(120, round(window_minutes)))
    empty = {'status': 'unknown' if os.name == 'nt' else 'unsupported', 'windowMinutes': window,
             'totalCrashes': 0, 'topApp': '', 'topAppCrashes': 0, 'apps': []}
    if os.name != 'nt': return empty
    script = (
        '$ErrorActionPreference = "Stop"; $events=@(); try { $events=@(Get-WinEvent -FilterHashtable '
        '@{LogName="Application";ProviderName="Application Error";Id=1000;StartTime=(Get-Date).AddMinutes(-'
        + str(window) + ')} -ErrorAction Stop) } catch { if ($_.FullyQualifiedErrorId -notlike "NoMatchingEventsFound*") { throw } }; '
        '$apps=@(); foreach($event in $events) { $xml=[xml]$event.ToXml(); '
        '$app=@($xml.Event.EventData.Data | Where-Object { $_.Name -eq "AppName" }); '
        'if($app.Count -ne 1 -or [string]::IsNullOrWhiteSpace($app[0].InnerText)) { throw "Unrecognized crash event schema" }; '
        '$apps+=$app[0].InnerText }; $groups=@($apps | Group-Object | Sort-Object Count -Descending | '
        'Select-Object -First 10 @{n="name";e={$_.Name}},@{n="count";e={$_.Count}}); $top=$groups | Select-Object -First 1; '
        '[pscustomobject]@{status="measured";totalCrashes=$apps.Count;topApp=if($top){$top.name}else{""};'
        'topAppCrashes=if($top){$top.count}else{0};apps=$groups} | ConvertTo-Json -Compress -Depth 4'
    )
    try:
        result = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
                                capture_output=True, text=True, timeout=8, encoding='utf-8', errors='replace',
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode != 0: return empty
        data = json.loads(result.stdout)
        integer = lambda v: isinstance(v, int) and not isinstance(v, bool) and v >= 0
        if (data.get('status') != 'measured' or not integer(data.get('totalCrashes'))
                or not integer(data.get('topAppCrashes')) or data['topAppCrashes'] > data['totalCrashes']
                or not isinstance(data.get('topApp'), str) or not isinstance(data.get('apps'), list)
                or data['totalCrashes'] > 0 and (not data['topApp'] or not data['topAppCrashes'])
                or any(not isinstance(a, dict) or not isinstance(a.get('name'), str) or not a['name']
                       or not integer(a.get('count')) or a['count'] < 1 for a in data['apps'])):
            return empty
        return {**empty, **data, 'windowMinutes': window}
    except (OSError, subprocess.TimeoutExpired, ValueError, AttributeError, TypeError):
        return empty


# ─── GIT ────────────────────────────────────────────────────────

def probe_git(cwd: str) -> dict:
    info = {
        'isRepo': False,
        'repoSizeMB': 0,
        'branch': '',
        'uncommittedFiles': 0,
        'untrackedFiles': 0,
        'hasLockFiles': False,
        'recentCommitStyle': 'unknown',
    }

    git_dir = os.path.join(cwd, '.git')
    if not os.path.exists(git_dir):
        return info

    info['isRepo'] = True
    info['branch'] = _run(f'git -C "{cwd}" branch --show-current')

    status = _run(f'git -C "{cwd}" status --porcelain')
    lines = [l for l in status.split('\n') if l.strip()]
    info['uncommittedFiles'] = len([l for l in lines if not l.startswith('??')])
    info['untrackedFiles'] = len([l for l in lines if l.startswith('??')])

    info['hasLockFiles'] = os.path.exists(os.path.join(git_dir, 'index.lock'))

    log = _run(f'git -C "{cwd}" log --oneline -5 --format="%s"')
    commits = [l for l in log.split('\n') if l.strip()]
    conv_pattern = re.compile(r'^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert)\(')
    conv_count = sum(1 for c in commits if conv_pattern.match(c))
    if commits:
        info['recentCommitStyle'] = 'conventional' if conv_count >= 3 else 'freeform'

    # Repo size — use powershell on Windows for speed
    size_str = _run(
        f'powershell -NoProfile -Command "'
        f"(Get-ChildItem -Recurse -Force '{git_dir}' -ErrorAction SilentlyContinue "
        f'| Measure-Object -Property Length -Sum).Sum"'
    )
    try:
        info['repoSizeMB'] = round(int(size_str) / 1024 / 1024)
    except (ValueError, TypeError):
        info['repoSizeMB'] = 0

    return info


# ─── SECRETS ────────────────────────────────────────────────────

def probe_secrets(cwd: str) -> dict:
    env_names = ['.env', '.env.local', '.env.production', '.env.development']
    env_files = [n for n in env_names if os.path.exists(os.path.join(cwd, n))]

    gitignored = False
    if env_files:
        check = _run(f'git -C "{cwd}" check-ignore .env')
        gitignored = '.env' in check

    key_patterns = ['credentials.json', 'service-account.json', 'id_rsa', '.pem']
    suspicious = [p for p in key_patterns if os.path.exists(os.path.join(cwd, p))]

    return {
        'envFilesFound': env_files,
        'envFilesGitignored': gitignored or len(env_files) == 0,
        'suspiciousFiles': suspicious,
    }


# ─── TEMP FILES ─────────────────────────────────────────────────

def probe_temp() -> dict:
    temp_dir = os.environ.get('TEMP', os.environ.get('TMP', '/tmp'))
    file_count = 0

    try:
        # Only walk 2 levels deep to stay fast
        for root, dirs, files in os.walk(temp_dir):
            depth = root.replace(temp_dir, '').count(os.sep)
            if depth >= 2:
                dirs.clear()
                continue
            file_count += len(files)
    except Exception:
        pass

    return {'tempDir': temp_dir, 'fileCount': file_count}


# ─── UPTIME ─────────────────────────────────────────────────────

def probe_uptime() -> dict:
    boot = psutil.boot_time()
    hours = round((time.time() - boot) / 3600, 1)
    return {'uptimeHours': hours}


# ─── KNOWLEDGE ──────────────────────────────────────────────────

def probe_knowledge(cwd: str) -> dict:
    indicators = [
        ('.claude', 'Claude config'),
        ('CLAUDE.md', 'CLAUDE.md'),
        ('.arcanea', 'Arcanea substrate'),
        ('docs', 'Documentation'),
    ]

    found = 0
    details = {}
    for path, name in indicators:
        exists = os.path.exists(os.path.join(cwd, path))
        details[name] = 'present' if exists else 'missing'
        if exists:
            found += 1

    memory_dir = os.path.join(cwd, '.claude', 'memory')
    if os.path.isdir(memory_dir):
        try:
            md_files = [f for f in os.listdir(memory_dir) if f.endswith('.md')]
            details['memoryFiles'] = len(md_files)
        except Exception:
            pass

    return {'found': found, 'total': len(indicators), 'details': details}


# ─── FULL PROBE ─────────────────────────────────────────────────

def run_all_probes(cwd: str) -> dict:
    """Run all probes and return raw metrics dict."""
    return {
        'memory': probe_memory(),
        'cpu': probe_cpu(),
        'disk': probe_disk(cwd),
        'gpu': probe_gpu(),
        'processes': probe_processes(),
        'crashes': probe_crashes(),
        'git': probe_git(cwd),
        'secrets': probe_secrets(cwd),
        'temp': probe_temp(),
        'uptime': probe_uptime(),
        'knowledge': probe_knowledge(cwd),
    }
