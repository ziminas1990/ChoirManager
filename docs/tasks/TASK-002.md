# TASK-002: Release 2 — add users with Telegram confirmation

## Background

After [release 1](./closed/TASK-001.md), users are stored in Firestore, but administrators cannot yet manage membership through the bot. Adding members needs a flow where AI proposes a change and a person makes the decision.

## Require

Allow administrators to find and add users through the bot with specified profile details and roles. If a person already exists as a user without roles, adding them must reuse their existing profile and history. Support changing an existing member's roles through the same confirmation flow.

AI may search for users and create change requests. A change may be applied only after its initiator explicitly confirms a Telegram message showing the specific proposed changes. Check administrative permissions when a request is created and when it is confirmed.

Report whether a request was applied, rejected, expired, or failed. Granted permissions must take effect in the current session. A user with the Admin role must be able to access the administrative dialog without also holding Chorister or Manager roles.

Requests may remain in memory for this release: a restart invalidates old requests. Full removal from membership is delivered in [release 3](TASK-003.md). A general workflow engine and protection against concurrent writes are not required for this release.

## Acceptance

- An administrator can find the intended person and request their addition with specified profile details and roles; ambiguous matches require clarification.
- Until confirmation, the target user's profile and permissions remain unchanged; an AI command alone does not apply the change.
- The confirmation message identifies who is being added or updated and which details and roles will be assigned.
- Confirmation by the initiator creates the user or updates their existing profile without a duplicate; the bot reports the actual outcome.
- An existing member's roles can be changed through the same flow; full removal from membership remains unavailable.
- A user without roles who has already contacted the bot retains their identifier and gains access after confirmed addition without a restart.
- An administrator without additional roles can use the administrative dialog.
- Rejection, timeout, or an attempt to confirm another person's request does not change data.
- Repeated clicks and buttons belonging to requests created before a restart cannot apply a change again or initiate a new change.
- A user without administrative permissions cannot create or confirm a request; losing permissions after creating a request prevents its application.
- An application failure is reported to the administrator as an error rather than a successful operation.
- Existing user flows from release 1 continue working.

## Plan

### 1. Improve user search and target selection

Status: Pending

Search before both adding users and changing roles. Reuse the existing system identifier when the intended person already has a profile without roles. Ask for clarification when several profiles match; a matching name alone must not trigger automatic profile merging.

### 2. Prepare specific changes before confirmation

Status: Pending

Validate the initiator's administrative permissions, the target, and the proposed changes when creating a request. Keep enough information to show the target, profile changes, and complete resulting role set in the confirmation message.

Apply changes only after confirmation. Updating an existing profile must preserve its identifier, Telegram binding, and history. If an identity conflict is discovered before application, fail the request and require a new proposal rather than silently changing its target.

### 3. Enforce release 2 membership restrictions

Status: Pending

Allow adding members and changing their roles, but reject changes that leave the target without any roles: full removal belongs to release 3. Preserve the existing restriction against removing the initiator's own Admin role. Enforce these rules in the administration service independently of AI instructions.

### 4. Complete the Telegram confirmation flow and outcome reporting

Status: Pending

Share the common confirmation handling between user creation and updates. Show the target's name and Telegram identity, current and proposed field values, and resulting roles.

Report the actual outcome to the administrator: applied, rejected, expired, or failed. Handle the result of background workflows instead of discarding it. An AI tool response must distinguish a successfully created request from a successfully applied change.

### 5. Ensure each request can be applied only once

Status: Pending

Recheck the initiator's current Admin permission and request ownership at confirmation. Make a request unavailable for repeated application before starting the write. Check expiration when processing a click, independently of background cleanup.

Verify that repeated clicks, another person's confirmation, and buttons from before a restart cannot apply changes. Show an appropriate message for expired or unavailable administrative confirmations.

### 6. Refresh permissions in the current session

Status: Pending

Make the administrative dialog available to users whose only role is Admin. Refresh session data and available AI tools after role changes so newly granted permissions work without restarting the bot or reopening the session. Check administrative actions against current user data rather than relying only on the tools registered when a dialog was created.

### 7. Connect the service and update configuration and documentation

Status: Pending

Create the administration service through its existing factory, register it in the environment, and connect expired-request cleanup to the runtime lifecycle. Remove the release 1 warnings that administrative changes are disabled. Add confirmation lifetime and pending-request limit settings to the configuration template and update the relevant operational documentation.

### 8. Verify acceptance criteria and release 1 regressions

Status: Pending

Add automated tests with storage and Telegram substitutes covering:

- No profile or permission changes before confirmation.
- Confirmed creation, reuse of an existing roleless profile without changing its identifier, and role updates.
- Rejection, expiration, loss of Admin permissions, and confirmation by another person.
- Repeated clicks, stale buttons after a restart, and write failures.
- Access for an Admin without additional roles and permission updates in an existing session.
- Rejection of full membership removal through the role-update flow.

Run `npm run autotests` and manually check the existing release 1 user flows. Keep requests in memory and reuse the existing administration service without introducing a general workflow engine or extending concurrent-write protection.
