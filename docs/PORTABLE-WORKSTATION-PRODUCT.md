# Peak Performance: portable workstation product

Status: implementation proposal plus initial skills-only package; not a released or directory-approved product. Source baseline: `19afd8df543f00d202c9ffeafe832bd5aa345e4f`. Updated 2026-10-31.

## Product decision

Extend this repository and its existing CLI, tray and MCP surfaces. Keep the published package identity and MIT license. Provide one headless engine, a focused Agent Skills pack, and platform-specific packaging. A second cleanup framework, desktop shell or always-on agent swarm is unnecessary for the first release.

Primary user: a developer running several projects and coding agents on a laptop. Primary outcome: enough verified disk and memory headroom for the selected workload, preserved required data, fewer redundant runtimes, and reproducible recovery. Targets are chosen per machine; a fixed free-space number is not universal.

Positioning: **a local workstation steward with evidence and recoverable actions**. A score summarizes observations; it neither authorizes actions nor proves a faster machine. Keep plain technical labels as the broadly usable interface; retain existing optional branding without requiring its vocabulary.

## Architecture

1. OS adapters collect bounded observations for Windows, macOS and Linux. Distinguish implemented, tested and unsupported operations by platform.
2. A versioned evidence model records value, unit, timestamp, scope, collection method and validity. Unknown, denied, timed-out, partial and unavailable measurements cannot silently become zero or healthy.
3. An incremental catalog records selected roots, volume/file identities, logical and allocated sizes, link attribution, cloud-placeholder state, errors, exclusions and checkpoint coverage. Whole-volume arithmetic must use non-overlapping categories.
4. A planner classifies source/originals, reproducible output, application state, histories, media derivatives and archived material. Plans estimate net benefits with confidence and uncertainty; path names and age are clues, not authorization.
5. A narrow action layer uses supported vendor tools or reviewed mechanisms. Actions consume a current exact plan, respect the host's permissions and authority, and record verified outcomes. Existing `fix` behavior must be reconciled with the repository's reversible-only contract before broader distribution.
6. CLI and optional MCP expose the same contracts. Skills explain decisions and route tools; they do not independently implement deletion, backup or process control.
7. Optional tray/notification projections reuse observations. No second scanner or per-session daemon. Hook work stays small and explicitly opt-in; no automatic deep scan at startup.

Reuse TypeScript orchestration and Python platform support already present. Add a native helper only for a demonstrated capability/performance gap. Benchmark before selecting Rust or Go. An Electron/Tauri UI and local-model downloads are outside the first milestone.

## Core workflows

| Workflow | Outcome and acceptance |
| --- | --- |
| Setup | Detect OS, installed CLI version/capabilities and available host tools; preview installation/configuration changes before applying them. Plugin installation must not silently install the CLI or activate services. |
| Workload preflight | Evaluate current valid headroom for a named task, retaining the existing OS/application reserve and any stricter local policy. Explain every hold. |
| Storage accounting | Reconcile observed allocation with volume usage, expose exclusions and unaccounted space, resume rather than rescan. Preserve paths, privacy and file identity where required. |
| Runtime review | Attribute process trees using PID plus start time, executable, redacted arguments, supervisor/session evidence and current consumers. Distinguish launch wrappers from independent services. |
| Project focus | Record active, occasional and archived projects, canonical checkouts and bounded worktree ownership. No branch/ref/stash pruning as a shortcut. |
| Cache maintenance | Qualify regeneration and current users, then run an exact supported maintenance action. No composite Temp/Recycle Bin purge disguised as universally safe. |
| Media organization | Index metadata first. Retain masters, rights, source/project relationships and derivatives; perceptual similarity is not byte equality or deletion proof. Lossy conversion creates a new derivative. |
| Archive/offload | Verify destination/account, quota, privacy, budget and key recovery; copy in resumable batches, restore independently, then consider exact local retirement. Upload success alone is insufficient. |
| Compression | Compare actual allocation and normal read performance on a scoped pilot. Preserve paths/content and required metadata; test decompression and stop on unfavorable results. |
| Periodic care | Summarize growth and actionable changes with finite budgets and retention; keep raw local paths/content private. Scheduling and cloud spend are opt-in. |

## Authority and privacy

Installation is not cleanup permission. The host's existing filesystem, tool, sandbox, organization and user rules remain authoritative. Preserve session authorization; ask only at a genuinely unresolved action boundary.

Match checks to risk. Reproducible caches need owner/consumer and regeneration evidence. Unique material needs appropriate preservation and restore proof. Do not impose archival ceremony on every harmless observation, or infer destructive permission from a vague score.

Store measurements locally by default. Exclude raw contents, environment variables, credentials, lease capabilities and raw command lines from normal receipts. Private indexing is not automatic permission to send metadata to an LLM or cloud provider. Redact exports, make outbound transfers explicit, and provide data location/retention/export/removal controls. A future local service needs authenticated loopback access and bounded tool scope; no public filesystem endpoint.

Leases coordinate existing sessions. Keep one writer per scope and a bounded workload budget. Cancellation must stop/drain owned work before finalization; record uncertain partial effects instead of success. Plans need expiry and replay/identity checks proportional to their actions. Never terminate a process solely because it is large, old, numerous or apparently parentless.

## Distribution design

Initial addition is a skills-only candidate: root portable `plugin.json`, Claude metadata in `.claude-plugin/plugin.json`, Antigravity metadata in `.antigravity-plugin/plugin.json`, and one shared `skills/` tree. No automatic MCP registration, hooks, scheduler, installer execution, credentials or machine changes on load.

The CLI runtime and agent pack have separate release acceptance. Keep version/capability compatibility explicit; npm distribution currently lists only dist/README, so Git plugin packaging must not be assumed to travel in the npm tarball. Generate release artifacts from one source/version map once release tooling exists.

Desktop/local-agent access is required for local-machine actions. Cloud-only chat cannot manage a user's laptop without an explicitly connected host capability. Optional MCP must reuse the CLI engine, remain disabled unless requested, and avoid multiplying local servers per agent. Private Starlight/SIS integration is an adapter, never a requirement for public users.

See `../knowledge/platform-support.md` for dated official mechanisms and submission gates. Do not call a self-published package an official or approved plugin.

## Delivery sequence

1. **Correctness and baseline:** reconcile open admission/release issues, unavailable probes, filesystem accounting and actual capability parity between source, installed runtime and tray. Define representative workload measurements.
2. **Portable instructions:** finish skill behavioral evaluations, vendor schema validation and clean-install tests. This branch starts that work; it does not complete it.
3. **Incremental inventory:** bounded SQLite catalog, resume/cancellation, versioned coverage, hard-link/cloud semantics and disk-budget exhaustion handling.
4. **Reviewed actions:** initially vendor maintenance and exact reversible pilots. Each supported action gets adverse-path tests, meaningful restoration/regeneration checks and privacy-safe receipts.
5. **Storage providers:** one accepted destination and a complete copy/restore/retirement pilot before provider expansion. Add Google Drive, OneDrive or object storage only through demonstrated capabilities.
6. **Distribution:** reproducible archives, SBOM/provenance as appropriate, versioned runtime installation with integrity checks, uninstall/rollback, Windows/macOS/Linux capability tests, then platform submissions.
7. **Ongoing quality:** known-issue regression corpus, bounded maintenance reports and optional fleet features after actual demand. Never use collection of more telemetry as a substitute for useful outcomes.

## Release gates and success criteria

- Missing/denied probes remain visibly unknown and cannot admit an unsafe workload.
- Logical size, allocated size and observed net recovery remain distinct; no double-counted parents or links.
- Resume performs no duplicate mutation; interruption leaves a reconcilable outcome.
- A failed worker cannot mask a peer resource guard; no readers remain after rollback.
- Active sessions, local-only Git state, credentials and application state survive all fixture scenarios.
- No secret/capability appears in plans, normal logs, exports or release assets.
- Every claimed host operation passes its platform tests, including permissions, placeholders, long paths, sharing conflicts and unavailable tools where relevant.
- Public examples are synthetic. No private incident reports, customer paths, real manifests or user histories ship in the pack.
- Installer and uninstall tests preserve unrelated host configuration. Fresh-session skill discovery and CLI version mismatches are exercised on each supported harness.
- Measure time to a useful plan, verified bytes recovered, recovery/rollback success, scan overhead, idle RAM/CPU, false-positive actions and representative workload latency. No invented performance percentage or savings guarantee.

## Immediate backlog

Existing issues #3/#4 track admission/source reconciliation; #5 tracks measured workload reports; #6 protects browser sessions; #7 concerns dirty-repository handover behavior. Keep those owners and evidence. This branch adds packaging/knowledge foundations only, without claiming those issues fixed or replacing their runtime work.
