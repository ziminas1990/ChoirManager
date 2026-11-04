# TASK-003: Release 3 — remove users from membership while preserving history

## Background

After [release 2](TASK-002.md), administrators can add members and manage their roles. A separate confirmed removal flow is needed to revoke access while preserving the person's data.

## Require

Add removal from membership through the bot. Removal means revoking all roles without physically deleting the profile. Preserve:

- The user identifier and Telegram binding.
- Deposits and transaction history.
- Statistics and other historical data.

AI creates a request that is applied only after Telegram confirmation by its initiator, who must still hold administrative permissions. The message must clearly identify the target user and state that all roles will be revoked.

Revoke access in the current session, including access through previously issued buttons and AI tools. Adding the person again must restore access to their existing profile. Prevent administrators from revoking their own administrative permissions.

## Acceptance

- The user's roles and access remain unchanged until removal is confirmed.
- After confirmation, all roles are revoked and the bot reports the result to the initiator.
- The removed user loses access to membership features and previously held privileged roles without a restart.
- Previously created buttons, AI tools, and pending requests cannot bypass revoked permissions.
- The user remains in the system with minimal permissions; removal does not erase their profile or Telegram binding.
- Deposits, transactions, and statistics are preserved; adding the person again restores access to their previous history without creating a new profile.
- Rejection, timeout, or confirmation by someone without the required permissions does not apply removal.
- Repeated confirmation or use of an old button after a restart does not apply the operation again.
- An administrator cannot remove themselves from membership or otherwise revoke their own Admin role.
- Users unaffected by the removal retain their existing features.
