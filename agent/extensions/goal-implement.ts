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

function commandArgsToRaw(args: unknown): string {
  if (Array.isArray(args)) return args.map((arg) => String(arg)).join(" ").trim();
  if (typeof args === "string") return args.trim();
  if (!args || typeof args !== "object") return "";

  const record = args as Record<string, unknown>;
  for (const key of ["ARGUMENTS", "arguments", "raw", "input"]) {
    const value = record[key];
    if (typeof value === "string") return value.trim();
  }

  const maybeArgs = record.args;
  if (Array.isArray(maybeArgs)) return maybeArgs.map((arg) => String(arg)).join(" ").trim();
  return "";
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

function goalFixPrompt(problem: string): string {
  return `/goal Fix the problem below via an iterative fix-review loop.

## Problem

${problem}

## Loop behavior

Repeat until the fix-review cycle converges:

1. **Assess** — Understand the problem. Decide what changes are needed and whether each aspect is worth fixing (correct, in-scope, valuable) before writing any code.
2. **Fix** — Apply the changes you decided to make.
3. **Review** — Use the \`codex-review-code\` skill to get a code review of all changes.
4. **Evaluate** — Judge the review feedback. For each item, classify it as:
   - **Incorporate** — correct and valuable → fix it.
   - **Discard** — wrong, out-of-scope, or low-priority → dismiss it.
5. **Decide whether to loop again:**
   - If you incorporated any feedback and made new changes → go back to step 3 and re-review the updated code.
   - If Codex approves with no actionable feedback → stop.
   - If all remaining feedback was discarded and no new changes were made → stop.
6. **Repeat** until converged (no new changes made in a round).`;
}

function goalReviewImplPrompt(scope: string): string {
  return `/goal Review and fix implementation issues via an iterative review-fix loop.

Unlike \`/goal-fix\` (which starts from a known problem), this command starts by asking Codex to review the implementation, then fixes whatever it finds.

## Review scope

${scope || "uncommitted"}

Pass the scope description directly to Codex — let Codex resolve it into concrete diff commands. Examples of valid scope descriptions:
- \`uncommitted\` or empty → uncommitted changes
- \`last 3 commits\` → last 3 commits
- \`branch X vs branch Y\` → diff between two branches
- \`<commit-sha>\` → a specific commit
- \`<file-path>\` → changes in a specific file

On re-review iterations (after fixes), tell Codex to also review any uncommitted working tree changes alongside the original scope. Codex sees the current state of the repo each time, so fixes are automatically visible.

## Loop behavior

1. **Review** — Run the \`codex-review-code\` skill asking Codex to review the scope. On re-review iterations, tell Codex to include uncommitted changes too.
   - If Codex finds no issues → output \`ALL CLEAN\` and stop.
2. **Evaluate** — Judge the review feedback. For each item, classify it as:
   - **Incorporate** — correct and valuable → fix it.
   - **Discard** — wrong, out-of-scope, or low-priority → dismiss it.
3. **Decide:**
   - If nothing should be incorporated (all feedback was discarded or there was no actionable feedback) → stop.
   - Otherwise → proceed to step 4.
4. **Fix** — Apply the changes you decided to incorporate, then invoke \`/commit-push\`.
5. **Re-review** — Go back to step 1. Do not emit \`ALL CLEAN\` here. Only Codex in step 1 can declare ALL CLEAN; do not self-certify your own fixes.`;
}

async function notify(ctx: CommandContext, message: string, type: "info" | "success" | "warning" | "error"): Promise<void> {
  await ctx.ui?.notify?.(message, type);
}

async function sendGoalPrompt(pi: ExtensionApi, ctx: CommandContext, prompt: string): Promise<void> {
  if (!pi.sendUserMessage) {
    await notify(ctx, "Cannot start /goal because sendUserMessage is unavailable.", "error");
    return;
  }

  await ctx.waitForIdle?.();
  await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  await notify(ctx, "Goal started.", "success");
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

        await sendGoalPrompt(pi, ctx, goalPrompt(designDoc, progressTracker, command));
      },
    });
  }

  pi.registerCommand?.("goal-fix", {
    description: "Fix a problem using /goal and Codex review",
    handler: async (args, ctx) => {
      const problem = commandArgsToRaw(args);
      if (!problem) {
        await notify(ctx, "Usage: /goal-fix <problem>", "warning");
        return;
      }

      await sendGoalPrompt(pi, ctx, goalFixPrompt(problem));
    },
  });

  pi.registerCommand?.("goal-review-impl", {
    description: "Review and fix implementation issues using /goal",
    handler: async (args, ctx) => {
      await sendGoalPrompt(pi, ctx, goalReviewImplPrompt(commandArgsToRaw(args)));
    },
  });
}
