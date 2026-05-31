Use the OMP-native Ralph loop to review and fix implementation issues via an iterative review-fix loop.

Unlike `/ralph-fix` (which starts from a known problem), this command starts by asking Codex to review the implementation, then fixes whatever it finds.

## Review scope

$ARGUMENTS

Pass the scope description directly to Codex — let Codex resolve it into concrete diff commands. Examples of valid scope descriptions:
- `uncommitted` or empty → uncommitted changes
- `last 3 commits` → last 3 commits
- `branch X vs branch Y` → diff between two branches
- `<commit-sha>` → a specific commit
- `<file-path>` → changes in a specific file

On re-review iterations (after fixes), tell Codex to also review any uncommitted working tree changes alongside the original scope. Codex sees the current state of the repo each time, so fixes are automatically visible.

## Loop behavior

1. **Review** — Run `codex-review-code` skill asking Codex to review the scope. On re-review iterations, tell Codex to include uncommitted changes too.
   - If Codex finds no issues → output `<promise>ALL CLEAN</promise>` and STOP.
2. **Evaluate** — Judge the review feedback. For each item, classify it as:
   - **Incorporate** — correct and valuable → fix it.
   - **Discard** — wrong, out-of-scope, or low-priority → dismiss it.
3. **Decide:**
   - If nothing to incorporate (all discarded or no actionable feedback) → done, STOP.
   - Otherwise → proceed to step 4.
4. **Fix** — Apply the changes you decided to incorporate, then `/commit-push`.
5. **Re-review** — You MUST go back to step 1. Do NOT emit `<promise>ALL CLEAN</promise>` here. Only Codex (in step 1) can declare ALL CLEAN — you cannot self-certify your own fixes.

## OMP Ralph setup

Do NOT start reviewing or fixing in this setup turn. Start the loop and stop.

1. Write the loop behavior, review scope, and `When the loop ends` section to `.claude/ralph-loop-prompt.local.md` using the Write tool. Do not include this setup section.
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

After the review-fix cycle converges, remove `.claude/ralph-loop.local.md` before the final response so the OMP extension does not queue another iteration. Then remove `.claude/ralph-loop-prompt.local.md`.

**Important:** Setup only starts the loop. The review/fix cycle must happen in loop iterations, and only Codex in step 1 can declare the implementation clean.