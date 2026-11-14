# EPIC-001: Automatic AI Reports

## Background

The bot needs to generate recurring AI reports from a configurable prompt and
recent destination-chat history, then publish them to that chat automatically.
Report definitions will initially live in Google Sheets behind a storage
interface.

Scheduling has hourly precision. All occurrences in the bot's startup hour are
skipped to avoid repeated reports during restarts, and missed occurrences are
not published later as catch-up reports. This service runs without the manual
approval flow used for administrator-requested attendance reports.

## Steps

1. [Store report definitions through Google Sheets](../TASK-023.md). Establish
   the six-field report contract and validation so the service can consume
   definitions independently of the storage backend.
2. [Generate and publish reports with chat history](../TASK-024.md). Use those
   definitions to run an AI agent and deliver a report to its destination,
   independently of scheduling. Depends on step 1.
3. [Schedule reports with startup-hour suppression](../TASK-025.md). Connect
   recurring execution to the bot lifecycle with the requested restart behavior.
   Depends on steps 1 and 2.
