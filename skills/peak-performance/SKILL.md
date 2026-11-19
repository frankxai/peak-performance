---
name: peak-performance
description: Diagnose developer-workstation performance, storage pressure and agent overhead, then produce a scoped recovery plan using verified local measurements. Use for machine health and workload readiness, not application feature development.
---

# Peak Performance

Help the user preserve required work while obtaining the headroom their machine and chosen workload need.

First discover local host access, OS, installed Peak Performance version and actual commands. Plugin installation does not install the CLI. If the runtime is absent, complete useful bounded observations with available tools and preview installation separately. Do not automatically download software, start MCP servers, change global settings or infer machine access from a cloud chat connection.

Use an existing audit/index when its scope and freshness fit. `pp audit --json --plain` is an existing entry point where available; it normally writes local score history in the current directory. Choose the working directory deliberately and respect the host's write policy. If audit writes are outside scope, use available tools for bounded read-only observations instead. Other commands must be confirmed in the installed runtime; source documentation and package versions can drift. Avoid composite automatic fixes until their actual recipes and authority are understood.

Evaluate measurement validity before the score. Distinguish zero from unavailable/denied/timeout, and machine observations from current-directory Git/config checks. If a required collector is invalid, label the combined score incomplete and do not use it for admission decisions depending on that measurement. Do not invent a replacement value. Compare CPU, available memory, paging and disk activity for a representative workload. A short sample, heuristic RAM estimate or process count does not prove a bottleneck.

For storage accounting and cleanup selection, use the sibling `storage-review` skill. For runtime pressure, attribute PID plus start time, parent/launcher relationships, current consumers and supervisor/session ownership. Coordinate before stopping user-owned or ambiguous processes. Apply the user's current authorization and host policy without creating redundant approval loops.

Choose an action proportional to evidence, preservation risk and net benefit. Execute only through available host tools and the applicable authority; skills grant no permissions. Prefer supported maintenance and existing supervisors. Record measured outcomes and recovery; stop or reconcile uncertain effects. Do not claim concurrent volume changes as attributable savings.

Read only relevant references:

- [Measurement validity and allocation](../../knowledge/measurements.md)
- [Preservation and action rules](../../knowledge/actions.md)
- [Workload, media and project playbooks](../../knowledge/playbooks.md)
- [Host capability and installation boundaries](../../knowledge/platform-support.md)

Return current scoped measurements, the largest credible next action, what was executed, verified outcomes and material gaps. Do not report a plan, score or successful upload as completed cleanup or proven performance improvement.
