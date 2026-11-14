# TASK-014: Complete and verify Analytic report calculations

## Background

The asynchronous Analytic service already provides personal attendance and
activity reports, low-attendance lists, and monthly reports. Personal statistics
and AttendanceTracker use it, and the old use-case and HTML prototype are removed.

Historical reports use each chorister's current voice, but per-part rehearsal
durations retain values calculated under earlier voice assignments. For example,
a 60-minute alto moved to tenor can be compared against a previously calculated
30-minute tenor duration, producing 200% attendance. Database updates only
increase stored maxima, so later refreshes can also retain obsolete durations
for the former part.

The calculations have no focused service tests. README links to a missing
docs/analytics.md guide, leaving the source-data rules incompletely documented.

## Require

Make report inputs consistent with current voice assignments on every request,
including historical reports. A part's rehearsal duration remains the maximum
presence of participants assigned to that part in the current snapshot. A voice
change must affect both individual eligibility and per-part duration on the next
request, without waiting for an attendance refresh or restart. Attendance
refreshes must not retain obsolete maxima or contributions to former parts.

Preserve the asynchronous, transport-mappable service contract with Date values
and no Analytic result cache or report store. Keep presentation and reminder
orchestration with the existing consumers.

Document the calculation rules in docs/analytics.md and ensure README's link
resolves. Cover:

- UTC reporting boundaries and the definition of a held rehearsal.
- Overall and per-part durations, including current voices in historical reports.
- Membership eligibility and expected attendance since the first recorded visit.
- The common rehearsal selection for individual counts and hours, consecutive
  absences, and piece statistics.
- Identity matching by system ID and Telegram username, including unmatched
  attendance records and profiles without a username.
- Full piece-time credit for positive partial attendance.
- Empty periods, zero denominators, rounding, and deterministic tie ordering.
- Monthly champions, part averages, and the two explicit leader selection modes.

Add focused regression coverage for the calculations and their source-data
integration, including voice changes and repeated attendance refreshes. Verify
that AttendanceTracker consumes service results while preserving reminder
orchestration.

## Acceptance

- Moving a 60-minute alto to tenor alongside a 30-minute tenor immediately gives
  a 60-minute tenor duration. Their attendance becomes 100% and 50%, respectively;
  the monthly tenor average is 75%, and only the first qualifies above 80%.
- Voice changes remove obsolete contributions to the former part. A part with
  no remaining positive attendance has zero duration. Repeated refreshes and
  decreases in recorded attendance do not leave stale duration maxima.
- Subsequent requests reflect the current source snapshot without an Analytic
  cache or report store. Focused checks exercise the production source adapter,
  not only an artificial snapshot or mocked service response.
- Personal counts and hours use only rehearsals with positive duration for the
  current part, within the requested period and since the first recorded visit.
  Consecutive absences and piece statistics use the same selection. Positive
  partial attendance credits the rehearsal's full piece times; zero expected
  time cannot produce NaN or infinite percentages.
- Activity coverage verifies the configurable inactivity gap, including equality
  at the gap boundary, and distinguishes ongoing periods from closed periods.
- Low-attendance selection compares rounded-up percentages against 60% and
  orders them descending. AttendanceTracker preserves its reminder trigger and
  notification behavior while using service results.
- Monthly coverage verifies inclusive UTC month starts and exclusive ends,
  including year boundaries. Only held rehearsals count; their hours count once.
  Piece times accumulate and sort descending.
- Champions require a positive visit to every held rehearsal for the current
  part over the whole month. Joining during the month does not waive earlier
  rehearsals. Empty months and parts without rehearsals have no champions.
- Monthly individual percentages use attended minutes divided by expected
  minutes; part averages are arithmetic means. Zero-denominator cases are
  excluded from averages and rankings, including empty months.
- Threshold mode uses unrounded percentages strictly above 80%; top-three mode
  returns up to three eligible choristers regardless of that threshold. Both
  order attendance descending with deterministic ties.
- The analytics guide resolves from README and explains all calculation rules
  listed above, including identity matching and rounding.
- Focused regression checks pass, as do npm run compile and npm run autotests.
