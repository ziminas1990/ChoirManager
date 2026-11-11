# TASK-017: Decouple diagnostic logging through IJournal

## Background

Application components depend on the concrete `Journal` class and obtain a
`pino.Logger` through `log()`. Tests replace these classes with incomplete
objects, making strict TypeScript checking difficult. Diagnostic logging needs
a small, backend-independent contract before the test migration in
[TASK-015](./TASK-015.md).

## Require

Introduce a synchronous `IJournal` interface with `info()`, `error()`, `debug()`,
and `warning()`. Each level supports a message string or structured fields plus
a message string. Use `unknown` for arbitrary field values without introducing
`any` or exposing pino types in the contract.

Provide `child(component, bindings?)`, returning `IJournal`. Preserve the current
hierarchical component path and inherited bindings. Child bindings override
inherited values with the same key without changing the parent or siblings.

Provide two interchangeable implementations:

- `PinoJournal` for production diagnostic output, preserving existing output
  conventions and mapping `warning()` to pino's warning level.
- `MemoryJournal` for recording all four levels in memory and inspecting typed
  records without console output or backend mocking. Records expose the level,
  message, component path, and structured context. A root and its descendants
  share one recording history in call order; independent roots remain isolated.
  Inspection must not allow callers to mutate the recording history.

Migrate all existing `Journal` consumers and logging helpers to `IJournal` and
direct level methods. Keep concrete backend construction at application setup
boundaries. Make configuration and model-validation diagnostics observable
through the selected journal, including warnings currently emitted through a
module-owned root journal. Preserve useful exception details when adapting
existing error calls to the new contract.

Replace existing diagnostic logger fixtures and backend prototype mocking with
`MemoryJournal` where logging is supplied or inspected. Keep this task independent
of reorganizing tests or converting the existing suite to TypeScript.

This task concerns diagnostic logging. The activity history described in
[TASK-016](../TASK-016.md) remains a separate capability.

## Acceptance

- Every existing `Journal` consumer accepts or uses `IJournal`; application
  callers no longer obtain a backend logger through `log()` or depend on
  `pino.Logger`. Pino types are confined to the pino implementation.
- Both implementations support message-only and structured-fields-plus-message
  calls at all four levels. The new logging contract and implementations use no
  `any` or unchecked casts that bypass contract checking.
- Nested children preserve component paths and inherited context. Overriding a
  binding on one child leaves its parent and siblings unchanged.
- Production logs retain their existing level meanings and structured output
  conventions, including component context and error details.
- Memory records expose diagnostics from a root and its children in call order,
  including debug messages. Independent roots do not share records, and record
  inspection cannot modify the stored history.
- Tests can supply `MemoryJournal` and assert diagnostic messages and context
  without constructing or mocking pino, including model deprecation warnings.
- Relevant behavioral tests cover both implementations and child contexts;
  `npm run autotests` and `npm run build` pass.
