# TASK-021: Publish attendance reports with two administrator confirmations

## Background

The Analytic service provides attendance report data, but an administrator cannot
ask the bot to prepare a report and publish an approved version to a chosen chat.
Publication needs the same explicit approval guarantees as user administration,
with a separate review of the actual report before it is sent.

## Require

Allow an administrator to request an attendance report for a specified period and
destination chat through the bot's administrative dialog. Use the Analytic
service for calculations, following [TASK-014](TASK-014.md).

Require two distinct confirmations from the initiating administrator:

- Before generating the report, show the requested period and destination and
  ask for approval to start the operation.
- After generation, send the full report privately to the administrator with
  the destination and ask for approval to publish that exact report.

Use the existing user-administration confirmation conventions, including
rejection and expiry. Check current administrator permissions at request time
and at both confirmation stages. A chat reply or an AI tool call alone must not
count as confirmation.

Resolve ambiguous report parameters before the first confirmation. Publish only
the reviewed report to the reviewed destination; changes require a new approval
flow. Report the actual operation outcome to the administrator.

## Acceptance

- An administrator can request a report for a chosen period and chat. The first
  confirmation clearly identifies both, and no report is generated before it.
- Report figures come from the Analytic service rather than duplicate attendance
  calculations in the dialog or AI layer.
- After the first approval, the administrator receives the full report privately.
  Nothing is published to the destination before the second approval.
- The second approval publishes the exact reviewed content to the chosen chat.
  Longer reports are fully reviewable and delivered without truncation.
- Only the initiating administrator can approve either stage. Loss of
  administrator permissions prevents the operation from proceeding.
- Rejection or expiry at either stage ends the operation without publication.
  Old confirmations cannot advance a replacement request.
- Repeated or concurrent confirmations do not generate or publish duplicate
  reports. Restarting the bot does not automatically approve pending requests.
- Generation or delivery failures are reported as failures, including partial
  delivery when a report requires multiple messages.
