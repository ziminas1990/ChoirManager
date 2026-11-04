# TASK-001: Release 1 — migrate users to Firestore

## Background

Updating the production bot requires migrating existing users from Google Sheets and Telegram bindings from the current runtime.json to Firestore. Existing features must continue working after the update without requiring users to register again.

## Require

Provide a single migration command that accepts the current runtime.json and user spreadsheet. The migration must preserve:

- User profiles and roles.
- Telegram bindings and private chat IDs.
- Links to existing deposits, transactions, and statistics.
- Users present only in runtime, with minimal permissions when no spreadsheet entry exists.

Support source validation before writing, a dry run, and repeated execution without duplicates. An incomplete migration must not count as successful; the operator needs a report explaining skipped records and conflicts.

Preserve chat settings from runtime and make the migration command available in the shipped environment. Document the production update and rollback procedure.

Administrative user creation and removal through the bot are unavailable in this release. Existing first-contact behavior for unknown users may remain, but it must not grant membership roles. Assume a single bot instance writes data; strict protection against concurrent writes is not required.

## Acceptance

- A dry run against a copy of production sources reports the migration plan and problems without changing Firestore data.
- After applying the migration, each migrated user retains their profile and roles, and every migrated Telegram binding points to an existing user.
- Users present only in runtime appear in the report and receive no additional permissions.
- Repeating a complete or partially completed migration creates no duplicates and preserves previously assigned identifiers.
- The report identifies read errors, ambiguous matches, and records that were not migrated; an incomplete migration exits with a nonzero code.
- After starting the new version, existing users can access their previous deposits and transaction history.
- Statistics, scores, and feedback work for existing users.
- Notifications, announcement translations, and the managers chat continue working; chat settings and user reachability survive a restart.
- The bot cannot be used to administratively create users, remove users, or change their roles.
- Following the documented procedure allows an operator to run the migration in the shipped environment, update the bot, and restore the previous version with the saved files.
