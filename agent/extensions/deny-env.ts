type ToolCallEvent = {
  toolName: string;
  input?: Record<string, unknown>;
};

type ExtensionApi = {
  on(event: "tool_call", handler: (event: ToolCallEvent) => Promise<BlockResult | void> | BlockResult | void): void;
};

type BlockResult = {
  block: true;
  reason: string;
};

const BLOCKED_ENV_FILE_SEGMENT = /(^|[/\\])\.env(?:\.(?!(?:example|template)(?=[:/\\]|$))[^:/\\]*)?(?=[:/\\]|$)/;

function isBlockedEnvPath(value: unknown): value is string {
  return typeof value === "string" && BLOCKED_ENV_FILE_SEGMENT.test(value);
}

function editTargetsEnvFile(input: Record<string, unknown> | undefined): boolean {
  const patch = input?.input;
  if (typeof patch !== "string") return false;

  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("¶")) continue;

    const header = line.slice(1);
    const hashIndex = header.indexOf("#");
    const path = (hashIndex === -1 ? header : header.slice(0, hashIndex)).trim();

    if (isBlockedEnvPath(path)) return true;
  }

  return false;
}

function block(reason: string): BlockResult {
  return { block: true, reason };
}

export default function denyEnvFiles(pi: ExtensionApi): void {
  pi.on("tool_call", (event) => {
    switch (event.toolName) {
      case "read":
        if (isBlockedEnvPath(event.input?.path)) {
          return block("Reading .env files is blocked by policy.");
        }
        return;

      case "write":
        if (isBlockedEnvPath(event.input?.path)) {
          return block("Writing .env files is blocked by policy.");
        }
        return;

      case "edit":
        if (editTargetsEnvFile(event.input)) {
          return block("Editing .env files is blocked by policy.");
        }
        return;

      default:
        return;
    }
  });
}
