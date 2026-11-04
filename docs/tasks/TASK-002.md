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
