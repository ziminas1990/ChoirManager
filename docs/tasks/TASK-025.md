# TASK-025: Schedule Automatic AI Reports with startup-hour suppression

## Background

Automatic reports must run at their configured cadence with hourly precision.
Restarting the bot during a scheduled report hour must not trigger that report
again. Restart protection is a deliberate skipped occurrence, not a delayed
publication after startup.

This task belongs to [EPIC-001](epics/EPIC-001.md) and depends on
[TASK-023](TASK-023.md) and [TASK-024](TASK-024.md).

## Require

Complete the Automatic AI Reports service with hourly scheduling and integrate
its lifecycle with the bot. Determine recurring occurrences from the first
report time and interval, without shifting the cadence to execution or restart
times.

Use one documented timezone and hour-boundary rule consistently. Skip every
report occurrence whose hour is the hour in which the bot started, regardless
of whether that occurrence had already been processed before the restart.
Start normal scheduling with later hours. Do not catch up skipped startup-hour
occurrences or occurrences missed while the bot was offline.

Ensure repeated scheduling checks and overlapping executions do not start the
same report occurrence more than once within a running process. Keep schedule
behavior independent of the Google Sheets adapter.

## Acceptance

- Reports recur from the configured first report time with hourly precision,
  including 1h, 1d, 7d, and 14d intervals. They do not run before the first
  scheduled report hour.
- If a report is due in hour H and the bot starts at any point in H, that
  occurrence is neither generated nor published. This also applies to a second
  restart in H.
- A report due in a later hour is processed normally after startup. For example,
  starting in hour 10 skips an hourly report in hour 10 and permits hour 11.
- Skipping an occurrence does not shift subsequent times. A skipped 7d report
  remains anchored to its original weekly schedule.
- Offline occurrences and skipped startup-hour occurrences are not sent later
  as catch-up reports.
- Repeated checks or a slow AI run do not start duplicate executions for the
  same report and occurrence. Other due reports can still progress.
- Updated report definitions follow the documented refresh behavior without
  replaying already processed occurrences in the current process.
- The bot starts and stops report scheduling with its normal lifecycle.
  Operational logs distinguish skipped occurrences from failed executions.
- Focused checks verify hour boundaries and recurrence behavior alongside the
  startup and restart scenarios above.
