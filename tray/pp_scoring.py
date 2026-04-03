"""
Peak Performance Tray — Ten Gate scoring engine.
Python port of gates/scoring.ts.
Maps raw probe metrics to 0-10 scores per gate, total 0-100.
"""


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
    score = 10
    detail = f"{cpu['model']}"

    if gpu:
        detail += f" | {gpu['name']} {gpu['tempC']}C"
        if gpu['tempC'] > 90:
            score -= 4
        elif gpu['tempC'] > 80:
            score -= 2
        elif gpu['tempC'] > 70:
            score -= 1

        if gpu['utilPct'] > 90:
            score -= 2

    logical = cpu['logicalCores'] or 1
    load_per_core = cpu['loadAvg1m'] / logical
    if load_per_core > 2:
        score -= 3
    elif load_per_core > 1:
        score -= 2
    elif load_per_core > 0.7:
        score -= 1

    score = _clamp(score)
    return {
        'id': 'cpu',
        'score': score,
        'status': _status(score),
        'detail': detail,
    }


# ─── Heart (Process Health) ────────────────────────────────────

def score_processes(procs: dict) -> dict:
    score = 10
    agents = procs['claudeCount'] + procs['cursorCount'] + procs['codexCount']
    node_per_agent = round(procs['nodeCount'] / agents) if agents > 0 else procs['nodeCount']

    if procs['claudeCount'] > 10:
        score -= 3
    elif procs['claudeCount'] > 6:
        score -= 2
    elif procs['claudeCount'] > 4:
        score -= 1

    if node_per_agent > 15:
        score -= 3
    elif node_per_agent > 10:
        score -= 2
    elif node_per_agent > 7:
        score -= 1

    if procs['totalProcesses'] > 600:
        score -= 2
    elif procs['totalProcesses'] > 400:
        score -= 1

    score = _clamp(score)
    return {
        'id': 'processes',
        'score': score,
        'status': _status(score),
        'detail': f"{agents} AI agents, {procs['nodeCount']} node, {procs['totalProcesses']} total ({node_per_agent}:1 node/agent)",
    }


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
    score = 10
    agents = procs['claudeCount'] + procs['cursorCount'] + procs['codexCount']

    est_agent_mb = procs['claudeCount'] * 450 + procs['cursorCount'] * 300 + procs['codexCount'] * 200
    agent_pct = round(est_agent_mb / mem['totalMB'] * 100) if mem['totalMB'] > 0 else 0

    if agent_pct > 40:
        score -= 4
    elif agent_pct > 30:
        score -= 3
    elif agent_pct > 20:
        score -= 1

    if mem['usedPct'] > 90 and agents > 3:
        score -= 2

    score = _clamp(score)
    return {
        'id': 'agents',
        'score': score,
        'status': _status(score),
        'detail': f"{agents} agents using ~{est_agent_mb}MB ({agent_pct}% of {mem['totalMB']}MB)",
    }


# ─── Source (System Overall) ──────────────────────────────────

def score_system(disk: dict, mem: dict, uptime_hours: float) -> dict:
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

def grade(score: int) -> str:
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
        score_processes(probes['processes']),
        score_git(probes['git']),
        score_secrets(probes['secrets']),
        score_workspace(probes['temp']),
        score_knowledge(probes['knowledge']),
        score_agent_load(probes['memory'], probes['processes']),
        score_system(probes['disk'], probes['memory'], probes['uptime']['uptimeHours']),
    ]

    total = sum(g['score'] for g in gates)
    g = grade(total)

    return {
        'totalScore': total,
        'grade': g,
        'gates': gates,
        'gateScores': {g['id']: g['score'] for g in gates},
    }
