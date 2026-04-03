"""
Peak Performance Tray — System probes.
Python port of core/probes.ts. Each probe returns raw metrics.
"""

import os
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
    total_mb = round(vm.total / 1024 / 1024)
    free_mb = round(vm.available / 1024 / 1024)
    used_pct = round((1 - free_mb / total_mb) * 100) if total_mb > 0 else 0
    return {'totalMB': total_mb, 'freeMB': free_mb, 'usedPct': used_pct}


# ─── CPU ────────────────────────────────────────────────────────

def probe_cpu() -> dict:
    freq = psutil.cpu_freq()
    load_avg = psutil.cpu_percent(interval=0.5)
    logical = psutil.cpu_count(logical=True) or 1
    physical = psutil.cpu_count(logical=False) or 1

    # Approximate 1-minute load average equivalent from cpu_percent
    # On Windows, os.getloadavg() doesn't exist, so we use cpu_percent / 100 * cores
    load_1m = round(load_avg / 100 * logical, 2)

    return {
        'model': f'{physical}C/{logical}T @ {round(freq.max)}MHz' if freq else f'{physical}C/{logical}T',
        'cores': physical,
        'logicalCores': logical,
        'loadAvg1m': load_1m,
    }


# ─── DISK ───────────────────────────────────────────────────────

def probe_disk(cwd: str) -> dict:
    # Detect drive letter
    drive = 'C:\\'
    match = re.match(r'^([A-Za-z]):', cwd)
    if match:
        drive = match.group(1).upper() + ':\\'

    try:
        usage = psutil.disk_usage(drive)
        total_gb = round(usage.total / 1024 / 1024 / 1024, 1)
        free_gb = round(usage.free / 1024 / 1024 / 1024, 1)
        used_pct = round(usage.percent)
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

def probe_processes() -> dict:
    info = {
        'totalProcesses': 0,
        'nodeCount': 0,
        'claudeCount': 0,
        'cursorCount': 0,
        'codexCount': 0,
        'vscodeCount': 0,
        'edgeChromeTabs': 0,
    }

    try:
        for proc in psutil.process_iter(['name']):
            info['totalProcesses'] += 1
            try:
                name = (proc.info['name'] or '').lower()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

            if 'node' in name:
                info['nodeCount'] += 1
            if 'claude' in name:
                info['claudeCount'] += 1
            if 'cursor' in name:
                info['cursorCount'] += 1
            if 'codex' in name:
                info['codexCount'] += 1
            if name == 'code.exe':
                info['vscodeCount'] += 1
            if 'msedge' in name or 'chrome' in name:
                info['edgeChromeTabs'] += 1
    except Exception:
        pass

    return info


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
        'git': probe_git(cwd),
        'secrets': probe_secrets(cwd),
        'temp': probe_temp(),
        'uptime': probe_uptime(),
        'knowledge': probe_knowledge(cwd),
    }
