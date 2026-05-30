ultrathink.

You are running an interactive planning command. Do not implement code, edit project files, or create a final plan until the requirements and decisions needed for an actionable plan are fully resolved.

Create a detailed implementation plan for:

$ARGUMENTS

Core rule: the final plan from this command must not contain unresolved open questions, "need decisions", TBDs, optional unresolved forks, or unconfirmed assumptions. If a missing decision affects the implementation, ask the user first and wait for their answer.

## Planning quality criteria

- Compare meaningful implementation options when more than one viable approach exists; include tradeoffs, fit, cost, and why one path is recommended.
- Prefer existing project patterns and mature ecosystem solutions over custom implementations unless there is a clear reason.
- Call out dependency, version, runtime, integration, or compatibility risks that could affect implementation.
- Consider maintainability and scalability where they materially affect the choice, without adding speculative complexity.

## Workflow

1. Understand the context
- Inspect the relevant codebase, docs, and existing patterns before proposing architecture.
- Restate the user's goal, constraints, and success criteria in your own words.
- Separate facts observed in the codebase from assumptions that need confirmation.

2. Clarify interactively
- Identify every missing requirement or decision that would change the plan.
- Ask focused questions in small batches. Prefer concrete options with a recommendation when possible.
- Use `AskUserQuestion` when choices would be clearer as selectable options.
- After each user response, update the working understanding and ask follow-up questions if anything important is still unresolved.
- Continue this loop until no required user decision remains.

3. Apply the final-plan readiness gate
Before writing or dumping the final plan, verify that all of these are settled:
- Scope and non-goals.
- User-facing behavior and edge cases.
- Data model, API, integration, or storage choices that affect implementation.
- Relevant tradeoffs between feasible approaches, with one selected path.
- Validation strategy and acceptance criteria.
- Assumptions are either confirmed by the user, confirmed from the codebase, or converted into implementation-time verification tasks with clear criteria.

If any item is not settled, do not output the final plan. Ask only the remaining blocking questions.

4. Output the final plan only when ready
Use this structure:

# Implementation Plan
## Goal
## Confirmed decisions
## Relevant codebase context
## Recommended approach
## Implementation steps
## Validation plan
## Risks and mitigations

Do not include an `Open Questions`, `Need Decisions`, `TBD`, or unresolved assumptions section. If something can only be discovered while implementing and does not require a user/product decision, express it as a concrete verification step with branch criteria, such as: "Verify X in file Y; if A is true, do B, otherwise do C."

## When the user asks to dump, save, or export

If the readiness gate passes, dump the final plan. If it does not pass, say the final plan is blocked by unresolved decisions and ask the minimum remaining questions instead. Do not create a markdown plan that contains open questions or pending decisions.
