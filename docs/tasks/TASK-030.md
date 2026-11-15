# TASK-030: Display deposit transactions in a table

## Background

Telegram deposit transaction history is displayed as a text list. Long histories
are difficult to scan, and comparing amounts across transactions is cumbersome.

## Require

Rework the transaction history widget to display transactions in a Rich HTML
table with pagination. Preserve the existing entry point and transaction order.
Support Russian and English, including a clear response when no transactions
are available.

## Acceptance

- Each transaction occupies a separate row beneath these labeled columns:
  - Date, using the current date format.
  - Action: debit or credit.
  - Amount.
  - Balance change, showing the signed difference.
  - Comment, left empty for now.
- Amounts identify GEL as the currency.
- The first page shows the 10 most recent transactions, and each subsequent
  page shows up to 10 older transactions in their original order.
- Buttons below the table navigate between pages: “Later” shows older
  transactions, and “Earlier” returns to newer transactions.
- Navigation cannot move before the first page or beyond the last page.
- If Rich HTML supports it, a current page / total pages counter appears between
  the navigation buttons.
- Transactions retain their original values across pages.
- The table is readable in Telegram on mobile devices in both supported
  languages.
- Empty transaction history produces a localized message instead of an empty
  table.
