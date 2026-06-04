/plan help me write a "/goal" prompt, so that I could directly copy-and-paste, to fix the problem below via an iterative fix-review loop.

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

**Important:** Setup only starts the loop. The fix/review cycle must happen in loop iterations.