# Application tests

Run commands from the repository root after installing dependencies. Test
execution requires Node.js 18.19 or newer.

## Commands

Check source and test types, then run the full suite:

```bash
npm run autotests
```

Run one test file against the current source:

```bash
npm test -- tests/components/messages_backlog_cache.test.ts
```

Run all tests without a separate type-checking pass:

```bash
npm test
```

Check types independently:

```bash
npm run typecheck
```

The production build remains a separate command:

```bash
npm run build
```

## Layout and contracts

The `tests/` tree mirrors `src/`. For example,
`src/components/administration_service.ts` is covered by
`tests/components/administration_service.test.ts`. Integration scenarios live
near their primary component; the Telegram-to-agent scenarios are in
`tests/components/ai/agents/managers_agent.test.ts`.

- `tests/mocks/` contains reusable, typed dependency doubles. Configure only the
  behavior a test needs; unconfigured service operations fail explicitly.
- `tests/helpers/` contains scenario data builders and shared assertions.
- Complete in-memory implementations belong in production adapters.
  `MemoryMessagesBacklog` implements `IMessagesBacklog` in
  `src/adapters/messages_storage/memory.ts`; components can use it directly.
- `MemoryJournal` supplies inspectable diagnostic records without a logger mock.

Tests and their support code use TypeScript. Use application interfaces to check
doubles with explicit types, `implements`, or `satisfies`. Avoid `any` and broad
unchecked assertions. Negative tests that intentionally send malformed runtime
data use a checked boundary helper rather than claiming those inputs satisfy a
valid application contract.

Each test starts with a `Motivation` comment and groups actions into numbered
steps, following [the test-writing rules](../.cursor/rules/test-steps.mdc).

## Execution

`tsconfig.tests.json` extends the application's strict compiler settings and
includes both `src/` and `tests/` with `noEmit`. It leaves the production output
layout unchanged.

The runner recursively discovers `.test.ts` files. A Node module loader uses the
existing `esbuild` dependency to transform TypeScript in memory, respecting the
application's compiler settings. It resolves `@src/` and `@tests/` aliases and
maps local `.js` imports to their `.ts` sources. No build output in `dist/` is
needed for either the full suite or an individual test.
