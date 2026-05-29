# Ride Recording Runtime Plan

## Goal

Deepen **Ride Recording Runtime** into a framework-independent module that owns active ride execution while preserving the current `useForegroundRideRecorder(settings)` interface.

## Decisions

- **Ride Recording Runtime** owns app-state foreground/background location handoff.
- It publishes one snapshot containing current state and recording errors.
- Persistence is behind the Runtime seam, including active ride identity, point sync, and finish persistence.
- The Runtime creates the **Ride Recording Accumulator** through an injected factory.
- The Runtime owns current ride settings. `startRide()` uses the latest settings; `updateSettings(settings)` updates the active accumulator and future adapter starts.
- The Runtime is framework-independent. React Native app-state values are passed into `handleAppStateChange(nextState)`.
- User-facing recording errors stay in the Runtime snapshot for the first pass.

## Target Interface

```ts
export type RideRecordingRuntimeSnapshot = {
  status: RideStatus;
  metrics: RideMetrics;
  routePoints: RidePoint[];
  currentCoordinate: RouteCoordinate | null;
  error: string | null;
  isAutoPaused: boolean;
};

export type RideRecordingRuntime = {
  getSnapshot(): RideRecordingRuntimeSnapshot;
  subscribe(
    listener: (snapshot: RideRecordingRuntimeSnapshot) => void,
  ): () => void;
  updateSettings(settings: RideSettings): void;
  startRide(): Promise<void>;
  pauseRide(): Promise<void>;
  resumeRide(): Promise<void>;
  stopRide(): Promise<FinishedRideSummary | null>;
  markLap(): void;
  handleAppStateChange(nextState: string): Promise<void>;
  dispose(): Promise<void>;
};
```

## Adapters Behind The Seam

- `foregroundLocation`: requests foreground permission, starts/stops a watch, emits `RidePoint` samples.
- `backgroundRecording`: gets/requests background permission, starts/stops background recording, reports whether it is started.
- `recordingStore`: initializes storage, creates ride id and ride row, owns active ride id, inserts/loads points, finishes a ride.
- `altitudeSensor`: starts/stops barometer sampling and exposes the current altitude override.
- `wakeLock`: activates/deactivates keep-awake; Runtime owns the policy for when to call it.
- `scheduler`: interval, timeout, and cancellation for timing ticks and delayed resume sync.
- `clock`: current timestamp for deterministic tests.
- `accumulatorFactory`: creates the **Ride Recording Accumulator**.

## Implementation Steps

1. Add `src/features/ride/rideRecordingRuntime.ts` with the interface, adapter types, and behavior moved from `useForegroundRideRecorder.ts`.
2. Add `src/features/ride/rideRecordingRuntime.test.ts` using fake adapters and a fake scheduler.
3. Refactor `src/features/ride/useForegroundRideRecorder.ts` into a React/Expo adapter that creates the Runtime, subscribes to snapshots, wires `AppState`, and returns the existing hook shape.
4. Keep `app/index.tsx` unchanged.
5. Run `npm run test`, `npm run typecheck`, and `npm run lint`.

## Test Coverage

- `startRide()` permission denied publishes the existing location error.
- `startRide()` creates a ride, active ride id, accumulator, timer, barometer, background recording attempt, foreground watch, keep-awake sync, and snapshot.
- Foreground point ingestion updates the accumulator snapshot and persists accepted points.
- Active-to-background handoff starts background recording and stops foreground watching when successful.
- Background-to-active handoff syncs points, restarts foreground watching, syncs again, and schedules delayed resume sync.
- Paused app-state handoff starts/stops only the foreground watch as today.
- `pauseRide()` and `resumeRide()` preserve active ride id, background recording, barometer, timer, and snapshot ordering.
- `stopRide()` freezes the accumulator, syncs persisted points around background stop, finishes persistence, clears active ride id, and returns the finished ride.
- `dispose()` cancels timers, stops watches/sensors/background recording, and deactivates wake lock.

## Compatibility Rules

- Preserve existing user-facing error strings.
- Preserve existing GPS accuracy/time/distance intervals in production adapters.
- Do not restart an already-running foreground location watch just because settings changed.
- Preserve the public hook return shape.
- Do not change database schema or `app/index.tsx`.
