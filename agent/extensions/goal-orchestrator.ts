type DeliveryMode = "steer" | "followUp" | "nextTurn";

type UiContext = {
  notify?: (message: string, type?: "info" | "success" | "warning" | "error") => void | Promise<void>;
  setEditorText?: (text: string) => void | Promise<void>;
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

function commandArgsToParts(args: unknown): string[] {
  if (Array.isArray(args)) return args.map((arg) => String(arg));

  if (typeof args === "string") return parseShellLikeArgs(args);
  if (!args || typeof args !== "object") return [];

  const record = args as Record<string, unknown>;
  const maybeArgs = record.args;
  if (Array.isArray(maybeArgs)) return maybeArgs.map((arg) => String(arg));

  for (const key of ["ARGUMENTS", "arguments", "raw", "input"]) {
    const value = record[key];
    if (typeof value === "string") return parseShellLikeArgs(value);
  }

  return [];
}

function parseShellLikeArgs(raw: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (const ch of raw.trim()) {
    if (quote) {
      if (ch === quote) {
        quote = undefined;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) parts.push(current);
  return parts;
}

type GoalPrefillCommandSpec = {
  name: string;
  description: string;
  usage: string;
  buildPrompt: (rawArgs: string, parts: readonly string[]) => string | undefined;
};

function goalImplPrefillPrompt(
  parts: readonly string[],
  buildPrompt: (designDoc: string, progressTracker: string) => string,
): string | undefined {
  const [designDoc, progressTracker] = parts;
  if (!designDoc || !progressTracker) return undefined;
  return buildPrompt(designDoc, progressTracker);
}

const GOAL_PREFILL_COMMANDS: GoalPrefillCommandSpec[] = [
  {
    name: "goal-fix",
    description: "Draft a /goal fix prompt into the editor",
    usage: "Usage: /goal-fix <problem>",
    buildPrompt: (rawArgs) => {
      if (!rawArgs) return undefined;
      return goalFixPrompt(rawArgs);
    },
  },
  {
    name: "goal-impl-fast",
    description: "Draft a fast /goal implementation prompt into the editor",
    usage: "Usage: /goal-impl-fast <design-doc> <progress-tracker>",
    buildPrompt: (_rawArgs, parts) => goalImplPrefillPrompt(parts, goalImplFastPrompt),
  },
  {
    name: "goal-impl-strict",
    description: "Draft a strict /goal implementation prompt into the editor",
    usage: "Usage: /goal-impl-strict <design-doc> <progress-tracker>",
    buildPrompt: (_rawArgs, parts) => goalImplPrefillPrompt(parts, goalImplStrictPrompt),
  },
  {
    name: "goal-review-impl",
    description: "Draft a /goal implementation-review prompt into the editor",
    usage: "Usage: /goal-review_impl <review-scope>",
    buildPrompt: (rawArgs) => goalReviewImplPrompt(rawArgs),
  },
];

function goalFixPrompt(problem: string): string {
  return `/goal set Fix the problem described below using an iterative fix-review loop.

Problem:
${problem}

Outcome:
The reported problem is correctly resolved with the smallest valuable in-scope change set. Assess the issue first, decide which aspects are worth fixing, then implement only the necessary changes.

Verification:
Run the relevant checks for this repository after each focused fix, such as tests, type checks, lint checks, or targeted manual verification. Record the commands run and the evidence that the problem is fixed. After code changes, use the codex-review-code skill to review all changes.

Constraints:
Do not broaden scope beyond the reported problem. Do not add speculative features, unnecessary abstractions, compatibility shims, or unrelated cleanup. Preserve existing behavior unless changing it is necessary to fix the problem.

Boundaries:
Write only to files needed for the fix. Do not modify unrelated files, generated artifacts, secrets, dependency versions, CI/CD configuration, or documentation unless the fix directly requires it.

Iteration policy:
Setup only starts the loop; the fix/review cycle must happen in loop iterations.

Each loop iteration:
1. Assess the problem and decide what should be fixed.
2. Apply one focused set of changes.
3. Run relevant verification.
4. Use the codex-review-code skill to review all changes.
5. Evaluate each review item:
   - Incorporate: correct, valuable, and in scope; fix it.
   - Discard: wrong, out of scope, or low priority; explain why it is dismissed.
6. If any review feedback was incorporated and new changes were made, rerun verification and request another codex-review-code review.
7. Continue until converged.

Stop when:
The problem is fixed, verification evidence supports completion, and either codex-review-code has no actionable feedback or all remaining feedback has been explicitly discarded without making further changes.

Pause if:
The root cause is unclear, the fix requires a product decision, verification cannot be run, required permissions are missing, the change would affect risky/shared systems, or the loop exceeds three review rounds without convergence.`;
}

function goalImplPrompt(designDoc: string, progressTracker: string, reviewTool: string): string {
  const reviewerName = reviewTool.includes("codex-review-code") ? "Codex" : "the reviewer subagent";
  return `/goal set Implement all doable tasks from design doc ${designDoc} and progress tracker ${progressTracker} using an iterative implement-review loop until the tracker is complete or only explicitly blocked/deferred tasks remain.

Verification:
- At the start of each iteration, read ${designDoc} and ${progressTracker} and identify unchecked \`- [ ]\` tasks.
- After implementation, run \`cargo check\` for Rust work, or the relevant project build/typecheck command if this is not Rust.
- Run related tests for the changed area.
- Each committed iteration must end in a compilable, test-passing state unless a blocker is explicitly recorded.
- Before stopping, reread ${progressTracker} and classify every remaining unchecked task as either doable now or blocked/deferred.

Constraints:
- Do not mark a task \`[x]\` unless it is actually implemented and verified.
- Do not leave already-implemented tasks unchecked.
- Do not skip doable unchecked tasks just because one coherent chunk has been committed.
- Do not guess on unclear design intent, ambiguous APIs, non-obvious edge cases, or materially different implementation approaches.
- If guessing would be required, invoke \`/codex-ask\` before committing. Resume an existing Codex session only if there is a known prior session for the same unresolved question; otherwise start fresh.
- Intermediate non-compilation during implementation is acceptable, but each iteration must converge back to passing verification.

Boundaries:
- Read ${designDoc} for design intent and ${progressTracker} for task status.
- Update ${progressTracker} only to mark truly completed tasks \`[x]\` or to record clear blocked/deferred reasons when stopping.
- Make only implementation changes needed for the unchecked tasks in the current coherent chunk.
- Do not clean up loop files while any unchecked task is still doable now.

Iteration policy:
1. Read ${designDoc} and ${progressTracker}.
2. If all tasks are \`[x]\`, output \`<promise>IMPLEMENTATION COMPLETE</promise>\` and stop.
3. Choose a coherent chunk of unchecked doable tasks. Multiple related tasks per iteration are allowed.
4. Implement the chunk.
5. Run build/check commands and related tests.
6. Mark completed tasks \`[x]\` in ${progressTracker}.
7. Run ${reviewTool} to check:
   - no over-marking: every \`[x]\` task is actually implemented;
   - no under-marking: no \`[ ]\` task has already been implemented;
   - no skips: no doable unchecked task remains that should have been included in this chunk.
8. Fix according to ${reviewerName} feedback unless ${reviewerName} says all good.
9. If review fixes changed anything, rerun ${reviewTool} and repeat until clean.
10. When review is clean, run \`/commit-push\`.
11. Reread ${progressTracker}. If any unchecked task is still doable now, continue the loop with the next coherent chunk.

Stop when:
- All tasks in ${progressTracker} are \`[x]\`, in which case output \`<promise>IMPLEMENTATION COMPLETE</promise>\`; or
- Every remaining unchecked task is blocked/deferred, and the response lists each remaining unchecked task with the reason it cannot be done now.

Pause if:
- Design intent is unclear.
- API choice is ambiguous.
- Edge-case behavior requires a human decision.
- Required tools, credentials, services, approvals, or external state are missing.
- Verification cannot be run locally for reasons outside the implementation.`;
}

function goalImplFastPrompt(designDoc: string, progressTracker: string): string {
  return goalImplPrompt(designDoc, progressTracker, "a reviewer subagent");
}

function goalImplStrictPrompt(designDoc: string, progressTracker: string): string {
  return goalImplPrompt(designDoc, progressTracker, "`codex-review-code`");
}

function goalReviewImplPrompt(reviewScope: string): string {
  return `/goal set Review and fix implementation issues in the requested scope via an iterative Codex review-fix loop.

Review scope:
${reviewScope}

Outcome:
Run an iterative review-fix loop until Codex reports the implementation is clean, or until there are no correct/actionable findings to incorporate.

Review:
- Run the \`codex-review-code\` skill.
- Pass the review scope description directly to Codex. Do not resolve it yourself into concrete git diff commands.
- Valid scope examples include:
  - empty or \`uncommitted\` → uncommitted changes
  - \`last 3 commits\`
  - \`branch X vs branch Y\`
  - \`<commit-sha>\`
  - \`<file-path>\`
- On the first review, ask Codex to review the original scope.
- On every re-review after fixes, ask Codex to review the original scope plus any uncommitted working tree changes.

Evaluate:
- For each Codex finding, classify it as:
  - Incorporate — correct, relevant, and worth fixing.
  - Discard — incorrect, out of scope, duplicate, low-priority, or not worth changing.
- Briefly record the classification and reason.

Fix:
- If at least one finding is classified Incorporate, apply one focused set of fixes.
- Do not make unrelated refactors or opportunistic cleanup.
- Preserve intended behavior unless the incorporated finding requires a behavior change.
- After fixing, run relevant checks.
- Then run \`/commit-push\`.

Iteration policy:
- After every fix and \`/commit-push\`, return to Review.
- Do not self-certify the implementation as clean.
- Do not emit \`<promise>ALL CLEAN</promise>\` after making fixes.
- Only Codex, during a Review step, can justify declaring the implementation clean.

Verification:
- Evidence must include Codex review output for the current iteration.
- Evidence for fixes must include the relevant test/check commands or an explanation if no automated check applies.
- Re-review must include the current repo state, including uncommitted changes, so Codex can see the fixes.

Constraints:
- Fix only implementation issues found by Codex that are classified Incorporate.
- Do not change files outside the reviewed scope unless required to correctly fix an incorporated issue.
- Do not bypass hooks, skip checks, force-push, or use destructive git operations.
- Do not emit \`<promise>ALL CLEAN</promise>\` unless Codex reports no issues in the Review step.

Boundaries:
- Allowed writes: files necessary to fix incorporated findings.
- Forbidden writes: unrelated documentation, unrelated refactors, generated artifacts, secrets, dependency changes unless explicitly required by an incorporated finding.

Stop when:
- Codex finds no issues in a Review step; then output exactly:
  \`<promise>ALL CLEAN</promise>\`
- Or Codex findings are all classified Discard with no actionable fixes remaining; summarize why and stop without claiming ALL CLEAN.

Pause if:
- A finding requires a product decision, risky migration, destructive action, dependency downgrade/removal, security-sensitive change, or scope expansion.
- Checks fail for reasons unrelated to the incorporated fixes.
- The loop exceeds 5 review-fix iterations.`;
}

type GogogoalPromptOptions = {
  parallel: boolean;
  proactive: boolean;
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
    description: "Orchestrate a goal workflow with parallel chunks",
    usage: "Usage: /gogogoal-parallel <goal-or-plan/checklist references>",
    options: { parallel: true, proactive: false },
  },
  {
    name: "gogogoal",
    description: "Orchestrate a goal workflow without parallel chunks",
    usage: "Usage: /gogogoal <goal-or-plan/checklist references>",
    options: { parallel: false, proactive: false },
  },
  {
    name: "gogogoal-parallel-proactive",
    description: "Orchestrate a goal workflow with parallel chunks and proactive no-clarification decisions",
    usage: "Usage: /gogogoal-parallel-proactive <goal-or-plan/checklist references>",
    options: { parallel: true, proactive: true },
  },
  {
    name: "gogogoal-proactive",
    description: "Orchestrate a goal workflow sequentially with proactive no-clarification decisions",
    usage: "Usage: /gogogoal-proactive <goal-or-plan/checklist references>",
    options: { parallel: false, proactive: true },
  },
];

function gogogoalPrompt(goalOrReferences: string, options: GogogoalPromptOptions): string {
  const gatherInstruction = options.proactive
    ? "Gather enough information by a workflow delegating codebase exploration/research and using available docs/tools. Do not ask the user for clarification in Step 1; research, inspect, decide proactively, and record the rationale and assumptions in the durable plan."
    : "Gather enough information by a workflow delegating codebase exploration/research and using available docs/tools. Ask the user only when a decision materially changes the outcome and cannot be resolved by tools or documentation.";
  const chunkInstruction = options.parallel
    ? "Split the plan into dependency-ordered, reviewable, verifiable, committable chunks. Identify which chunks can run in parallel."
    : "Split the plan into dependency-ordered, reviewable, verifiable, committable chunks, then schedule them sequentially even when multiple chunks are independent.";
  const implementationInstruction = options.parallel
    ? "Implement chunks only through task/subagent workers. The orchestrator must not make real implementation edits itself. Dependent chunks wait for prerequisites."
    : "Implement exactly one selected chunk at a time through task/subagent workers. The orchestrator must not make real implementation edits itself. Finish each chunk's implementation, verification, review-fix loop, and commit before selecting the next chunk.";
  const chunkPolicy = options.parallel
    ? `## Parallel worktree policy

Create separate git worktrees/branches for parallel chunks. Each worktree owns one bounded checklist slice. Never let parallel chunks touch the same files, interfaces, migrations, generated artifacts, or checklist items. Merge back to the starting branch only after a chunk is fully clean. After the merge succeeds, remove that chunk worktree with \`git worktree remove\` and prune stale worktree metadata before considering the chunk closed.`
    : `## Sequential chunk policy

Do not implement multiple chunks in parallel. Do not create concurrent chunk worktrees or branches. If an isolated worktree/branch is necessary to protect user-owned work or keep the active chunk reviewable, use it for the single active chunk only and merge it back to the starting branch only after that chunk is fully clean. After the merge succeeds, remove that chunk worktree with \`git worktree remove\` and prune stale worktree metadata before considering the chunk closed.`;

  return `orchestrate only for the goal below. Do not perform implementation edits, code exploration, online research, or review directly as the orchestrator; delegate those activities and coordinate the results.

## Goal or references

${goalOrReferences}

## Semantics

Treat the raw argument above as either a new goal or references to existing plan/checklist artifacts.

Step 0. **Resume first** — Detect and read existing plan, checklist, and progress artifacts for the same goal before creating anything new. If actionable artifacts exist, resume at implementation/chunking instead of creating a competing plan.
Step 1. **Gather context** — ${gatherInstruction}
Step 2. **Plan durably** — Create or update a durable plan and checklist/progress tracker so future sessions can resume the work.
Step 3. **Chunk the work** — ${chunkInstruction} Record the chunks in the durable plan/checklist, then git commit the new or updated planning artifacts before implementation begins.
Step 4. **Implement by delegation only** — ${implementationInstruction}

${chunkPolicy}

## Commit policy

Never save all work for one final commit. Use Conventional Commit messages for every commit. Commit after creating and chunking a new plan/checklist, after a green draft chunk implementation, after each green review-fix change, and after a fully clean chunk. Do not commit a red tree. Do not push unless explicitly requested by the user or repository workflow. Only commit current-chunk owned changes and tracker updates; protect pre-existing/user-owned changes.

## Review and completion

Step 5. **Per-chunk review-fix loop** — After implementing a chunk and passing its required verification, update the checklist/progress tracker before starting the chunk review: mark only completed and verified items, leave partial or blocked work unchecked with notes, and then run review. Do not over-mark, under-mark, or skip doable tasks. Use review workflow / the \`codex-review-code\` skill / external review via reviewer subagent depending on the best-fit. Fix actionable feedback, verify, update the checklist again if task status changed, commit, and re-review until clean.
Step 6. **Final split review** — Split the whole implementation into reviewable chunks. For each review chunk, use review workflow / the \`codex-review-code\` skill / external review via reviewer subagent depending on the best-fit, review the chunk, then fix, verify, commit, and re-review until clean.

## Final gate

Before stopping, reread the checklist/progress tracker. Classify every unchecked task as either doable now or blocked/deferred. Continue if any unchecked task is doable now. Stop only when all tasks are checked or every remaining unchecked task has a concrete blocker.`;
}

async function notify(ctx: CommandContext, message: string, type: "info" | "success" | "warning" | "error"): Promise<void> {
  await ctx.ui?.notify?.(message, type);
}

async function sendWorkflowPrompt(pi: ExtensionApi, ctx: CommandContext, prompt: string, label: string): Promise<void> {
  if (!pi.sendUserMessage) {
    await notify(ctx, `Cannot start ${label} because sendUserMessage is unavailable.`, "error");
    return;
  }

  await ctx.waitForIdle?.();
  await pi.sendUserMessage(prompt, { deliverAs: "nextTurn" });
  await notify(ctx, `${label} started.`, "success");
}

async function prefillEditorPrompt(ctx: CommandContext, prompt: string, label: string): Promise<void> {
  if (!ctx.ui?.setEditorText) {
    await notify(ctx, `Cannot draft ${label} because editor text control is unavailable.`, "error");
    return;
  }

  await ctx.ui.setEditorText(prompt);
  await notify(ctx, `${label} drafted. Press Enter to submit.`, "success");
}

function registerGoalPrefillCommand(pi: ExtensionApi, command: GoalPrefillCommandSpec): void {
  pi.registerCommand?.(command.name, {
    description: command.description,
    handler: async (args, ctx) => {
      const raw = commandArgsToRaw(args);
      const prompt = command.buildPrompt(raw, commandArgsToParts(args));
      if (!prompt) {
        await notify(ctx, command.usage, "warning");
        return;
      }

      await prefillEditorPrompt(ctx, prompt, `/${command.name}`);
    },
  });
}

function registerGogogoalCommand(
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

      await sendWorkflowPrompt(pi, ctx, buildPrompt(goalOrReferences), `/${name}`);
    },
  });
}

export default function goalOrchestratorExtension(pi: ExtensionApi): void {
  for (const command of GOAL_PREFILL_COMMANDS) {
    registerGoalPrefillCommand(pi, command);
  }

  for (const command of GOGOGOAL_COMMANDS) {
    registerGogogoalCommand(
      pi,
      command.name,
      command.description,
      command.usage,
      (goalOrReferences) => gogogoalPrompt(goalOrReferences, command.options),
    );
  }
}
