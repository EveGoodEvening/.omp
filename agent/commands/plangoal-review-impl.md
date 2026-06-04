/plan help me write a "/goal" prompt, so that I could directly copy-and-paste, to review and fix implementation issues via an iterative review-fix loop.

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

**Important:** Setup only starts the loop. The review/fix cycle must happen in loop iterations, and only Codex in step 1 can declare the implementation clean.