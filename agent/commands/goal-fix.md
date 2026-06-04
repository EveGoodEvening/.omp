/goal Fix the problem described below using an iterative fix-review loop.

Problem:
$ARGUMENTS

Outcome:
The reported problem is correctly resolved with the smallest valuable in-scope change set. Assess the issue first, decide which aspects are worth fixing, then implement only the necessary changes.

Verification:
Run the relevant checks for this repository after each focused fix, such as tests, type checks, lint checks, or targeted manual verification. Record the commands run and the evidence that the problem is fixed. After code changes, use the codex-review-code skill to review all changes.

Constraints:
Do not broaden scope beyond the reported problem. Do not add speculative features, unnecessary abstractions, compatibility shims, or unrelated cleanup. Preserve existing behavior unless changing it is necessary to fix the problem.

Boundaries:
Write only to files needed for the fix. Do not modify unrelated files, generated artifacts, secrets, dependency versions, CI/CD configuration, or documentation unless the fix directly requires it.

Iteration policy:
Setup only starts the loop; the fix/review cycle must happen in loop iterations.

Each loop iteration:
1. Assess the problem and decide what should be fixed.
2. Apply one focused set of changes.
3. Run relevant verification.
4. Use the codex-review-code skill to review all changes.
5. Evaluate each review item:
   - Incorporate: correct, valuable, and in scope; fix it.
   - Discard: wrong, out of scope, or low priority; explain why it is dismissed.
6. If any review feedback was incorporated and new changes were made, rerun verification and request another codex-review-code review.
7. Continue until converged.

Stop when:
The problem is fixed, verification evidence supports completion, and either codex-review-code has no actionable feedback or all remaining feedback has been explicitly discarded without making further changes.

Pause if:
The root cause is unclear, the fix requires a product decision, verification cannot be run, required permissions are missing, the change would affect risky/shared systems, or the loop exceeds three review rounds without convergence.