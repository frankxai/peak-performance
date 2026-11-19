# Platform support and submission evidence

Documentation checked 2026-10-31. This describes platform mechanisms, not completed installation, acceptance or an official listing for Peak Performance.

| Platform | Candidate packaging | Validation and release boundary |
| --- | --- | --- |
| OpenAI / Codex | Root `plugin.json` using the Agent Plugins schema, shared `skills/`, `requires_local_executor=true` under `extensions.com.openai`. | Desktop-only skills follow the standard submission flow and applicable access/identity checks. A future local MCP submission needs additional partner eligibility. Public listing requires review, not merely a manifest. |
| Claude Code | `.claude-plugin/plugin.json` and the same skill folders. | Local `claude plugin validate` plus current strict validation and task evaluations where supported. A team marketplace differs from Anthropic's directory and official marketplace. |
| Antigravity | `.antigravity-plugin/plugin.json` for the multi-provider repository and shared `skills/`. | Current docs describe `agy plugin validate --strict`, GitHub/local installs and a marketplace partner intake. Verify each target surface/version rather than assuming identical app/CLI/IDE support. |
| Other Agent Skills hosts | Focused `SKILL.md` folders and references. | Check discovery, shell/local access, invocation and permissions. Portable instructions do not establish binary, MCP or filesystem support. |

Official sources:

- [OpenAI packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenAI desktop-only submission](https://developers.openai.com/plugins/deploy/desktop-only)
- [Claude plugin overview](https://code.claude.com/docs/en/plugins)
- [Claude publishing](https://code.claude.com/docs/en/plugins/publish)
- [Antigravity skills](https://antigravity.google/docs/skills)
- [Antigravity plugin authoring](https://antigravity.google/docs/build-plugins/)
- [Antigravity plugin installation](https://antigravity.google/docs/plugins/)

The initial package contains skills only. It has no hooks, local server autostart, cloud connector, installer side effect or default scheduling. Existing standalone CLI and MCP source are not automatically installed by these manifests.

Before submission: complete fresh-install/removal and realistic task tests, provide truthful capability/OS support, publisher metadata, bundled accessible artwork, README, data handling and legal/support information as required by each portal. Schema validation is not platform approval. Do not invent legal URLs, registered application IDs or endorsements. No marketplace submission has occurred from this branch.

Release evidence should distinguish built, structurally checked, schema validated, task tested, installed, runtime tested, submitted, approved and published. Record exact revision/artifact/version per host. Public release material must exclude private machine paths, credentials, raw manifests and user data.
