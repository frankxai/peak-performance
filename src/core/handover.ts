/**
 * Agent State Preservation & Handover (ASPH) Protocol
 * core/handover.ts
 *
 * Scans, checkpoints, and generates continuation prompts for active agents.
 * Exports summaries to the User's Desktop as HTML & TXT.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

interface SessionData {
  sessionId: string;
  project: string;
  lastPrompt: string;
  lastTimestamp: number;
  promptCount: number;
}

interface RepoAudit {
  name: string;
  path: string;
  branch: string;
  uncommittedCount: number;
  uncommittedList: string[];
  lastCommit: string;
  checkpointCreated: boolean;
  activeSession?: SessionData;
}

function runCmd(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', cwd, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

/** Get user's Desktop directory path */
function getDesktopPath(): string {
  const home = os.homedir();
  const oneDriveDesktop = join(home, 'OneDrive', 'Desktop');
  if (existsSync(oneDriveDesktop)) return oneDriveDesktop;
  const desktop = join(home, 'Desktop');
  if (existsSync(desktop)) return desktop;
  const downloads = join(home, 'Downloads');
  if (existsSync(downloads)) return downloads;
  return home;
}

export function runPrepHandover(cwd: string): { success: boolean; desktopDir: string; txtFile: string; htmlFile: string } {
  const reposRoot = 'C:\\Users\\frank\\starlight\\repos';
  const historyPath = 'C:\\Users\\frank\\.claude\\history.jsonl';
  
  // 1. Gather all repositories inside the repos root
  const repoDirs: string[] = [];
  if (existsSync(reposRoot)) {
    const entries = readdirSync(reposRoot, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && existsSync(join(reposRoot, e.name, '.git'))) {
        repoDirs.push(e.name);
      }
    }
  }

  // 2. Parse active sessions from Claude + other harness histories (agy/antigravity, codex)
  // Merge by sessionId (or workspace for non-claude), keep the most recent lastPrompt.
  const sessions: Record<string, SessionData> = {};
  const historyFiles = [
    historyPath,
    'C:\\Users\\frank\\.gemini\\antigravity-cli\\history.jsonl',
    'C:\\Users\\frank\\.codex\\history.jsonl'
  ];
  for (const hPath of historyFiles) {
    if (!existsSync(hPath)) continue;
    const lines = readFileSync(hPath, 'utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Claude uses sessionId + project + display; agy often workspace + display + conversationId; codex session_id + text
        const sessionId = entry.sessionId || entry.conversationId || entry.session_id || (entry.workspace ? `ws:${entry.workspace}` : null);
        const project = entry.project || entry.workspace || '';
        const display = entry.display || entry.text || '';
        const timestamp = entry.timestamp || entry.ts || 0;
        if (!sessionId) continue;
        
        if (!sessions[sessionId]) {
          sessions[sessionId] = {
            sessionId,
            project: project || '',
            lastPrompt: '',
            lastTimestamp: timestamp || 0,
            promptCount: 0
          };
        }
        
        if (display && display.trim()) {
          // Prefer longer/more recent prompt
          if (timestamp >= sessions[sessionId].lastTimestamp || display.length > sessions[sessionId].lastPrompt.length) {
            sessions[sessionId].lastPrompt = display.trim();
          }
          sessions[sessionId].promptCount++;
        }
        if (timestamp) {
          sessions[sessionId].lastTimestamp = Math.max(sessions[sessionId].lastTimestamp, timestamp);
        }
        // If project empty but we have a later one, keep best
        if (project && (!sessions[sessionId].project || timestamp > sessions[sessionId].lastTimestamp)) {
          sessions[sessionId].project = project;
        }
      } catch {
        // Skip parse errors
      }
    }
  }

  // 3. Audit each Git repo and run WIP checkpoints
  const repoAudits: RepoAudit[] = [];
  
  for (const name of repoDirs) {
    const repoPath = join(reposRoot, name);
    const branch = runCmd('git branch --show-current', repoPath) || 'unknown';
    const lastCommit = runCmd('git log -1 --oneline', repoPath) || 'no commits';
    
    // Check for dirty files
    const status = runCmd('git status --porcelain', repoPath);
    const uncommittedList = status.split('\n').filter(l => l.trim());
    const uncommittedCount = uncommittedList.length;
    
    // Match this repo path to the most recent active session
    let matchedSession: SessionData | undefined;
    for (const s of Object.values(sessions)) {
      if (s.project && s.project.toLowerCase() === repoPath.toLowerCase()) {
        if (!matchedSession || s.lastTimestamp > matchedSession.lastTimestamp) {
          matchedSession = s;
        }
      }
    }

    let checkpointCreated = false;
    let wipTag = '';
    if (uncommittedCount > 0) {
      // Create WIP commit to stash changes safely
      runCmd('git add -A', repoPath);
      const commitOut = runCmd('git commit -m "wip: pre-reboot checkpoint (ASPH)" --no-verify', repoPath);
      if (commitOut) {
        checkpointCreated = true;
        // Genius safety: tag + note the objective + touched for traceability (smarter than plain commit)
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0,19);
        wipTag = `asph-wip-${ts}`;
        runCmd(`git tag ${wipTag}`, repoPath);
        // Safer note via temp file (avoids quoting hell with newlines/special chars in objective)
        const noteContent = `ASPH WIP\nBranch: ${branch}\nObjective: ${(matchedSession ? matchedSession.lastPrompt.replace(/\n/g, ' ').slice(0,300) : 'N/A')}\nTouched: ${uncommittedList.slice(0,10).join(' ')}\nResume with: git reset HEAD~1 --mixed\nFull prompt + visual console in agentic-ops/lifecycle/asph-genius-recovery.html`;
        const noteFile = join(repoPath, '.asph-wip', `note-${ts}.txt`);
        try { require('fs').writeFileSync(noteFile, noteContent); runCmd(`git notes add -f -F "${noteFile}"`, repoPath); } catch(e){ /* non-fatal */ }
        // Export patch for extra safety / visual diff later
        const patchDir = join(repoPath, '.asph-wip');
        if (!existsSync(patchDir)) {
          runCmd(`mkdir -p "${patchDir}"`, repoPath); // cross platform-ish
        }
        runCmd(`git diff HEAD~1 > "${patchDir}/asph-${ts}.patch"`, repoPath);
      }
    }

    repoAudits.push({
      name,
      path: repoPath,
      branch,
      uncommittedCount,
      uncommittedList,
      lastCommit,
      checkpointCreated,
      activeSession: matchedSession
    });
  }

  // 4. Generate continuation prompts with prompt-hub optimization patterns
  const desktopDir = getDesktopPath();
  const txtFile = join(desktopDir, 'handover-reboot.txt');
  const htmlFile = join(desktopDir, 'handover-reboot.html');

  // Build TXT file content
  let txtContent = `STARLIGHT INTEL SYSTEM — ASPH HANDOVER REPORT\n`;
  txtContent += `Generated: ${new Date().toLocaleString()}\n`;
  txtContent += `======================================================================\n\n`;
  txtContent += `RECOVERY ACTIONS:\n`;
  txtContent += `1. Reboot machine to clean RAM and close active processes.\n`;
  txtContent += `2. Open terminal in each repo directory.\n`;
  txtContent += `3. Run 'git reset HEAD~1' in dirty directories to restore working tree.\n`;
  txtContent += `4. Start agents using resume commands and prompts below.\n\n`;
  txtContent += `======================================================================\n\n`;

  repoAudits.forEach(repo => {
    txtContent += `REPOSITORY: ${repo.name}\n`;
    txtContent += `- Path: ${repo.path}\n`;
    txtContent += `- Branch: ${repo.branch}\n`;
    txtContent += `- Uncommitted Files: ${repo.uncommittedCount} (${repo.checkpointCreated ? 'Saved to WIP commit' : 'None'})\n`;
    txtContent += `- Last Commit: ${repo.lastCommit}\n`;
    
    if (repo.activeSession) {
      txtContent += `- Session ID: ${repo.activeSession.sessionId}\n`;
      txtContent += `- Last Prompt: ${repo.activeSession.lastPrompt.slice(0, 100)}...\n`;
      // Touched files since the WIP (best effort)
      const touched = runCmd('git diff --name-only HEAD~1 2>$null || git status --porcelain', repo.path).split('\n').filter(Boolean).slice(0, 8).join(', ');
      if (touched) txtContent += `- Touched (approx): ${touched}\n`;
      txtContent += `- Continuation prompt:\n`;
      txtContent += `------------------------------------------------------------\n`;
      txtContent += `/goal [FEYNMAN ROUTE] Resume task on branch ${repo.branch}.\n`;
      txtContent += `Objective: Continue working on: "${repo.activeSession.lastPrompt.replace(/\n/g, ' ')}".\n`;
      let ctx = `Context: First run 'git reset HEAD~1' to restore uncommitted files. Verify git status. Do not write speculative code. Keep edits surgical. Focus on completing the objective thoroughly.`;
      if (touched) ctx += ` Touched files: ${touched}.`;
      // Worktree / global protocol note for best thinkers pattern
      if (!/agent\//.test(repo.branch)) {
        ctx += ` (Note: active branch is not agent/* — consider worktree per global parallel agent rules for isolation.)`;
      }
      txtContent += `${ctx}\n`;
      txtContent += `------------------------------------------------------------\n`;
      
      const shortShortcut = repo.name === 'Starlight-Intelligence-System' ? 'clsis' :
                            repo.name === 'FrankX' ? 'clfx' :
                            repo.name === 'arcanea-ecosystem' ? 'clarc' :
                            repo.name === 'agentic-creator-os' ? 'clacos' : `cl ${repo.name}`;
      
      txtContent += `- Resume Command: ${shortShortcut}\n`;
    } else {
      txtContent += `- No active session detected.\n`;
    }
    txtContent += `\n======================================================================\n\n`;
  });

  writeFileSync(txtFile, txtContent, 'utf8');

  // Build HTML file content
  let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ASPH Handover Matrix</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-gradient: linear-gradient(135deg, #020617 0%, #0b1528 50%, #030712 100%);
            --card-bg: rgba(15, 23, 42, 0.6);
            --card-border: rgba(255, 255, 255, 0.06);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-blue: #3b82f6;
            --accent-green: #10b981;
            --accent-yellow: #f59e0b;
            --accent-cyan: #06b6d4;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: var(--bg-gradient);
            color: var(--text-primary);
            font-family: 'Outfit', sans-serif;
            min-height: 100vh;
            padding: 40px 20px;
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        header { text-align: center; margin-bottom: 40px; }
        header h1 {
            font-size: 2.5rem;
            font-weight: 800;
            background: linear-gradient(to right, #f8fafc, #60a5fa, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
        }
        header p { color: var(--text-secondary); font-size: 1.1rem; }
        
        .grid { display: grid; grid-template-columns: 1fr; gap: 25px; margin-bottom: 40px; }
        @media (min-width: 768px) {
            .grid { grid-template-columns: repeat(auto-fill, minmax(500px, 1fr)); }
        }
        
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 24px;
            backdrop-filter: blur(12px);
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
            transition: border-color 0.3s;
        }
        .card:hover { border-color: rgba(255, 255, 255, 0.12); }
        .card.dirty { border-left: 4px solid var(--accent-yellow); }
        .card.clean { border-left: 4px solid var(--accent-green); }
        
        .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .repo-name { font-size: 1.25rem; font-weight: 700; color: #fff; }
        .status-badge {
            font-size: 0.75rem;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 50px;
        }
        .status-badge.dirty { background: rgba(245, 158, 11, 0.1); color: var(--accent-yellow); border: 1px solid rgba(245, 158, 11, 0.2); }
        .status-badge.clean { background: rgba(16, 185, 129, 0.1); color: var(--accent-green); border: 1px solid rgba(16, 185, 129, 0.2); }
        
        .meta-row { font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 15px; }
        .meta-row div { margin-bottom: 4px; }
        
        .code-box {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.8rem;
            background: rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(255, 255, 255, 0.04);
            padding: 10px 14px;
            border-radius: 8px;
            color: var(--accent-cyan);
            margin-bottom: 15px;
            word-break: break-all;
            position: relative;
        }
        
        .prompt-box {
            font-size: 0.85rem;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
            color: var(--text-secondary);
        }
        .prompt-box strong { color: #fff; display: block; margin-bottom: 5px; }
        
        .btn {
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.2);
            color: var(--accent-blue);
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 0.8rem;
            cursor: pointer;
            font-family: inherit;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .btn:hover { background: rgba(59, 130, 246, 0.2); color: #fff; }
        
        .actions-card {
            background: rgba(59, 130, 246, 0.05);
            border: 1px solid rgba(59, 130, 246, 0.15);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 30px;
        }
        .actions-card h2 { font-size: 1.25rem; margin-bottom: 15px; color: #fff; }
        .actions-list { padding-left: 20px; }
        .actions-list li { margin-bottom: 8px; font-size: 0.95rem; }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>ASPH Handover Matrix</h1>
            <p>Session checkpoint registry before system restart • Generated ${new Date().toLocaleString()}</p>
        </header>

        <div class="actions-card">
            <h2>⚡ Quick-Recovery Runbook</h2>
            <ul class="actions-list">
                <li>Run <code>git reset HEAD~1</code> in dirty repos to undo the WIP commit.</li>
                <li>Launch the agent in the directory using the recovery commands below.</li>
                <li>Copy the optimized continuation prompt and paste it to resume the session with complete state.</li>
            </ul>
        </div>

        <div class="grid">`;

  repoAudits.forEach(repo => {
    const isDirty = repo.uncommittedCount > 0;
    const cleanLabel = isDirty ? 'dirty' : 'clean';
    const statusText = isDirty ? `${repo.uncommittedCount} Files Saved` : 'Clean';
    
    htmlContent += `
            <div class="card ${cleanLabel}">
                <div class="card-header">
                    <span class="repo-name">${repo.name}</span>
                    <span class="status-badge ${cleanLabel}">${statusText}</span>
                </div>
                <div class="meta-row">
                    <div>Branch: <strong>${repo.branch}</strong></div>
                    <div>Last commit: <code>${repo.lastCommit.slice(0, 50)}...</code></div>
                </div>`;

    if (repo.activeSession) {
      const shortShortcut = repo.name === 'Starlight-Intelligence-System' ? 'clsis' :
                            repo.name === 'FrankX' ? 'clfx' :
                            repo.name === 'arcanea-ecosystem' ? 'clarc' :
                            repo.name === 'agentic-creator-os' ? 'clacos' : `cl ${repo.name}`;
      
      const optPrompt = `/goal [FEYNMAN ROUTE] Resume task on branch ${repo.branch}. \\nObjective: Continue working on: "${repo.activeSession.lastPrompt.replace(/"/g, '&quot;').replace(/\n/g, ' ')}".\\nContext: First run 'git reset HEAD~1' to restore uncommitted files. Verify git status. Do not write speculative code. Keep edits surgical. Focus on completing the objective thoroughly.`;
      
      htmlContent += `
                <div class="prompt-box">
                    <strong>Continuation Prompt</strong>
                    <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; margin-top: 5px;">
                        ${optPrompt.replace(/\\n/g, '<br/>')}
                    </div>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <div class="code-box" style="margin: 0; flex-grow: 1;">
                        ${shortShortcut}
                    </div>
                    <button class="btn" onclick="navigator.clipboard.writeText('${shortShortcut}')">Copy Command</button>
                    <button class="btn" onclick="navigator.clipboard.writeText('${optPrompt.replace(/'/g, "\\'")}')">Copy Prompt</button>
                </div>`;
    } else {
      htmlContent += `
                <p style="color: var(--text-muted); font-size: 0.9rem; font-style: italic;">No active Claude session mapped.</p>`;
    }

    htmlContent += `
            </div>`;
  });

  htmlContent += `
        </div>
    </div>
</body>
</html>`;

  writeFileSync(htmlFile, htmlContent, 'utf8');

  return {
    success: true,
    desktopDir,
    txtFile,
    htmlFile
  };
}
