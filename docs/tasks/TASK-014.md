# TASK-014: Publish monthly choir attendance reports

## Background

The bot provides personal attendance statistics but does not publish a monthly
summary in the main choir chat. Choristers need a shared view of rehearsal
activity and recognition for consistent attendance.

## Require

Add a stateless Analytic service whose initial capability builds a
MonthlyAttendanceReport for a requested calendar month. Recalculate each report
from the current source data on every request, without caching or persisting
reports. Keep its asynchronous contract independent of Telegram and scheduling.

Include the following in the report:

- Total rehearsal count and total rehearsal hours.
- Rehearsed pieces, ordered by total rehearsal time descending.
- Champions who attended every rehearsal in the month, when any exist.
- Average attendance and attendance leaders for each voice part.

Support two configurable leader selection modes within each part: all choristers
with attendance strictly above 80%, or the top three by attendance. Both modes
order choristers by attendance descending; the threshold mode includes every
qualifying chorister regardless of how many qualify.

Add monthly publication to the main choir chat as a separate responsibility.
Keep formatting separate from report calculation. Any delivery state belongs to
the publication component, not Analytic.

## Acceptance

- Each request returns a newly calculated report; changes in the source snapshot
  are reflected in subsequent requests without an Analytic cache or report store.
- Reports cover the previous calendar month when published automatically, using
  an inclusive start and exclusive end in the documented reporting timezone.
- Totals include only rehearsals treated as held under the documented source-data
  rule. Rehearsal hours are counted once, without multiplying by participants or
  voice parts. Pieces show their accumulated rehearsal time in descending order.
- Champions attended every held rehearsal in the month. Partial attendance counts
  as visiting a rehearsal; joining midway through the month does not make someone
  a champion after attending only the remaining rehearsals. Empty months have no
  champions and produce no division-by-zero results.
- Individual attendance is the ratio of attended minutes to expected minutes.
  The part average is the arithmetic mean of eligible individual percentages.
  Membership eligibility and expected time for newcomers are documented;
  zero-denominator cases do not distort the average or ranking.
- Threshold mode includes all and only choristers strictly above 80%, ordered by
  attendance descending. Top-three mode returns the three highest-ranked eligible
  choristers, or all eligible choristers if fewer than three exist. Thresholds
  and ranking use unrounded values, with deterministic ordering for ties.
- The configured monthly report reaches the main choir chat. Successful delivery
  is remembered across restarts; a missed scheduled tick or a definite delivery
  failure does not permanently skip the report. An uncertain delivery outcome is
  distinguished from a definite failure to avoid blind duplicate retries.
- Long reports retain all required content across message parts. User-supplied
  names and piece titles display correctly. Reports can be built and previewed
  without publishing to the choir chat.
- Failed source refreshes do not result in publishing a report presented as fresh.
  An empty month has explicit handling and cannot produce misleading rankings.

## Plan

### 1. Define calculation and source-data rules

Status: Pending

Specify MonthlyAttendanceReport and its serializable month request. Define the
reporting timezone and publication schedule. Keep both leader modes explicit;
do not switch modes based on the number exceeding 80%.

Document the following source-data rules before implementing the calculations:

- How held rehearsals are distinguished from cancelled or unfilled date columns.
- How overall and per-part rehearsal durations are obtained; the current Database
  derives per-part duration from maximum participant presence, not an explicit
  scheduled duration.
- Which choristers are eligible, including newcomers and missing identity matches;
  use the existing first-presence convention for newcomers unless revised.
- How current voice assignments affect historical reports, since membership and
  voice-change history are not currently available.
- How zero expected minutes, empty months, and equal attendance are handled.

### 2. Make the rehearsal snapshot reliable

Status: Pending

Review RehersalsTracker updates: removed sheet values must disappear from the
in-memory snapshot rather than surviving earlier imports. Make successful refresh
completion observable so publication can await a fresh, consistent snapshot.
Extend the source contract only where needed to implement the rules from step 1.

### 3. Implement the stateless Analytic service

Status: Pending

Add IAnalyticService with an asynchronous
build_monthly_attendance_report(year, month) operation returning
Expected<MonthlyAttendanceReport>. Implement it in components/analytic_service.ts
and assemble dependencies through adapters/analytic_service/factory.ts. Do not
add an Analytic storage adapter or cache.

Read a consistent snapshot of rehearsals and users for each request. Aggregate
the monthly report using system_id for participant identity and Telegram usernames
only to bridge existing attendance records. Reuse compatible calculation rules
from use_cases/analytic.ts without changing existing personal statistics behavior.

### 4. Format reports and provide a preview path

Status: Pending

Add a formatter independent of the calculations. Format totals and piece times
with consistent units, and omit the champions section when empty. Escape dynamic
HTML content and split long output at section or item boundaries. Provide a way
to preview a requested month's report without sending it to the main chat.

### 5. Wire monthly publication and delivery tracking

Status: Pending

Add a separate publication component to Runtime.proceed(). Once the configured
time is due, refresh the source snapshot, request the previous month's report,
and send formatted messages through IGroupChat from get_choir_chat(). On initial
enablement, consider only the previous month rather than replaying all history.

Use a storage/service split and factories for publication state. Track delivery
by month and destination, including progress for multi-part reports and returned
message IDs. Persist successful delivery across restarts and retry definite
failures. Define recovery for uncertain send outcomes without promising atomic
delivery across Telegram and storage. Keep report persistence out of Analytic.

Register configuration and validation through the appropriate factories and
BotConfig, and update botcfg.template.json. Document the schedule and recovery
behavior in the relevant operational guide.

### 6. Verify calculations and publication behavior

Status: Pending

Add focused tests for the following behavior:

- Month and year boundaries, empty months, and source-data eligibility rules.
- Rehearsal totals, piece ordering, part averages, and newcomer denominators.
- Full-month champions versus partial-month newcomers.
- Both leader modes, especially one or two above 80%, exactly 80%, and ties.
- Recalculation after source changes, including deleted attendance values.
- Scheduling after downtime, restart recovery, and partial or uncertain delivery.
- Failed refreshes, escaped names, and reports requiring multiple messages.

Run npm run compile and npm run autotests. Review a preview against a known
monthly source snapshot, verifying counts and attendance before enabling the
production schedule.
