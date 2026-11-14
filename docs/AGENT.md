# Project documentation

Development work is tracked by tasks and epics under `docs/tasks/`.
Other documents in `docs/` describe current architecture, infrastructure,
deployment, and operational procedures.

## Development tasks and epics

Before creating, editing, or closing a task or epic, read
[`task-writing.mdc`](../.cursor/rules/task-writing.mdc). Follow
[`tasks/README.md`](tasks/README.md) for commands and directory layout.

- Tasks use `TASK-XXX` and describe a problem, required behavior, and observable
  acceptance criteria.
- Epics use `EPIC-XXX` and group related tasks in the required order.
- Create and close both through `scripts/task.py` from `docs/tasks/`.
- Never choose identifiers or move tracking documents into archives by hand.
- Closed tasks and epics are historical records. Only the script may update
  their links; do not rewrite their content to match later code.

Tasks use `Background`, `Require`, and `Acceptance`. Epics use `Background`
and `Steps`. These formats apply to tracking documents, not general guides.

## Working with documentation

Read relevant guides and any referenced task or epic before changing code.
Create new documentation only at the user's explicit request.

Make targeted edits to existing guides when implemented behavior, configuration,
or operational procedures change. Describe only the current state; do not
include before-and-after accounts or mention behavior that no longer exists.
Keep edits limited to the affected content. Record planned changes and their
acceptance criteria in tasks, following the development tracking rules above.
Closed tasks and epics remain immutable historical records.

Before closing a task, verify its acceptance criteria and relevant checks.
Before closing an epic, verify that its steps are complete, or record why it
is being abandoned. The script archives documents and maintains links; it does
not verify completion.

When documentation and code disagree, identify the inconsistency and use the
user's requested behavior and the task's requirements to determine the intended
change. Correct affected code or current guides accordingly, preserving closed
tracking documents as history. Ask for clarification when the intended behavior
cannot be determined from the available context.
