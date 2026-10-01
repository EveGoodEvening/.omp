# AGENTS.md

## Project lessons

- When you learn something reusable while working in a project, record it in the `Lessons` section of the repo-level `AGENTS.md` at the repository root. This includes library versions, model names, project conventions, corrected assumptions, and fixes for mistakes. Do not write these lessons to the user-level global files under `~/.omp/agent/`.

## Network exposure

- Docker-published Compose ports can bypass expected UFW `deny incoming` behavior through Docker iptables chains; local/dev service ports should bind explicitly to `127.0.0.1` in `ports` mappings on cloud hosts unl
ess public exposure is intended.

## Resource limits

- **Gate heavy work:** run every browser launch (including smoke/e2e), Electron, emulator, or command expected to exceed ~2 GiB through `~/.omp/bin/heavy-gate [-n N] [-m 6G] -- <cmd>`. Shared with Claude at `/tmp/heavy-gate`: max 2 slots, `MemAvailable >= 4500 MiB` before launch, per-command systemd scope with `MemoryMax` (default 6G) and no swap. Stop if isolation is unavailable; never run uncapped, change limits/directory to bypass the gate, add project-local locks, or gate the whole OMP session.
- **Execution:** finite gated OMP `bash` calls require `async: true, timeout: 0`; never wrap the gate in `timeout`. Inspect holders with `~/.omp/bin/heavy-gate --status`. Lingering slots may indicate live descendants; terminate only your own processes/scopes.
- **Browsers:** `-n N` reserves N browser slots. Prefer one browser, `--workers=1`, and reused contexts/pages; close browsers in `finally`. Gate external browser scripts. Eval `browser.open()` is attach-only: explicit `app.cdp_url` to an already-gated browser, or `app.relay: true` to an existing user-owned browser, with `app` first. No `app.path` or implicit Chromium. Verify CDP targets are gated; close tabs and stop owned browsers afterward.
- **Fan-out:** first check `free -m` and gate `--status`. Browser verification is machine-wide width <= 2, including other sessions: use batches of at most two or one serial verifier; assign other agents static checks/unit tests. Copy gate, timeout, and attachment rules into every browser-capable subagent prompt, regardless of extension inheritance.
- **Guard:** `agent/extensions/heavy-gate.ts` calls `~/.omp/bin/heavy-gate-hook` before Bash/Eval. Detection is best-effort; internal, indirect/dynamic, and third-party launches still require gating. If denied, use the gate; never disguise commands or switch tools to bypass it.
- **Other resources:** use launch-time checks/locks for shared ports, GPUs, and dev servers too. Agent counts and prompt rules are not resource guards.
