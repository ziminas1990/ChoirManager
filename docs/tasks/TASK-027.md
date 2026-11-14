# TASK-027: Replace inline keyboards with Rich HTML button grids

## Background

Most Telegram interfaces attach inline keyboards separately from message text.
Personal statistics already embed buttons in Rich HTML, but construct their
layout locally. Mixing these approaches duplicates rendering logic and makes
message updates inconsistent.

The bot should use Rich HTML with controls at the bottom of messages while
preserving the button grids users already know. This task follows the unified
sending contract in [TASK-026](./closed/TASK-026.md), which preserves existing formatting
and keyboards during that earlier refactoring.

## Require

Replace inline keyboards throughout the bot with embedded Rich HTML buttons.
Use Rich HTML consistently for outgoing text messages and their edits. Place
controls after the message body, retaining the current row boundaries and button
order in each interface, including dynamically generated grids.

Provide a reusable component that returns Rich HTML for a supplied button grid.
Use it across interfaces, including statistics, so callers do not repeat button
markup construction. Keep action handling separate from rendering.

Preserve existing button labels and actions. Cover the current interfaces:

- Guest registration and deposit operations.
- Score downloads and personal statistics.
- Feedback collection and confirmations.

Keep current permission checks and callback lifetime rules. Durable controls
must remain usable after restart; temporary controls must retain their existing
expiry and invalidation behavior. Previously sent inline buttons must continue
to follow those same rules.

Updating a message must replace its embedded controls together with its content.
Completing or expiring an interaction must remove controls when the current flow
requires it. Refreshing an older message must remove any separate inline
keyboard to avoid duplicate controls.

Use the unified sending contract from TASK-026 and remove obsolete inline
keyboard options after migrating callers. Update the formatting documentation
to describe the Rich HTML contract and shared grid rendering.

## Acceptance

- Newly sent and updated text messages use Rich HTML. No interface creates or
  attaches a separate inline keyboard for its controls.
- Every migrated interface retains its button labels and actions. Button row
  boundaries and order match the existing grid, including incomplete last rows
  in dynamically generated lists.
- Controls appear below the message body and use the shared grid renderer;
  statistics no longer construct their own button-row markup.
- Literal button labels and callback values containing HTML metacharacters
  remain intact and cannot alter the generated markup.
- Updated messages show only the current controls. Completed and expired flows
  cannot be advanced through removed or stale buttons.
- Existing callback permission checks and lifetime rules remain effective for
  both embedded controls and previously sent inline buttons.
- Durable score and statistics controls still work after restart; temporary
  confirmations do not become valid again.
- Delivery and edit failures remain handled errors without reporting success.
- Formatting documentation matches the migrated interfaces. Relevant checks
  cover grid preservation and control lifecycle; type checks and build pass.
