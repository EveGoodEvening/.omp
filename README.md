# `oh-my-pi` Setup

This repository contains my local `oh-my-pi` configuration, including agents, commands, skills, extensions, and plugin-related settings.

## Purpose

I use this setup to customize my coding assistant workflow and keep reusable automation in one place.

## Marketplace and Plugins of Interest

I am interested in the following plugin marketplaces and the following plugins.

```bash
/marketplace add anthropics/claude-plugins-official
/marketplace install ... # see `enabledPlugins` in https://github.com/EveGoodEvening/.claude/blob/master/settings.json
/marketplace add nexu-io/open-design
/marketplace install open-design@open-design
```

## Machine-wide heavy-command gate

`bin/heavy-gate` and `bin/heavy-gate-hook` are adapted from
[`EveGoodEvening/.claude` commit `4464b3e`](https://github.com/EveGoodEvening/.claude/commit/4464b3e611d971b16e946c266399262dbaa89ab6).
`agent/extensions/heavy-gate.ts` is auto-discovered by OMP's default profile and
rebound to its subagents. Restart OMP after installation; this does not patch the
installed executable or change `agent/config.yml`. Other profiles must load this
extension explicitly. `--no-extensions` or disabling the extension removes the
launch checks.

### Usage

```sh
~/.omp/bin/heavy-gate --status
~/.omp/bin/heavy-gate -n 1 -m 6G -l browser-smoke -- node scripts/smoke.mjs
```

The second command illustrates a project's browser script. From OMP, use the
`bash` tool with `async: true, timeout: 0` for finite gated jobs; the extension
also applies these arguments to recognized gated commands. Async execution alone
does not remove OMP's deadline. Never put `timeout` around the gate.

- Linux prerequisites: Bash, Python 3, `flock`, cgroup v2 memory support, and a
  working user systemd manager. Isolation failures refuse execution, rather than
  running the command without a cap.
- Default state is `/tmp/heavy-gate`, shared with Claude: two `slot-N` flock locks
  and a `launch` lock. This is one shared budget, not two slots per assistant.
  Both clients must retain the same directory and slot limit.
- Admission requires `MemAvailable >= 4500 MiB`; launches settle for 20 seconds.
  Each command has its own scope with `MemoryMax=6G` and `MemorySwapMax=0`.
  `-n` reserves one or two slots atomically; `-m` changes the finite per-command
  cap. Prefer one browser with one worker.
- OMP retains slots until the entire scope exits, including children that close
  inherited descriptors. TERM/INT/HUP stop only that invocation's scope. Status
  includes the owning PID, scope name, and label; never stop another session's
  holders. Uncatchable supervisor termination (e.g. SIGKILL) is not a guaranteed
  cleanup path; inspect the scope before assuming its descendants are gone.
- The original `HEAVY_GATE_*` environment knobs are retained for administration
  and isolated lightweight tests, not for escaping shared resource limits.

### OMP browser integration and boundaries

The extension checks Bash commands, scripts/local imports, package scripts, and
recognizable direct browser automation in Eval. It fails closed if its Python
checker cannot run. A denial means rerun through the gate, not obscure the launch.
The full orchestration policy lives in `agent/AGENTS.md` and is also injected into
agent prompts by the extension.

Bun options are resolved before selecting package-script or interpreter mode.
Commands such as `bun --cwd project run smoke` inspect the selected package;
leading options on inline code, cwd-relative preloads, and `bun -` stdin scripts
also retain browser-launch checks. Ordinary non-browser Bun commands remain usable.

OMP 18.4.4's [`browser.open` is an Eval host bridge](https://github.com/can1357/oh-my-pi/blob/v18.4.4/docs/hooks.md),
not a separately intercepted tool call. Its
[`shared browser startup has a 30-second readiness deadline`](https://github.com/can1357/oh-my-pi/blob/v18.4.4/packages/coding-agent/src/tools/browser/shared-daemon.ts),
so wrapping `PUPPETEER_EXECUTABLE_PATH` in a gate that can wait minutes is not a
reliable integration. This setup instead rejects recognizable implicit managed
launches and `app.path` calls. Use a gated external automation script, or attach
to an already-running gated browser:

```js
const tab = await browser.open({
  app: { cdp_url: "http://127.0.0.1:9222" },
  name: "verification",
});
try {
  console.log(await tab.title());
} finally {
  await tab.close();
}
```

For Python, use `browser.open(app={"cdp_url": "http://127.0.0.1:9222"}, name="verification")`.
Keep `app` first and the endpoint literal so the conservative checker recognizes
each attachment. `app: { relay: true }` / `app={"relay": True}` is also allowed for
an existing user browser. CDP must bind to `127.0.0.1`; use a dedicated Chrome
profile, keep the browser process under the gate for its entire lifetime, and
wait for its HTTP `/json/version` endpoint before attaching. Closing an attached
tab does **not** terminate the external browser; its launcher must stop it and
release the slot when verification finishes. Do not cap the whole OMP session.

These are accident-prevention checks, not an execution sandbox. Aliases, generated
code, third-party extensions, direct process APIs, and unrelated existing
browsers are not comprehensively intercepted. The resource rule applies even
when static detection is silent; no automatic ownership or gating is inferred
from a CDP URL.
Manual `!command` and RPC's direct `bash` command use OMP's separate `user_bash`
route, not this model-tool hook. Use the gate explicitly there as well.

### Verification

Run the deterministic launch-policy regressions with:

```sh
python3 -m unittest discover -s tests -p '*_test.py' -v
```

Resource smoke checks additionally exercised real user-systemd scopes: kernel
memory/swap limits, shared Claude locks, two-slot acquisition, low-memory waiting,
stdin and exit-code preservation, descendant lifetime, scoped OOM, and owned-scope
cancellation. Those probes use isolated lock directories and small caps; they
are not a reason to change the production shared namespace.

Real OMP 18.4.4 smoke runs also verified automatic extension discovery, Bash and
Eval denial, ordinary command execution, and nested Eval `tool.bash` enforcement.
A scoped child-session smoke confirmed that a gated command requested with
`async: false, timeout: 1` actually ran as an async job with its deadline disabled.
A Chromium process launched through the production gate was confirmed inside its
6 GiB scope, attached through OMP Eval/CDP, clicked a page button, and produced a
verified screenshot. Its launcher then stopped the browser and released the
entire scope. No model request was needed for these runtime checks.
The Bun dispatch smoke additionally exercised the real OMP Bash wrapper and nested
Eval `tool.bash`: browser-bearing package scripts, prefixed inline code, preloads,
and stdin were denied, while ordinary Bun scripts and inline code executed normally.
