# TASK-007: Mark messages with unregistered button callbacks as outdated

## Background

Telegram messages can retain visible buttons after their callback handlers
expire or are lost during a bot restart. Clicking such a button currently
produces only a log error, so the message appears usable but does nothing.

## Require

When a button callback has no registered handler, mark the originating message
as outdated. Replace its text with the exact notice “(X) Похоже что это сообщение
устарело” and remove all of its buttons.

Apply this behavior to unregistered button callbacks throughout the bot,
including buttons in score lists.

## Acceptance

- Clicking a button with no registered callback handler replaces the originating
  message's text with “(X) Похоже что это сообщение устарело”.
- All buttons on that message are removed, including buttons other than the
  one that was clicked.
- The message that contained the clicked button is updated in its original
  chat; other messages remain unchanged.
- The behavior applies both after callback expiration and after a bot restart
  that loses the handler.
- Buttons with registered handlers continue to perform their normal actions.
