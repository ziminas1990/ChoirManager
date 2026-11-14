# TASK-028: Expose message editing through IUserAgent

## Background

IUserAgent exposes message sending but has no message-editing operation.
Editing is available only through TelegramUser, with separate methods for
ordinary HTML and Rich HTML. Consumers need the concrete Telegram adapter to
update messages even when they otherwise use the common agent interface.

## Require

Add an asynchronous edit_message operation to IUserAgent with an explicit,
platform-independent options contract and a Promise<Status> result. Support
the editing capabilities used by current consumers:

- Replacing message content in ordinary HTML or Rich HTML.
- Updating an inline keyboard together with the content.
- Updating or clearing an inline keyboard without replacing the content.

Keep format selection consistent with send_message and its defaults from
[TASK-026](./TASK-026.md). Limit editing options to supported application
capabilities; do not expose arbitrary Telegram SDK parameters or reply-keyboard
options that cannot be used for message edits.

Migrate current editing paths to the common contract, including personal
statistics. Remove the separate rich-message editing method. Preserve current
controls and their lifecycle; the button-grid migration remains covered by
[TASK-027](../TASK-027.md).

Define the supported options and defaults in the public interface, including
the difference between leaving a keyboard unchanged and explicitly clearing it.

## Acceptance

- Code typed as IUserAgent can edit ordinary HTML and Rich HTML messages without
  accessing TelegramUser or the Telegram SDK.
- Content edits without a format option use ordinary HTML, consistently with
  send_message. Explicit Rich HTML edits produce valid API payloads.
- Content and inline controls can be updated together. Keyboard-only changes
  preserve the message content; an empty keyboard removes its controls.
- Omitting keyboard options preserves the existing keyboard. Personal statistics
  retain their table and embedded controls, with no duplicate separate keyboard
  when refreshed.
- Feedback and confirmation flows retain their current editing and control
  cleanup behavior. No edit_rich_message callers or separate method remain.
- Successful edits return a successful Status. API rejections and transport
  failures remain handled errors, including consumer handling of unchanged
  content where applicable.
- Public interface comments match the implemented options and defaults. Focused
  editing tests, type checks, and the production build pass.
