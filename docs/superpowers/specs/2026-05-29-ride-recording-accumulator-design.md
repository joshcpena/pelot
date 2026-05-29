# Ride Recording Accumulator Design

## Goal

Move live ride recording metric policy out of `useForegroundRideRecorder` and finish-time reconciliation out of `rideStorage.finishRide()` into one deep ride module named **Ride Recording Accumulator**.

The refactor must preserve existing behavior. This is an ownership and testability pass, not a metric semantics change.

## Current Friction

Live recording metrics are spread across several seams:

- `useForegroundRideRecorder.ts` owns timers, refs, auto-pause, manual pause, lap reset, incremental distance/ascent/speed, calories, and background point sync.
- `rideCalculations.ts` can replay points, but callers still know when and how to apply pause intervals, fallback timing, lap state, and split rules.
- `rideStorage.finishRide()` re-decides final metrics by combining point replay with fallback live metrics.
- `metrics.ts` provides useful primitives, but callers assemble the ride lifecycle policy themselves.

The interface is currently shallow: callers must know too much about timing authority, pause interval state, lap progress, calorie refresh, and finish reconciliation.

## Proposed Module

Create a pure module under `src/features/ride/`, likely `rideRecordingAccumulator.ts`, with focused tests beside it.

The module should expose a small stateful interface. Exact names can be refined during implementation, but the intended shape is:

```ts
createRideRecordingAccumulator({
  settings,
  startedAt,
});
```

The accumulator should own these actions:

- `ingestPoint(point, now)`
- `beginManualPause(now)`
- `endManualPause(now)`
- `setAutoPaused(isAutoPaused, now)`
- `markLap(now)`
- `refreshTiming(now)`
- `replacePointsFromPersistence(points, now)`
- `finish(now)`

The accumulator should expose these read methods:

- `getMetrics()`
- `getRoutePoints()`
- `getCurrentCoordinate()`
- `getPauseIntervals(now?)`
- `getFinishSnapshot(now)`

The implementation should remain independent of Expo, React, SQLite, background recording, and barometer APIs.

## Foreground Hook Role

`useForegroundRideRecorder` remains the adapter for platform mechanics:

- foreground location permission and location watch lifecycle
- Expo location objects to `RidePoint`
- barometer altitude sampling
- background recording start/stop and app-state handoff
- database inserts and persisted point loading
- keep-awake lifecycle
- public React state and command surface

The hook should stop owning metric math, pause interval bookkeeping, lap reset details, and finish metric reconciliation. It should delegate those to the accumulator and then publish the accumulator state.

## Storage Role

`rideStorage.finishRide()` should persist a finished ride snapshot rather than rebuilding the summary policy itself.

The heavy pass should keep storage as a persistence module. It may still load saved points and build splits, but the metric authority should come from the Ride Recording Accumulator finish snapshot. Where persisted points are needed for splits, use the same pause intervals and behavior-preserving timing rules that the accumulator uses.

## Behavior Preservation Rules

This pass must preserve current behavior:

- The stopped-speed threshold remains `0.75` meters per second.
- GPS accuracy, time interval, and distance interval behavior remains in the foreground hook.
- Barometer preference remains an adapter concern; the accumulator receives normalized `RidePoint` values.
- Manual pause and auto-pause intervals continue to contribute to total and lap paused seconds.
- Auto-pause starts and ends are converted into pause intervals exactly as today.
- Lap reset preserves current behavior: increment lap number, set lap start to the mark time, clear lap distance/ascent/speed/calorie values, and reset committed lap pause seconds.
- Auto-lap behavior remains based on moving lap time for time splits and lap distance for distance splits.
- Calories continue to use the existing `withEstimatedCalories` formulas and rider settings.
- Finish preserves today's compatibility rule: live elapsed and moving seconds remain the timing authority, while replayed point metrics provide distance, ascent, current speed, average speed, and max speed when enough points exist.
- If there are too few points, finish uses the accumulator's live metrics snapshot as fallback.

## Data Flow

### Start

The hook creates a ride id, persists the ride row, and creates a Ride Recording Accumulator with `startedAt`. The accumulator initializes metrics with `startedAt`, `lapStartedAt`, lap number 1, empty points, and calorie estimates from settings.

### Foreground Point

The hook normalizes an Expo location sample into a `RidePoint` and passes it to the accumulator. The accumulator decides:

- whether the point is chronological or should be merged into persisted points
- whether movement should count based on manual pause, auto-pause, and previous point state
- distance, ascent, current speed, average speed, max speed, lap distance, lap ascent, lap average, lap max, and calories
- whether auto-lap should fire

The hook persists the point after the accumulator accepts it.

### Persisted Point Sync

When background points are loaded, the hook merges foreground and persisted points using the existing point merge behavior. It gives the merged list to the accumulator. The accumulator replays route metrics using its pause intervals, then keeps live timing as the timing authority.

### Pause And Resume

Manual pause and resume call accumulator actions to commit timing and pause intervals. The hook still handles active ride id, background recording, location watch, barometer, and keep-awake effects.

### Stop

Stop calls accumulator finish with `stoppedAt`. The accumulator commits open manual and auto-pause intervals, freezes timing, refreshes calories, and returns a finish snapshot. Storage persists that snapshot and uses the snapshot pause intervals when building splits.

## Tests

Add parity-focused tests before moving implementation:

- initial metrics at ride start
- foreground point ingestion increments distance/ascent/current speed/average speed/max speed
- manual pause excludes paused time from moving seconds and emits pause intervals
- auto-pause threshold starts and ends pause intervals
- lap reset clears lap metrics while preserving total metrics
- time-based and distance-based auto-lap triggers preserve current behavior
- persisted point replacement replays route metrics and keeps live timing authority
- finish snapshot commits open pause intervals and preserves fallback behavior with too few points
- finish snapshot uses replayed point distance/ascent/speeds when enough points exist
- calorie estimates are refreshed from settings for total and lap metrics

Existing tests in `metrics.test.ts`, `rideCalculations.test.ts`, and recorder-adjacent tests should remain green.

## Rollout Plan

1. Add accumulator types and tests around current behavior.
2. Move timing, pause interval, lap, point ingestion, and calorie logic into the accumulator.
3. Wire `useForegroundRideRecorder` to the accumulator while keeping the public hook contract unchanged.
4. Change finish persistence to accept the accumulator finish snapshot and remove duplicate reconciliation logic from `rideStorage.finishRide()`.
5. Run full tests, typecheck, lint, format check, and reference searches for stale metric ownership in the hook/storage modules.

## Non-goals

- No new ride metric formulas.
- No UI redesign.
- No changes to GPS permission behavior.
- No changes to background recording registration.
- No database schema changes unless implementation uncovers a strict persistence mismatch.
- No simulator or device automation requirement in the first implementation plan, though manual device QA remains valuable after merge.

## Success Criteria

- `useForegroundRideRecorder` reads like a platform adapter rather than a metric policy module.
- Finish-time saved summaries match current behavior.
- Active ride UI receives the same recorder contract.
- Metric lifecycle behavior can be tested through the Ride Recording Accumulator interface without React, Expo, or SQLite.
- Stale metric policy references in `useForegroundRideRecorder` and `rideStorage.finishRide()` are removed or reduced to adapter calls.
