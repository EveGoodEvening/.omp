import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type DeliveryMode = "steer" | "followUp" | "nextTurn";

type UiContext = {
  notify?: (message: string, type?: "info" | "success" | "warning" | "error") => void | Promise<void>;
};

type ExtensionContext = {
  cwd: string;
  ui?: UiContext;
  sessionManager?: {
    getBranch?: () => unknown[];
    getSessionFile?: () => string | undefined;
  };
};

type CommandContext = ExtensionContext & {
  waitForIdle?: () => Promise<void>;
};

type ExtensionApi = {
  on(event: "turn_end", handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void;
  registerCommand?(
    name: string,
    command: {
      description: string;
      handler: (args: unknown, ctx: CommandContext) => Promise<void> | void;
    },
  ): void;
  sendUserMessage?: (content: string, options?: { deliverAs?: DeliveryMode }) => Promise<void> | void;
};

type RalphState = {
  path: string;
  raw: string;
  fields: Record<string, string>;
  prompt: string;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
};

type ParsedLoopArgs = {
  prompt: string;
  maxIterations: number;
  completionPromise: string | null;
};

const STATE_RELATIVE_PATH = [".claude", "ralph-loop.local.md"] as const;
const PROMPT_RELATIVE_PATH = [".claude", "ralph-loop-prompt.local.md"] as const;

function statePath(cwd: string): string {
  return join(cwd, ...STATE_RELATIVE_PATH);
}

function promptPath(cwd: string): string {
  return join(cwd, ...PROMPT_RELATIVE_PATH);
}

function unquoteScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;

  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }

  if (quote === '"') {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed.slice(1, -1);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function parseFrontmatter(raw: string): { fields: Record<string, string>; prompt: string } | null {
  const normalized = raw.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") return null;

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return null;

  const fields: Record<string, string> = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    const colon = line.indexOf(":");
    if (colon <= 0) continue;

    const key = line.slice(0, colon).trim();
    if (!key) continue;

    fields[key] = unquoteScalar(line.slice(colon + 1));
  }

  return { fields, prompt: lines.slice(end + 1).join("\n").trim() };
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) return fallback;
  return Number(value);
}

async function readState(cwd: string): Promise<RalphState | null> {
  const path = statePath(cwd);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }

  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;
  if (parsed.fields.active === "false") return null;

  const completionPromise = parsed.fields.completion_promise;

  return {
    path,
    raw,
    fields: parsed.fields,
    prompt: parsed.prompt,
    iteration: parseNonNegativeInteger(parsed.fields.iteration, 1),
    maxIterations: parseNonNegativeInteger(parsed.fields.max_iterations, 0),
    completionPromise:
      completionPromise === undefined || completionPromise === "" || completionPromise === "null" ? null : completionPromise,
  };
}

async function writeState(path: string, args: ParsedLoopArgs, sessionFile: string | undefined): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    [
      "---",
      "active: true",
      "iteration: 1",
      sessionFile ? `omp_session_file: ${yamlString(sessionFile)}` : null,
      "max_iterations: " + args.maxIterations,
      "completion_promise: " + (args.completionPromise === null ? "null" : yamlString(args.completionPromise)),
      "started_at: " + yamlString(new Date().toISOString()),
      "---",
      "",
      args.prompt,
      "",
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    "utf8",
  );
}

async function updateIteration(state: RalphState, nextIteration: number): Promise<void> {
  const replacement = `iteration: ${nextIteration}`;
  const nextRaw = /^iteration:.*$/m.test(state.raw)
    ? state.raw.replace(/^iteration:.*$/m, replacement)
    : state.raw.replace(/^---\n/, `---\n${replacement}\n`);
  await writeFile(state.path, nextRaw, "utf8");
}

async function notify(
  ctx: ExtensionContext,
  message: string,
  type: "info" | "success" | "warning" | "error" = "info",
): Promise<void> {
  await ctx.ui?.notify?.(message, type);
}

function sessionMatches(state: RalphState, ctx: ExtensionContext): boolean {
  const expected = state.fields.omp_session_file;
  if (!expected) return true;

  const actual = ctx.sessionManager?.getSessionFile?.();
  return actual === expected;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  let text = "";
  for (const block of content) {
    if (typeof block === "string") {
      text += block;
      continue;
    }
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
      const value = (block as { text?: unknown }).text;
      if (typeof value === "string") text += value;
    }
  }
  return text;
}

function lastAssistantText(ctx: ExtensionContext): string {
  const branch = ctx.sessionManager?.getBranch?.();
  if (!Array.isArray(branch)) return "";

  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (!entry || typeof entry !== "object") continue;
    if ((entry as { type?: unknown }).type !== "message") continue;

    const message = (entry as { message?: { role?: unknown; content?: unknown } }).message;
    if (message?.role === "assistant") return textFromContent(message.content);
  }

  return "";
}

function extractedPromiseText(text: string): string | null {
  const match = text.match(/<promise>([\s\S]*?)<\/promise>/);
  if (!match) return null;
  return match[1].trim().replace(/\s+/g, " ");
}

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

function parseLoopArgs(args: unknown): ParsedLoopArgs | string {
  const tokens = commandArgsToTokens(args);
  const promptParts: string[] = [];
  let maxIterations = 0;
  let completionPromise: string | null = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--max-iterations") {
      const value = tokens[i + 1];
      if (!value || !/^\d+$/.test(value)) return "--max-iterations requires a non-negative integer.";
      maxIterations = Number(value);
      i += 1;
      continue;
    }

    if (token === "--completion-promise") {
      const value = tokens[i + 1];
      if (!value) return "--completion-promise requires a non-empty value.";
      completionPromise = value;
      i += 1;
      continue;
    }

    if (token === "-h" || token === "--help") {
      return 'Usage: /ralph-loop "PROMPT" [--max-iterations N] [--completion-promise TEXT]';
    }

    promptParts.push(token);
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) return "Usage: /ralph-loop \"PROMPT\" [--max-iterations N] [--completion-promise TEXT]";

  return { prompt, maxIterations, completionPromise };
}

async function sendLoopPrompt(pi: ExtensionApi, prompt: string): Promise<void> {
  if (!pi.sendUserMessage) return;
  await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}

export default function ralphLoopExtension(pi: ExtensionApi): void {
  let handlingTurnEnd = false;

  pi.on("turn_end", async (_event, ctx) => {
    if (handlingTurnEnd) return;
    handlingTurnEnd = true;

    try {
      const state = await readState(ctx.cwd);
      if (!state || !sessionMatches(state, ctx)) return;

      if (!state.prompt) {
        await notify(ctx, "Ralph loop state exists, but its prompt is empty.", "warning");
        return;
      }

      if (state.completionPromise !== null) {
        if (extractedPromiseText(lastAssistantText(ctx)) === state.completionPromise) {
          await rm(state.path, { force: true });
          await notify(ctx, "Ralph loop completed by completion promise.", "success");
          return;
        }
      }

      if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
        await notify(ctx, `Ralph loop stopped at max iteration ${state.maxIterations}.`, "warning");
        return;
      }

      const nextIteration = state.iteration + 1;
      await updateIteration(state, nextIteration);
      await sendLoopPrompt(pi, state.prompt);
    } finally {
      handlingTurnEnd = false;
    }
  });

  pi.registerCommand?.("ralph-loop", {
    description: "Start an OMP-native Ralph loop in the current session",
    handler: async (args, ctx) => {
      const parsed = parseLoopArgs(args);
      if (typeof parsed === "string") {
        await notify(ctx, parsed, "warning");
        return;
      }

      await ctx.waitForIdle?.();
      await rm(promptPath(ctx.cwd), { force: true });
      await writeState(statePath(ctx.cwd), parsed, ctx.sessionManager?.getSessionFile?.());
      await notify(ctx, "Ralph loop activated.", "success");
      await sendLoopPrompt(pi, parsed.prompt);
    },
  });

  pi.registerCommand?.("cancel-ralph", {
    description: "Cancel the active OMP-native Ralph loop",
    handler: async (_args, ctx) => {
      const state = await readState(ctx.cwd);
      if (!state) {
        await notify(ctx, "No active Ralph loop found.", "info");
        return;
      }

      await rm(state.path, { force: true });
      await rm(promptPath(ctx.cwd), { force: true });
      await notify(ctx, `Cancelled Ralph loop at iteration ${state.iteration}.`, "success");
    },
  });
}
