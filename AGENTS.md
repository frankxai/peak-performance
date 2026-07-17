# Repository Instructions

This repo is part of the FrankX / Starlight / Arcanea agent estate.

## Classification

- Repo: `peak-performance`
- Class: published npm CLI + Python system tray + MCP server (`@arcanea/peak-performance` / `@arcanea/pp`) — system health auditor for AI-powered development machines
- Default health command: `npm test` (`tsx --test src/**/*.test.ts`) and `npm run lint` (`tsc --noEmit`)
- Remote: https://github.com/frankxai/peak-performance

## What this repo is

Peak Performance scores a development machine across the Ten Gates (disk, memory, CPU/GPU, process health, git hygiene, security, workspace, knowledge, agent load, system) into one 0-100 score with an S-F grade, and ships three surfaces: the `pp` CLI (`src/cli.ts`), a Python system-tray app (`tray/`), and an MCP server exposing `pp_audit`/`pp_trend`/`pp_fix`. This is not a standalone toy — it is the canonical machine-health gate referenced by Frank's estate-wide `machine-performance-contract.md`: `pp preflight --workload <type>` gates builds, browser QA, local models, and swarms against live headroom before they start. Changes here have estate-wide blast radius.

## Agent Rules

- Read this file before making changes.
- Preserve existing user work and unrelated dirty files.
- Keep edits scoped to the requested task.
- Prefer existing repo conventions over new abstractions.
- Run the health command before handoff when feasible.
- Do not publish secrets, private memory, credentials, or internal-only strategy.

## Class-Specific Guidance

- `pp fix`, `pp preflight`, and `pp overnight` are read-only/reversible-only by contract — never add a code path that kills processes, restarts the machine, or mutates cloud services from these commands. Any new destructive capability needs an explicit decision record, not a silent addition.
- `pp preflight` must keep the 4GB OS/application safety floor on top of any workload reserve — do not remove or shrink it without an explicit ask.
- Keep the TypeScript (`src/`) and Python (`tray/`) probes in parity where they measure the same gate — don't let one silently drift from the other's scoring logic.
- `pp inspect`/`pp watch` output must stay redacted (no raw secrets/env values) — this feeds Starlight/JarvisOps and Queen-style orchestration ingestion.

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
