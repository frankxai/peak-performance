/**
 * Core audit engine — runs all probes and scores all gates.
 */
import os from 'node:os';
import type { AuditResult, PPConfig, Recommendation } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';
import {
  probeMemory, probeCpu, probeDisk, probeGpu,
  probeProcesses, probeGit, probeSecrets, probeTemp, probeUptime,
} from './probes.js';
import {
  scoreDisk, scoreMemory, scoreCpuGpu, scoreProcesses,
  scoreGit, scoreSecrets, scoreWorkspace, scoreKnowledge,
  scoreAgentLoad, scoreSystem, grade,
} from '../gates/scoring.js';

export function runAudit(config: Partial<PPConfig> = {}): AuditResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Run all probes
  const mem = probeMemory();
  const cpu = probeCpu();
  const disk = probeDisk(cfg.cwd);
  const gpu = probeGpu();
  const procs = probeProcesses();
  const git = probeGit(cfg.cwd);
  const secrets = probeSecrets(cfg.cwd);
  const temp = probeTemp();
  const uptime = probeUptime();

  // Score all gates
  const gates = [
    scoreDisk(disk),
    scoreMemory(mem),
    scoreCpuGpu(cpu, gpu),
    scoreProcesses(procs),
    scoreGit(git),
    scoreSecrets(secrets),
    scoreWorkspace(temp),
    scoreKnowledge(cfg.cwd),
    scoreAgentLoad(mem, procs),
    scoreSystem(disk, mem, uptime.uptimeHours),
  ];

  const totalScore = gates.reduce((sum, g) => sum + g.score, 0);

  // Collect recommendations
  const recommendations: Recommendation[] = [];

  if (disk.freeGB < 20) {
    recommendations.push({
      priority: 'urgent', gate: 'disk',
      message: `Only ${disk.freeGB}GB disk free — run: npm cache clean --force`,
      fix: 'npm-cache-clean',
      autoFixable: true,
    });
  }

  if (mem.usedPct > 85) {
    recommendations.push({
      priority: 'high', gate: 'memory',
      message: `RAM at ${mem.usedPct}% — close unused apps`,
      autoFixable: false,
    });
  }

  if (procs.claudeCount > 4) {
    recommendations.push({
      priority: 'high', gate: 'agents',
      message: `${procs.claudeCount} Claude instances — recommend max 4 for ${mem.totalMB}MB RAM`,
      autoFixable: false,
    });
  }

  if (procs.nodeCount > 50) {
    recommendations.push({
      priority: 'medium', gate: 'processes',
      message: `${procs.nodeCount} node processes — check for orphans`,
      autoFixable: false,
    });
  }

  if (gpu && gpu.tempC > 80) {
    recommendations.push({
      priority: 'high', gate: 'cpu',
      message: `GPU at ${gpu.tempC}°C — check ventilation`,
      autoFixable: false,
    });
  }

  if (temp.fileCount > 10000) {
    recommendations.push({
      priority: 'medium', gate: 'workspace',
      message: `${temp.fileCount} temp files — consider cleanup`,
      fix: os.platform() === 'win32' ? 'temp-clean-win' : 'temp-clean-unix',
      autoFixable: true,
    });
  }

  if (!secrets.envFilesGitignored && secrets.envFilesFound.length > 0) {
    recommendations.push({
      priority: 'urgent', gate: 'secrets',
      message: '.env files are NOT gitignored — add .env* to .gitignore',
      autoFixable: false, // Don't auto-modify gitignore — user should review
    });
  }

  // Sort recommendations by priority
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    timestamp: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    totalScore,
    grade: grade(totalScore),
    gates,
    recommendations,
  };
}
