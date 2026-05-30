---
name: codex-ask
description: This skill should be used when the user asks to "ask codex", "get codex's opinion", "ask codex to plan", "ask codex to debug", "codex help me", "what does codex think", "resume codex", "continue asking codex", "follow up with codex", or wants a second opinion from OpenAI Codex CLI on a question, implementation plan, or debugging session. Supports three modes (question, plan, debug) with session resume for multi-turn discussions.
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - AskUserQuestion
---

Get an independent answer, implementation plan, or debugging analysis from OpenAI's Codex CLI using gpt-5.5 with maximum reasoning effort. Codex acts as a principal engineer providing a second opinion. You have more context than Codex — use your own judgment to decide what to incorporate. Sessions can be resumed for multi-turn discussions — see Session Management below.

## Invoking Codex

### First call (new session)

Use `codex exec` to start a new session. Write the prompt to a temp file, invoke Codex with that file redirected into stdin, and capture Codex's response with `-o "$TMPFILE"`. Select the sandbox level based on the mode.

```bash
TMPFILE=$(mktemp /tmp/codex-ask.XXXXXXXX)
ERRFILE=$(mktemp /tmp/codex-ask-err.XXXXXXXX)
PROMPTFILE=$(mktemp /tmp/codex-ask-prompt.XXXXXXXX)

cat > "$PROMPTFILE" <<'EOF'
[Prompt text goes here]
EOF

[ -f "$HOME/.codex/.env" ] && . "$HOME/.codex/.env"
if codex exec \
  -m gpt-5.5 \
  -c 'model_reasoning_effort="xhigh"' \
  -s "$SANDBOX" \
  -o "$TMPFILE" \
  - < "$PROMPTFILE" 2> "$ERRFILE"; then
  cat "$TMPFILE"
else
  code=$?
  cat "$ERRFILE"
  exit "$code"
fi
```

After execution, look for the session ID in the stdout/stderr output (a line containing `session id: <uuid>` or similar). **Remember this session ID in your conversation context** — you will need it if the user wants to follow up.

### Resume call (continuing a session)

When the user wants to follow up on a previous Codex discussion, use `codex exec resume` with the stored session ID and pass the follow-up prompt through explicit stdin:

```bash
TMPFILE=$(mktemp /tmp/codex-ask.XXXXXXXX)
ERRFILE=$(mktemp /tmp/codex-ask-err.XXXXXXXX)
PROMPTFILE=$(mktemp /tmp/codex-ask-prompt.XXXXXXXX)

cat > "$PROMPTFILE" <<'EOF'
[Follow-up prompt text goes here]
EOF

[ -f "$HOME/.codex/.env" ] && . "$HOME/.codex/.env"
if codex exec resume "$SESSION_ID" \
  -m gpt-5.5 \
  -c 'model_reasoning_effort="xhigh"' \
  -o "$TMPFILE" \
  - < "$PROMPTFILE" 2> "$ERRFILE"; then
  cat "$TMPFILE"
else
  code=$?
  cat "$ERRFILE"
  exit "$code"
fi
```

**Note:** `codex exec resume` does not accept the `-s` (sandbox) flag. The sandbox level is inherited from the original session. Since all codex-ask modes use `danger-full-access`, this is not an issue.

**Fallback:** If resume fails because the session is expired or not found, start a fresh session with the prior discussion context embedded in the prompt. Remember the new session ID for future follow-ups. Report to the user that the original session could not be resumed and a new one was started. If the error is auth, network, or config related, do **not** fall back — report the error and let the user resolve it (consistent with the error handling rule below).

### Flags explained

- `-m gpt-5.5` — model selection
- `-c 'model_reasoning_effort="xhigh"'` — maximum thinking effort
- `-s "$SANDBOX"` — sandbox level, varies by mode (see below)
- `-o "$TMPFILE"` — write the last assistant message to a file for clean capture. Note: stdout still contains metadata (headers, `session id:` line) which is needed for session management
- `- < "$PROMPTFILE"` — the lone `-` tells Codex to read the prompt from stdin, and the redirect provides bounded file input

**Critical — stdin handling:** Always include the lone `-` positional argument and redirect from `"$PROMPTFILE"` for both new and resumed sessions. Do not pass a large prompt as a shell argument, do not omit stdin, and do not use a pipeline that could leave Codex waiting. If Codex prints `Reading additional input from stdin...` and does not progress, stop and fix the invocation rather than waiting.

**Critical — temp file creation:** Use `mktemp` exactly as shown. Do NOT add a file extension after the X's — `mktemp` only replaces trailing X's. The templates `/tmp/codex-ask.XXXXXXXX`, `/tmp/codex-ask-err.XXXXXXXX`, and `/tmp/codex-ask-prompt.XXXXXXXX` (no extensions) must be used verbatim.

**Error handling:** If codex returns a non-zero exit code, read stderr, report the error to the user, and do not retry automatically.

## Session Management

### Detecting resume vs new question

A follow-up is when the user wants to continue a previous Codex discussion. Indicators:
- **Explicit:** "resume codex", "continue with codex", "follow up with codex", "ask codex again about..."
- **Contextual:** the user's question directly references or builds on a previous Codex response in this conversation, and you have a stored session ID

If ambiguous, ask the user whether they want to resume the previous session or start fresh.

### Remembering the session

After each first call, remember the session ID in your conversation context. You do not need to persist it to a file — the session only needs to survive within the current Claude conversation.

If you cannot find a session ID in the Codex output, the session cannot be resumed. Inform the user and proceed with a fresh call on follow-up. Don't try `codex exec resume --last` as a fallback (resumes the most recent session), because multiple Codex sessions may be started in the same conversation, or wrose, different conversations (user migh have multiple task running) — it may pick the wrong one.

### Mode switching on resume

A resumed session can switch modes freely. For example, the user might start with a Question, then follow up with "ask codex to debug that issue" — this switches to Debug mode. Adjust the **prompt format** to match the new mode. The sandbox level carries over from the original session (all modes use `danger-full-access`, so this is seamless).

## Three Modes

Determine the mode from the user's request. Each mode uses a corresponding sandbox level:

All three sandbox options exist (`read-only`, `workspace-write`, `danger-full-access`), but all modes default to `danger-full-access` so Codex can run commands (build, lint, tests) to verify its guesses/findings.

| Mode | Sandbox | Why |
|------|---------|-----|
| Question | `-s danger-full-access` | May need to run commands to verify findings |
| Plan | `-s danger-full-access` | May need to run commands to verify guesses/findings |
| Debug | `-s danger-full-access` | May need to run tests, try fixes, execute build commands |

### Choosing the mode
- If the user explicitly says "plan", "design", or "implement" → Plan
- If the user mentions a bug, failure, error, test failing, or unexpected behavior → Debug
- Otherwise → Question (the safe default)
- When ambiguous, briefly ask the user which mode they prefer.

### Mode 1: Question (ask)

For general questions about the codebase, architecture, or implementation approach.
**Sandbox:** `danger-full-access`

### Mode 2: Plan

For implementation planning — designing a feature, migration strategy, or refactoring approach.
**Sandbox:** `danger-full-access`

### Mode 3: Debug

For debugging — diagnosing failures, unexpected behavior, or test failures. Codex gets full access so it can run tests, try compilation, execute the failing code, and actively investigate.
**Sandbox:** `danger-full-access`

## Constructing the Prompt

Codex has shell access — it can run git commands and read files itself. Don't bloat the prompt by embedding file contents. Tell Codex *what* to look at and let it retrieve the code.

Every prompt must include:

### 1. Role and context (required)

Set the role and provide brief context about the codebase and the current situation.

### 2. The question or task (required)

State clearly what Codex should answer, plan, or debug.

### 3. Scope pointers (required)

Tell Codex which files, directories, or git commands to examine. Examples:
- "Read `src/auth/` to understand the current auth implementation"
- "Run `git log --oneline -20` to see recent changes"
- "Read `config.toml` and `src/main.rs` for the relevant context"

### 4. Execution environment note (required)

Tell Codex: "If you use Python, run `python3` instead of `python`."

### 5. Output format (required)

Use the appropriate format for the mode:

**Question format:**
```
Return your answer as plain text in this format:

## Answer
Direct answer to the question with supporting reasoning.

## Evidence
Specific files, lines, or code patterns that support your answer.

## Caveats
Assumptions made or things you couldn't verify. If none, write "None."

Do NOT include metadata or commentary outside this format.
If you cannot access a file or run a command, say so clearly.
```

**Plan format:**
```
Return your plan as plain text in this format:

## Approach
High-level strategy in 2-3 sentences.

## Steps
Numbered implementation steps. For each step include:
- What to do
- Which files to create or modify
- Key implementation details

## Risks and Trade-offs
Potential issues, edge cases, or alternative approaches considered.

## Open Questions
Decisions that need human input before proceeding. If none, write "None."

Do NOT include metadata or commentary outside this format.
If you cannot access a file or run a command, say so clearly.
```

**Debug format:**
```
You have full shell access (danger-full-access) — you can read files, run builds, execute tests, and try fixes directly.

Return your analysis as plain text in this format:

## Diagnosis
Root cause or most likely cause of the issue.

## Evidence
Specific code paths, log patterns, or state that points to the root cause.
Include any test output, build errors, or runtime logs you collected.

## Fix
Concrete steps to fix the issue. Reference specific files and lines.
If you were able to try a fix, describe what you changed and whether it worked.

## Verification
How to verify the fix works — test commands you ran, expected vs actual output, or assertions.

Do NOT include metadata or commentary outside this format.
If you cannot access a file or run a command, say so clearly.
```

### Example prompts

**Question:**
```
You are a principal engineer examining a git repository. Context:

This is a Java-Rust hybrid blockchain node (java-tron). The storage layer is being migrated from embedded Java RocksDB to a remote Rust gRPC service.

**Question:** How does the StorageSpiFactory decide whether to use embedded or remote storage? What are all the configuration sources it checks?

Read `framework/src/main/java/org/tron/core/storage/spi/StorageSpiFactory.java` and any files it references. If you need more context, run git commands to explore.

If you use Python, run `python3` instead of `python`.

[... format instructions ...]
```

**Plan:**
```
You are a principal engineer planning an implementation. Context:

This is a Java-Rust hybrid blockchain node. We need to add support for a new transaction type in the Rust execution engine.

**Task:** Design a plan to implement VoteWitnessContract execution in Rust, maintaining parity with the Java VoteWitnessActuator.

Read `actuator/src/main/java/org/tron/core/actuator/VoteWitnessActuator.java` and `rust-backend/execution/src/` to understand both sides. If you need more context, explore freely.

If you use Python, run `python3` instead of `python`.

[... format instructions ...]
```

**Debug:**
```
You are a principal engineer debugging an issue. Context:

This is a Java-Rust hybrid blockchain node. After enabling remote execution mode, state digests diverge at block 12345.

**Issue:** The SHA256 state digest from embedded (Java) execution differs from remote (Rust) execution for TransferContract transactions.

Run `git diff` to see recent changes. Read `framework/src/main/java/org/tron/core/execution/spi/RuntimeSpiImpl.java` and `rust-backend/execution/src/transfer.rs`. If you need more context, explore freely.

If you use Python, run `python3` instead of `python`.

[... format instructions ...]
```

### 5. Resume prompt (for follow-ups only)

When resuming a session, the prompt can be shorter — Codex already has the prior context. Focus on:
- What the user wants to follow up on
- Any new information or constraints since the last round
- The new mode's output format if the mode changed

Example resume prompt:
```
Following up on our previous discussion about the storage layer migration:

The user wants to understand the error handling paths more deeply. Specifically, what happens when the gRPC connection to the remote storage service drops mid-transaction?

Read `src/storage/remote/grpc_client.rs` if you haven't already.

[... format instructions for the current mode ...]
```

Do NOT re-embed the full context from the first call — Codex retains the conversation history via session resumption.

### Important:
- Always tell Codex it can run git commands if it needs more context.
- Always tell Codex to return an error message (not silently fail) if it cannot access something.

## Processing Codex's Response

### 1. Assess the response yourself

Do NOT blindly relay Codex's answer. You have far more context about:
- The broader codebase and its conventions
- The user's intent and constraints
- What has already been tried or discussed
- Project-specific patterns and trade-offs

For each point, decide:
- **Incorporate** — correct and valuable
- **Adapt** — right spirit, needs adjustment for this codebase
- **Discard** — wrong, irrelevant, or conflicts with known constraints

### 2. Report to the user

Present a clear summary:

**Codex's Take:**
- Key points from Codex's response

**My Assessment:**
- Which points are solid and why
- Which need adjustment and why
- Which to discard and why

**Synthesis:**
- Combined recommendation incorporating both perspectives
- Any points needing the user's judgment

### 3. Act if appropriate

- For **questions**: synthesize the answer, noting where you agree or disagree with Codex
- For **plans**: merge Codex's plan with your own knowledge, flag conflicts
- For **debug**: if the diagnosis is sound and you can fix it, offer to fix it

### 4. If Codex returns errors

Report the error clearly. Do NOT retry automatically. Suggest what the user might check (codex auth, file permissions, etc.).

## What NOT to Do

- Do not treat Codex's response as authoritative — it is a second opinion, not the final word.
- Do not call Codex repeatedly in a loop trying to get different answers.
- Do not embed large file contents in the prompt — let Codex read them itself.
- Do not skip your own assessment — the user relies on your judgment to filter and contextualize.