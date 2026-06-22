# Project Documentation Model

The `docs/` directory contains two subdirectories:

* `proposals/` — historical documents describing proposed changes.
* `specs/` — living documents describing how the system works now.

## Core principle

Use `proposals/` to answer:

> What change was proposed, why was it needed, and what was decided at that time?

Use `specs/` to answer:

> How does this part of the system work in its current implemented state?

A proposal records intent and reasoning at a specific point in time. A spec records the latest accepted implementation.

Do not treat old proposals as the current architecture. The relevant spec is the primary source of truth for the intended current design.

## Directory structure

```text
proposals/
  prop-001-initial-event-storage.md
  prop-002-add-event-search.md

specs/
  spec-001-event-domain.md
  spec-002-event-storage.md
  spec-003-event-search.md
```

## Naming convention

Use sequential numeric identifiers and descriptive kebab-case names.

```text
proposals/prop-NNN-short-description.md
specs/spec-NNN-short-description.md
```

Examples:

```text
proposals/prop-012-add-task-assignees.md
specs/spec-007-task-domain.md
```

Never reuse an existing number.

## Proposals

A proposal is historical. Do not rewrite it later to make it describe the final implementation. Update its status instead.

Every proposal must begin with metadata:

```md
# Add task assignees

Status: draft

Related specs:
- specs/spec-007-task-domain.md
```

Allowed statuses:

* `draft` — under consideration and not yet accepted;
* `accepted` — approved for implementation;
* `implemented` — implementation and related specs have been updated;
* `rejected` — explicitly decided against;
* `superseded` — replaced by a later proposal.

## Specs

A spec describes one coherent component, domain area, or cross-cutting concern as it exists now.

Examples:

* event domain and lifecycle;
* authentication;
* Firestore persistence;
* Telegram integration;
* task management;
* search behavior;
* background jobs.

A spec must not describe planned or hypothetical behavior. Planned changes belong in proposals until implemented.

Every spec must start with an influence history:

```md
# Task domain

## Influencing proposals

- `prop-005-create-task-domain.md` — introduced tasks, task status, and ownership.
- `prop-012-add-task-assignees.md` — added assignees and assignment rules.
- `prop-018-task-deadlines.md` — added optional deadlines and overdue-state semantics.
```

Keep this list in chronological order. Each entry must state the essential change introduced by that proposal.

## Required workflow for changes

When asked to make a non-trivial change:

1. Inspect the relevant specs before changing code.
2. Inspect the proposals listed in the relevant specs when historical context matters.
3. If the requested change requires a proposal, ask the user if you should create a new propsal for that or not.
4. Update every affected spec so that it reflects the implemented state.
5. Add the proposal to the `Influencing proposals` section of each affected spec.
6. Mark the proposal as `implemented`.
7. Verify that the proposal, specs, and code do not contradict one another.

## Handling inconsistencies

When code, specs, and proposals disagree:

* Treat proposals as historical context, not current truth.
* Treat specs as the intended current design.
* Treat code as the actual current behavior.
* Do not silently overwrite one source to match another.
* Identify the inconsistency and determine whether the code or spec should be corrected.
* Update the affected documentation once the intended state is clear.

When uncertain, ask the user for clarification.
