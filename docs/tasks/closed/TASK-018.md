# TASK-018: Refactoring: Inject the Telegram adapter's user collection

## Background

`TgAdapter` constructs its user collection internally through
`PlainCollectionFactory` and a Firestore converter. Tests must replace the static
factory method to supply a test collection, despite the adapter already storing
it as `IPlainCollection<TelegramUserRecord>`. This hidden dependency complicates
typed fixtures for [TASK-015](./TASK-015.md).

## Require

Make `TgAdapter` accept an externally constructed
`IPlainCollection<TelegramUserRecord>` in its constructor and restoration API.
Remove storage construction and storage configuration from the adapter itself.

Introduce `TgAdapterFactory` to assemble the collection and adapter for both
normal startup and restoration. Report collection creation failures through
`Expected`. Preserve the existing external JSON configuration, including
`users_storage`.

Keep loading user records and rebuilding Telegram users in `TgAdapter.init()`.
Update adapter tests to pass test collections directly instead of replacing
`PlainCollectionFactory.create()`.

## Acceptance

- `TgAdapter` can be constructed and restored with a supplied
  `IPlainCollection<TelegramUserRecord>` without invoking a storage factory or
  depending on a Firestore converter.
- Runtime startup and restoration use the factory to supply the collection;
  collection creation failures return contextual errors through `Expected`.
- Existing JSON configuration remains valid, and restored chat identifiers retain
  their previous behavior.
- Adapter initialization still loads users from the supplied collection.
- Adapter tests no longer replace `PlainCollectionFactory.create()` and preserve
  existing behavioral coverage without introducing `any` or broad unchecked
  type assertions.
- `npm run autotests` and `npm run build` succeed.
