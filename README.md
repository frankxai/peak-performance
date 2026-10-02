# Peak Performance

## Preflight storage and evidence

Preflight checks available bytes on the system, working-directory and temporary
filesystems. The strictest volume applies: below 4% is freeze with operator
escalation; below 8% holds disk growth; 8–15% permits one interactive build with
cleanup and reports explicit prohibitions on installs, worktree additions, build fanout, media/model
and unattended work. At least 15% follows the other resource budgets. Thresholds
use exact bytes, without rounding a displayed percentage.

Budgeted work requires fresh, measured memory, disk, CPU, process and crash evidence. Failed
or partial probes hold admission. Windows crashes use structured event data;
POSIX crash collection is currently unsupported and therefore holds budgeted
work. Missing command lines for agent-capable runtimes also hold admission,
including access denied for elevated or other-session processes; incomplete
visibility cannot establish capacity. Maintenance reports constrain/pause for
unknown probes instead of advertising expansion. Zero-reserve interactive reading remains available above freeze. An
interactive or review-lite label never grants disk growth. Select the actual
workload and recheck storage before every growing step; preflight is a snapshot,
not a reservation or ongoing supervisor.

Filesystem reads run in a bounded child. Windows network/device paths and mapped
network drives are rejected; mount resolution is checked before statfs. This
does not establish a sandbox against path races or POSIX remote mounts. The
preflight collects memory, CPU, disk, process, uptime and crash evidence plus
the three storage scopes. It skips GPU, Git, secret, temp-file and knowledge
audits. The admission snapshot does not supply a Ten Gate score; full audit and
maintenance still collect all gates. Process classification coverage, physical
calibration, irreversible cleanup and installed client acceptance still need
separate verification before main integration.

The storage API is documented in [Node 18 fs.statfsSync](https://nodejs.org/docs/latest-v18.x/api/fs.html#fsstatfssyncpath-options).
Subprocess bounds follow [Node child_process](https://nodejs.org/docs/latest-v18.x/api/child_process.html#child_processexecfilesyncfile-args-options).
Windows drive types follow [Win32_LogicalDisk](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-logicaldisk).

**System health auditor for AI-powered development machines.**

Your machine runs Claude, Cursor, Codex, and dozens of Node processes simultaneously. Peak Performance monitors everything and tells you — in one number — whether your system can handle more or needs relief.

```
$ pp audit

  Peak Performance Audit
  2026-04-04T01:54:03Z | DESKTOP-1B4ICID | win32

  Score: 80/100 | Grade: A-

  Foundation (Lyssandria)       ██████░░░░  6/10  28GB free / 475GB (94% used)
  Flow (Leyla)                  ██████░░░░  6/10  2.5GB free / 16GB (85% used)
  Fire (Draconia)               ██████████ 10/10  i7-9750H | GTX 1650 62°C
  Heart (Maylinn)               ████░░░░░░  4/10  10 Claude, 80 node (8:1 ratio)
  Voice (Alera)                 ██████████ 10/10  main | 5 uncommitted
  Sight (Lyria)                 ██████████ 10/10  No secrets exposed
  Crown (Aiyami)                ████████░░  8/10  17K temp files
  Starweave (Elara)             ██████████ 10/10  4/4 knowledge indicators
  Unity (Ino)                   ██████████  9/10  10 agents using ~4.5GB
  Source (Shinkami)              ████████░░  8/10  Uptime: 12h | stable

  Recommendations
  !!! Only 28GB disk free
      $ npm cache clean --force
   !! 10 Claude instances — recommend max 4 for 16GB RAM
```

## Why This Exists

Every AI coding agent (Claude Code, Cursor, Codex, Windsurf, Devin) spawns processes, eats RAM, bloats disk. None of them audit the machine they're running on. Peak Performance is that missing layer — it tells you when your system is healthy and when it's about to crash.

## Install

### CLI (TypeScript)

```bash
# Build from a source checkout (Node 24.16.0 and pnpm 11.5.0)
git clone https://github.com/frankxai/peak-performance
cd peak-performance
pnpm install --frozen-lockfile
pnpm build
node dist/cli.js audit
```

Package metadata names `@arcanea/peak-performance`. npm/npx installation requires
a published version; anonymous registry reads for this name and `@arcanea/pp`
returned 404 at 2026-10-01T22:18Z (UTC). The commands above use your local source build.

### System Tray (Python)

```bash
cd tray/
pip install -e .
pp-tray
```

A colored circle appears in your system tray showing your score. Green = healthy. Yellow = attention needed. Red = fix now. Refreshes every 60 seconds.

### MCP Server (any AI agent)

```bash
# Claude Code, after building the source checkout
claude mcp add peak-performance -- node /absolute/path/to/peak-performance/dist/cli.js --mcp

# Or in .mcp.json
{
  "peak-performance": {
    "command": "node",
    "args": ["/absolute/path/to/peak-performance/dist/cli.js", "--mcp"]
  }
}
```

Exposes four tools: `pp_audit`, `pp_preflight`, `pp_trend`, `pp_fix`.

Replace the example path with the absolute path to your built CLI. `pp --mcp`
and `pp mcp` launch the same stdio adapter. The launcher is checked with emitted
code; package publication and actual client registration remain release gates.
Malformed request envelopes and argument containers receive protocol errors;
invalid `cwd` and `dryRun` types receive tool errors. An explicit `cwd` must be an
existing fully qualified directory, including when using the server's default
directory. Every tool call validates both the server directory and any explicit
target before checking either on disk; an explicit target cannot bypass an
unsupported server directory, which disables all four tools. Windows requires a
drive letter followed by a slash or backslash;
UNC shares, device/extended namespaces and paths relative to the current drive's
root are rejected before filesystem access. POSIX paths beginning with two or
more slashes are also rejected before normalization. It never silently substitutes
another directory. This spelling check is not a filesystem sandbox: mapped drives,
network mounts and junctions can still redirect an otherwise accepted path.
Use a trusted local server directory and audit target; resolving those filesystem
and permission boundaries remains a gate before actual client adoption.
The Windows Git-size probe encodes paths before using them as PowerShell data.
Notifications never execute
tools. Unexpected execution failures return a generic correlated error.
Messages are limited to 65,536 UTF-16 code units; oversized lines are drained
through their newline so subsequent requests can still be processed.
Each stdio message requires a trailing newline. Invalid workload still returns
the existing protocol error after directory validation succeeds; an unsupported
server or target directory is rejected first. Invalid `cwd` and other tool choices
use tool errors.
Audit history is stored under the server's working directory even with another
audit target; `pp_fix` and `pp_trend` operate in server scope and do not select
their target using `cwd`, although any supplied `cwd` must still pass validation.
Destructive annotations are hints, and older clients
may ignore them; the `pp_fix` description also states its deletion behavior.

## Source verification

The source checks workflow verifies each candidate head on Linux and Windows with
Node 24.16.0 and pnpm 11.5.0: frozen dependencies, source tests, typecheck, build,
emitted tests, the dependency-free admission fixture, and compiled CLI/MCP tests.
Matrix jobs run one at a time, including draft pull requests.
The emitted tests and compiled contracts also run on Node 18.20.8 to check the
advertised minimum major version. Node 18 is end of life; use Node 24 for new
source builds. This compatibility check does not certify every Node 18 patch.

Run the compiled contract checks after `pnpm build`:

```bash
node --test scripts/test-preflight-compiled.cjs
```

These tests use real emitted code and child-process stdio with synthetic machine
metrics; audit/remediation are replaced with functions that refuse execution.
They verify reserve decisions, CLI exit codes, launcher dispatch and malformed
input recovery. They do
not certify installed runtime adoption or live machine sensor accuracy.

## Commands

| Command | Description |
|---------|-------------|
| `pp audit` | Full system audit with all 10 gates |
| `pp audit --json` | JSON output for piping |
| `pp audit --md` | Markdown output for reports |
| `pp audit --plain` | Generic names instead of Arcanea gates |
| `pp trend [N]` | Show last N score entries with delta |
| `pp fix` | Run auto-fixable repairs (npm cache, temp files) |
| `pp compact` | One-line status: `PP 80/A- 3WARN` |
| `pp inspect [--all|--json]` | Process census with memory, command, role, reasoning, and protected-process classification |
| `pp watch [--seconds N] [--interval N] [--log path]` | Bounded process start/stop ledger for Starlight/JarvisOps ingestion |
| `pp maintain [--json]` | Predict maintenance posture, swarm posture, and safe action paths |
| `pp preflight --workload <type> [--reserve-gb N] [--json]` | Admit, bound, or hold CPU/RAM-intensive work against live machine headroom |
| `pp overnight [--write|--json|--md]` | Build an overnight swarm guard plan with Queen/SDS/process instructions |
| `pp snapshot [notes]` | Screenshot both screens + audit + agent census |

## The Ten Gates

Peak Performance scores your system across 10 dimensions. Each gate is scored 0-10, totaling 0-100.

| Gate | What It Measures | Arcanea Name |
|------|-----------------|--------------|
| Disk Health | Free space, usage percentage | Foundation (Lyssandria) |
| Memory | RAM usage, free MB | Flow (Leyla) |
| CPU / GPU | Temperature, utilization, driver status | Fire (Draconia) |
| Process Health | Agent count, node:agent ratio, total processes | Heart (Maylinn) |
| Git Hygiene | Uncommitted files, repo size, commit style | Voice (Alera) |
| Security | .env gitignored, no secrets in tracked files | Sight (Lyria) |
| Workspace | Temp file count, build cache size | Crown (Aiyami) |
| Knowledge | CLAUDE.md, docs, memory files present | Starweave (Elara) |
| Agent Load | Combined AI agent memory pressure | Unity (Ino) |
| System | Overall health composite, uptime | Source (Shinkami) |

Use `--plain` to see generic names. Use default for Arcanea-themed output.

## Grading

| Score | Grade | Meaning |
|-------|-------|---------|
| 95-100 | S | Perfect — system is fully optimized |
| 85-94 | A | Excellent — minor optimizations possible |
| 70-84 | B | Good — some gates need attention |
| 55-69 | C | Fair — multiple issues affecting capacity |
| 40-54 | D | Poor — system struggling under load |
| 0-39 | F | Critical — immediate action needed |

## Agent Detection

Peak Performance automatically identifies running AI agents:

- **Claude Code** — process: `claude`
- **Cursor** — process: `cursor`
- **Codex CLI** — process: `codex`
- **VS Code** — process: `code.exe`
- **Windsurf** — process: `windsurf`

Each agent's memory footprint is estimated and factored into the Agent Load gate.

## System Tray App

The Python tray app (`tray/`) provides always-on monitoring:

- Colored circle icon with your score number (green/cyan/yellow/red)
- Tooltip with RAM, disk, and Claude instance count
- Right-click menu with gate scores submenu
- Full Audit, Snapshot, Fix, Trend actions
- Arcanea/Plain theme toggle
- Toast notification when score drops below 50
- Writes to same `.pp/history.json` as CLI — shared trend data

### Tray Icon by Grade

| S | A- | B+ | C+ | D | F |
|---|----|----|----|----|---|
| Green | Green | Cyan | Yellow | Orange | Red |

## Auto-Fix

`pp fix` can remove cache and temporary files:

- `npm cache clean --force` — frees GB of cached packages
- Clean temp files older than 3 days
- More fixes coming (git gc, cache cleanup, and supervised maintenance tasks)

Before/after score comparison is shown automatically.
Deletion is not reversible. The MCP `pp_fix` tool advertises destructive hints;
use `dryRun: true` to inspect recommendations before requesting remediation.

`pp fix` does not kill user-owned processes. Use `pp inspect` first, then write a process action receipt before terminating anything ambiguous or user-facing.

## Process Inspection

`pp inspect` lists process rows with PID, parent PID, memory, role, redacted command line, reasoning, action hint, and a guard label. AI agents, local model runtimes, MCP/tool servers, editors, and supervised dev servers are treated as protected by default.

Use this for RAM triage before taking action:

```bash
pp inspect
pp inspect --all
pp inspect --json
```

Process cleanup policy lives in `docs/process-action-receipts.md`.

## Process Ledger

`pp watch` samples process state for a bounded window and appends start/stop events to a local JSONL ledger. This is meant for the Starlight/JarvisOps control plane and Queen-style orchestration to understand what started, why it was classified that way, and what the safe action path is.

```bash
pp watch --seconds 60 --interval 2
pp watch --seconds 300 --log "$HOME/.starlight/process-ledger/process-events.jsonl"
```

Default ledger path:

```text
~/.starlight/process-ledger/process-events.jsonl
```

The watcher is bounded by default and is not an always-on background service.

## Predictive Maintenance

`pp maintain` turns the audit and process map into an operating posture:

- maintenance posture: `green`, `watch`, `constrain`, `maintenance`, or `restart-soon`
- swarm posture: `expand`, `steady`, `pause-new-swarms`, or `drain-and-handoff`
- reasons for the posture
- action list with owner, permission type, command hint, risk, and receipt requirement

```bash
pp maintain
pp maintain --json
```

### Workload preflight

Run preflight before builds, browser QA, local models, new swarms, or unattended work:

```bash
pp preflight --workload build
pp preflight --workload review-lite --json
pp preflight --workload browser-qa --json
pp preflight --workload local-model --reserve-gb 16
pp preflight --workload swarm
pp preflight --workload overnight
```

The decision is `allow`, `bounded`, or `hold`. RAM-gated work requires a 4GB operating-system and application safety floor in addition to the workload reserve. `review-lite` reserves 2GB for one frozen-diff, strict-MCP checker. `hold` exits with code 2 for headroom shortfalls, invalid reserve/RAM evidence, restart posture, or critical conditions affecting heavy/unattended work. Preflight is read-only: it never starts, stops, schedules, or cleans processes.

The command predicts and routes work; it does not stop processes, restart the machine, mutate cloud services, or launch new agents.

Zero-reserve `interactive` work remains available for normal reading, editing, and small tests under RAM pressure. Its JSON reports `budget.ramGated: false` and `requiredFreeMB: 0`; `safetyFloorMB` remains the policy floor for gated work. Passing a positive `--reserve-gb` requires the reserve plus the 4GB floor for `interactive` and requires an owned workload receipt and cleanup. Repeated flags use the largest reserve, and any invalid value holds. Invalid RAM evidence holds budgeted work. Fractional MB reserves round up. Invalid numeric budget fields serialize as `null`; consumers must honor the `hold` decision and hard blocks.

Reserve flags accept plain decimal GB values. Scientific notation, non-decimal forms, and positive values that underflow to zero hold. A reserve changes the RAM budget only; choose the actual workload for posture, CPU, and timeout rules. Use `review-lite` for an independent checker and `build` for builds.

The admission and MCP dispatch tests were verified without installing dependencies or invoking machine probes on Node 24.16.0:

```bash
node --experimental-vm-modules scripts/test-preflight-native.cjs
```

This focused runner uses Node's experimental [TypeScript stripping API](https://nodejs.org/api/module.html#modulestriptypescripttypescode-options), introduced in Node 22.13. Older supported API versions still need verification. It runs the actual admission source and test file with a sensor stub that throws if called. The MCP protocol case loads the actual adapter and admission source with fixture machine readings and isolated fake stdio. Other tool handlers throw if called. It does not typecheck or replace the normal project test/build commands.

## Overnight Guard

`pp overnight` builds a non-destructive overnight operating packet for Starlight swarms. It combines the maintenance posture, protected process classes, reviewable process candidates, SDS guidance, process-watch command, and Queen/agent instructions into one guard plan.

```bash
pp overnight
pp overnight --write
pp overnight --json
```

`--write` saves JSON and Markdown reports under:

```text
~/.starlight/overnight-guard/
```

The overnight guard does not kill processes, start background daemons, launch agents, or mutate cloud services. It is an operator packet for the Starlight Queen, Command Center, JarvisOps, SDS, and future agents.

## Snapshot

`pp snapshot` captures a full system state archive:

- Screenshots of all connected monitors
- Full PP audit as JSON
- Agent census (which AI tools are running, how many instances)
- Saves to `docs/ops/snapshots/{date}/`

Useful for tracking your setup over time or debugging crashes after the fact.

## Architecture

```
@arcanea/peak-performance
├── src/                          # TypeScript CLI + MCP server
│   ├── core/
│   │   ├── probes.ts             # 8 OS-agnostic system probes
│   │   ├── audit.ts              # Orchestrates probes → scoring → result
│   │   └── snapshot.ts           # Screenshot + metrics archive
│   ├── gates/
│   │   └── scoring.ts            # Ten Gate scoring engine
│   ├── agents/
│   │   └── detector.ts           # AI agent process detection
│   ├── history/
│   │   └── tracker.ts            # JSON trend tracking
│   ├── fixes/
│   │   └── autofix.ts            # Safe auto-repair recipes
│   ├── format/
│   │   └── terminal.ts           # 5 output formats
│   ├── integrations/
│   │   └── mcp-server/index.ts   # MCP stdio server
│   ├── cli.ts                    # CLI entry point
│   ├── index.ts                  # Library exports
│   └── types.ts                  # TypeScript interfaces
├── tray/                         # Python system tray app
│   ├── pp_tray.py                # Main tray application
│   ├── pp_monitor.py             # System probes (Python)
│   ├── pp_scoring.py             # Gate scoring (Python)
│   ├── pp_config.py              # Configuration
│   ├── requirements.txt          # pystray, psutil, Pillow
│   └── setup.py                  # pip installable
├── package.json
└── tsconfig.json
```

## Platform Support

| Platform | CLI | Tray | MCP |
|----------|-----|------|-----|
| Windows 11 | Source checks pass | Available; runtime unverified here | Emitted stdio checks |
| macOS | Runtime verification pending | Partial | Runtime verification pending |
| Linux | Source checks pass | Partial | Emitted stdio checks |

Windows is the primary target — that's where AI agent density is highest.

## Use as Library

```typescript
import { runAudit, formatMarkdown, TrendTracker } from '@arcanea/peak-performance';

const result = runAudit({ cwd: process.cwd() });
console.log(result.totalScore, result.grade);
console.log(formatMarkdown(result));
```

## History & Trends

CPU, process, crash and capacity evidence can be unknown. An incomplete scored
snapshot now returns `totalScore: null`, `rawScore: null`, grade `UNKNOWN`, and
`score: null` on affected gates. Displays show `Unknown`; JSON and history keep
the nulls. Callers must check for null before arithmetic. Trend deltas require
two numerical readings, and best/worst comparisons exclude unknown readings.
Maintenance labels failed capacity explicitly and avoids recommending cleanup
from an invalid disk reading. Reserved preflight work requires fresh measured
memory, disk, CPU, process and crash evidence, including the capacity fields in
`probeEvidence`; older incomplete plans hold until refreshed.

The tray uses raw CPU counter deltas and the same CPU, process and agent scoring
thresholds as TypeScript. On Windows, system time already includes interrupt
time, so both probes count it once. See the
[libuv Windows collector](https://github.com/libuv/libuv/blob/v1.51.0/src/win/util.c)
and [psutil CPU counters](https://psutil.io/api/#psutil.cpu_times).
Common synthetic evidence verifies scorer parity and unknown propagation;
physical sampling calibration and an installed tray session remain unverified.
POSIX samples use Node's user/nice/system/idle/IRQ counter coverage; Linux
iowait, softirq and steal coverage remains outside this comparison.

Tray process metrics include task runtimes, MCP leaves and duplicate signatures,
and observed agent-tree memory. Command lines stay transient inside the Python
probe and are redacted before duplicate signatures are counted. Denied runtime
commands, incomplete rows and failed enumeration remain
unknown. Windows crash collection uses structured Application Error events with
an eight-second deadline and a hidden child window; POSIX crash evidence remains
unsupported. Unsupported POSIX crashes make the total unknown and hold reserved
work, even when process counts are measured. Unknown tray cycles show `?` and
emit no numerical score alert; a subsequent measured low score alerts once.

The draft source checks exercise both scorers, isolated collectors, nullable
history and display consumers on Ubuntu and Windows. Full main readiness remains
blocked on installed/client adoption, remaining classifier coverage, safe cleanup
and caller lifecycle, history durability, and probe cost. The shared launcher and
installed distribution remain unchanged.
CI pins Python 3.12.10 through the official
[setup-python action](https://github.com/actions/setup-python) for the isolated
fixtures. Real psutil, pystray and Pillow installation remains a separate check.
The isolated Windows checks also execute the Python crash collector against
the host event log. Common collector comparisons cover three supplied process
fixtures; denied working-set visibility is treated more strictly in Python.
Preflight `current` and overnight process summaries retain raw observations.
Admission decisions, hard blocks and maintenance `probeEvidence` qualify their
validity; consumers must check these before using raw metrics.

Every audit (from CLI or tray) writes to `.pp/history.json`. View trends:

```bash
$ pp trend 5

  Trend History
  2026-04-03 21:37  88/100 A
  2026-04-03 21:38  71/100 B
  2026-04-04 00:14  75/100 B+
  2026-04-04 01:46  82/100 A-
  2026-04-04 01:54  80/100 A-

  ↑ 5 points (improving) since last audit
```

## Contributing

```bash
git clone https://github.com/frankxai/peak-performance
cd peak-performance

# TypeScript CLI
pnpm install --frozen-lockfile
pnpm pp audit

# Python tray
cd tray
pip install -e .
pp-tray
```

## License

MIT

---

Built by [FrankX](https://github.com/frankxai) with [Arcanea](https://arcanea.ai). The Ten Gate framework maps to the Arcanea mythology — each gate is guarded by a deity who governs that domain of creative capacity.
