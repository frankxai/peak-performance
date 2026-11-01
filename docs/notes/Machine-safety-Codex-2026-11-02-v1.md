# Machine safety, Codex, 2 November 2026

Author: Codex. Revision: 1. Review state: source tests and typecheck pass;
hosted build and independent provider review pending. No runtime installation.

## Outcome and decision

`pp fix` and MCP `pp_fix` must return review plans without deleting caches or
temporary files. Signed-in browser processes must remain protected. Process names
alone must not establish operating-system identity or abandoned ownership.

The change is based on accepted main `19afd8df543f00d202c9ffeafe832bd5aa345e4f`.
It preserves main's existing checkpoint, stash selection, HTML escaping and
`prep --help` protections. Browser protection and Python count parity reuse the
three-file proposal at `b497cc30a58c796bc43aa3dfc0cbb1a72cd032a0` (PR 6).
The read-only remediation module reuses the existing reserve-floor proposal;
its exact source hash is
`f80613a931ed3e7c005890c80c1ffe17bae3cef8bcf0dbcc169c6a769b1734a3`.
Those original checkouts and unfinished proposals remain unchanged.

The alternative was to stack the older browser and admission branches wholesale.
That would also import unrelated changes and conflict with accepted main. This
candidate brings across the scoped protections with interface regression coverage.

## Behavior

- Every remediation entry point returns `disposition: held`,
  `executionPermitted: false` and `success: false`. Legacy cleanup exports remain
  callable; the implementation has no process-execution import.
- CLI and MCP collect one audit and return held plans, including manual proposals.
  `dryRun: false` cannot authorize execution. Neither surface reports fabricated
  before/after improvements.
- Doctor offers read-only review commands and requires actual task ownership
  before closure. Counts and process-name fragments do not establish abandonment.
- Chrome, Edge, Brave and Comet roots and renderer children stay protected,
  including when their command line contains agent or build words. Python counts
  the same browser families. Unknown system-like names remain protected while
  their identity is explicitly unverified.

## Verification and limits

`pnpm test`: 32 passed, zero failed or skipped. `pnpm lint` and `git diff --check`
passed. The seven remediation cases and affected CLI/MCP/doctor interface cases
failed against their unsafe baseline before the correction. Fixtures stub sensors
and process execution; they do not clean files or operate the live machine.

The workflow has read-only repository permissions, pinned action commits, path
filters, draft gating, cancellation of superseded runs and a five-minute limit per
Linux/Windows job. It installs frozen dependencies without lifecycle scripts,
runs source tests, typechecks, builds, checks emitted safety behavior and invokes
compiled `prep --help`. It uploads no artifacts and writes no cache. These are
standard public-repository verification jobs; no private workloads are exported.

Local compilation and a new independent provider review are held by machine RAM
admission. Hosted results must be read back at the actual candidate revision.
This note does not certify those pending checks or the installed runtime.

Runtime-source reconciliation remains tracked by issue 3. Main and the installed
admission-control producer have different features; replacing the installed CLI
with this branch would require explicit compatibility and rollback verification.
No dependency version, live launcher, process, service, credential or schedule is
changed here.

Sources: repository AGENTS.md; accepted main and browser proposal commits above;
existing reserve-floor remediation source; regression fixtures in this change;
[runtime-source issue 3](https://github.com/frankxai/peak-performance/issues/3).
