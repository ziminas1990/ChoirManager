# TASK-026: Unify user-agent message sending through explicit options

## Background

`IUserAgent.send_message()` accepts only message text, while
`TelegramUser.send_message()` also exposes most Telegram SDK sending parameters.
The implementation always selects ordinary HTML, even when options specify a
format. Rich HTML requires a separate `TelegramUser.send_rich_message()` call,
which is unavailable through the user-agent interface.

Callers need one consistent sending contract that covers the capabilities the
application already uses without exposing the entire Telegram SDK surface.

## Require

Review the signatures of `IUserAgent.send_message()` and
`TelegramUser.send_message()`. Provide one `send_message(message, options?)`
contract for ordinary messages and Rich HTML messages, with the mode selected
through options.

Limit options to the parameters required by current sending paths, including:

- Message formatting, covering the existing ordinary HTML and Rich HTML modes.
- Inline keyboards used by existing dialogs and confirmations.
- Reply keyboards used by existing private dialogs.

Honor supported options when constructing Telegram requests. Define the default
behavior for omitted options and preserve existing ordinary HTML callers.
Represent the current `send_rich_message()` behavior through appropriate
`send_message()` options, and migrate its callers to the unified contract.
Remove the separate rich-message sending method.

Preserve the asynchronous `Expected<number>` result contract. Document the
supported options and their defaults for callers.

## Acceptance

- Code typed as `IUserAgent` can send both ordinary HTML and Rich HTML through
  `send_message()` using explicitly supported options.
- Calls without options retain their current ordinary HTML behavior.
- The options type covers parameters used by current callers without accepting
  arbitrary Telegram SDK sending parameters.
- Supported options affect the outgoing Telegram request rather than being
  silently overwritten. Ordinary and rich modes produce valid API payloads.
- Existing inline keyboards and reply keyboards retain their behavior.
- Personal statistics retain their Rich HTML table and embedded controls after
  migration to `send_message()`; no `send_rich_message()` callers remain.
- Successful sends return the Telegram message identifier. Delivery failures
  remain handled errors rather than successful outcomes.
- The documented options match the public interface and implementation.
- Type checks, relevant sending tests, and the production build pass.
