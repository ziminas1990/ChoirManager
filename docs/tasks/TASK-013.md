# TASK-013: Migrate to TypeScript 7

## Background

The project declares TypeScript ^5.5.4 and uses its compiler for builds and
automated tests. Moving to TypeScript 7 requires the existing development
toolchain to remain compatible with the new compiler.

## Require

Migrate the project to TypeScript 7 as the compiler used by the standard
development commands. Resolve compatibility issues in the compiler
configuration and supporting tools, including any required source changes.
Preserve existing application behavior and strict type checking.

Update the development documentation to describe the resulting toolchain
and any changed prerequisites.

## Acceptance

- A clean dependency installation provides the documented TypeScript 7
  compiler, and standard project commands use it.
- `npm run compile` completes successfully with the existing strictness
  guarantees preserved.
- `npm run build` produces the application bundle, with module imports and
  the @src alias resolved correctly.
- `npm run autotests` passes using the migrated toolchain.
- The built application starts successfully in the test environment without
  changes to its expected runtime behavior.
- The development documentation states the compiler version and prerequisites
  needed to reproduce the build and test results.
