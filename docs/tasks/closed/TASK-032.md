# TASK-032: Include recent transactions in deposit change notifications

## Background

Deposit change notifications tell users about changes to their deposit, but do
not show recent transactions that help explain its history.

## Require

Append a table of the user's five most recent deposit transactions to the end
of each deposit change notification.

## Acceptance

- A deposit change notification ends with a table containing the five most recent transactions for that user.
- If fewer than five transactions exist, the table shows all available transactions without adding empty transaction rows.
- If no transactions exist, the notification clearly indicates that there are no transactions.
- The notification and transaction information are understandable in both Russian and English.
- The existing deposit change information remains present in the notification.
