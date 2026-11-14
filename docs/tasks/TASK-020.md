# TASK-020: Add a Delete button to bot messages in the managers chat

## Background

Bot messages in the managers chat cannot currently be removed through the bot's
own controls. Managers need a quick way to remove an unwanted bot message.

## Require

Add an inline button labelled “Удалить” to messages sent by the bot to the
managers chat, including AI replies and service notifications. Keep any other
buttons available on the message.

Allow managers and administrators to delete the originating bot message through
this button. Check the caller's current permissions when the button is pressed.
Handle deletion failures without reporting success.

## Acceptance

- Bot messages in the managers chat have a “Удалить” button alongside any
  existing controls.
- A manager or administrator pressing the button removes that message from its
  original chat or topic; other messages remain unchanged.
- A user without current manager or administrator permissions cannot delete a
  message through the button.
- The control remains usable after a bot restart while Telegram permits deletion.
- An already deleted message or a Telegram deletion restriction is handled
  without an unhandled error or a false success notification.
