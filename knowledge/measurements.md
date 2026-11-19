# Measurements and storage accounting

Last reviewed: 2026-10-31. General engineering rules; exact platform collectors require their own tests.

## Validity before scores

A measurement needs a timestamp, scope, unit, source and validity state. Zero is a measured value; it cannot also mean command failure, permission denial or unsupported API. Preserve unknown and partial results through scoring, workload admission, reports and the tray. Brief samples do not establish sustained performance.

Count agent sessions from evidence, not process-name counts alone. Sum of working sets can include shared pages; private allocation is not independently reclaimable physical RAM. Attribute memory, paging, CPU and disk pressure together. Avoid default estimates presented as real observations.

## Filesystem accounting

Separate logical bytes, allocated bytes, compressed storage and changes in volume free space. Shared hard links, nested folder totals, alternate streams, snapshots, metadata, access errors and concurrent writers can prevent a simple sum from reconciling to the volume. A cloud placeholder's apparent length can greatly exceed local allocation. Observe without hydrating it.

Use disjoint categories when reporting a drive. Show the unreconciled gap and coverage exclusions rather than labeling it junk. For identity-sensitive actions, do not assume a path still denotes the previously inspected file. Directories called cache or archive are not automatically unused.

## Bounded inventory

Start with volume telemetry and existing indexes. Scan selected high-value roots, checkpoint coverage, bound depth/time/entries where appropriate, and resume. Keep metadata reads separate from content hashing and semantic analysis. Hash only when the decision needs exact content evidence.

Store observations incrementally. One database writer and a small bounded reader pool are often sufficient; benchmark the actual bottleneck before adding a swarm or native rewrite. Drain failed readers before rollback. Budget the index, its journals and temporary copies; report its own overhead. Treat SQLite-full as a bounded failure, never a completed scan.

Completion of a live comparison means its recorded scope was traversed. It does not establish an atomic snapshot, metadata equivalence, no consumers or a recoverable deletion. Do not repeatedly rerun a completed scan without a concrete freshness requirement.
