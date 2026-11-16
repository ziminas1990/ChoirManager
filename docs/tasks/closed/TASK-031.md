# TASK-031: Restore inline keyboards for Telegram widgets

## Background

[TASK-027](./TASK-027.md) replaced inline keyboards with buttons embedded
in Rich HTML. Messages containing Rich HTML buttons cannot be edited, which
breaks widgets that update their content or controls after an interaction.

## Require

Reverse the button migration from TASK-027 and restore inline keyboards for
Telegram widget controls. Preserve the existing widget behavior and the ability
to edit messages and update or remove their controls. Rich HTML may still be
used for message content where appropriate.

Account for messages already sent with embedded buttons during the transition.
Update the affected formatting documentation to match the restored behavior.

## Acceptance

- Widgets use inline keyboards rather than embedded Rich HTML buttons for
  controls, including guest registration, deposits, score downloads, personal
  statistics, feedback, and confirmations.
- Widget messages can be edited as their content or controls change; completed
  and expired interactions remove controls when required.
- Button labels, actions, row order, and dynamically generated layouts retain
  their existing behavior.
- Permission checks and callback lifetime rules remain effective. Durable
  controls work after restart, and expired temporary controls stay invalid.
- Previously sent messages with embedded buttons are handled without reporting
  an unsuccessful edit as successful; users can continue the affected flow.
- Delivery and edit failures remain handled errors. Relevant checks cover widget
  updates and control lifecycles, and the affected documentation is current.
