# TASK-029: Replace the Telegram reply keyboard with an actions menu

## Background

The Telegram bot displays a persistent reply keyboard beneath the input field.
Updating that keyboard requires sending a message, coupling navigation to the
bot's messages.

## Require

Replace the reply keyboard with the Telegram bot commands menu. Preserve access
to every existing keyboard action and remove the code that builds the reply
keyboard.

## Acceptance

- The menu provides the existing actions: restart the conversation, view deposit
  information, view statistics, send feedback, and download scores.
- Each menu action retains the behavior of its corresponding keyboard button and
  is available in the supported languages.
- The reply keyboard is removed for existing users and is not shown in new
  conversations.
- Bot messages no longer construct or attach a reply keyboard.
