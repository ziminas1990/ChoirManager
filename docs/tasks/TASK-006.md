# TASK-006: Keep score download buttons usable over time

## Background

The Telegram scores list contains download buttons whose handlers expire one
hour after the list is created. The buttons remain visible after their handlers
are removed. Clicking them then produces only a log error, leaving the user
without a download or an explanation even when the bot has not restarted.

## Require

Make score download buttons remain usable when users return to an earlier
list, including after a bot restart. Users should not need to request a fresh
list merely because time has passed.

When a requested download cannot be completed, provide a clear explanation
and a way to continue. Preserve current access restrictions and check access
when a download is requested.

## Acceptance

- A user can obtain the correct score link from a list created more than an
  hour earlier without requesting a new list.
- Download buttons in lists created with the fix continue to work after the
  bot restarts.
- Repeated clicks on a valid download button remain supported.
- A button for an unavailable score produces a clear user-facing explanation
  and guidance on how to proceed.
- An unrecognized or expired button from an older list produces useful
  user-facing feedback rather than silently failing.
- A user who no longer has permission to download scores cannot obtain a
  download through a previously received list and receives a clear explanation.
