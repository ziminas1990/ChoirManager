# TASK-015: Migrate application tests to TypeScript and mirror the source layout

## Background

Application tests currently live in a flat `tests/` directory as `.mjs` files
and import compiled modules from `dist/`. Their location does not identify the
corresponding source layer, and running a test directly can exercise stale build
output. Test code also lacks TypeScript checking against application contracts.

## Require

Reorganize `tests/` to mirror the directory structure of `src/`. Place tests next
to the corresponding module path within the test tree; for example,
`src/components/administration_service.ts` maps to
`tests/components/administration_service.test.ts`.

Migrate all application tests and their supporting code under `tests/` to
TypeScript. Preserve existing behavioral coverage and the project's test-writing
conventions. Keep integration tests near the primary component or entry point
they exercise.

Make tests target source modules instead of importing `dist/` paths. Update test
execution and type checking to support the nested TypeScript test tree. Document
how to run the full suite and an individual test.

## Acceptance

- Test paths under `tests/` mirror the corresponding paths under `src/`, including
  component and adapter subdirectories.
- All application test files use `.test.ts`; supporting test code is also
  TypeScript, with no remaining JavaScript test implementations under `tests/`.
- Type checking includes test code and reports incompatible uses of application
  interfaces.
- Tests import source modules without hard-coded `dist/` dependencies. Running a
  test uses current source changes without requiring a pre-existing build.
- `npm run autotests` discovers and runs the complete nested test suite, preserving
  existing behavioral coverage.
- A documented command runs an individual TypeScript test successfully, and the
  application still builds with `npm run build`.
