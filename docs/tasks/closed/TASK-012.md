# TASK-012: Keep statistics widget buttons working after a restart

## Background

The attendance statistics widget uses randomly generated callback identifiers whose handlers exist only in memory. After a bot restart, buttons on previously sent statistics messages stop working even though the messages remain visible in Telegram.

## Require

Give each statistics button a stable action identifier so its action can be determined without the original widget instance or an in-memory callback registration. Support the existing period choices and closing the widget.

When a period button is pressed, recalculate the sender's statistics using current data and update the message containing that button. Multiple statistics messages must work independently. Check the sender's current access before displaying statistics.

No persistent widget state is required. Existing messages with random callback identifiers do not need to be restored; users may open a new statistics widget once after the update.

## Acceptance

- A newly opened widget displays statistics with the existing layout and language selection.
- Buttons for 30, 60, 90, and 180 days and for all time have stable identifiers that unambiguously identify their actions.
- After restarting the bot, each period button on a widget sent before the restart still works without reopening the widget.
- Selecting a period recalculates statistics from current data relative to the time of the click and edits the original message instead of sending a replacement widget.
- Several open statistics messages can be updated independently; clicking a button changes only the message containing it.
- The close button deletes its own statistics message, including after a restart.
- Users without current permission to view statistics cannot obtain them through previously issued buttons.
- Invalid or unsupported statistics actions produce a controlled response without changing another message or exposing statistics.
- Previously sent buttons with random identifiers are handled as unavailable, and opening a new widget provides working buttons.
- Automated checks cover callbacks after a restart without the original widget instance or callback registrations.
