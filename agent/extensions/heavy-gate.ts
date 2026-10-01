import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const hook = join(homedir(), ".omp", "bin", "heavy-gate-hook");
const policy = [
  "Machine-wide resource policy (also applies to every subagent):",
  "Run browser launches, Electron/emulators, and commands expected to use >2 GiB through ~/.omp/bin/heavy-gate [-n N] [-m 6G] -- <command>.",
  "Claude and OMP share two slots in /tmp/heavy-gate; prefer one browser/--workers=1 and close it in finally. Never evade the gate or create a project-local replacement.",
  "Finite gated bash commands require async:true and timeout:0; never wrap the gate in timeout. Check free -m and heavy-gate --status before fan-out; browser verification is one machine-wide stage of width <=2.",
  "Eval cannot launch browser automation directly. Native browser.open must use explicit app.cdp_url (browser already launched under the gate) or app.relay:true (existing user browser), with app first. Do not use implicit managed Chromium or app.path. Stop your owned CDP browser after use.",
  "Copy these requirements into browser-capable child prompts. Launch detection is best-effort, not a sandbox; undetected heavy work still requires the gate.",
].join("\n");

type Decision = { block: boolean; reason?: string; gated?: boolean };

async function check(toolName: string, input: Record<string, unknown>, cwd: string, schema: { parse(value: unknown): Decision }): Promise<Decision> {
  try {
    const proc = Bun.spawn([hook], {
      stdin: new Response(JSON.stringify({ toolName, input, cwd })),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(10_000),
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) throw new Error(`checker exited ${code}: ${stderr.trim()}`);
    return schema.parse(JSON.parse(stdout));
  } catch (error) {
    return { block: true, reason: `heavy-gate check unavailable; refusing unchecked execution: ${error}` };
  }
}

export default function heavyGate(pi: ExtensionAPI): void {
  const schema = pi.zod.object({
    block: pi.zod.boolean(),
    reason: pi.zod.string().optional(),
    gated: pi.zod.boolean().optional(),
  });
  pi.on("before_agent_start", event => ({
    systemPrompt: Array.isArray(event.systemPrompt)
      ? [...event.systemPrompt, policy]
      : `${event.systemPrompt}\n\n${policy}`,
  }));

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash" && event.toolName !== "eval") return;
    const input = event.input as Record<string, unknown>;
    const decision = await check(event.toolName, input, ctx.cwd, schema);
    if (decision.block) return { block: true, reason: decision.reason ?? "Blocked by heavy-gate" };
    // Async changes only when results return; timeout:0 separately removes the deadline.
    // Named services have their own lifetime/readiness contract, not finite-job flags.
    if (event.toolName === "bash" && decision.gated && !input.name) {
      return { input: { ...input, async: true, timeout: 0 } };
    }
  });
}
