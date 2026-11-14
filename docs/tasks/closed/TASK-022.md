# TASK-022: Update the Telegram Bot API client and demonstrate Rich HTML statistics

## Background

The project declares node-telegram-bot-api ^0.66.0 and corresponding TypeScript
types. Some sending paths already select HTML mode, so HTML is not entirely
missing. The client dependency still needs updating, with consistent formatting
for the bot's outgoing messages and reports. Personal attendance statistics use
a monospace text table and a separate inline keyboard rather than the rich
formatting available in the new API.

## Require

Update the Telegram Bot API client dependency and use its compatible TypeScript
types. Resolve any compatibility changes required by the application.

Ensure outgoing messages can use supported Telegram HTML formatting across
private dialogs and group chats, including report previews and publication.
Preserve literal user-provided text by escaping it where inserted into HTML.
Document the supported formatting contract for callers and AI-generated content.

Demonstrate Rich HTML in personal attendance statistics. Display the per-piece
statistics as an HTML table with readable, untruncated piece names. Place period
selection and close controls inside the message. Keep the existing calculations
and current permission checks. Existing statistics controls must remain usable
after a restart and refresh the same message.

## Acceptance

- The dependency manifest and lockfile install the updated client and compatible
  types reproducibly.
- Supported HTML formatting renders in private dialogs and group chats rather
  than appearing as raw markup.
- Literal text containing ampersands or angle brackets remains readable and does
  not break a formatted message.
- Report preview and publication can use the same HTML content. Invalid or
  unsupported markup produces a handled outcome rather than a false success.
- Existing inline buttons and topic routing continue to work with the updated
  client.
- Personal statistics in both supported languages use a Rich HTML table with
  embedded controls instead of a monospace table and a separate inline keyboard.
- Every existing period and the close action work after a new session is created.
  A period change refreshes the original message using current profile data.
- Piece names containing HTML metacharacters remain literal text, and revoked
  access or delivery failures do not expose statistics or report false success.
- npm run compile, npm run autotests, and npm run build pass.
