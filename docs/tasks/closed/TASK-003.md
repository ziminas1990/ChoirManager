# TASK-003: Release 3 — remove users from membership while preserving history

## Background

After [release 2](./TASK-002.md), administrators can add members and manage their roles. A separate confirmed removal flow is needed to revoke access while preserving the person's data.

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

## Plan

### 1. Add a membership removal operation

Status: Done

Extend `IAdministrationService` with `request_remove_member(actor_id, system_id)` and add removal variants to the operation and result types. Reuse the existing pending-request lifecycle in `AdministrationService`.

Validate the initiator's Admin permission and the target's membership. Reject self-removal. Capture the target and current roles for confirmation. Keep ordinary role updates separate from full removal so the latter always has an explicit confirmation.

Implemented request planning with the shared pending-request lifecycle and detached profile snapshots. Added removal operation/result types and compatible text rendering. Application is handled in step 2. Step 1 validation: `npm run autotests` passed all 80 tests, including seven new administration-service tests.

### 2. Apply removal only after confirmation

Status: Done

Reuse request ownership, expiration, and current Admin checks. Consume the request before starting the write to prevent repeated application.

Recheck the target and captured roles before application. If roles changed after the request was created, fail the request and require a new proposal so the confirmed change matches the applied change.

Persist only `roles: []`. Preserve the profile and its identity; leave historical data untouched.

### 3. Connect AI requests and Telegram confirmation

Status: Done

Add `user_remove_request` to `AdministrationTools`, accepting a `system_id` obtained through user search. Connect it through `AdministratorWorkflows` to the existing confirmation flow.

Show the target's name and Telegram identity in the confirmation. List current roles and explicitly state that all roles will be revoked while the profile and history remain. Add removal result text and reuse rejection, timeout, and failure reporting.

### 4. Revoke access in active sessions

Status: Done

Ensure protected actions in `TelegramUser` and `UserLogic` use current permissions. Block protected actions when permissions cannot be resolved.

Review access through:

- Previously issued buttons, especially saved callback functions; retain and verify existing checks for scores and statistics.
- Every AI tool invocation, including calls from an assistant response already in progress. Removing tools from the advertised list alone is insufficient.
- Membership tools currently registered as base capabilities, which must become unavailable when no roles remain.
- Pending administrative requests created by a user whose Admin permission has since been revoked.

Route the removed user to the existing guest dialog without restarting the bot.

### 5. Preserve identity when adding the member again

Status: Done

Reuse the existing promotion flow for profiles without roles. Verify the complete membership cycle from removal to addition without creating a new profile.

Confirm preservation of:

- The original `system_id` and Telegram binding.
- Deposits and transaction history.
- Statistics and other historical data.

Restore access using the roles assigned during the new addition.

### 6. Add regression coverage

Status: Pending

Cover the administration service, Telegram confirmation, and access in an existing session. Follow the project's test motivation and numbered-step rules.

Verify:

- No changes before confirmation and complete role revocation afterward.
- No application after rejection, expiration, another person's confirmation, or loss of Admin permission.
- Rejection of self-removal and other attempts to remove the initiator's own Admin role.
- No repeated write from duplicate or concurrent confirmations or an old button after restart.
- Rejection of stale proposals when the target's roles changed.
- No access bypass through old buttons, AI calls, or pending requests.
- History preservation and reuse of the original profile on addition.
- Continued access for unaffected users.

### 7. Validate and update documentation

Status: Pending

Run `npm run autotests` and `npm run build`. Manually verify the Telegram flow with an administrator and a separate target user. Update affected operational guides and check every acceptance criterion before closing the task.

Pending requests may remain in memory and become invalid after restart. The broader user-facing lifecycle for unfinished requests after restart belongs to [release 4](../TASK-004.md); protection against repeated execution and revoked-permission bypass is required here.
