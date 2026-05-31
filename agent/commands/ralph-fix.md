Use the OMP-native Ralph loop to fix the problem below via an iterative fix-review loop.

## Problem

$ARGUMENTS

## Loop behavior

1. **Assess** — Understand the problem. Decide what changes are needed and whether each aspect is worth fixing (correct, in-scope, valuable) before writing any code.
2. **Fix** — Apply the changes you decided to make.
3. **Review** — Use the `codex-review-code` skill to get a code review of all changes.
4. **Evaluate** — Judge the review feedback. For each item, classify it as:
   - **Incorporate** — correct and valuable → fix it.
   - **Discard** — wrong, out-of-scope, or low-priority → dismiss it.
5. **Decide whether to loop again:**
   - If you incorporated any feedback and made new changes → go back to step 3 (re-review the updated code).
   - If Codex approves (no actionable feedback) → done.
   - If all remaining feedback was discarded (no new changes) → done.
6. **Repeat** until converged (no new changes made in a round).

## OMP Ralph setup

Do NOT fix the problem in this setup turn. Start the loop and stop.

1. Write the full problem description plus the `Loop behavior` and `When the loop ends` sections to `.claude/ralph-loop-prompt.local.md` using the Write tool. Do not include this setup section.
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

After the fix-review cycle converges, remove `.claude/ralph-loop.local.md` before the final response so the OMP extension does not queue another iteration. Then remove `.claude/ralph-loop-prompt.local.md`.

**Important:** Setup only starts the loop. The fix/review cycle must happen in loop iterations.