---
name: codex-review-code
description: Get a second-opinion code review from OpenAI Codex CLI (gpt-5.5 xhigh). Use when the user asks for a code review, wants a second pair of eyes, or you want to validate significant changes.
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - AskUserQuestion
---

Get an independent code review from OpenAI's Codex CLI using gpt-5.5 with maximum reasoning effort. Codex acts as a principal engineer providing a second opinion. You have more context than Codex — use your own judgment to decide what feedback to incorporate.

**Stop hook integration:** A Stop hook may trigger this skill. After completing a review (and any fixes), you must save a diff-hash marker (see "After the review is complete") so the hook won't re-trigger for already-reviewed changes. If the hook triggers again after you've saved the marker, it means NEW changes were made — go for a new review round.

## Invoking Codex

Use `codex exec` to run a one-shot review. Write the prompt to a temp file, invoke Codex with that file redirected into stdin, and capture Codex's response with `-o "$TMPFILE"`. This avoids Codex waiting forever for additional interactive input.

```bash
TMPFILE=$(mktemp /tmp/codex-review.XXXXXXXX)
ERRFILE=$(mktemp /tmp/codex-review-err.XXXXXXXX)
PROMPTFILE=$(mktemp /tmp/codex-review-prompt.XXXXXXXX)

cat > "$PROMPTFILE" <<'EOF'
[Prompt text goes here]
EOF

[ -f "$HOME/.codex/.env" ] && . "$HOME/.codex/.env"
if codex exec \
  -m gpt-5.5 \
  -c 'model_reasoning_effort="xhigh"' \
  -s danger-full-access \
  --ephemeral \
  -o "$TMPFILE" \
  - < "$PROMPTFILE" 2> "$ERRFILE"; then
  cat "$TMPFILE"
else
  code=$?
  cat "$ERRFILE"
  exit "$code"
fi
```

**Flags explained:**
- `-m gpt-5.5` — model selection (always use this for reviews)
- `-c 'model_reasoning_effort="xhigh"'` — maximum thinking effort, principal-engineer level
- `-s danger-full-access` — sandbox policy. Options: `read-only`, `workspace-write`, `danger-full-access`. Use `danger-full-access` in case Codex needs to run commands (e.g., build, lint, tests) to verify its findings.
- `--ephemeral` — no conversation persistence, clean context
- `-o "$TMPFILE"` — write output to file (avoids noisy stdout metadata)
- `- < "$PROMPTFILE"` — the lone `-` tells Codex to read the prompt from stdin, and the redirect provides bounded file input

**Critical — stdin handling:** Always include the lone `-` positional argument and redirect from `"$PROMPTFILE"`. Do not pass a large prompt as a shell argument, do not omit stdin, and do not use a pipeline that could leave Codex waiting. If Codex prints `Reading additional input from stdin...` and does not progress, stop and fix the invocation rather than waiting.

**Critical — temp file creation:** You MUST use `mktemp` exactly as shown above. On macOS, `mktemp` only replaces the X's when they are the **last characters** of the template. Do NOT add a file extension (e.g., `.md`) after the X's — this causes `mktemp` to use the template literally without substitution, creating a file literally named with X's. The templates `/tmp/codex-review.XXXXXXXX`, `/tmp/codex-review-err.XXXXXXXX`, and `/tmp/codex-review-prompt.XXXXXXXX` (no extensions) are correct and must be used verbatim.

**Error handling:** If codex returns a non-zero exit code, read stderr for the error message. Report the error to the user and do not retry automatically — there may be an auth or config issue the user needs to resolve.

## Telling Codex what to review

Codex has shell access — it can run git commands and read files itself. Don't bloat the prompt by embedding diffs or file contents. Instead, tell Codex *what* to do in the prompt and let it retrieve the code.

### Git diff (most common — review uncommitted changes)
Tell Codex to run `git diff` (or `git diff --cached` for staged changes).

### Git commit(s)
Tell Codex the commit hash(es) and to run `git show <hash>` or `git log -p <hash1>..<hash2>`.

### Specific files or directory
Tell Codex the file paths or directory to review and to read them itself.

### Scoping the review
To narrow what Codex reviews, pass the scope in the prompt itself. For example:
- "Run `git diff -- src/api/routes.py src/api/middleware.py` and review those changes"
- "Read the files in `src/auth/` and review them"
- "Run `git show abc1234 -- lib/` and review only the lib changes"

Codex handles the filtering — no need to embed content.

### Important:
- Always tell Codex it can run git commands if it needs more context beyond what you asked it to review.
- Always tell Codex to return an error message (not silently fail) if it cannot access something.

## Constructing the prompt

The prompt to Codex must include these sections:

### 1. Context summary (required)
A brief summary of what the code changes are for and the goal. This prevents Codex from optimizing for the wrong thing.

### 2. What to review (required)
Tell Codex what to review — a git command to run, file paths to read, or (rarely) embedded code.

### 3. Focus areas (optional but recommended)
If you or the user have specific concerns, list them. Examples: "pay special attention to error handling", "check for SQL injection", "verify the caching logic is correct".

### 4. Execution environment note (required)
Tell Codex: "If you use Python, run `python3` instead of `python`."

### 5. Output format instructions (required)
Tell Codex exactly how to structure its response:

```
Return your review as plain text in this format:

## Critical Issues
Issues that must be fixed — bugs, security vulnerabilities, data loss risks.
List each with: file, line/section, issue description, and what should change.
If none, write "None found."

## Improvements
Code quality, performance, readability, or maintainability suggestions.
Tag each with a severity: [high] (real impact on correctness, performance, or security if left), [medium] (meaningful quality improvement), [low] (nitpick or style preference).
List each with: severity tag, file, line/section, what to improve, and why.

Be token-efficient. Use whichever is most concise: a brief description, a function/variable name, a short code snippet, or a one-liner fix. Don't rewrite large blocks of code — describe the change instead.

## Positive Notes
Things done well that should be kept.

## Summary
2-3 sentence overall assessment.

Do NOT include metadata, conversation artifacts, or commentary outside this format.
If you cannot access a file or run a command, say so clearly in your response instead of silently skipping it.
```

### Example full prompt

```
You are reviewing code changes in a git repository. Here is the context:

**Goal:** Adding rate limiting middleware to the Express API to prevent abuse of the /api/search endpoint.

**Focus areas:** Check that the rate limit configuration is correct, that the middleware ordering is right, and that error responses follow our existing API format.

You have access to git and the filesystem. If you need more context, run git commands to explore. If you cannot access something, say so clearly.
If you use Python, run `python3` instead of `python`.

**What to review:** Run `git diff` to see the uncommitted changes, then review them.

Return your review as plain text in this format:
[... format instructions from above ...]
```

## Processing Codex's response

### 1. Read and assess the feedback yourself
Do NOT blindly apply Codex's suggestions. You have far more context about:
- The broader codebase and its conventions
- The user's intent and constraints
- What has already been tried or discussed
- Project-specific patterns and trade-offs

For each piece of feedback, decide:
- **Incorporate** — the feedback is correct and valuable
- **Adapt** — the spirit is right but the specific suggestion needs adjustment for this codebase
- **Discard** — the feedback is wrong, irrelevant, or conflicts with known constraints

### 2. Fix what you can
If Codex identified real issues that you agree with and can fix, fix them before reporting to the user. Don't make the user do work you can handle.

### 3. Report to the user
Present a clear summary structured as:

**Codex Review Summary:**
- Brief overview of what Codex found

**My Assessment:**
- Which feedback points you're incorporating and why
- Which you're discarding and why
- Any points you're unsure about and want the user's input on

**Changes Made:**
- What you fixed based on the review
- Why those changes improve the code

**For Your Decision:**
- Any feedback points that require the user's judgment (e.g., architectural trade-offs, business logic questions)

### 4. If Codex returns errors
If Codex couldn't complete the review (auth issues, timeout, can't access files):
- Report the error clearly to the user
- Do NOT retry automatically
- Suggest what the user might check (codex auth, file permissions, etc.)

## After the review is complete

Save a diff-hash marker so the Stop hook won't re-trigger for already-reviewed changes:

```bash
H=$(command -v shasum >/dev/null 2>&1 && echo "shasum -a 256" || echo "sha256sum")
REPO_ID=$(git rev-parse --show-toplevel 2>/dev/null | $H | cut -d' ' -f1 | head -c 12)
(git diff HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null | LC_ALL=C sort | while IFS= read -r f; do printf '\0%s\0' "$f"; cat "$f"; done) | $H | cut -d' ' -f1 > "/tmp/.codex-last-reviewed-hash-${REPO_ID}"
```

If you make additional fixes after saving the hash, save it again.

## What NOT to do

- Do not treat Codex's feedback as authoritative. It is a second pair of eyes, not the final word.
- Do not call Codex repeatedly in a loop trying to get different answers.
- Do not send the entire repository — keep reviews focused on the relevant changes.
- Do not skip your own assessment. The user is relying on your judgment to filter and contextualize Codex's raw feedback.
