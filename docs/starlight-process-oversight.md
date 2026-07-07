# Starlight Process Oversight

Status: initial operating design
Related work items: `ops-jarvisops-desktop-control-plane`, `ops-agent-run-ledger-calendar`

## Purpose

Peak Performance is the local sensor and reasoning layer for machine process health. It should help Starlight know what is running, why it likely exists, how much memory it takes, and what the safe reduction path is.

It is not the execution authority. Process termination, dev-server shutdown, local model shutdown, and agent interruption still require the right supervisor path and, for ambiguous/user-owned work, explicit confirmation.

## Orchestration Model

| Layer | Responsibility |
|---|---|
| PP | Measure RAM/disk/process pressure, classify processes, redact commands, emit snapshots and process start/stop events. |
| Starlight Process Oversight Queen | Read PP process ledgers, maintain a narrative of what started and why, propose reductions, queue bounded follow-up tasks. |
| SO | Owns cross-repo operating doctrine, cost/risk gates, and routing between PP, JarvisOps, SDS, and agent ledgers. |
| JarvisOps Desktop | Visual control plane: manifests, support packets, action approvals, and operator UI. |
| Starlight Agent Run Ledger | Correlates process events with agent runs, PRs, tokens, recaps, and calendar projections. |
| SDS | Owns local dev-server lifecycle, TTL, review URLs, duplicate port prevention, and server shutdown. |

Best-practice orchestration doctrine lives at:

```text
C:/Users/frank/starlight/repos/starlight-agent-config/core/policies/starlight-agent-orchestration-best-practices-2026-07-04.md
```

That policy is the routing authority for choosing a script, skill, workflow, router, subagent set, or full swarm. PP supplies the machine pressure gate and process evidence; it does not decide that more agents are automatically better.

## Current Data Contract

`pp inspect --json` returns the full redacted process map:

- PID and parent PID
- process name
- memory in MB
- role: `ai-agent`, `local-model`, `mcp`, `dev-server`, `build`, `node`, `browser`, `editor`, `shell`, `system`, or `other`
- protected flag
- protection reason when guarded
- reasoning
- action hint
- redacted command line

`pp watch` appends JSONL start/stop events to:

```text
~/.starlight/process-ledger/process-events.jsonl
```

Each event includes the SO lane, the provisional `starlight-process-oversight-queen`, and related ledger work items.

`pp maintain` returns the current maintenance posture and swarm posture:

- `green`: machine can expand work.
- `watch`: proceed, but avoid casual extra load.
- `constrain`: pause new swarms and inspect before adding work.
- `maintenance`: drain current work and run supervised cleanup.
- `restart-soon`: preserve state and plan a restart after handoff.

Action permissions are governed by `docs/starlight-agent-action-policy.md`.

`pp overnight` returns a non-destructive overnight swarm guard plan. It combines the current maintenance plan, process policy, bounded watch command, SDS guidance, Queen instructions, no-touch classes, and review-before-stop classes. Use `pp overnight --write` before leaving swarms running for a long unattended window.

## Reduction Rubric

Protected by default:

- Claude, Codex, Cursor, Antigravity, and active coding-agent workspaces.
- LM Studio, llmster, Ollama, and other local model runtimes.
- MCP/tool servers and agent bridges.
- Editor processes.
- Supervised dev servers; route through SDS.
- Windows system services, Defender, Memory Compression, shell host, desktop window manager, and core OS processes.

Reviewable, never automatic:

- Build and generation jobs.
- Generic node processes.
- Browser processes.
- Shells with child jobs.
- Unknown processes.

Reduction requires:

1. process receipt;
2. repo/path or owner inference when possible;
3. reason it is safe to stop;
4. before/after RAM or disk;
5. recovery command;
6. human confirmation unless the process is already covered by a safe supervisor action.

## Startup Coverage

PP cannot know intent perfectly from OS process data alone. The best operating model is layered:

1. Agent launch wrappers emit run receipts.
2. SDS emits dev-server receipts.
3. PP `watch` emits process start/stop events.
4. JarvisOps merges those into a manifest and action UI.
5. The Process Oversight Queen summarizes the chain of reasoning and suggests bounded cleanup tasks.

This keeps the system granular without turning PP into an unsafe always-on killer.

## Predictive Loop

Before launching heavy agent work:

```powershell
pp maintain
```

Before leaving swarms running overnight:

```powershell
pp overnight --write
```

If the swarm posture is `pause-new-swarms` or `drain-and-handoff`, the Queen should stop adding workers and request handoffs from active agents. If cleanup is needed, use the owner-specific path:

- PP for safe cache/temp fixes.
- SDS for local dev servers.
- JarvisOps for approved local actions and support packets.
- Human approval for process termination, restart, external mutations, and secrets.

## Topology Guidance

When the machine posture allows parallel work, choose the smallest topology that matches the task:

- single skill for focused work with one context owner;
- workflow for ordered steps with explicit checkpoints;
- router for classification and specialist dispatch;
- mesh for research, audits, and multi-perspective review;
- hierarchical for implementation with lead/worker/reviewer roles;
- star for QA/security/design/docs review around one artifact;
- ring for intake-to-release pipelines.

If `pp maintain` returns `pause-new-swarms` or `drain-and-handoff`, do not start new mesh, star, hierarchical, ring, or adaptive swarms. Finish current work and preserve handoffs.

## Future Work

- Add repo/cwd inference for process rows where Windows exposes enough ancestry.
- Add a JarvisOps adapter that imports PP process-ledger JSONL.
- Add an SDS bridge so dev-server rows link to TTL and review URL state.
- Add topology and run-id fields to PP/JarvisOps operator packets.
- Add optional Windows process-creation event subscription only after a cost/risk review; default remains bounded polling.
- Add a weekly Queen report that summarizes new recurring processes, memory trends, reductions proposed, reductions accepted, and avoided unsafe actions.
