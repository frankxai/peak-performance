"""
Peak Performance Tray — Ten Gate scoring engine.
Python port of gates/scoring.ts.
Maps raw probe metrics to 0-10 scores per gate, total 0-100.
"""

import math


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _integer(value):
    return _finite(value) and value >= 0 and int(value) == value


def _round(value):
    # Match JavaScript Math.round for the nonnegative quantities used here.
    return math.floor(value + 0.5)


def _unknown(gid, detail):
    return {'id': gid, 'score': None, 'status': 'UNKNOWN', 'detail': detail}


def _valid_capacity(info, total, free):
    return (_finite(info.get(total)) and info[total] > 0
            and _finite(info.get(free)) and 0 <= info[free] <= info[total]
            and _finite(info.get('usedPct')) and 0 <= info['usedPct'] <= 100)


def _status(score: int) -> str:
    if score >= 9:
        return 'PERFECT'
    if score >= 7:
        return 'OK'
    if score >= 4:
        return 'WARN'
    return 'CRIT'


def _clamp(score: int) -> int:
    return max(0, min(10, score))


# ─── Foundation (Disk) ──────────────────────────────────────────

def score_disk(disk: dict) -> dict:
    if not _valid_capacity(disk, 'totalGB', 'freeGB'):
        return _unknown('disk', 'Invalid disk capacity evidence')
    free = disk['freeGB']
    if free < 10:
        score = 2
    elif free < 20:
        score = 4
    elif free < 50:
        score = 6
    elif free < 100:
        score = 8
    else:
        score = 10

    return {
        'id': 'disk',
        'score': score,
        'status': _status(score),
        'detail': f"{free}GB free / {disk['totalGB']}GB ({disk['usedPct']}% used)",
    }


# ─── Flow (Memory) ─────────────────────────────────────────────

def score_memory(mem: dict) -> dict:
    if not _valid_capacity(mem, 'totalMB', 'freeMB'):
        return _unknown('memory', 'Invalid memory evidence')
    pct = mem['usedPct']
    if pct > 95:
        score = 1
    elif pct > 90:
        score = 3
    elif pct > 85:
        score = 5
    elif pct > 80:
        score = 6
    elif pct > 70:
        score = 8
    else:
        score = 10

    return {
        'id': 'memory',
        'score': score,
        'status': _status(score),
        'detail': f"{mem['freeMB']}MB free / {mem['totalMB']}MB ({pct}% used)",
    }


# ─── Fire (CPU + GPU) ──────────────────────────────────────────

def score_cpu_gpu(cpu: dict, gpu: dict | None) -> dict:
    if (cpu.get('status') != 'measured'
            or not all(_finite(cpu.get(k)) and 0 <= cpu[k] <= 100 for k in ['loadPct', 'systemLoadPct'])
            or cpu['systemLoadPct'] > cpu['loadPct']):
        return _unknown('cpu', 'A measured valid CPU sample is required')
    score = 10
    if gpu:
        if gpu['tempC'] > 90: score -= 4
        elif gpu['tempC'] > 80: score -= 2
        elif gpu['tempC'] > 70: score -= 1
        if gpu['utilPct'] > 90: score -= 2
    load, system = cpu['loadPct'], cpu['systemLoadPct']
    if load >= 95: score = min(score, 2)
    elif load >= 85: score = min(score, 4)
    elif load >= 70: score = min(score, 6)
    elif load >= 55: score = min(score, 8)
    if system >= 45: score = min(score, 4)
    elif system >= 30: score = min(score, 6)
    score = _clamp(score)
    return {'id': 'cpu', 'score': score, 'status': _status(score),
            'detail': f"CPU {load}% ({system}% system)"}

# ─── Heart (Process Health) ────────────────────────────────────

def score_processes(procs: dict, crashes: dict | None = None) -> dict:
    crashes = crashes or {}
    keys = ['claudeCount', 'cursorCount', 'codexCount', 'nodeCount',
            'codexTaskRuntimeCount', 'duplicateMcpProcesses', 'totalProcesses']
    if (procs.get('status') != 'measured' or crashes.get('status') != 'measured'
            or not all(_integer(procs.get(k)) for k in keys)
            or not all(_integer(crashes.get(k)) for k in ['totalCrashes', 'topAppCrashes'])
            or crashes['topAppCrashes'] > crashes['totalCrashes']):
        return _unknown('processes', 'Incomplete process or crash evidence')
    score = 10
    named = procs['claudeCount'] + procs['cursorCount'] + procs['codexCount']
    runtimes = max(named, procs['codexTaskRuntimeCount'])
    ratio = _round(procs['nodeCount'] / runtimes) if runtimes else procs['nodeCount']
    if runtimes > 12: score -= 4
    elif runtimes > 8: score -= 3
    elif runtimes > 4: score -= 2
    elif runtimes > 2: score -= 1
    duplicates = procs['duplicateMcpProcesses']
    if duplicates > 60: score -= 4
    elif duplicates > 30: score -= 3
    elif duplicates > 10: score -= 2
    elif duplicates > 0: score -= 1
    if ratio > 15: score -= 3
    elif ratio > 10: score -= 2
    elif ratio > 7: score -= 1
    if procs['totalProcesses'] > 550: score -= 2
    elif procs['totalProcesses'] > 400: score -= 1
    crashes_count = crashes['topAppCrashes']
    if crashes_count >= 30: score = min(score, 1)
    elif crashes_count >= 10: score = min(score, 3)
    elif crashes_count >= 3: score -= 2
    score = _clamp(score)
    return {'id': 'processes', 'score': score, 'status': _status(score),
            'detail': f"{named} named agents, {runtimes} runtimes, {duplicates} duplicate MCP, {crashes_count} recent crashes"}

# ─── Voice (Git Hygiene) ───────────────────────────────────────

def score_git(git: dict) -> dict:
    if not git['isRepo']:
        return {'id': 'git', 'score': 5, 'status': 'WARN', 'detail': 'Not a git repo'}

    score = 10

    if git['uncommittedFiles'] > 50:
        score -= 3
    elif git['uncommittedFiles'] > 20:
        score -= 2
    elif git['uncommittedFiles'] > 5:
        score -= 1

    if git['hasLockFiles']:
        score -= 2

    if git['recentCommitStyle'] == 'conventional':
        score = min(score + 1, 10)

    if git['repoSizeMB'] > 500:
        score -= 1

    score = _clamp(score)
    return {
        'id': 'git',
        'score': score,
        'status': _status(score),
        'detail': f"{git['branch']} | {git['uncommittedFiles']} uncommitted, {git['untrackedFiles']} untracked | {git['repoSizeMB']}MB .git",
    }


# ─── Sight (Security) ──────────────────────────────────────────

def score_secrets(secrets: dict) -> dict:
    score = 10

    if len(secrets['suspiciousFiles']) > 0:
        score -= 4
    if not secrets['envFilesGitignored']:
        score -= 3

    score = max(0, score)

    if secrets['envFilesFound']:
        detail = f"{', '.join(secrets['envFilesFound'])} {'(gitignored)' if secrets['envFilesGitignored'] else 'NOT GITIGNORED!'}"
    else:
        detail = 'No .env files found'

    return {
        'id': 'secrets',
        'score': score,
        'status': _status(score),
        'detail': detail,
    }


# ─── Crown (Workspace) ────────────────────────────────────────

def score_workspace(temp: dict) -> dict:
    score = 10

    if temp['fileCount'] > 20000:
        score -= 4
    elif temp['fileCount'] > 10000:
        score -= 2
    elif temp['fileCount'] > 5000:
        score -= 1

    score = max(0, score)
    return {
        'id': 'workspace',
        'score': score,
        'status': _status(score),
        'detail': f"{temp['fileCount']} temp files in {temp['tempDir']}",
    }


# ─── Starweave (Knowledge) ────────────────────────────────────

def score_knowledge(knowledge: dict) -> dict:
    score = 10
    if knowledge['found'] < 2:
        score -= 3

    return {
        'id': 'knowledge',
        'score': score,
        'status': _status(score),
        'detail': f"{knowledge['found']}/{knowledge['total']} knowledge indicators present",
    }


# ─── Unity (Agent Load) ───────────────────────────────────────

def score_agent_load(mem: dict, procs: dict) -> dict:
    if (not _valid_capacity(mem, 'totalMB', 'freeMB') or procs.get('status') != 'measured'
            or not _finite(procs.get('agentTreeMemoryMB')) or procs['agentTreeMemoryMB'] < 0
            or not all(_integer(procs.get(k)) for k in ['claudeCount', 'cursorCount', 'codexCount', 'codexTaskRuntimeCount'])):
        return _unknown('agents', 'Incomplete process or memory evidence')
    agents = procs['claudeCount'] + procs['cursorCount'] + procs['codexCount']
    estimate = (procs['agentTreeMemoryMB'] if procs['agentTreeMemoryMB'] > 0
                else procs['claudeCount'] * 450 + procs['cursorCount'] * 300 + procs['codexCount'] * 200)
    pct = _round(estimate / mem['totalMB'] * 100)
    score = 10
    if pct > 50: score = 2
    elif pct > 35: score = 4
    elif pct > 25: score = 6
    elif pct > 15: score = 8
    if mem['usedPct'] > 90 and agents > 3: score -= 2
    score = _clamp(score)
    return {'id': 'agents', 'score': score, 'status': _status(score),
            'detail': f"{agents} named agents using ~{estimate}MB ({pct}%)"}

# ─── Source (System Overall) ──────────────────────────────────

def score_system(disk: dict, mem: dict, uptime_hours: float) -> dict:
    if (not _valid_capacity(disk, 'totalGB', 'freeGB') or not _valid_capacity(mem, 'totalMB', 'freeMB')
            or not _finite(uptime_hours) or uptime_hours < 0):
        return _unknown('system', 'Invalid capacity or uptime evidence')
    score = 10

    if disk['freeGB'] < 20 and mem['usedPct'] > 85:
        score -= 4
    elif disk['freeGB'] < 50 and mem['usedPct'] > 80:
        score -= 2

    if uptime_hours > 168:
        score -= 2
    elif uptime_hours > 72:
        score -= 1

    score = _clamp(score)
    hours = round(uptime_hours, 1)
    return {
        'id': 'system',
        'score': score,
        'status': _status(score),
        'detail': f"Uptime: {hours}h | Disk: {disk['freeGB']}GB free | RAM: {mem['usedPct']}%",
    }


# ─── GRADE ─────────────────────────────────────────────────────

def grade(score: int | None) -> str:
    if not _finite(score) or not 0 <= score <= 100:
        return 'UNKNOWN'
    if score >= 95:
        return 'S'
    if score >= 90:
        return 'A+'
    if score >= 85:
        return 'A'
    if score >= 80:
        return 'A-'
    if score >= 75:
        return 'B+'
    if score >= 70:
        return 'B'
    if score >= 65:
        return 'B-'
    if score >= 60:
        return 'C+'
    if score >= 55:
        return 'C'
    if score >= 50:
        return 'C-'
    if score >= 45:
        return 'D+'
    if score >= 40:
        return 'D'
    return 'F'


# ─── FULL AUDIT ────────────────────────────────────────────────

def run_audit(probes: dict) -> dict:
    """Score all gates from raw probe data. Returns audit result."""
    gates = [
        score_disk(probes['disk']),
        score_memory(probes['memory']),
        score_cpu_gpu(probes['cpu'], probes['gpu']),
        score_processes(probes['processes'], probes.get('crashes')),
        score_git(probes['git']),
        score_secrets(probes['secrets']),
        score_workspace(probes['temp']),
        score_knowledge(probes['knowledge']),
        score_agent_load(probes['memory'], probes['processes']),
        score_system(probes['disk'], probes['memory'], probes['uptime']['uptimeHours']),
    ]

    unknown = [g['id'] for g in gates if g['score'] is None or g['status'] == 'UNKNOWN']
    raw = None if unknown else sum(g['score'] for g in gates)
    total = raw
    caps = []
    if unknown:
        caps.append('Incomplete probe evidence: ' + ', '.join(unknown))
    elif probes['crashes']['topAppCrashes'] >= 10:
        total = min(total, 49)
        caps.append('Application crash loop')
    elif any(g['status'] == 'CRIT' for g in gates):
        total = min(total, 69)
        caps.append('At least one Ten Gate is critical')
    g = grade(total)

    return {
        'totalScore': total,
        'rawScore': raw,
        'scoreCaps': caps,
        'grade': g,
        'gates': gates,
        'gateScores': {g['id']: g['score'] for g in gates},
    }
