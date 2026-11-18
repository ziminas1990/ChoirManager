# TASK-030: Display deposit transactions in a table

## Background

Telegram deposit transaction history is displayed as a text list. Long histories
are difficult to scan, and comparing amounts across transactions is cumbersome.

## Require

Rework the transaction history widget to display transactions from the last six
months in a Rich HTML table without buttons or pagination. Preserve the existing
entry point and transaction order. Support Russian and English, including a clear
response when no transactions are available in this period.

## Acceptance

- Each transaction occupies a separate row beneath these labeled columns:
  - Date, using the current date format.
  - Operation: top-up or withdrawal followed by the absolute value of
    `after - before`, without a sign.
  - Balance: `before -> after` when the values differ, otherwise only `after`.
  - Comment: deposit top-up or withdrawal for `balance`, and membership fee
    payment for `membership`, localized into the selected language.
- The operation is a top-up for a nonnegative difference and a withdrawal for
  a negative difference. There is no separate balance-change column.
- The table does not display a currency.
- Only transactions dated within the last six calendar months through the
  current time appear, including both boundaries. The cutoff retains the UTC
  time of day and uses the last day of the target month when needed.
- The period is based on the transaction date, not the membership month.
- All matching transactions appear in one table in their original order and
  retain their original values. The title identifies the six-month period.
- The history message has no buttons or page counter and does not require
  message editing.
- The table is readable in Telegram on mobile devices in both supported
  languages.
- A history with no transactions in this period produces a localized message
  identifying the period instead of an empty table.
