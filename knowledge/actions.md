# Actions and preservation

Last reviewed: 2026-10-31. Apply the actual host/user policy; these principles do not grant permissions.

| Data/action | Qualification needed |
| --- | --- |
| Observation | Bound cost, disclose scope and uncertainty, protect private output. |
| Reproducible cache | Identify current consumers and a credible regeneration path; prefer exact vendor maintenance. Clarify offline consequences. |
| Unique originals, histories or archives | Establish retention and a suitable preservation/restore path before local retirement. |
| Git worktree | Preserve modified, untracked, ignored and local-only state; shared Git stores, refs, stashes, LFS and submodules need separate treatment. Check the current owner. |
| Application state | Use supported maintenance/export mechanisms; distinguish local-only data and active SQLite/WAL state from closed copies. |
| Process reduction | Attribute exact process identity/start time, consumers and supervisor; coordinate active work and use supported graceful stop. |
| Compression | Pilot exact scope, logical content and required metadata, ordinary reads, decompression and allocation/latency. Avoid active database/build hot paths until justified. |
| Cloud offload | Confirm account/destination, quota, privacy, cost, retention and recovery keys; separately restore before approved source retirement. |
| Media conversion | Preserve masters and rights/project relationships. Lossy output is a derivative, not a replacement by default. |

Use current task authorization and avoid repeated approval requests where it already covers the action. Make any unresolved destructive scope concrete before requesting approval. Do not treat a score, package installation, directory name or previous pilot as blanket authority.

Prefer standard tools over new file-operation frameworks. Use a custom native mechanism only when it is justified by an actual requirement and reviewed/tested. Avoid both uncontrolled recursive cleanup and endless elaborate tooling for negligible gains.

Receipts record exact scope, action state, before/after evidence, errors, recovery and uncertainty. Keep credentials and lease tokens in memory or an appropriate credential store; never in ordinary receipts. A successful command alone is not measured recovery or independent verification. External writers can change free space during an operation.

Supported vendor references, to recheck before implementing a platform action:

- [Git worktrees](https://git-scm.com/docs/git-worktree): use supported lifecycle operations; preserve unique work and shared objects.
- [npm cache](https://docs.npmjs.com/cli/v11/commands/npm-cache): verification and force clearing are different operations.
- [Windows compact](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/compact): standard NTFS compression and decompression; not universal evidence of improved performance.
- [Windows component-store cleanup](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/clean-up-the-winsxs-folder): use supported system maintenance rather than manual WinSxS deletion.

These links are implementation starting points, not certification that a local adapter implements them correctly.
