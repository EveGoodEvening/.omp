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
    reviewInstructions: "Run a reviewer subagent to check:",
    fixInstruction: "Fix according to the reviewer subagent's feedback unless the reviewer subagent says all good.",
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

type GogogoalPromptOptions = {
  parallel: boolean;
  weakClarification: boolean;
};

type GogogoalCommandSpec = {
  name: string;
  description: string;
  usage: string;
  options: GogogoalPromptOptions;
};

const GOGOGOAL_COMMANDS: GogogoalCommandSpec[] = [
  {
    name: "gogogoal-parallel",
    description: "Orchestrate a goal using /goal with parallel chunks",
    usage: "Usage: /gogogoal-parallel <goal-or-plan/checklist references>",
    options: { parallel: true, weakClarification: false },
  },
  {
    name: "gogogoal",
    description: "Orchestrate a goal using /goal without parallel chunks",
    usage: "Usage: /gogogoal <goal-or-plan/checklist references>",
    options: { parallel: false, weakClarification: false },
  },
  {
    name: "gogogoal-parallel-weak",
    description: "Orchestrate a goal using /goal with parallel chunks and proactive decisions",
    usage: "Usage: /gogogoal-parallel-weak <goal-or-plan/checklist references>",
    options: { parallel: true, weakClarification: true },
  },
  {
    name: "gogogoal-weak",
    description: "Orchestrate a goal using /goal sequentially with proactive decisions",
    usage: "Usage: /gogogoal-weak <goal-or-plan/checklist references>",
    options: { parallel: false, weakClarification: true },
  },
];

function gogogoalPrompt(goalOrReferences: string, options: GogogoalPromptOptions): string {
  const gatherInstruction = options.weakClarification
    ? "Gather enough information by delegating codebase exploration/research and using available docs/tools. Do not ask the user for clarification in Step 1; research, inspect, decide proactively, and record the rationale and assumptions in the durable plan."
    : "Gather enough information by delegating codebase exploration/research and using available docs/tools. Ask the user only when a decision materially changes the outcome and cannot be resolved by tools or documentation.";
  const chunkInstruction = options.parallel
    ? "Split the plan into dependency-ordered, reviewable, verifiable, committable chunks. Identify which chunks can run in parallel."
    : "Split the plan into dependency-ordered, reviewable, verifiable, committable chunks, then schedule them sequentially even when multiple chunks are independent.";
  const implementationInstruction = options.parallel
    ? "Implement chunks only through task/subagent workers. The orchestrator must not make real implementation edits itself. Dependent chunks wait for prerequisites."
    : "Implement exactly one selected chunk at a time through task/subagent workers. The orchestrator must not make real implementation edits itself. Finish each chunk's implementation, verification, review-fix loop, and commit before selecting the next chunk.";
  const chunkPolicy = options.parallel
    ? `## Parallel worktree policy

Create separate git worktrees/branches for parallel chunks. Each worktree owns one bounded checklist slice. Never let parallel chunks touch the same files, interfaces, migrations, generated artifacts, or checklist items. Merge back to the starting branch only after a chunk is fully clean.`
    : `## Sequential chunk policy

Do not implement multiple chunks in parallel. Do not create concurrent chunk worktrees or branches. If an isolated worktree/branch is necessary to protect user-owned work or keep the active chunk reviewable, use it for the single active chunk only and merge it back to the starting branch only after that chunk is fully clean.`;

  return `/goal Orchestrate only for the goal below. Do not perform implementation edits, code exploration, online research, or review directly as the orchestrator; delegate those activities and coordinate the results.

## Goal or references

${goalOrReferences}

## Semantics

Treat the raw argument above as either a new goal or references to existing plan/checklist artifacts.

Step 0. **Resume first** — Detect and read existing plan, checklist, and progress artifacts for the same goal before creating anything new. If actionable artifacts exist, resume at implementation/chunking instead of creating a competing plan.
Step 1. **Gather context** — ${gatherInstruction}
Step 2. **Plan durably** — Create or update a durable plan and checklist/progress tracker so future sessions can resume the work.
Step 3. **Chunk the work** — ${chunkInstruction}
Step 4. **Implement by delegation only** — ${implementationInstruction}

${chunkPolicy}

## Commit policy

Never save all work for one final commit. Commit after a green draft chunk implementation, after each green review-fix change, and after a fully clean chunk. Do not commit a red tree. Do not push unless explicitly requested by the user or repository workflow. Only commit current-chunk owned changes and tracker updates; protect pre-existing/user-owned changes.

## Review and completion

Step 5. **Per-chunk review-fix loop** — After implementing a chunk and passing its required verification, update the checklist/progress tracker before starting the chunk review: mark only completed and verified items, leave partial or blocked work unchecked with notes, and then run review. Do not over-mark, under-mark, or skip doable tasks. Use external review via reviewer subagent or the \`codex-review-code\` skill according to availability/project convention. Fix actionable feedback, verify, update the checklist again if task status changed, commit, and re-review until clean.
Step 6. **Final split review** — Split the whole implementation into reviewable chunks. Review each chunk, then fix, verify, commit, and re-review until clean.

## Final gate

Before stopping, reread the checklist/progress tracker. Classify every unchecked task as either doable now or blocked/deferred. Continue if any unchecked task is doable now. Stop only when all tasks are checked or every remaining unchecked task has a concrete blocker.`;
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

function registerRawGoalCommand(
  pi: ExtensionApi,
  name: string,
  description: string,
  usage: string,
  buildPrompt: (goalOrReferences: string) => string,
): void {
  pi.registerCommand?.(name, {
    description,
    handler: async (args, ctx) => {
      const goalOrReferences = commandArgsToRaw(args);
      if (!goalOrReferences) {
        await notify(ctx, usage, "warning");
        return;
      }

      await sendGoalPrompt(pi, ctx, buildPrompt(goalOrReferences));
    },
  });
}

export default function goalWorkflowsExtension(pi: ExtensionApi): void {
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

  for (const command of GOGOGOAL_COMMANDS) {
    registerRawGoalCommand(
      pi,
      command.name,
      command.description,
      command.usage,
      (goalOrReferences) => gogogoalPrompt(goalOrReferences, command.options),
    );
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
