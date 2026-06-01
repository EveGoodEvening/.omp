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
    description: "Orchestrate a goal with parallel chunks",
    usage: "Usage: /gogogoal-parallel <goal-or-plan/checklist references>",
    options: { parallel: true, proactive: false },
  },
  {
    name: "gogogoal",
    description: "Orchestrate a goal without parallel chunks",
    usage: "Usage: /gogogoal <goal-or-plan/checklist references>",
    options: { parallel: false, proactive: false },
  },
  {
    name: "gogogoal-parallel-proactive",
    description: "Orchestrate a goal with parallel chunks and proactive no-clarification decisions",
    usage: "Usage: /gogogoal-parallel-proactive <goal-or-plan/checklist references>",
    options: { parallel: true, proactive: true },
  },
  {
    name: "gogogoal-proactive",
    description: "Orchestrate a goal sequentially with proactive no-clarification decisions",
    usage: "Usage: /gogogoal-proactive <goal-or-plan/checklist references>",
    options: { parallel: false, proactive: true },
  },
];

function gogogoalPrompt(goalOrReferences: string, options: GogogoalPromptOptions): string {
  const gatherInstruction = options.proactive
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

  return `Orchestrate only for the goal below. Do not perform implementation edits, code exploration, online research, or review directly as the orchestrator; delegate those activities and coordinate the results.

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

async function sendWorkflowPrompt(pi: ExtensionApi, ctx: CommandContext, prompt: string, label: string): Promise<void> {
  if (!pi.sendUserMessage) {
    await notify(ctx, `Cannot start ${label} because sendUserMessage is unavailable.`, "error");
    return;
  }

  await ctx.waitForIdle?.();
  await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  await notify(ctx, `${label} started.`, "success");
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
