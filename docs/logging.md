# Diagnostic logging

Application code accepts `IJournal` from `src/interfaces/journal.ts` and calls
`info()`, `error()`, `debug()`, or `warning()` directly. Each method accepts a
message string or structured fields followed by a message string. Operations
are synchronous and return `void`. Field values use `unknown`.

```typescript
journal.info("Starting runtime");
journal.error({ error, user_id }, "Failed to update user");
const users = journal.child("users", { request_id });
users.warning({ user_id }, "User is unavailable");
```

Children append to the component path and inherit parent bindings. Child
bindings override matching inherited keys, and call fields override bindings
for that record. A child does not change the parent or its siblings. Callers
do not obtain or depend on a backend logger.

## Production

Application setup creates `PinoJournal` with `PinoJournal.create()` and passes
the resulting journal to components. The adapter retains uppercase levels and
the `component` field in JSON output. `warning()` produces pino's `WARN` level.
The default threshold is `info`; debug output is suppressed. The adapter also
accepts a level and a text destination when configuring output.

Pass caught exceptions as `{ error }` alongside a message. The adapter preserves
the exception message and stack, including when the application error helpers
report failures.

## Tests

Create a `MemoryJournal` from `src/components/memory_journal.ts` and pass it as
an `IJournal`. Its `records` getter exposes typed snapshots containing:

- `level`: `info`, `error`, `debug`, or `warning`.
- `message`: the diagnostic message.
- `component`: the dot-separated component path.
- `fields`: inherited bindings merged with call fields.

A root and its children share a history in call order. All four levels are
recorded without console output. Independent roots have independent histories.
`clear()` on the concrete memory journal clears its shared history while
existing children remain connected.

Inputs are copied when recorded, and inspection returns detached snapshots.
Changing input objects or returned records does not change stored history.
Errors are captured as diagnostic objects containing their name, message,
stack, and additional fields. Functions are represented as strings; class
instances contribute their enumerable fields. Dates and collections retain
their values, and circular references are supported.

## Configuration diagnostics

`load_config(path, journal)` and `BotConfig.verify(journal)` forward the selected
journal to model validation and report disabled optional services through it.
Individual model configuration validators and `OpenaiAPI.get_llm(model, journal)`
also accept a journal. Without this optional argument validation emits no
diagnostics. Deprecation warnings are emitted once per model for each supplied
journal instance, so separate tests can observe their own warnings.

This diagnostic facility is separate from the planned user activity history.
