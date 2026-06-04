/goal Review and fix implementation issues in the requested scope via an iterative Codex review-fix loop.

Review scope:
$ARGUMENTS

Outcome:
Run an iterative review-fix loop until Codex reports the implementation is clean, or until there are no correct/actionable findings to incorporate.

Review:
- Run the `codex-review-code` skill.
- Pass the review scope description directly to Codex. Do not resolve it yourself into concrete git diff commands.
- Valid scope examples include:
  - empty or `uncommitted` → uncommitted changes
  - `last 3 commits`
  - `branch X vs branch Y`
  - `<commit-sha>`
  - `<file-path>`
- On the first review, ask Codex to review the original scope.
- On every re-review after fixes, ask Codex to review the original scope plus any uncommitted working tree changes.

Evaluate:
- For each Codex finding, classify it as:
  - Incorporate — correct, relevant, and worth fixing.
  - Discard — incorrect, out of scope, duplicate, low-priority, or not worth changing.
- Briefly record the classification and reason.

Fix:
- If at least one finding is classified Incorporate, apply one focused set of fixes.
- Do not make unrelated refactors or opportunistic cleanup.
- Preserve intended behavior unless the incorporated finding requires a behavior change.
- After fixing, run relevant checks.
- Then run `/commit-push`.

Iteration policy:
- After every fix and `/commit-push`, return to Review.
- Do not self-certify the implementation as clean.
- Do not emit `<promise>ALL CLEAN</promise>` after making fixes.
- Only Codex, during a Review step, can justify declaring the implementation clean.

Verification:
- Evidence must include Codex review output for the current iteration.
- Evidence for fixes must include the relevant test/check commands or an explanation if no automated check applies.
- Re-review must include the current repo state, including uncommitted changes, so Codex can see the fixes.

Constraints:
- Fix only implementation issues found by Codex that are classified Incorporate.
- Do not change files outside the reviewed scope unless required to correctly fix an incorporated issue.
- Do not bypass hooks, skip checks, force-push, or use destructive git operations.
- Do not emit `<promise>ALL CLEAN</promise>` unless Codex reports no issues in the Review step.

Boundaries:
- Allowed writes: files necessary to fix incorporated findings.
- Forbidden writes: unrelated documentation, unrelated refactors, generated artifacts, secrets, dependency changes unless explicitly required by an incorporated finding.

Stop when:
- Codex finds no issues in a Review step; then output exactly:
  `<promise>ALL CLEAN</promise>`
- Or Codex findings are all classified Discard with no actionable fixes remaining; summarize why and stop without claiming ALL CLEAN.

Pause if:
- A finding requires a product decision, risky migration, destructive action, dependency downgrade/removal, security-sensitive change, or scope expansion.
- Checks fail for reasons unrelated to the incorporated fixes.
- The loop exceeds 5 review-fix iterations.