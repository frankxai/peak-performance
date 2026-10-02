# Repository Instructions

This repo is part of the FrankX / Starlight / Arcanea agent estate.

## Classification

- Repo: `peak-performance`
- Class: TypeScript CLI + Python system tray + MCP server, a system health auditor for AI-powered development machines
- Default health command: `pnpm test` (`tsx --test src/**/*.test.ts`) and `pnpm run lint` (`tsc --noEmit`)
- Remote: https://github.com/frankxai/peak-performance.git

## What this repo is

Peak Performance scores a development machine across the Ten Gates (disk, memory, CPU/GPU, process health, git hygiene, security, workspace, knowledge, agent load and system) into a 0-100 score and an S-F grade. Its source includes the `pp` CLI (`src/cli.ts`), a Python system-tray app (`tray/`) and an MCP server. The estate's machine performance contract uses preflight decisions before heavy work. Source changes require verification of the probes, callers and installed runtime. It is the canonical machine-health gate referenced by the estate machine performance contract. By contract, `pp preflight --workload <type>` gates builds, browser QA, local models and swarms against live headroom before they start. Changes here have estate-wide blast radius.

Builds and dependency installs follow the applicable workspace resource admission.
The source checks workflow runs tests, typecheck, build and compiled CLI/MCP
contracts. A build alone does not establish installed runtime or client acceptance.

## Agent Rules

- Read this file before making changes.
- Preserve existing user work and unrelated dirty files.
- Keep edits scoped to the requested task.
- Prefer existing repo conventions over new abstractions.
- Run the health command before handoff when feasible.
- Do not publish secrets, private memory, credentials, or internal-only strategy.

## Class-Specific Guidance

- `pp fix`, `pp preflight`, and `pp overnight` are read-only/reversible-only by contract — never add a code path that kills processes, restarts the machine, or mutates cloud services from these commands. Any new destructive capability needs an explicit decision record, not a silent addition.
- `pp preflight` must keep the 4GB OS/application safety floor on top of any workload reserve — do not remove or shrink it without an explicit ask. Ordinary reading, editing and small tests remain permitted; apply the floor to workload admission.
- Keep the TypeScript (`src/`) and Python (`tray/`) probes in parity where they measure the same gate — don't let one silently drift from the other's scoring logic.
- `pp inspect`/`pp watch` output must stay redacted (no raw secrets/env values) — this feeds Starlight/JarvisOps and Queen-style orchestration ingestion.

## Main readiness

Preserve accepted main instructions when reconciling producer branches. Review
the full inherited change before main integration. Verify storage admission,
probe validity and TypeScript/tray parity before acceptance. Reversible-only
behavior remains the required contract above; an MCP annotation does not
authorize irreversible cleanup. Main source, installed runtime and client
adoption require their own verified acceptance.

## Handoff

Summarize changed files, validation run, risks, and any follow-up needed.

## Design Taste Kernel

For any site, app, landing page, dashboard, visual identity, brand, motion, media, social, or frontend task, apply the shared Design Taste Kernel before handoff:

- C:\Users\frank\starlight\repos\DESIGN_TASTE.md
- C:\Users\frank\starlight\repos\WEB_EXPERIENCE_STANDARD.md
- C:\Users\frank\starlight\repos\MOTION_TASTE_RUBRIC.md
- C:\Users\frank\starlight\repos\MULTI_AGENT_DESIGN_COUNCIL.md
- C:\Users\frank\starlight\repos\VISUAL_QA_GATE.md

When motion, scroll, generated media, GIF/video, or premium polish matters, route through the Motion Design Studio plugin/skills and verify the result visually.
