# Process Action Receipts

Peak Performance can identify pressure, but it must not silently decide what work is disposable.
Use this receipt flow before terminating user-owned processes.

## Default Flow

1. Run `pp inspect` or an equivalent process census.
2. Record the candidate process tree before acting:
   - PID and parent PID
   - executable name
   - redacted command line
   - memory footprint
   - likely repo or working directory when discoverable
   - reason it is believed safe to stop
3. Classify the process:
   - `protected`: AI agent sessions, local model runtimes, MCP/tool servers, editors, supervised dev servers, OS processes.
   - `review`: build jobs, generators, orphaned node processes, browsers, shells, unknowns.
4. Ask before terminating user-owned or ambiguous processes.
5. After acting, record:
   - exact command used
   - before/after RAM or disk state
   - what was not touched
   - how to resume or regenerate the work

## Receipt Template

Use this shape for receipts:

    # Process Action Receipt - YYYY-MM-DD - <short-name>

    ## Action

    - Decision:
    - Command:
    - Operator:
    - Time:

    ## Process Tree

    ```text
    PID <pid> <name> <redacted command>
      PID <child> <name> <redacted command>
    ```

    ## Classification

    - Role:
    - Guard:
    - Confidence:
    - Reason:

    ## Evidence

    - Candidate repo/path:
    - Related package script:
    - Output or artifact paths:
    - Recent writes:

    ## Impact

    - Before:
    - After:
    - Freed:
    - Not touched:

    ## Recovery

    - Resume/regenerate command:
    - Validation:
    - Remaining risk:

## Hard Rules

- Do not kill local model runtimes just because they are large; Frank may be using them for local LLM work.
- Do not kill Claude, Codex, Cursor, editor, MCP, or dev-server processes without a specific coordination reason.
- Do not treat PP scoring recommendations as authorization. The score explains pressure; a human-readable receipt explains action.
- Prefer stopping project-owned dev servers through their supervisor script when one exists.
