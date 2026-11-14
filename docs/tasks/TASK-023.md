# TASK-023: Store Automatic AI Reports definitions through Google Sheets

## Background

Automatic AI Reports needs an editable table of recurring report definitions.
Google Sheets will be the initial backend, while the service must remain
independent of that storage technology.

This task belongs to [EPIC-001](epics/EPIC-001.md).

## Require

Define a storage interface for report definitions and provide a Google Sheets
adapter. Each definition has these fields:

- Internal report name, never included in published report content.
- Destination chat.
- Prompt for generating the report.
- First report time.
- Recurrence interval, supporting values such as 1h, 1d, 7d, and 14d.
- Number of days of destination-chat history to include in the agent context.

Validate definitions and expose failures clearly without preventing valid rows
from being used. Keep persistence separate from scheduling and AI behavior.
Provide the configuration and factory boundary required for the report service
to obtain this storage without depending directly on Google Sheets.

Document the sheet schema and value formats. Define the timezone used for report
times and the meaning of interval units; a day represents 24 elapsed hours.
State how edits to the table become visible to the running service.

## Acceptance

- A configured Google Sheet supplies all six fields through a storage interface
  without exposing Google Sheets types to service consumers.
- Report times and supported intervals are interpreted consistently according
  to documented rules. Invalid intervals cannot create a scheduling loop.
- Empty prompts or destinations are rejected. History length accepts zero or a
  positive whole number of days and rejects negative or malformed values.
- An invalid row is identified clearly and does not prevent other valid report
  definitions from being read. Storage access failures remain distinguishable
  from an empty table.
- Table edits take effect according to the documented refresh behavior.
- Configuration validation catches missing Google Sheets settings before the
  service starts processing reports.
