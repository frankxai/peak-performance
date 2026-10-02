// Compare executable TS/Python scorers on common synthetic evidence.
// Requires Node 24 for source mode; --compiled also supports Node 18.
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmdirSync } = require('node:fs');
const { resolve, dirname, join } = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const root = resolve(__dirname, '..');
const compiled = process.argv.includes('--compiled');
const modules = new Map();
async function source(file) {
  if (modules.has(file)) return modules.get(file);
  const { SourceTextModule, SyntheticModule } = require('node:vm');
  let m;
  if (file.startsWith('node:')) {
    const actual = require(file), keys = [...new Set(['default', ...Object.keys(actual)])];
    m = new SyntheticModule(keys, function () { for (const key of keys) this.setExport(key, key === 'default' ? actual : key === 'execFileSync' ? (...args) => actual[key](...args) : actual[key]); });
  } else {
    const { stripTypeScriptTypes } = require('node:module');
    m = new SourceTextModule(stripTypeScriptTypes(readFileSync(file, 'utf8')), { identifier: file });
  }
  modules.set(file, m);
  return m;
}
async function load(file) {
  if (compiled) return import(pathToFileURL(join(root, 'dist', file.replace(/\.ts$/, '.js'))).href);
  const m = await source(join(root, 'src', file));
  if (m.status === 'unlinked') await m.link((specifier, parent) => source(specifier.startsWith('node:') ? specifier : resolve(dirname(parent.identifier), specifier.replace(/\.js$/, '.ts'))));
  if (m.status === 'linked') await m.evaluate();
  return m.namespace;
}
async function main() {
  const ts = await load('gates/scoring.ts'), audit = await load('core/audit.ts'), probes = await load('core/probes.ts');
  const mem = { totalMB: 10000, freeMB: 5000, usedPct: 50 };
  const disk = { drive: 'fixture', totalGB: 1000, freeGB: 500, usedPct: 50 };
  const procs = { status: 'measured', totalProcesses: 180, nodeCount: 6, claudeCount: 0, cursorCount: 0, codexCount: 1,
    vscodeCount: 0, edgeChromeTabs: 0, protectedCount: 1, codexTaskRuntimeCount: 1, mcpCount: 0, mcpProcessCount: 0,
    mcpMemoryMB: 0, duplicateMcpProcesses: 0, agentTreeMemoryMB: 200, processes: [], topConsumers: [] };
  const crashes = { status: 'measured', windowMinutes: 15, totalCrashes: 0, topApp: '', topAppCrashes: 0, apps: [] };
  const cpu = { status: 'measured', model: 'fixture', cores: 1, logicalCores: 1, loadPct: 20, systemLoadPct: 10, sampleMs: 350 };
  const cases = [];
  const add = (fn, args, expected) => cases.push({ fn, args, expected });
  for (const load of [0, 20, 54, 55, 69, 70, 84, 85, 94, 95, 100]) {
    for (const system of [0, 29, 30, 44, 45]) if (system <= load) add('scoreCpuGpu', [{ ...cpu, loadPct: load, systemLoadPct: system }, null]);
  }
  add('scoreCpuGpu', [{ ...cpu, loadPct: 95 }, null], { score: 2, status: 'CRIT' });
  add('scoreCpuGpu', [{ ...cpu, status: 'unknown' }, null], { score: null, status: 'UNKNOWN' });
  for (const [load, system] of [[-1, 0], [101, 1], [20, 21]]) add('scoreCpuGpu', [{ ...cpu, loadPct: load, systemLoadPct: system }, null]);
  for (const temp of [70, 71, 80, 81, 90, 91]) add('scoreCpuGpu', [cpu, { name: 'fixture', tempC: temp, utilPct: 95, memUsedMB: 0, memTotalMB: 1 }]);
  for (const runtime of [0, 2, 3, 4, 5, 8, 9, 12, 13]) add('scoreProcesses', [{ ...procs, codexTaskRuntimeCount: runtime }, crashes]);
  for (const duplicate of [0, 1, 10, 11, 30, 31, 60, 61]) add('scoreProcesses', [{ ...procs, duplicateMcpProcesses: duplicate }, crashes]);
  for (const node of [15, 21, 31]) add('scoreProcesses', [{ ...procs, nodeCount: node, codexTaskRuntimeCount: 2 }, crashes]);
  for (const total of [400, 401, 550, 551]) add('scoreProcesses', [{ ...procs, totalProcesses: total }, crashes]);
  for (const count of [0, 2, 3, 9, 10, 29, 30]) add('scoreProcesses', [procs, { ...crashes, totalCrashes: count, topAppCrashes: count }]);
  for (const status of ['unknown', 'unsupported']) add('scoreProcesses', [procs, { ...crashes, status }]);
  add('scoreProcesses', [{ ...procs, status: 'unknown' }, crashes]);
  add('scoreProcesses', [{ ...procs, nodeCount: -1 }, crashes]);
  for (const footprint of [0, 1500, 1550, 2500, 2550, 3500, 3550, 5000, 5050]) add('scoreAgentLoad', [mem, { ...procs, agentTreeMemoryMB: footprint }]);
  add('scoreAgentLoad', [{ ...mem, freeMB: 100, usedPct: 99 }, { ...procs, claudeCount: 5, agentTreeMemoryMB: 6000 }]);
  add('scoreAgentLoad', [mem, { ...procs, status: 'unknown' }]);
  add('scoreAgentLoad', [mem, { ...procs, claudeCount: 0.5 }]);
  for (const pct of [70, 71, 80, 81, 85, 86, 90, 91, 95, 96]) add('scoreMemory', [{ ...mem, usedPct: pct }]);
  for (const free of [0, 9, 10, 19, 20, 49, 50, 99, 100]) add('scoreDisk', [{ ...disk, freeGB: free }]);
  add('scoreMemory', [{ ...mem, totalMB: 0 }]);
  add('scoreDisk', [{ ...disk, freeGB: 2000 }]);
  for (const uptime of [72, 73, 168, 169, -1]) add('scoreSystem', [disk, mem, uptime]);
  for (const score of [null, -1, 0, 39, 40, 94, 95, 100, 101]) add('grade', [score]);
  const row = (pid, parentPid, name, command, memMB) => ({ pid, parentPid, name, command, memMB });
  const processes = [row(1, 0, 'codex.exe', 'codex', 100), row(2, 1, 'node.exe', 'node mcp-server.js --token fixture-one', 10),
    row(3, 2, 'node.exe', 'node mcp-server.js --token fixture-one', 10), row(4, 1, 'node.exe', 'node mcp-server.js --token fixture-two', 10),
    row(5, 0, 'node_repl.exe', 'openai codex', 10), row(6, 0, 'notclaude.exe', 'notclaude', 10)];
  add('processFixture', [processes]);
  add('processFixture', [[row(1, 0, 'node_repl.exe', null, 10)]]);
  add('processFixture', [[row(4, 0, 'System', null, 0)]]);
  const cwd = mkdtempSync(join(tmpdir(), 'pp-parity-'));
  try {
    const snapshot = { mem, cpu, disk, gpu: null, procs,
      git: { isRepo: false, branch: '', repoSizeMB: 0, uncommittedFiles: 0, untrackedFiles: 0, hasLockFiles: false, recentCommitStyle: 'unknown' },
      secrets: { envFilesFound: [], envFilesGitignored: true, suspiciousFiles: [] }, temp: { tempDir: 'fixture', fileCount: 0 }, uptime: { uptimeHours: 1 }, crashes };
    const audits = [snapshot, { ...snapshot, cpu: { ...cpu, loadPct: 100 } },
      { ...snapshot, crashes: { ...crashes, totalCrashes: 30, topAppCrashes: 30, topApp: 'fixture', apps: [{ name: 'fixture', count: 30 }] } },
      { ...snapshot, procs: { ...procs, status: 'unknown' } }, { ...snapshot, crashes: { ...crashes, status: 'unsupported' } }];
    for (const s of audits) add('audit', [s]);
    const script = `import json,sys,types\nsys.path.insert(0,sys.argv[1])\nmock=types.ModuleType('psutil');mock.Error=mock.AccessDenied=mock.NoSuchProcess=Exception;sys.modules['psutil']=mock\nimport pp_scoring as s, pp_monitor as m\nnames={'scoreCpuGpu':'score_cpu_gpu','scoreProcesses':'score_processes','scoreAgentLoad':'score_agent_load','scoreMemory':'score_memory','scoreDisk':'score_disk','scoreSystem':'score_system','grade':'grade'}\ndef run(c):\n if c['fn']=='processFixture': return m._process_metrics(*c['args'])\n if c['fn']=='audit':\n  p=c['args'][0]\n  return s.run_audit({'memory':p['mem'],'cpu':p['cpu'],'disk':p['disk'],'gpu':p['gpu'],'processes':p['procs'],'crashes':p['crashes'],'git':p['git'],'secrets':p['secrets'],'temp':p['temp'],'uptime':p['uptime'],'knowledge':{'found':0,'total':4}})\n return getattr(s,names[c['fn']])(*c['args'])\nprint(json.dumps([run(c) for c in json.load(sys.stdin)]))`;
    const child = spawnSync(process.env.PYTHON || 'python', ['-B', '-c', script, join(root, 'tray')], { input: JSON.stringify(cases), encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr);
    const py = JSON.parse(child.stdout);
    const pick = value => typeof value === 'string' ? value : { score: value.score, status: value.status };
    cases.forEach((c, i) => {
      if (c.fn === 'processFixture') {
        const os = require('node:os'), child = require('node:child_process'), { syncBuiltinESMExports } = require('node:module');
        const platform = os.platform, exec = child.execFileSync;
        let value;
        try {
          os.platform = () => 'win32';
          child.execFileSync = () => JSON.stringify(c.args[0].map(p => ({ ProcessId: p.pid, ParentProcessId: p.parentPid, Name: p.name, CommandLine: p.command, WorkingSetSize: p.memMB * 1024 * 1024 })));
          syncBuiltinESMExports(); value = probes.probeProcesses();
        } finally { os.platform = platform; child.execFileSync = exec; syncBuiltinESMExports(); }
        const fields = p => Object.fromEntries(['status', 'totalProcesses', 'nodeCount', 'claudeCount', 'cursorCount', 'codexCount', 'codexTaskRuntimeCount', 'mcpCount', 'mcpProcessCount', 'mcpMemoryMB', 'duplicateMcpProcesses', 'agentTreeMemoryMB'].map(k => [k, p[k]]));
        assert.deepEqual(fields(value), fields(py[i]), `collector ${i}`);
        if (c.args[0].length === 6) { assert.equal(value.duplicateMcpProcesses, 1); assert.equal(value.agentTreeMemoryMB, 130); }
        return;
      }
      const value = c.fn === 'audit' ? audit.scoreAuditSnapshot(c.args[0], { cwd }) : ts[c.fn](...c.args);
      if (c.fn === 'audit') {
        const fields = a => ({ total: a.totalScore, raw: a.rawScore, grade: a.grade, gates: a.gates.map(pick) });
        assert.deepEqual(fields(value), fields(py[i]), `audit ${i}`);
      } else {
        assert.deepEqual(pick(value), pick(py[i]), `${c.fn} ${i}: ${JSON.stringify(c.args)}`);
        if (c.expected) assert.deepEqual(pick(value), c.expected);
      }
    });
    console.log(JSON.stringify({ parityCases: cases.length, auditCases: audits.length, collectorCases: 3, mode: compiled ? 'compiled' : 'source', measuredSaturationScore: 2, unknownScore: null, physicalCalibration: false }));
  } finally { rmdirSync(cwd); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
