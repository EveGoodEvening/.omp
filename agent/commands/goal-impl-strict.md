/goal Implement all doable tasks from design doc $1 and progress tracker $2 using an iterative implement-review loop until the tracker is complete or only explicitly blocked/deferred tasks remain.

Verification:
- At the start of each iteration, read $1 and $2 and identify unchecked `- [ ]` tasks.
- After implementation, run `cargo check` for Rust work, or the relevant project build/typecheck command if this is not Rust.
- Run related tests for the changed area.
- Each committed iteration must end in a compilable, test-passing state unless a blocker is explicitly recorded.
- Before stopping, reread $2 and classify every remaining unchecked task as either doable now or blocked/deferred.

Constraints:
- Do not mark a task `[x]` unless it is actually implemented and verified.
- Do not leave already-implemented tasks unchecked.
- Do not skip doable unchecked tasks just because one coherent chunk has been committed.
- Do not guess on unclear design intent, ambiguous APIs, non-obvious edge cases, or materially different implementation approaches.
- If guessing would be required, invoke `/codex-ask` before committing. Resume an existing Codex session only if there is a known prior session for the same unresolved question; otherwise start fresh.
- Intermediate non-compilation during implementation is acceptable, but each iteration must converge back to passing verification.

Boundaries:
- Read $1 for design intent and $2 for task status.
- Update $2 only to mark truly completed tasks `[x]` or to record clear blocked/deferred reasons when stopping.
- Make only implementation changes needed for the unchecked tasks in the current coherent chunk.
- Do not clean up loop files while any unchecked task is still doable now.

Iteration policy:
1. Read $1 and $2.
2. If all tasks are `[x]`, output `<promise>IMPLEMENTATION COMPLETE</promise>` and stop.
3. Choose a coherent chunk of unchecked doable tasks. Multiple related tasks per iteration are allowed.
4. Implement the chunk.
5. Run build/check commands and related tests.
6. Mark completed tasks `[x]` in $2.
7. Run `codex-review-code` to check:
   - no over-marking: every `[x]` task is actually implemented;
   - no under-marking: no `[ ]` task has already been implemented;
   - no skips: no doable unchecked task remains that should have been included in this chunk.
8. Fix according to Codex feedback unless Codex says all good.
9. If review fixes changed anything, rerun `codex-review-code` and repeat until clean.
10. When review is clean, run `/commit-push`.
11. Reread $2. If any unchecked task is still doable now, continue the loop with the next coherent chunk.

Stop when:
- All tasks in $2 are `[x]`, in which case output `<promise>IMPLEMENTATION COMPLETE</promise>`; or
- Every remaining unchecked task is blocked/deferred, and the response lists each remaining unchecked task with the reason it cannot be done now.

Pause if:
- Design intent is unclear.
- API choice is ambiguous.
- Edge-case behavior requires a human decision.
- Required tools, credentials, services, approvals, or external state are missing.
- Verification cannot be run locally for reasons outside the implementation.