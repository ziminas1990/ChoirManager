# TASK-014: Consolidate report calculations in the Analytic service

## Background

Personal attendance calculations live in a static use-case class, while the
low-attendance list is calculated inside AttendanceTracker's formatting code.
Activity-period calculations also exist, but have no current callers. A separate
HTML analytics prototype is unfinished and no longer needed.

A single service should own these calculations and provide monthly choir report
data using consistent, explicit source-data rules.

## Require

Add a stateless Analytic service with an asynchronous IAnalyticService contract
that accepts transport-mappable requests and returns structured report data.
Use Date objects for dates; transport adapters own their encoding and restoration.
Recalculate results from the current source snapshot on every request, without
an Analytic cache or report store.

Consolidate the existing calculations in this service:

- Personal attendance for a requested period, including expected and attended
  rehearsal counts and hours, consecutive recent absences, and piece statistics.
- Activity periods, including first attendance and the start of the latest active
  period, with a configurable inactivity gap.
- Low-attendance lists for a requested period, including attendance percentages
  and the existing selection and ordering rules.

Switch the personal statistics widget and AttendanceTracker to the service.
Keep presentation and reminder orchestration with their existing consumers.
Remove src/use_cases/analytic.ts after migrating its calculations.

Add MonthlyAttendanceReport for a requested calendar month, containing:

- Total rehearsal count and total rehearsal hours.
- Rehearsed pieces, ordered by accumulated rehearsal time descending.
- Champions who attended every held rehearsal for their voice part in the month.
- Average attendance and attendance leaders for each voice part.

Support two explicit leader selection modes per part: all eligible choristers
strictly above 80%, or the top three eligible choristers. Both modes order by
attendance descending; do not switch modes based on how many exceed 80%.

Document calculation rules supported by the available data:

- Reporting timezone and period boundaries.
- Which rehearsals count as held and how overall and per-part durations are
  determined, given that current per-part duration is maximum participant presence.
- Membership eligibility and expected time since the first recorded attendance.
- Rehearsal eligibility for each chorister: positive duration for their current
  voice part, within the requested period and since their first recorded visit.
  Apply it consistently to all individual attendance measures.
- Use of current voice assignments for historical reports.
- Identity matching between system IDs and attendance records keyed by Telegram
  username, including unmatched records.
- Piece-time attribution when a chorister attended only part of a rehearsal.
- Empty periods, zero expected time, rounding, and deterministic tie ordering.

Remove the abandoned HTML analytics prototype under src/analytic/ and its
exclusive build configuration and dependencies.

## Acceptance

- All report calculations are available through the asynchronous Analytic service
  as transport-mappable data with Date values, independently of presentation.
  Analytic has no report persistence or result cache; subsequent requests reflect
  changes in its input snapshot.
- Personal statistics and AttendanceTracker use the service without duplicating
  attendance calculations. Existing reminder orchestration is preserved. The
  low-attendance list preserves its current rounded-up percentage comparison
  against 60% and descending ordering.
- Personal statistics use only rehearsals for the chorister's current voice part
  since their first recorded attendance. The same selection applies to rehearsal
  counts and hours, consecutive absences, and piece statistics. Rehearsals with
  zero duration for that part and dates before joining cannot count as absences.
  Partial presence retains the current piece-time attribution. Zero expected time
  has explicit handling and cannot produce NaN or infinite percentages.
- Activity results retain the existing inactivity-gap semantics and distinguish
  ongoing periods from closed periods.
- Monthly results cover the requested calendar month with an inclusive start and
  exclusive end in the documented reporting timezone, including year boundaries.
- Monthly totals include only held rehearsals. Rehearsal hours are counted once,
  without multiplying by participants or voice parts. Piece times are accumulated
  and ordered descending.
- Champions attended every held rehearsal for their current voice part over the
  whole month; positive partial attendance counts as a visit. Attending only the
  remaining rehearsals after joining does not waive earlier rehearsals for that
  part. A part with no rehearsals has no champions. Empty months have no champions
  or misleading rankings.
- Monthly individual attendance is attended minutes divided by expected minutes.
  Each part average is the arithmetic mean of eligible individual percentages.
  Zero-denominator cases are excluded from monthly averages and rankings.
- Monthly threshold mode includes all and only eligible choristers strictly above
  80%. Top-three mode returns the three highest-ranked eligible choristers, or all
  if fewer than three exist. Monthly comparisons use unrounded values and ties
  have deterministic ordering.
- src/use_cases/analytic.ts and the abandoned HTML analytics prototype are removed;
  active code and build configuration no longer reference them.
- Focused checks cover migrated calculations and monthly report edge cases.
  npm run compile and npm run autotests pass after the migration and cleanup.
