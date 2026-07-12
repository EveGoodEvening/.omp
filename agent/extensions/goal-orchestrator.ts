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

type ReviewerEffort = "xhigh";

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
  // {
  //   name: "goal-fix-xhreview",
  //   description: "Draft a /goal fix prompt with xhigh reviewer subagents into the editor",
  //   usage: "Usage: /goal-fix-xhreview <problem>",
  //   buildPrompt: (rawArgs) => {
  //     if (!rawArgs) return undefined;
  //     return goalFixPrompt(rawArgs, "xhigh");
  //   },
  // },
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
  // {
  //   name: "goal-impl-strict-xhreview",
  //   description: "Draft a strict /goal implementation prompt with xhigh reviewer subagents into the editor",
  //   usage: "Usage: /goal-impl-strict-xhreview <design-doc> <progress-tracker>",
  //   buildPrompt: (_rawArgs, parts) => goalImplPrefillPrompt(
  //     parts,
  //     (designDoc, progressTracker) => goalImplPrompt(designDoc, progressTracker, "strict", "xhigh"),
  //   ),
  // },
  {
    name: "goal-review-impl",
    description: "Draft a /goal implementation-review prompt into the editor",
    usage: "Usage: /goal-review-impl <review-scope>",
    buildPrompt: (rawArgs) => goalReviewImplPrompt(rawArgs),
  },
  // {
  //   name: "goal-review-impl-xhreview",
  //   description: "Draft a /goal implementation-review prompt with xhigh reviewer subagents into the editor",
  //   usage: "Usage: /goal-review-impl-xhreview <review-scope>",
  //   buildPrompt: (rawArgs) => goalReviewImplPrompt(rawArgs, "xhigh"),
  // },
];

function reviewerEffortPrompt(reviewerEffort?: ReviewerEffort): string {
  if (reviewerEffort !== "xhigh") return "";

  return `

Reviewer subagent effort policy:
For every reviewer subagent in every review and re-review round, explicitly request xhigh thinking/reasoning effort.`;
}

function goalFixPrompt(problem: string, reviewerEffort?: ReviewerEffort): string {
  const reviewerPrompt = reviewerEffortPrompt(reviewerEffort);
  return `/goal set Fix the problem described below using an iterative fix-review loop.

Problem:
${problem}

Outcome:
The reported problem is correctly resolved with the smallest valuable in-scope change set. Assess the issue first, decide which aspects are worth fixing, then implement only the necessary changes.

Verification:
Run the relevant checks for this repository after each focused fix, such as tests, type checks, lint checks, or targeted manual verification. Record the commands run and the evidence that the problem is fixed. After code changes, run a reviewer subagent to review all changes.

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
4. Run a reviewer subagent to review all changes.
5. Evaluate each review item:
   - Incorporate: correct, valuable, and in scope; fix it.
   - Discard: wrong, out of scope, or low priority; explain why it is dismissed.
6. If any review feedback was incorporated and new changes were made, rerun verification and request another reviewer subagent review.
7. Continue until converged.${reviewerPrompt}

Stop when:
The problem is fixed, verification evidence supports completion, and either reviewer subagent has no actionable feedback or all remaining feedback has been explicitly discarded without making further changes.

Pause if:
The root cause is unclear, the fix requires a product decision, verification cannot be run, required permissions are missing, the change would affect risky/shared systems, or the loop exceeds 5 review rounds without convergence.`;
}

function goalImplPrompt(designDoc: string, progressTracker: string, reviewMode: string, reviewerEffort?: ReviewerEffort): string {
  const reviewModePrompt = reviewMode.includes("fast") ? "" : "\n   - no bugs: no non-trivial bugs";
  const reviewerPrompt = reviewerEffortPrompt(reviewerEffort);
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
- If guessing would be required, discuss with a plan subagent before implementing. Continue discussion for as many rounds as needed until the decisions are clear and finalized.
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
7. Run a reviewer subagent to check:
   - no over-marking: every \`[x]\` task is actually implemented;
   - no under-marking: no \`[ ]\` task has already been implemented;
   - no skips: no doable unchecked task remains that should have been included in this chunk.${reviewModePrompt}
8. Fix according to the reviewer subagent feedback unless the reviewer subagent says all good.
9. If review fixes changed anything, rerun another reviewer subagent and repeat until clean.
10. When review is clean, run \`/commit-push\`.
11. Reread ${progressTracker}. If any unchecked task is still doable now, continue the loop with the next coherent chunk.${reviewerPrompt}

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
  return goalImplPrompt(designDoc, progressTracker, "fast");
}

function goalImplStrictPrompt(designDoc: string, progressTracker: string): string {
  return goalImplPrompt(designDoc, progressTracker, "strict");
}

function goalReviewImplPrompt(reviewScope: string, reviewerEffort?: ReviewerEffort): string {
  const reviewerPrompt = reviewerEffortPrompt(reviewerEffort);
  return `/goal set Review and fix implementation issues in the requested scope via a review-fix loop.

Review scope:
${reviewScope}

Outcome:
Run an iterative review-fix loop until reviewwe subagent reports the implementation is clean, or until there are no correct/actionable findings to incorporate.

Review:
- Run a reviewer subagent
- Pass the review scope description directly to the review subagent. Do not resolve it yourself into concrete git diff commands.
- Valid scope examples include:
  - empty or \`uncommitted\` → uncommitted changes
  - \`last 3 commits\`
  - \`branch X vs branch Y\`
  - \`<commit-sha>\`
  - \`<file-path>\`
- On the first review, ask review subagent to review the original scope.
- On every re-review after fixes, ask review subagent to review the original scope plus any uncommitted working tree changes.${reviewerPrompt}

Evaluate:
- For each review subagent finding, classify it as:
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
- Only review subagent, during a Review step, can justify declaring the implementation clean.

Verification:
- Evidence must include review subagent review output for the current iteration.
- Evidence for fixes must include the relevant test/check commands or an explanation if no automated check applies.
- Re-review must include the current repo state, including uncommitted changes, so review subagent can see the fixes.

Constraints:
- Fix only implementation issues found by review subagent that are classified Incorporate.
- Do not change files outside the reviewed scope unless required to correctly fix an incorporated issue.
- Do not bypass hooks, skip checks, force-push, or use destructive git operations.
- Do not emit \`<promise>ALL CLEAN</promise>\` unless review subagent reports no issues in the Review step.

Boundaries:
- Allowed writes: files necessary to fix incorporated findings.
- Forbidden writes: unrelated documentation, unrelated refactors, generated artifacts, secrets, dependency changes unless explicitly required by an incorporated finding.

Stop when:
- review subagent finds no issues in a Review step; then output exactly:
  \`<promise>ALL CLEAN</promise>\`
- Or review subagent findings are all classified Discard with no actionable fixes remaining; summarize why and stop without claiming ALL CLEAN.

Pause if:
- A finding requires a product decision, risky migration, destructive action, dependency downgrade/removal, security-sensitive change, or scope expansion.
- Checks fail for reasons unrelated to the incorporated fixes.
- The loop exceeds 50 review-fix iterations.`;
}

type GogogoalPromptOptions = {
  parallel: boolean;
  proactive: boolean;
  reviewerEffort?: ReviewerEffort;
};

type GogogoalCommandSpec = {
  name: string;
  description: string;
  usage: string;
  options: GogogoalPromptOptions;
};

const GOGOGOAL_COMMANDS: GogogoalCommandSpec[] = [
  {
    name: "gogogoal",
    description: "Orchestrate a goal workflow without parallel chunks",
    usage: "Usage: /gogogoal <goal-or-plan/checklist references>",
    options: { parallel: false, proactive: false },
  },
  // {
  //   name: "gogogoal-xhreview",
  //   description: "Orchestrate a goal workflow without parallel chunks and with xhigh reviewer subagents",
  //   usage: "Usage: /gogogoal-xhreview <goal-or-plan/checklist references>",
  //   options: { parallel: false, proactive: false, reviewerEffort: "xhigh" },
  // },
  {
    name: "gogogoal-parallel",
    description: "Orchestrate a goal workflow with parallel chunks",
    usage: "Usage: /gogogoal-parallel <goal-or-plan/checklist references>",
    options: { parallel: true, proactive: false },
  },
  // {
  //   name: "gogogoal-parallel-xhreview",
  //   description: "Orchestrate a goal workflow with parallel chunks and xhigh reviewer subagents",
  //   usage: "Usage: /gogogoal-parallel-xhreview <goal-or-plan/checklist references>",
  //   options: { parallel: true, proactive: false, reviewerEffort: "xhigh" },
  // },
  {
    name: "gogogoal-parallel-proactive",
    description: "Orchestrate a goal workflow with parallel chunks and proactive no-clarification decisions",
    usage: "Usage: /gogogoal-parallel-proactive <goal-or-plan/checklist references>",
    options: { parallel: true, proactive: true },
  },
  // {
  //   name: "gogogoal-parallel-proactive-xhreview",
  //   description: "Orchestrate a goal workflow with parallel chunks, proactive no-clarification decisions, and xhigh reviewer subagents",
  //   usage: "Usage: /gogogoal-parallel-proactive-xhreview <goal-or-plan/checklist references>",
  //   options: { parallel: true, proactive: true, reviewerEffort: "xhigh" },
  // },
  {
    name: "gogogoal-proactive",
    description: "Orchestrate a goal workflow sequentially with proactive no-clarification decisions",
    usage: "Usage: /gogogoal-proactive <goal-or-plan/checklist references>",
    options: { parallel: false, proactive: true },
  },
  // {
  //   name: "gogogoal-proactive-xhreview",
  //   description: "Orchestrate a goal workflow sequentially with proactive no-clarification decisions and xhigh reviewer subagents",
  //   usage: "Usage: /gogogoal-proactive-xhreview <goal-or-plan/checklist references>",
  //   options: { parallel: false, proactive: true, reviewerEffort: "xhigh" },
  // },
];

function gogogoalPrompt(goalOrReferences: string, options: GogogoalPromptOptions): string {
  const gatherInstruction = options.proactive
    ? "Gather enough information by a workflowz delegating codebase exploration/research and using available docs/tools. Do not ask the user for clarification in Step 1; research, inspect, decide proactively, and record the rationale and assumptions in the durable plan."
    : "Gather enough information by a workflowz delegating codebase exploration/research and using available docs/tools. Ask the user only when a decision materially changes the outcome and cannot be resolved by tools or documentation.";
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
  const reviewerEffortPolicy = options.reviewerEffort === "xhigh"
    ? `

## Reviewer subagent effort policy

For every reviewer subagent or review workflowz in the plan review gate, per-chunk review-fix loop, final split review, and all re-review rounds, explicitly request xhigh thinking/reasoning effort. Do not apply xhigh effort to implementation workers unless a separate instruction requires it.`
    : "";

  return `orchestrate only for the goal below. Do not perform implementation edits, code exploration, online research, or review directly as the orchestrator; delegate those activities and coordinate the results.

## Goal or references

${goalOrReferences}

## Semantics

Treat the raw argument above as either a new goal or references to existing plan/checklist artifacts.

## Scope completion invariant

When the goal references a durable plan/checklist, treat every unchecked, doable item in that checklist as in scope. "Implement the next chunk" means start with the next unchecked chunk, not stop after it, unless the user explicitly says to implement only that single chunk or to stop after it.

For sequential mode, select the next dependency-ready unchecked chunk, implement it, verify it, run its review-fix loop, update the tracker, commit it, then immediately reread the tracker and select the next dependency-ready unchecked chunk. A clean chunk commit is not a yield point while another unchecked chunk is doable.

Do not classify later chunks as future/deferred merely because one chunk completed. A later chunk may be deferred only if it has a concrete blocker, dependency, product decision, or explicit user-approved scope reduction recorded in the durable tracker. Split-turn summaries, resumed context, or "next chunk" language must not shrink the durable checklist scope unless they explicitly say "only this chunk" or "stop after this chunk".

Step 0. **Resume first** — Detect and read existing plan, checklist, and progress artifacts for the same goal before creating anything new. If actionable artifacts exist, resume from them instead of creating a competing plan.
  - **In-progress resume:** If a durable plan/checklist/progress tracker exists and there is evidence implementation has already started (checked or in-progress tracker items, implementation commits, worktree changes tied to checklist items, or notes naming an active chunk/step), do not re-chunk the plan and do not run the plan review gate again. Resume at Step 5 or Step 6 with the current/next doable unchecked item. Only update planning artifacts enough to record current status, blockers, or newly discovered constraints.
  - **Pre-implementation resume:** If artifacts exist but there is no evidence implementation has started, continue with context gathering as needed, chunking, and the plan review gate before implementation begins.
Step 1. **Gather context** — ${gatherInstruction}
Step 2. **Plan durably** — Delegate to a dedicated plan subagent to create or update the durable plan and checklist/progress tracker so future sessions can resume the work. The orchestrator coordinates and validates the planning artifact only; it must not design the plan itself. Skip this step for an in-progress resume unless the tracker is missing, stale, or insufficient to identify the current/next implementation item.
Step 3. **Chunk the work** — ${chunkInstruction} Record the chunks in the durable plan/checklist, then git commit the new or updated planning artifacts before implementation begins. Skip this step for an in-progress resume.
Step 4. **Plan review gate** — Before implementation begins, delegate to an independent reviewer subagent to review the durable plan, checklist/progress tracker, and chunking for goal coverage, feasibility, verifiability, dependency order, reviewable/committable chunk boundaries, parallel-safety, missing migration/testing/rollback/risk items, and unresolved decisions. Fix actionable planning feedback, then rerun the plan review until clean or all remaining findings are explicitly classified as discarded with reasons. Skip this step for an in-progress resume unless implementation is blocked by missing, contradictory, or unsafe planning information.
Step 5. **Implement by delegation only** — ${implementationInstruction}

${chunkPolicy}${reviewerEffortPolicy}

## Commit policy

Never save all work for one final commit. Use Conventional Commit messages for every commit. Commit after creating, chunking, and satisfying the plan review gate for new or updated planning artifacts, after a green draft chunk implementation, after each green review-fix change, and after a fully clean chunk. Do not commit a red tree. Do not push unless explicitly requested by the user or repository workflow. Only commit current-chunk owned changes and tracker updates; protect pre-existing/user-owned changes.

## Review and completion

Step 6. **Per-chunk review-fix loop** — After implementing a chunk and passing its required verification, update the checklist/progress tracker before starting the chunk review:
- mark only completed and verified items;
- leave partial or blocked work unchecked with notes;
- pass the design/checklist/progress tracker context to a review workflowz;
- explicitly ask the reviewer to audit implementation bugs, security issues, and task accounting:
  - no over-marking: every checked task is actually implemented and verified;
  - no under-marking: no unchecked task has already been implemented;
  - no skips: no doable unchecked task was omitted from the chunk without a concrete blocker, dependency, product decision, or explicit user-approved scope reduction.
Fix actionable feedback, verify, update the checklist again if task status changed, commit, and re-review until clean.
Step 7. **Final split review** — Split the whole implementation into reviewable chunks. For each review chunk, use a review workflowz, review the chunk, then fix, verify, commit, and re-review until clean.

## Final gate

Before stopping, reread the checklist/progress tracker. For every unchecked task, quote the exact task, classify it as doable now or blocked/deferred, and record any blocker/deferred reason in the durable tracker. Commit any final tracker-only blocker/deferred updates before stopping so the recorded state survives resume and branch changes. Continue if any unchecked task is doable now. Stop only when all tasks are checked or every remaining unchecked task has a concrete blocker/deferred reason recorded in the tracker. A phase boundary, clean chunk commit, or completed review-fix loop is never a stopping point by itself.`;
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
