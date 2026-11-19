# Portable pack validation — 2026-10-31

Candidate branch: `codex/portable-machine-pack`, based on source commit `19afd8df543f00d202c9ffeafe832bd5aa345e4f`. No commit, push, npm publication, installation into a user harness, marketplace submission or approval has occurred for these changes.

## Executed checks

- Claude's installed `plugin validate <candidate> --strict` exited 0 and reported validation passed. Its additional directory check warned that an icon is missing; directory safety/policy review and actual installation are not covered by that result.
- Installed `agy` reports version1.2.12. `agy plugin validate <candidate>` exited0 and processed two skills. The current documented `validate --strict <candidate>` form failed because this installed tool treated `--strict` as a path. Therefore Antigravity strict/schema validation is not claimed.
- `git diff --check` passed for the tracked edit at the time checked. New files require separate structural and release checks.
- Dependency-free `node scripts/validate-portable-pack.mjs` passed: three manifests with matching identity/version/license/author, two skills with the intentionally limited metadata form, eleven local references checked within the package, valid evaluation JSON and no declared autoload surfaces in this candidate. Its output explicitly states vendorSchemaValidated=false. Node syntax checking passed for the validator. It is also exposed as `npm run validate:pack`.
- An independent existing reviewer forward-tested the two skills using a synthetic denied-CPU/placeholder/worktree/WAL/media/unsafe-fix scenario, with only skill/reference reads allowed. Its response preserved the uncertain data, rejected the unsafe recipe, qualified actual commands and reported no false recovery. This is one qualitative evaluation, not a statistical safety claim.
- Two wording refinements followed that evaluation: explicitly flag incomplete scores and provide a read-only alternative when audit-history writes are not allowed.
- Current OpenAI desktop-only documentation was verified and the root manifest now sets `extensions.com.openai.requires_local_executor=true`. The structural checker requires this flag; it does not create submission access or prove a desktop installation.

## Incomplete checks

The Skill Creator `quick_validate.py` was attempted for both skills but could not import PyYAML in the available default Python. Standalone JSON Schema validation was not available in that interpreter either. No dependencies were installed solely to make those checks pass. Native vendor checks and the behavioral evaluation do not substitute for all schema/frontmatter checks.

No engine test, build or dependency installation was run: this branch changes documentation, skill instructions, packaging and a dependency-free package checker only. Existing runtime admission/collector/source-parity issues remain open. No evaluation exercised real deletion, process shutdown, backup, compression, cloud access or installer behavior.

## Required before release

Finish official schema and supported strict host validation, resolve runtime compatibility/admission issues, add truthful install/remove instructions and required artwork/legal/support metadata, verify clean installation/discovery in each claimed host, and run realistic bounded task evaluations. Keep release evidence tied to exact artifacts and versions. A plugin manifest does not install the standalone npm CLI. Desktop-only host access and submission eligibility must be demonstrated separately.
