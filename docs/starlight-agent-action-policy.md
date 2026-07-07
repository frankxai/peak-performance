# Starlight Agent Action Policy

Status: initial operating policy
Related work items: `ops-jarvisops-desktop-control-plane`, `ops-agent-run-ledger-calendar`

## Purpose

Starlight should create massive action without losing machine control. Agents can move quickly when the action class is clear, observable, reversible, and routed to the right supervisor.

This policy defines what agents can do, what they cannot do, and how PP, SDS, JarvisOps, the Starlight Queen, and the run ledger interconnect.

## Action Classes

| Class | Agents may do? | Receipt | Approval | Examples |
|---|---:|---:|---:|---|
| Observe | Yes | Optional | No | `pp audit`, `pp inspect --json`, git status, read docs. |
| Bounded sample | Yes | Yes | No | `pp watch --seconds 60`, local metric snapshot. |
| Safe local fix | Yes when tool marks safe | Tool log | No | `pp fix` cache/temp cleanup only. |
| Supervisor action | Yes through supervisor | Supervisor state | Sometimes | `sds reap`, `sds stop -Port`, queue bounded Queen job. |
| Reviewable process reduction | Propose only | Required | Yes | Stop build/generator/node/shell process. |
| Agent/model interruption | Propose only | Required | Yes | Stop Claude/Codex/Antigravity/LM Studio/Ollama. |
| Destructive local change | Propose only | Required | Explicit | Delete repos, reset git, discard generated work. |
| External mutation | Propose only | Decision record | Explicit | Railway/Vercel/DNS/billing/secrets/connectors. |

## Agent Capability Rules

Agents may:

- inspect process, disk, memory, git, and dev-server state;
- run bounded watches;
- write local receipts and decision records;
- propose a cleanup/restart plan;
- queue bounded Starlight Queen tasks;
- run safe local validation and build checks;
- stop supervised dev servers through SDS when policy allows it.

Agents must not:

- kill user-owned processes without confirmation;
- kill local model runtimes because they are large;
- interrupt active Claude, Codex, Antigravity, Cursor, editor, or MCP/tooling sessions without coordination;
- launch unbounded swarms when PP says `pause-new-swarms` or `drain-and-handoff`;
- install new swarm/MCP/orchestration tooling just because it is interesting; use the work-ledger pre-decision gate first;
- start duplicate localhost servers outside SDS;
- perform Railway, Vercel, DNS, billing, connector, or secret mutations without explicit approval;
- erase generated work without documenting recovery.

## Massive Action Routing

Use this route before spawning agents:

1. Run `pp maintain`.
2. If swarm posture is `expand`, queue bounded work normally.
3. If `steady`, allow only high-value bounded work and prefer one agent per repo.
4. If `pause-new-swarms`, finish current work, avoid new parallelism, and run `pp inspect --all --json`.
5. If `drain-and-handoff`, stop launching new work, ask active agents for handoff, run `pp prep`, then consider restart/cleanup.

Then choose the smallest sufficient orchestration pattern from the Starlight best-practice policy:

```text
C:/Users/frank/starlight/repos/starlight-agent-config/core/policies/starlight-agent-orchestration-best-practices-2026-07-04.md
```

Default ladder: function/script -> skill -> workflow -> router -> subagents -> swarm -> human approval. A swarm must have a work item, topology, stopping condition, and evidence path.

## Maintenance Prediction

`pp maintain` is the default preflight before:

- starting a large local model;
- launching more than one coding agent;
- running a dev-server-heavy visual QA loop;
- starting long build/generation work;
- leaving the machine unattended with active agents;
- deciding whether to restart.

`pp overnight --write` is the default handoff packet before leaving swarms running overnight. It does not authorize cleanup by itself; it records the current posture, guardrails, SDS guidance, no-touch classes, and review-before-stop classes.

## Queen Integration

The provisional Starlight Process Oversight Queen owns:

- reading PP maintenance plans and process-ledger events;
- deciding whether the next hour is `expand`, `steady`, `pause`, or `drain`;
- creating queue tasks only when the machine posture allows it;
- asking agents to summarize state before restart;
- sending ambiguous cleanup to a human approval lane.

The Queen does not directly kill processes. It routes actions to PP, SDS, JarvisOps, or a human confirmation step.

## Recovery Standard

Every reviewable reduction needs:

- process tree;
- command line with secrets redacted;
- inferred repo/purpose;
- why it is safe to reduce;
- expected RAM/disk gain;
- recovery command;
- before/after state.

Use `docs/process-action-receipts.md`.
