type DeliveryMode = "steer" | "followUp" | "nextTurn";

type UiContext = {
  notify?: (message: string, type?: "info" | "success" | "warning" | "error") => void | Promise<void>;
};

type CommandContext = {
  ui?: UiContext;
  waitForIdle?: () => Promise<void>;
};

type ExtensionApi = {
  registerCommand?: (
    name: string,
    command: {
      description: string;
      handler: (args: unknown, ctx: CommandContext) => Promise<void> | void;
    },
  ) => void;
  sendUserMessage?: (content: string, options?: { deliverAs?: DeliveryMode }) => Promise<void> | void;
};

function tokenizeArgs(raw: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        token += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }

    token += char;
  }

  if (token) tokens.push(token);
  return tokens;
}

function commandArgsToTokens(args: unknown): string[] {
  if (Array.isArray(args)) return args.map((arg) => String(arg));
  if (typeof args === "string") return tokenizeArgs(args);
  if (!args || typeof args !== "object") return [];

  const record = args as Record<string, unknown>;
  for (const key of ["ARGUMENTS", "arguments", "raw", "input"]) {
    const value = record[key];
    if (typeof value === "string") return tokenizeArgs(value);
  }

  const maybeArgs = record.args;
  if (Array.isArray(maybeArgs)) return maybeArgs.map((arg) => String(arg));
  return [];
}

type GoalCommandSpec = {
  name: string;
  description: string;
  modeLabel: string;
  reviewInstructions: string;
  fixInstruction: string;
};

const GOAL_COMMANDS: GoalCommandSpec[] = [
  {
    name: "goal-implement-fast",
    description: "Implement tracked tasks using /goal and subagent review",
    modeLabel: "fast",
    reviewInstructions: "Run a subagent to check:",
    fixInstruction: "Fix according to the subagent's feedback unless the subagent says all good.",
  },
  {
    name: "goal-implement-strict",
    description: "Implement tracked tasks using /goal and Codex review",
    modeLabel: "strict",
    reviewInstructions: "Run the `codex-review-code` skill to check:",
    fixInstruction: "Fix according to Codex's feedback unless Codex says all good.",
  },
];

function goalPrompt(designDoc: string, progressTracker: string, command: GoalCommandSpec): string {
  return `/goal Implement tasks from design doc ${designDoc} and progress tracker ${progressTracker} via a ${command.modeLabel} iterative implement-review loop.

## Loop behavior

Repeat until the progress tracker is complete or every remaining unchecked task is explicitly blocked/deferred:

1. **Read** — Read ${designDoc} (design planning) and ${progressTracker} (progress tracker). Identify unchecked \`- [ ]\` tasks.
   - If ALL tasks are \`[x]\` → output \`IMPLEMENTATION COMPLETE\` and stop.
2. **Implement** — Work through unchecked tasks. Multiple related tasks per iteration is fine — use judgment on what forms a coherent chunk. Don't force yourself to stop mid-work if the next task is closely related.
   - If proceeding would require guessing — unclear design intent, ambiguous API choice, non-obvious edge-case handling, or choosing between materially different approaches — invoke \`/codex-ask\` to discuss before committing. Resume an existing codex session only if there's a known prior session on the same unresolved question; otherwise start fresh.
3. **Verify** — Run \`cargo check\` (Rust) or the relevant build command. Run related tests. The goal is that each iteration ends in a compilable, test-passing state — but intermediate non-compilation during implementation is acceptable.
4. **Mark** completed tasks \`[x]\` in ${progressTracker}.
5. **Review** — ${command.reviewInstructions}
   - No over-marking: every \`[x]\` task is actually implemented
   - No under-marking: no \`[ ]\` task has actually been implemented already
   - No skips: no doable unchecked tasks remain that should have been done in this chunk
6. **Fix** — ${command.fixInstruction}
7. **Converge** — If you made changes from the review → go back to step 5 and re-review. If no new changes → invoke \`/commit-push\`, then reread ${progressTracker}.
   - If any unchecked task is still doable without guessing or external blockers, continue at step 1 for the next coherent chunk.
   - If remaining unchecked tasks are blocked by missing tools, credentials, approvals, ambiguous requirements, or explicit deferral, report why and stop.
   - Do not treat one committed chunk as completion when more doable work remains.

## Completion gate

Before the final response:

1. Reread ${progressTracker} and list every remaining unchecked \`- [ ]\` task.
2. Classify each unchecked task as either:
   - **doable now** — enough context and local capability exist to implement and verify it, or
   - **blocked/deferred** — it needs missing tooling, credentials, external services, user decisions, or explicit deferral.
3. If any task is **doable now**, continue the loop at step 1 for the next coherent chunk.
4. Only stop when every task is \`[x]\`, or all remaining unchecked tasks are explicitly blocked/deferred and you have reported why.`;
}

async function notify(ctx: CommandContext, message: string, type: "info" | "success" | "warning" | "error"): Promise<void> {
  await ctx.ui?.notify?.(message, type);
}

export default function goalImplementExtension(pi: ExtensionApi): void {
  for (const command of GOAL_COMMANDS) {
    pi.registerCommand?.(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        const [designDoc, progressTracker] = commandArgsToTokens(args);
        if (!designDoc || !progressTracker) {
          await notify(ctx, `Usage: /${command.name} <design-doc> <progress-tracker>`, "warning");
          return;
        }

        if (!pi.sendUserMessage) {
          await notify(ctx, "Cannot start /goal because sendUserMessage is unavailable.", "error");
          return;
        }

        await ctx.waitForIdle?.();
        await pi.sendUserMessage(goalPrompt(designDoc, progressTracker, command), { deliverAs: "followUp" });
        await notify(ctx, "Goal implementation started.", "success");
      },
    });
  }
}
