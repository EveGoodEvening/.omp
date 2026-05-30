ultrathink.

You are generating a detailed execution-ready todolist/checklist from the user's request or existing plan:

$ARGUMENTS

The output must be ready for implementation, not a planning scratchpad. Do not include unresolved open questions, "need decisions", TBDs, optional unresolved forks, or unconfirmed assumptions.

## Before generating the todolist

1. Read the source request or plan carefully.
2. Scan for unresolved decisions, ambiguous scope, missing acceptance criteria, or placeholders such as `Open Questions`, `Need Decisions`, `TBD`, `choose`, `decide`, or `confirm`.
3. If any unresolved item would affect scope, UX, API behavior, data model, integration behavior, migration strategy, or validation, stop and ask the user to resolve the minimum set of questions. Do not output the todolist yet.
4. If an unknown can be resolved by inspecting the code during implementation and does not require a user/product decision, convert it into a concrete investigation task with explicit branch criteria.

If the input came from `advanced-planning` and still contains open questions or pending decisions, do not carry them into the todolist. Ask the user to resolve them first.

## Output format when ready

# Todo List
## Locked decisions
- List the decisions that make the todo list actionable.

## Implementation tasks
- [ ] Task title
  - What to change.
  - Where to change it, using file paths when known.
  - Definition of done.

## Validation
- [ ] Specific test, typecheck, manual QA, or review step.

Do not include an `Open Questions`, `Need Decisions`, `TBD`, or unresolved assumptions section. Every todo item should be actionable by an implementer without requiring another planning pass.
