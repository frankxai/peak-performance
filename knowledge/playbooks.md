# Practical workstation playbooks

Last reviewed: 2026-10-31. Discover installed commands and host permissions first.

## Slow machine

Capture a short representative CPU, available-memory, paging and disk-latency/queue sample. Attribute active runtime trees and workloads. Determine whether the bottleneck is CPU, memory pressure, storage latency, thermal limits or a specific application. A process count is a lead, not a kill list. Choose one attributable change, measure the same workload again, and retain recovery instructions.

## Free a meaningful amount of storage

Confirm volume capacity, the user's free-space goal and working reserve. Reuse existing inventories and reconcile non-overlapping allocation. Rank candidates by credible net recovery, preservation risk, qualification cost and time. Execute the largest qualified bounded batch, verify its effect and update the gap. Stop revisiting empty caches. Do not force a target by removing required data.

## Keep the right projects local

Maintain a small active working set chosen by the user, with occasional and archived projects recorded separately. Every worktree has a purpose, owner and retirement condition. Preserve canonical repositories and unique Git state. After preservation, unused working copies and reproducible dependencies can be candidates; clean status alone does not prove inactivity. Rehydrate occasional projects on demand.

## Archive closed material

Choose a destination by collaboration, retention, retrieval frequency, actual quota and total cost. A sync location is not independently proven backup. Record source relationships and required metadata. Copy a bounded batch, perform a separate restore, verify required properties and key recovery, then present the exact local retirement. Avoid staging a large extra archive on an already pressured volume.

## Organize images and videos

Inventory format, dimensions, duration, size, hash and project/rights references locally first. Group exact duplicates separately from visually similar versions. Preserve originals; generate thumbnails/proxies for browsing. Use local deterministic tools for metadata and ordinary transforms. Semantic models are optional for ambiguous classification, after privacy and resource decisions. Never infer duplicate status from a filename or perceptual similarity alone.

## Reduce agent overhead

Discover only the tools needed for the current job. Reuse an existing shared service when its authority and isolation are appropriate. A launcher and child process may be one tool stack. Avoid a permanent local worker per skill. Coordinate session lifecycle before disabling integrations or restarting hosts. Any periodic observer must have finite work and retention budgets.

## Installation and maintenance

Preview required runtime, version, scope, download source and configuration changes. Prefer a pinned supported release with available integrity/provenance information; never execute a network pipe as an installation shortcut. Explain restart requirements. Uninstall should remove only owned software/configuration and preserve user inventories, archives, credentials and unrelated settings unless explicitly requested.

## Daily and weekly review

Daily: short telemetry plus changes relevant to active work. Weekly: growth, expired worktrees, failed backups, release/version drift and unresolved exceptions. Deep scans are on demand. Success is useful recovered capacity and reliable work, not the number of reports or agents created.
