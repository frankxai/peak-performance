---
name: storage-review
description: Reconcile local disk usage, classify large folders and worktrees, and qualify bounded cleanup or archive batches while preserving originals and project state. Use for storage recovery, duplicate qualification and hot/warm/archive placement.
---

# Storage review

Confirm the target volume, current free space, requested reserve and machine/workload constraints. Reuse existing indexes and receipts. Avoid a second estate-wide scan when selected-root inspection can change the next decision.

Report logical bytes, allocated bytes and volume change separately. Do not sum nested folders or hard-linked paths as independent savings. Identify placeholders without hydration, expose errors/exclusions and keep the unreconciled gap visible. Bound scans and their own storage overhead; resume checkpoints and stop on resource or database failures.

Rank disjoint candidates by verified or credible net recovery, preservation risk and execution effort. Distinguish active originals, histories/application state, generated output, reproducible dependencies and closed archives. Matching hashes establish content evidence only; ignored Git paths, age and cache-like names do not establish disposability or consumer absence.

Qualify the selected batch according to its actual risks. Cache maintenance needs current consumers and regeneration evidence. Worktree retirement needs its owner, dirty/untracked/ignored/local-only state, shared stores, refs and recovery. Unique data needs appropriate preservation and restore evidence. Media derivatives and lossy conversions do not replace masters by default.

Compression or consolidation must preserve the required paths, content and metadata or explicitly account for changes. Begin with a bounded, qualified pilot and ordinary-read/recovery checks. A synthetic compression ratio is not a forecast for the user's files.

For offload, verify account/destination, quota, privacy, retention, budget and key recovery. Copy and separately restore before proposing exact local retirement. Existing destination access or an upload receipt is insufficient. Do not transfer raw data to an LLM for ordinary sizing, hashing or duplicate accounting.

Present exact unresolved destructive scope at the approval boundary required by the host. Preserve prior authorization. Execute through available supported tools, retain outcome/recovery evidence and distinguish observed physical recovery from concurrent free-space movement. Stop on ownership, identity, authority or partial-effect uncertainty.

Use [accounting](../../knowledge/measurements.md), [action rules](../../knowledge/actions.md) and the [practical playbooks](../../knowledge/playbooks.md) as needed. Finish with the remaining gap and the next largest qualified batch; do not keep inspecting empty caches or repeat completed comparisons without a concrete freshness reason.
