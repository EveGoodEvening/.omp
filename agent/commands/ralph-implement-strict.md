Use the ralph-loop plugin to implement tasks from design doc $1 and progress tracker $2 via an iterative implement-review loop.

## Loop behavior

Each iteration:

1. **Read** — Read $1 (design planning) and $2 (progress tracker). Identify unchecked `- [ ]` tasks.
   - If ALL tasks are `[x]` → output `<promise>IMPLEMENTATION COMPLETE</promise>` and STOP.
2. **Implement** — Work through unchecked tasks. Multiple related tasks per iteration is fine — use judgment on what forms a coherent chunk. Don't force yourself to stop mid-work if the next task is closely related.
   - If proceeding would require guessing — unclear design intent, ambiguous API choice, non-obvious edge-case handling, or choosing between materially different approaches — invoke `/codex-ask` to discuss before committing. Resume an existing codex session only if there's a known prior session on the same unresolved question; otherwise start fresh.
3. **Verify** — Run `cargo check` (Rust) or the relevant build command. Run related tests. The goal is that the iteration ends in a compilable, test-passing state — but intermediate non-compilation during implementation is acceptable.
4. **Mark** completed tasks `[x]` in $2.
5. **Review** — Run `codex-review-code` skill to check:
   - No over-marking: every `[x]` task is actually implemented
   - No under-marking: no `[ ]` task has actually been implemented already
   - No skips: no doable unchecked tasks remain that should have been done in this chunk
6. **Fix** according to codex's feedback unless codex says all good.
7. **Converge** — If you made changes from the review → go back to step 5 (re-review). If no new changes → `/commit-push` the changes, then reread $2 before stopping:
   - If any unchecked task is still doable without guessing or external blockers, continue at step 1 for the next coherent chunk.
   - If remaining unchecked tasks are blocked by missing tools, credentials, approvals, or ambiguous requirements, record why they are blocked in your response and then STOP.
   - Do not treat one committed chunk as loop completion when more doable work remains.

## How to invoke ralph-loop

The ralph-loop skill runs a shell setup script that cannot handle backticks, special characters, or long multi-line arguments passed directly. To work around this:

1. **Clean up stale loop files first:**
   Remove any leftover files from previous runs so the user isn't prompted for permission on files that already exist:
   ```
   rm -f .claude/ralph-loop-prompt.local.md .claude/ralph-loop.local.md
   ```

2. **Write the prompt to a file:**
   Write the resolved loop behavior (with actual file paths substituted for $1 and $2) to `.claude/ralph-loop-prompt.local.md` using the Write tool. Do NOT include the "How to invoke" section — only the loop behavior and rules.

3. **Invoke ralph-loop with a short, shell-safe argument:**
   Run the setup script directly via Bash tool: `CLAUDE_CODE_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}" "$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/scripts/setup-ralph-loop.sh" "See .claude/ralph-loop-prompt.local.md"`
   Do NOT pass the raw $1 or $2 text to ralph-loop — it will break if the text contains backticks, quotes, or other shell metacharacters.

## When the loop ends

Before cleaning up, run this mandatory pre-cleanup gate:

1. Reread $2 and list every remaining unchecked `- [ ]` task.
2. Classify each unchecked task as either:
   - **doable now** — enough context and local capability exist to implement and verify it, or
   - **blocked/deferred** — it needs missing tooling, credentials, external services, user decisions, or explicit deferral.
3. If any task is **doable now**, do NOT clean up the loop files. Continue the Ralph loop at step 1 for the next coherent chunk.
4. Only clean up when every task is `[x]`, or all remaining unchecked tasks are explicitly blocked/deferred and you have reported why.

After that gate passes, clean up the loop files:
```
rm -f .claude/ralph-loop-prompt.local.md .claude/ralph-loop.local.md
```

**Important:** Do NOT implement tasks directly. Write the prompt file, then invoke `/ralph-loop` and let it drive the implement-review cycle. Do NOT remove the Ralph loop files merely because one chunk was committed; cleanup means the whole requested loop is complete or blocked.
