Use the OMP-native Ralph loop to implement tasks from design doc $1 and progress tracker $2 via an iterative implement-review loop.

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

## OMP Ralph setup

Do NOT implement tasks in this setup turn. Start the loop and stop.

1. Write the resolved loop prompt to `.claude/ralph-loop-prompt.local.md` using the Write tool. Include only the resolved `Loop behavior` and `When the loop ends` sections, with actual file paths substituted for $1 and $2. Do not include this setup section.
2. Write `.claude/ralph-loop.local.md` using the Write tool with exactly this shape:
   ```md
   ---
   active: true
   iteration: 1
   max_iterations: 0
   completion_promise: null
   started_at: "omp-native"
   ---

   See .claude/ralph-loop-prompt.local.md
   ```
3. Stop after the two files are written. The OMP extension `agent/extensions/ralph-loop.ts` will feed `See .claude/ralph-loop-prompt.local.md` back into the session after the turn ends.

Do not use Claude Code's shell Stop hook or `setup-ralph-loop.sh`; OMP does not run that hook path.

## When the loop ends

Before cleaning up, run this mandatory pre-cleanup gate:

1. Reread $2 and list every remaining unchecked `- [ ]` task.
2. Classify each unchecked task as either:
   - **doable now** — enough context and local capability exist to implement and verify it, or
   - **blocked/deferred** — it needs missing tooling, credentials, external services, user decisions, or explicit deferral.
3. If any task is **doable now**, do NOT clean up the loop files. Continue the Ralph loop at step 1 for the next coherent chunk.
4. Only clean up when every task is `[x]`, or all remaining unchecked tasks are explicitly blocked/deferred and you have reported why.

After that gate passes, remove `.claude/ralph-loop.local.md` before the final response so the OMP extension does not queue another iteration. Then remove `.claude/ralph-loop-prompt.local.md`.

**Important:** Setup only starts the loop. The implementation/review cycle must happen in loop iterations, and cleanup means the whole requested loop is complete or blocked.

