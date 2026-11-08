# TASK-004: Release 4 — close remaining technical gaps in user management

## Background

After [release 3](./closed/TASK-003.md), migration and membership management work. Technical gaps remain in linking historical data to users and handling the lifecycle of administrative actions. Close these gaps while preserving the behavior delivered in previous releases.

## Require

Preserve the link between a user and their historical data when their Telegram username changes. A display-name change must not alter the user's identity or associate them with someone else's history.

Make profile and role updates consistent across active sessions and caches. Remove temporary workarounds left by previous releases.

Give unfinished requests a clear user-facing outcome after a restart. Requests that can no longer be confirmed must not appear active without an explanation.

Update documentation and extend regression checks across the membership management lifecycle. A general WorkflowService is not a required deliverable. The assumption of a single writing instance remains; add protection against concurrent writes only if a separate requirement arises.

Fixes needed to meet a previous release's acceptance criteria belong in that release and must not be deferred to this task.

## Acceptance

- After a Telegram username change, the user retains their identifier and access to their deposit history, transactions, and statistics.
- A new owner of the previous username does not receive someone else's permissions or historical data.
- Profile and role updates are reflected consistently in active sessions; outdated tools and buttons do not retain revoked permissions.
- After a restart, an unfinished request has a defined outcome that its initiator can understand; an invalid button is not silently ignored.
- Neither a restart nor redelivery of a confirmation applies a change automatically or repeatedly.
- Checks cover migration, addition, role changes, and removal from membership.
- Username changes, adding a former member again, and restarting with an unfinished request are explicitly verified.
- Existing deposits, statistics, and other user flows remain functional; documentation matches the actual behavior and update procedure.
