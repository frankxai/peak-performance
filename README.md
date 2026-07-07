# Peak Performance

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
# Run instantly (no install)
npx @arcanea/pp audit

# Or install globally
npm install -g @arcanea/peak-performance
pp audit
```

### System Tray (Python)

```bash
cd tray/
pip install -e .
pp-tray
```

A colored circle appears in your system tray showing your score. Green = healthy. Yellow = attention needed. Red = fix now. Refreshes every 60 seconds.

### MCP Server (any AI agent)

```bash
# Claude Code
claude mcp add peak-performance -- npx @arcanea/pp --mcp

# Or in .mcp.json
{
  "peak-performance": {
    "command": "npx",
    "args": ["@arcanea/pp", "--mcp"]
  }
}
```

Exposes three tools: `pp_audit`, `pp_trend`, `pp_fix`.

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

`pp fix` runs safe, reversible repairs:

- `npm cache clean --force` — frees GB of cached packages
- Clean temp files older than 3 days
- More fixes coming (git gc, cache cleanup, and supervised maintenance tasks)

Before/after score comparison is shown automatically.

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

The command predicts and routes work; it does not stop processes, restart the machine, mutate cloud services, or launch new agents.

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
| Windows 11 | Full | Full | Full |
| macOS | Full (planned) | Partial | Full |
| Linux | Full (planned) | Partial | Full |

Windows is the primary target — that's where AI agent density is highest.

## Use as Library

```typescript
import { runAudit, formatMarkdown, TrendTracker } from '@arcanea/peak-performance';

const result = runAudit({ cwd: process.cwd() });
console.log(result.totalScore, result.grade);
console.log(formatMarkdown(result));
```

## History & Trends

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
npm install
npx tsx src/cli.ts audit

# Python tray
cd tray
pip install -e .
pp-tray
```

## License

MIT

---

Built by [FrankX](https://github.com/frankxai) with [Arcanea](https://arcanea.ai). The Ten Gate framework maps to the Arcanea mythology — each gate is guarded by a deity who governs that domain of creative capacity.
