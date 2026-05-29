# Ride Recording Accumulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move live ride recording metric policy and finish-time metric reconciliation behind a pure, tested Ride Recording Accumulator module while preserving existing recorder behavior.

**Architecture:** Create `src/features/ride/rideRecordingAccumulator.ts` as the deep module for timing, pause intervals, auto-pause, lap progress, point ingestion, calories, persisted point replay, and finish snapshots. Keep `useForegroundRideRecorder` as the adapter for Expo location, barometer, background recording, keep-awake, and persistence. Make `rideStorage.finishRide()` persist the accumulator finish snapshot instead of re-owning summary metric reconciliation.

**Tech Stack:** Expo React Native, TypeScript, Vitest, existing ride metric primitives, existing ride point merge/replay helpers, existing SQLite storage module.

---

## File Structure

- Create `src/features/ride/rideRecordingAccumulator.ts`: pure stateful Ride Recording Accumulator, exported constants/types, and factory.
- Create `src/features/ride/rideRecordingAccumulator.test.ts`: parity tests for timing, pause intervals, point ingestion, auto-pause, laps, persisted point replay, finish snapshots, and calories.
- Modify `src/features/ride/useForegroundRideRecorder.ts`: delegate metric and pause/lap policy to the accumulator while preserving the hook interface.
- Modify `src/features/ride/rideStorage.ts`: accept an accumulator finish snapshot and persist its metrics/pause intervals.
- Keep `src/features/ride/metrics.ts`, `src/features/ride/rideCalculations.ts`, and `src/features/ride/ridePoints.ts` as pure primitives used by the accumulator.
- Do not change UI files for this pass unless typecheck exposes a public hook contract mismatch.

---

### Task 1: Accumulator Core Timing And Manual Pause

**Files:**

- Create: `src/features/ride/rideRecordingAccumulator.ts`
- Create: `src/features/ride/rideRecordingAccumulator.test.ts`

- [ ] **Step 1: Write failing timing and manual pause tests**

Create `src/features/ride/rideRecordingAccumulator.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import {
  createRideRecordingAccumulator,
  initialRideRecordingMetrics,
} from './rideRecordingAccumulator';
import type { RidePoint, RideSettings } from './types';

const BASE_TIME = 1_700_000_000_000;

function settings(overrides: Partial<RideSettings> = {}): RideSettings {
  return {
    hasCompletedWelcome: true,
    unitSystem: 'imperial',
    keepAwakeDuringRide: true,
    autoDimScreen: false,
    autoPause: true,
    autoLap: true,
    ascentSource: 'gps-only',
    gpsAccuracy: 'standard',
    splitType: 'distance',
    splitDistanceMeters: 1000,
    splitDurationSeconds: 60,
    theme: 'system',
    mapType: 'standard',
    routeProfile: 'bike',
    dashboardLayout: [],
    dashboardScreens: [],
    connectedHeartRateDevice: null,
    riderWeightKg: null,
    riderHeightCm: null,
    riderAgeYears: null,
    riderMaxHeartRateBpm: null,
    riderSex: null,
    ...overrides,
  };
}

function point(seconds: number, overrides: Partial<RidePoint> = {}): RidePoint {
  return {
    recordedAt: BASE_TIME + seconds * 1000,
    latitude: 0,
    longitude: 0,
    altitude: null,
    speedMps: null,
    heading: null,
    horizontalAccuracy: null,
    verticalAccuracy: null,
    ...overrides,
  };
}

describe('createRideRecordingAccumulator', () => {
  it('starts with the existing initial ride metrics shape', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    expect(initialRideRecordingMetrics).toMatchObject({
      startedAt: null,
      elapsedSeconds: 0,
      movingSeconds: 0,
      pausedSeconds: 0,
      distanceMeters: 0,
      ascentMeters: 0,
      activeCaloriesKcal: null,
      lapNumber: 1,
      lapStartedAt: null,
      lapElapsedSeconds: 0,
      lapPausedSeconds: 0,
      lapMovingSeconds: 0,
    });
    expect(accumulator.getMetrics()).toMatchObject({
      startedAt: BASE_TIME,
      lapStartedAt: BASE_TIME,
      lapNumber: 1,
      elapsedSeconds: 0,
      movingSeconds: 0,
      pausedSeconds: 0,
      lapElapsedSeconds: 0,
      lapMovingSeconds: 0,
      lapPausedSeconds: 0,
    });
    expect(accumulator.getRoutePoints()).toEqual([]);
    expect(accumulator.getCurrentCoordinate()).toBeNull();
    expect(accumulator.getPauseIntervals()).toEqual([]);
  });

  it('refreshes elapsed and moving time from the live clock', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.refreshTiming(BASE_TIME + 75_500);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 75,
      movingSeconds: 75,
      pausedSeconds: 0,
      lapElapsedSeconds: 75,
      lapMovingSeconds: 75,
      lapPausedSeconds: 0,
    });
  });

  it('commits manual pause intervals into total and lap paused time', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.refreshTiming(BASE_TIME + 10_000);
    accumulator.beginManualPause(BASE_TIME + 10_000);
    accumulator.refreshTiming(BASE_TIME + 25_000);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 25,
      movingSeconds: 10,
      pausedSeconds: 15,
      lapElapsedSeconds: 25,
      lapMovingSeconds: 10,
      lapPausedSeconds: 15,
    });

    accumulator.endManualPause(BASE_TIME + 30_000);
    accumulator.refreshTiming(BASE_TIME + 50_000);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 50,
      movingSeconds: 30,
      pausedSeconds: 20,
      lapElapsedSeconds: 50,
      lapMovingSeconds: 30,
      lapPausedSeconds: 20,
    });
    expect(accumulator.getPauseIntervals()).toEqual([
      {
        startedAt: BASE_TIME + 10_000,
        endedAt: BASE_TIME + 30_000,
      },
    ]);
  });

  it('scopes manual pause seconds to the current lap after markLap', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.beginManualPause(BASE_TIME + 10_000);
    accumulator.endManualPause(BASE_TIME + 20_000);
    accumulator.markLap(BASE_TIME + 30_000);
    accumulator.beginManualPause(BASE_TIME + 35_000);
    accumulator.refreshTiming(BASE_TIME + 45_000);

    expect(accumulator.getMetrics()).toMatchObject({
      lapNumber: 2,
      elapsedSeconds: 45,
      pausedSeconds: 20,
      movingSeconds: 25,
      lapElapsedSeconds: 15,
      lapPausedSeconds: 10,
      lapMovingSeconds: 5,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapAverageSpeedMps: 0,
      lapMaxSpeedMps: 0,
      lapActiveCaloriesKcal: 0,
    });
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/features/ride/rideRecordingAccumulator.test.ts
```

Expected: FAIL because `rideRecordingAccumulator.ts` does not exist.

- [ ] **Step 3: Add the accumulator shell and timing implementation**

Create `src/features/ride/rideRecordingAccumulator.ts` with:

```ts
import { withEstimatedCalories } from './metrics';
import type { RidePauseInterval } from './rideCalculations';
import type {
  RideMetrics,
  RidePoint,
  RideSettings,
  RouteCoordinate,
} from './types';

export const RIDE_RECORDING_STOPPED_SPEED_MPS = 0.75;

export const initialRideRecordingMetrics: RideMetrics = {
  startedAt: null,
  elapsedSeconds: 0,
  movingSeconds: 0,
  pausedSeconds: 0,
  distanceMeters: 0,
  ascentMeters: 0,
  activeCaloriesKcal: null,
  currentSpeedMps: 0,
  averageSpeedMps: 0,
  maxSpeedMps: 0,
  lapNumber: 1,
  lapStartedAt: null,
  lapElapsedSeconds: 0,
  lapPausedSeconds: 0,
  lapMovingSeconds: 0,
  lapDistanceMeters: 0,
  lapAscentMeters: 0,
  lapActiveCaloriesKcal: null,
  lapAverageSpeedMps: 0,
  lapMaxSpeedMps: 0,
};

export type RideRecordingPointIngestionResult = {
  didChangeRoutePoints: boolean;
  shouldPersistPoint: boolean;
  didAutoLap: boolean;
};

export type RideRecordingTimingResult = {
  didAutoLap: boolean;
};

export type RideRecordingFinishSnapshot = {
  metrics: RideMetrics;
  routePoints: RidePoint[];
  pauseIntervals: RidePauseInterval[];
};

export type RideRecordingAccumulator = {
  updateSettings: (settings: RideSettings) => void;
  getMetrics: () => RideMetrics;
  getRoutePoints: () => RidePoint[];
  getCurrentCoordinate: () => RouteCoordinate | null;
  getIsAutoPaused: () => boolean;
  getPauseIntervals: (now?: number) => RidePauseInterval[];
  refreshTiming: (now?: number) => RideRecordingTimingResult;
  beginManualPause: (now?: number) => void;
  endManualPause: (now?: number) => void;
  setAutoPaused: (nextIsAutoPaused: boolean, now?: number) => void;
  markLap: (now?: number) => void;
  ingestPoint: (
    point: RidePoint,
    now?: number,
  ) => RideRecordingPointIngestionResult;
  replacePointsFromPersistence: (points: RidePoint[], now?: number) => void;
  finish: (now?: number) => RideRecordingFinishSnapshot;
};

function secondsBetween(startedAt: number, endedAt: number) {
  return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
}

function toRouteCoordinate(point: RidePoint): RouteCoordinate {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function cloneMetrics(metrics: RideMetrics): RideMetrics {
  return { ...metrics };
}

export function createRideRecordingAccumulator({
  settings,
  startedAt,
}: {
  settings: RideSettings;
  startedAt: number;
}): RideRecordingAccumulator {
  let currentSettings = settings;
  let metrics = withEstimatedCalories(
    {
      ...initialRideRecordingMetrics,
      startedAt,
      lapStartedAt: startedAt,
    },
    currentSettings,
  );
  let routePoints: RidePoint[] = [];
  let currentCoordinate: RouteCoordinate | null = null;
  let isAutoPaused = false;
  let previousPoint: RidePoint | null = null;
  let manualPausedStartedAt: number | null = null;
  let autoPausedStartedAt: number | null = null;
  let pauseIntervals: RidePauseInterval[] = [];
  let committedPausedSeconds = 0;
  let committedLapPausedSeconds = 0;
  let stoppedAt: number | null = null;

  function getTimingNow(now = Date.now()) {
    return stoppedAt ?? now;
  }

  function getElapsedSeconds(now = Date.now()) {
    return metrics.startedAt == null
      ? 0
      : secondsBetween(metrics.startedAt, getTimingNow(now));
  }

  function getLapElapsedSeconds(now = Date.now()) {
    return metrics.lapStartedAt == null
      ? 0
      : secondsBetween(metrics.lapStartedAt, getTimingNow(now));
  }

  function getLapPauseSeconds(startedAt: number, endedAt: number) {
    const lapStartedAt = metrics.lapStartedAt;
    const scopedStartedAt =
      lapStartedAt == null ? startedAt : Math.max(startedAt, lapStartedAt);

    return secondsBetween(scopedStartedAt, endedAt);
  }

  function getInProgressPauseSeconds(
    startedAt: number | null,
    now = Date.now(),
  ) {
    if (startedAt == null) {
      return { pausedSeconds: 0, lapPausedSeconds: 0 };
    }

    const timingNow = getTimingNow(now);

    return {
      pausedSeconds: secondsBetween(startedAt, timingNow),
      lapPausedSeconds: getLapPauseSeconds(startedAt, timingNow),
    };
  }

  function getTimingMetrics(now = Date.now()) {
    const elapsedSeconds = getElapsedSeconds(now);
    const lapElapsedSeconds = getLapElapsedSeconds(now);
    const inProgressAutoPauseSeconds = getInProgressPauseSeconds(
      autoPausedStartedAt,
      now,
    );
    const inProgressManualPauseSeconds = getInProgressPauseSeconds(
      manualPausedStartedAt,
      now,
    );
    const pausedSeconds = Math.min(
      elapsedSeconds,
      committedPausedSeconds +
        inProgressAutoPauseSeconds.pausedSeconds +
        inProgressManualPauseSeconds.pausedSeconds,
    );
    const lapPausedSeconds = Math.min(
      lapElapsedSeconds,
      committedLapPausedSeconds +
        inProgressAutoPauseSeconds.lapPausedSeconds +
        inProgressManualPauseSeconds.lapPausedSeconds,
    );

    return {
      elapsedSeconds,
      movingSeconds: Math.max(0, elapsedSeconds - pausedSeconds),
      pausedSeconds,
      lapElapsedSeconds,
      lapPausedSeconds,
      lapMovingSeconds: Math.max(0, lapElapsedSeconds - lapPausedSeconds),
    };
  }

  function applyMetrics(nextMetrics: RideMetrics) {
    metrics = withEstimatedCalories(nextMetrics, currentSettings);
  }

  function refreshTimingState(now = Date.now()) {
    const timingMetrics = getTimingMetrics(now);

    applyMetrics({
      ...metrics,
      ...timingMetrics,
      averageSpeedMps:
        timingMetrics.movingSeconds > 0
          ? metrics.distanceMeters / timingMetrics.movingSeconds
          : 0,
      lapAverageSpeedMps:
        timingMetrics.lapMovingSeconds > 0
          ? metrics.lapDistanceMeters / timingMetrics.lapMovingSeconds
          : 0,
    });
  }

  function refreshTiming(now = Date.now()) {
    refreshTimingState(now);
    return { didAutoLap: false };
  }

  function recordPauseInterval(startedAt: number, endedAt: number) {
    if (endedAt <= startedAt) {
      return;
    }

    pauseIntervals = [...pauseIntervals, { startedAt, endedAt }];
  }

  function commitPauseInterval(startedAt: number, endedAt: number) {
    const pausedSeconds = secondsBetween(startedAt, endedAt);

    if (pausedSeconds <= 0) {
      return;
    }

    committedPausedSeconds += pausedSeconds;
    committedLapPausedSeconds += getLapPauseSeconds(startedAt, endedAt);
    recordPauseInterval(startedAt, endedAt);
  }

  function beginManualPause(now = Date.now()) {
    if (manualPausedStartedAt != null) {
      return;
    }

    manualPausedStartedAt = getTimingNow(now);
    refreshTimingState(now);
  }

  function endManualPause(now = Date.now()) {
    if (manualPausedStartedAt == null) {
      return;
    }

    const startedAt = manualPausedStartedAt;
    manualPausedStartedAt = null;
    commitPauseInterval(startedAt, getTimingNow(now));
    refreshTimingState(now);
  }

  function commitAutoPausedTime(now = Date.now()) {
    if (autoPausedStartedAt == null) {
      return;
    }

    const startedAt = autoPausedStartedAt;
    autoPausedStartedAt = null;
    commitPauseInterval(startedAt, getTimingNow(now));
  }

  function setAutoPaused(nextIsAutoPaused: boolean, now = Date.now()) {
    if (nextIsAutoPaused === isAutoPaused) {
      return;
    }

    if (nextIsAutoPaused) {
      autoPausedStartedAt = getTimingNow(now);
    } else {
      commitAutoPausedTime(now);
    }

    isAutoPaused = nextIsAutoPaused;
    refreshTimingState(now);
  }

  function markLap(now = Date.now()) {
    const timingMetrics = getTimingMetrics(now);
    committedLapPausedSeconds = 0;

    applyMetrics({
      ...metrics,
      ...timingMetrics,
      lapNumber: metrics.lapNumber + 1,
      lapStartedAt: now,
      lapElapsedSeconds: 0,
      lapPausedSeconds: 0,
      lapMovingSeconds: 0,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapActiveCaloriesKcal: null,
      lapAverageSpeedMps: 0,
      lapMaxSpeedMps: 0,
    });
  }

  function getPauseIntervals(now = Date.now()) {
    const timingNow = getTimingNow(now);
    const intervals = [...pauseIntervals];

    if (manualPausedStartedAt != null && timingNow > manualPausedStartedAt) {
      intervals.push({ startedAt: manualPausedStartedAt, endedAt: timingNow });
    }

    if (autoPausedStartedAt != null && timingNow > autoPausedStartedAt) {
      intervals.push({ startedAt: autoPausedStartedAt, endedAt: timingNow });
    }

    return intervals;
  }

  return {
    updateSettings(nextSettings) {
      currentSettings = nextSettings;
      applyMetrics(metrics);
    },
    getMetrics: () => cloneMetrics(metrics),
    getRoutePoints: () => [...routePoints],
    getCurrentCoordinate: () => currentCoordinate,
    getIsAutoPaused: () => isAutoPaused,
    getPauseIntervals,
    refreshTiming,
    beginManualPause,
    endManualPause,
    setAutoPaused,
    markLap,
    ingestPoint(point) {
      currentCoordinate = toRouteCoordinate(point);
      routePoints = [...routePoints, point];
      previousPoint = point;
      refreshTimingState();
      return {
        didChangeRoutePoints: true,
        shouldPersistPoint: true,
        didAutoLap: false,
      };
    },
    replacePointsFromPersistence(points, now = Date.now()) {
      routePoints = [...points];
      previousPoint = routePoints.at(-1) ?? null;
      currentCoordinate = previousPoint
        ? toRouteCoordinate(previousPoint)
        : null;
      refreshTimingState(now);
    },
    finish(now = Date.now()) {
      commitAutoPausedTime(now);
      endManualPause(now);
      stoppedAt = now;
      refreshTimingState(now);

      return {
        metrics: cloneMetrics(metrics),
        routePoints: [...routePoints],
        pauseIntervals: getPauseIntervals(now),
      };
    },
  };
}
```

- [ ] **Step 4: Run the timing tests**

Run:

```bash
npm test -- src/features/ride/rideRecordingAccumulator.test.ts
```

Expected: PASS for the four timing/manual pause tests.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ride/rideRecordingAccumulator.ts src/features/ride/rideRecordingAccumulator.test.ts
git commit -m "Add ride recording accumulator timing"
```

---

### Task 2: Point Ingestion, Auto-Pause, And Laps

**Files:**

- Modify: `src/features/ride/rideRecordingAccumulator.ts`
- Modify: `src/features/ride/rideRecordingAccumulator.test.ts`

- [ ] **Step 1: Add failing point ingestion, auto-pause, and lap tests**

Append these helpers and tests to `src/features/ride/rideRecordingAccumulator.test.ts`:

```ts
const EARTH_RADIUS_METERS = 6_371_000;

function pointAtMeters(
  seconds: number,
  metersEast: number,
  overrides: Partial<RidePoint> = {},
): RidePoint {
  return point(seconds, {
    longitude: (metersEast / EARTH_RADIUS_METERS) * (180 / Math.PI),
    ...overrides,
  });
}

describe('ride point ingestion', () => {
  it('increments live route metrics for counted movement', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    expect(
      accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME),
    ).toMatchObject({
      didChangeRoutePoints: true,
      shouldPersistPoint: true,
      didAutoLap: false,
    });
    accumulator.ingestPoint(
      pointAtMeters(10, 100, { altitude: 10 }),
      BASE_TIME + 10_000,
    );
    accumulator.ingestPoint(
      pointAtMeters(20, 250, { altitude: 14 }),
      BASE_TIME + 20_000,
    );

    expect(accumulator.getRoutePoints()).toHaveLength(3);
    expect(accumulator.getCurrentCoordinate()).toEqual({
      latitude: 0,
      longitude: (250 / EARTH_RADIUS_METERS) * (180 / Math.PI),
    });
    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(250, 6);
    expect(accumulator.getMetrics().ascentMeters).toBe(4);
    expect(accumulator.getMetrics().movingSeconds).toBe(20);
    expect(accumulator.getMetrics().currentSpeedMps).toBeCloseTo(15, 6);
    expect(accumulator.getMetrics().averageSpeedMps).toBeCloseTo(12.5, 6);
    expect(accumulator.getMetrics().maxSpeedMps).toBeCloseTo(15, 6);
    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(250, 6);
    expect(accumulator.getMetrics().lapAscentMeters).toBe(4);
  });

  it('uses reported speed for current and max speed when present', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.ingestPoint(
      pointAtMeters(10, 100, { speedMps: 22 }),
      BASE_TIME + 10_000,
    );

    expect(accumulator.getMetrics().currentSpeedMps).toBe(22);
    expect(accumulator.getMetrics().maxSpeedMps).toBe(22);
  });

  it('does not count the segment that enters or leaves auto-pause', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: true }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.ingestPoint(
      pointAtMeters(10, 2, { speedMps: 0.2 }),
      BASE_TIME + 10_000,
    );

    expect(accumulator.getIsAutoPaused()).toBe(true);
    expect(accumulator.getMetrics().distanceMeters).toBe(0);
    expect(accumulator.getMetrics().movingSeconds).toBe(0);
    expect(accumulator.getMetrics().pausedSeconds).toBe(10);

    accumulator.ingestPoint(
      pointAtMeters(20, 102, { speedMps: 10 }),
      BASE_TIME + 20_000,
    );

    expect(accumulator.getIsAutoPaused()).toBe(false);
    expect(accumulator.getMetrics().distanceMeters).toBe(0);
    expect(accumulator.getPauseIntervals()).toEqual([
      { startedAt: BASE_TIME, endedAt: BASE_TIME + 20_000 },
    ]);

    accumulator.ingestPoint(
      pointAtMeters(30, 202, { speedMps: 10 }),
      BASE_TIME + 30_000,
    );

    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(100, 6);
    expect(accumulator.getMetrics().movingSeconds).toBe(10);
  });

  it('marks laps manually and through distance and time auto-lap rules', () => {
    const distanceAccumulator = createRideRecordingAccumulator({
      settings: settings({
        autoPause: false,
        autoLap: true,
        splitType: 'distance',
        splitDistanceMeters: 100,
      }),
      startedAt: BASE_TIME,
    });

    distanceAccumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    const distanceResult = distanceAccumulator.ingestPoint(
      pointAtMeters(10, 110),
      BASE_TIME + 10_000,
    );

    expect(distanceResult.didAutoLap).toBe(true);
    expect(distanceAccumulator.getMetrics()).toMatchObject({
      lapNumber: 2,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapMovingSeconds: 0,
    });

    const timeAccumulator = createRideRecordingAccumulator({
      settings: settings({
        autoPause: false,
        autoLap: true,
        splitType: 'time',
        splitDurationSeconds: 10,
      }),
      startedAt: BASE_TIME,
    });

    timeAccumulator.refreshTiming(BASE_TIME + 10_000);

    expect(timeAccumulator.getMetrics()).toMatchObject({
      lapNumber: 2,
      lapElapsedSeconds: 0,
      lapMovingSeconds: 0,
    });

    timeAccumulator.markLap(BASE_TIME + 20_000);

    expect(timeAccumulator.getMetrics()).toMatchObject({
      lapNumber: 3,
      lapStartedAt: BASE_TIME + 20_000,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapAverageSpeedMps: 0,
      lapMaxSpeedMps: 0,
    });
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/features/ride/rideRecordingAccumulator.test.ts
```

Expected: FAIL because point ingestion only appends points and does not yet calculate distance, auto-pause, or auto-laps.

- [ ] **Step 3: Implement behavior-preserving point ingestion and auto-laps**

Modify `src/features/ride/rideRecordingAccumulator.ts`:

1. Update imports:

```ts
import {
  distanceBetweenMeters,
  positiveElevationGainMeters,
  withEstimatedCalories,
} from './metrics';
import {
  calculateMetricsFromPoints,
  type RidePauseInterval,
} from './rideCalculations';
import { areRidePointListsEqual, mergeRidePoints } from './ridePoints';
```

2. Add this helper inside `createRideRecordingAccumulator` after `refreshTiming()`:

```ts
function maybeAutoLap(now = Date.now()) {
  if (!currentSettings.autoLap) {
    return false;
  }

  if (
    currentSettings.splitType === 'time' &&
    metrics.lapMovingSeconds >= currentSettings.splitDurationSeconds
  ) {
    markLap(now);
    return true;
  }

  if (
    currentSettings.splitType === 'distance' &&
    metrics.lapDistanceMeters >= currentSettings.splitDistanceMeters
  ) {
    markLap(now);
    return true;
  }

  return false;
}
```

3. Update the public `refreshTiming()` wrapper so timer ticks own time-based auto-lap:

```ts
function refreshTiming(now = Date.now()) {
  refreshTimingState(now);
  return { didAutoLap: maybeAutoLap(now) };
}
```

4. Replace `ingestPoint(point)` with:

```ts
    ingestPoint(point, now = Date.now()) {
      const latestRoutePoint = routePoints.at(-1) ?? null;
      const isChronologicallyNewPoint =
        latestRoutePoint == null || point.recordedAt > latestRoutePoint.recordedAt;

      if (!isChronologicallyNewPoint) {
        const nextRoutePoints = mergeRidePoints(routePoints, [point]);

        if (areRidePointListsEqual(routePoints, nextRoutePoints)) {
          return {
            didChangeRoutePoints: false,
            shouldPersistPoint: false,
            didAutoLap: false,
          };
        }

        replacePointsFromPersistence(nextRoutePoints, now);

        return {
          didChangeRoutePoints: true,
          shouldPersistPoint: true,
          didAutoLap: false,
        };
      }

      currentCoordinate = toRouteCoordinate(point);
      const previous = previousPoint;
      const reportedSpeed = point.speedMps ?? 0;
      const wasAutoPaused = isAutoPaused;
      const secondsSincePrevious = previous
        ? Math.max(0, Math.round((point.recordedAt - previous.recordedAt) / 1000))
        : 0;
      const distanceMeters = previous ? distanceBetweenMeters(previous, point) : 0;
      const calculatedSpeed =
        secondsSincePrevious > 0 ? distanceMeters / secondsSincePrevious : 0;
      const currentSpeedMps = Math.max(0, reportedSpeed || calculatedSpeed);
      const nextAutoPaused =
        currentSettings.autoPause &&
        currentSpeedMps < RIDE_RECORDING_STOPPED_SPEED_MPS;

      setAutoPaused(nextAutoPaused, now);

      const timingMetrics = getTimingMetrics(now);
      const isManualPaused = manualPausedStartedAt != null;
      const shouldCountMovement =
        !isManualPaused && !nextAutoPaused && !wasAutoPaused && previous != null;
      const nextDistanceMeters = shouldCountMovement
        ? metrics.distanceMeters + distanceMeters
        : metrics.distanceMeters;
      const ascentMeters = shouldCountMovement
        ? metrics.ascentMeters + positiveElevationGainMeters(previous, point)
        : metrics.ascentMeters;
      const lapAscentGain = previous
        ? positiveElevationGainMeters(previous, point)
        : 0;
      const lapDistanceMeters = shouldCountMovement
        ? metrics.lapDistanceMeters + distanceMeters
        : metrics.lapDistanceMeters;
      const lapAscentMeters = shouldCountMovement
        ? metrics.lapAscentMeters + lapAscentGain
        : metrics.lapAscentMeters;
      const averageSpeedMps =
        timingMetrics.movingSeconds > 0
          ? nextDistanceMeters / timingMetrics.movingSeconds
          : 0;
      const lapAverageSpeedMps =
        timingMetrics.lapMovingSeconds > 0
          ? lapDistanceMeters / timingMetrics.lapMovingSeconds
          : 0;
      const maxSpeedMps = Math.max(metrics.maxSpeedMps, currentSpeedMps);
      const lapMaxSpeedMps = Math.max(metrics.lapMaxSpeedMps, currentSpeedMps);

      routePoints = [...routePoints, point];
      previousPoint = routePoints.at(-1) ?? null;

      applyMetrics({
        ...metrics,
        ...timingMetrics,
        distanceMeters: nextDistanceMeters,
        ascentMeters,
        currentSpeedMps,
        averageSpeedMps,
        maxSpeedMps,
        lapDistanceMeters,
        lapAscentMeters,
        lapAverageSpeedMps,
        lapMaxSpeedMps,
      });

      const didAutoLap = maybeAutoLap(now);

      return {
        didChangeRoutePoints: true,
        shouldPersistPoint: true,
        didAutoLap,
      };
    },
```

5. Replace `replacePointsFromPersistence(points, now)` with:

```ts
    replacePointsFromPersistence(points, now = Date.now()) {
      routePoints = [...points];
      previousPoint = routePoints.at(-1) ?? null;
      currentCoordinate = previousPoint ? toRouteCoordinate(previousPoint) : null;

      if (routePoints.length <= 1) {
        refreshTimingState(now);
        return;
      }

      const pauseIntervalsForReplay = getPauseIntervals(now);
      const totalMetrics = calculateMetricsFromPoints(
        routePoints,
        pauseIntervalsForReplay,
      );
      const timingMetrics = getTimingMetrics(now);
      const lapStartedAt = metrics.lapStartedAt;
      const lapPoints = lapStartedAt
        ? routePoints.filter((candidate) => candidate.recordedAt >= lapStartedAt)
        : routePoints;
      const lapMetrics = calculateMetricsFromPoints(
        lapPoints,
        pauseIntervalsForReplay,
      );

      applyMetrics({
        ...metrics,
        ...timingMetrics,
        elapsedSeconds: Math.max(
          timingMetrics.elapsedSeconds,
          totalMetrics.elapsedSeconds,
        ),
        distanceMeters: totalMetrics.distanceMeters,
        ascentMeters: totalMetrics.ascentMeters,
        currentSpeedMps: totalMetrics.currentSpeedMps,
        averageSpeedMps:
          timingMetrics.movingSeconds > 0
            ? totalMetrics.distanceMeters / timingMetrics.movingSeconds
            : 0,
        maxSpeedMps: totalMetrics.maxSpeedMps,
        lapDistanceMeters: lapMetrics.distanceMeters,
        lapAscentMeters: lapMetrics.ascentMeters,
        lapAverageSpeedMps:
          timingMetrics.lapMovingSeconds > 0
            ? lapMetrics.distanceMeters / timingMetrics.lapMovingSeconds
            : 0,
        lapMaxSpeedMps: lapMetrics.maxSpeedMps,
      });

    },
```

- [ ] **Step 4: Run the accumulator tests**

Run:

```bash
npm test -- src/features/ride/rideRecordingAccumulator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing metric and point tests**

Run:

```bash
npm test -- src/features/ride/metrics.test.ts src/features/ride/rideCalculations.test.ts src/features/ride/ridePoints.test.ts src/features/ride/rideRecordingAccumulator.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ride/rideRecordingAccumulator.ts src/features/ride/rideRecordingAccumulator.test.ts
git commit -m "Add ride recording accumulator point ingestion"
```

---

### Task 3: Finish Snapshot And Persistence Replay

**Files:**

- Modify: `src/features/ride/rideRecordingAccumulator.ts`
- Modify: `src/features/ride/rideRecordingAccumulator.test.ts`

- [ ] **Step 1: Add failing replay and finish snapshot tests**

Append these tests to `src/features/ride/rideRecordingAccumulator.test.ts`:

```ts
describe('persisted point replay and finish snapshots', () => {
  it('replays persisted points while keeping live timing as authority', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.refreshTiming(BASE_TIME + 100_000);
    accumulator.replacePointsFromPersistence(
      [pointAtMeters(0, 0), pointAtMeters(20, 100), pointAtMeters(40, 250)],
      BASE_TIME + 100_000,
    );

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 100,
      movingSeconds: 100,
      lapElapsedSeconds: 100,
      lapMovingSeconds: 100,
    });
    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(250, 6);
    expect(accumulator.getMetrics().averageSpeedMps).toBeCloseTo(2.5, 6);
    expect(accumulator.getMetrics().maxSpeedMps).toBeCloseTo(7.5, 6);
  });

  it('commits open pauses and freezes finish metrics', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.beginManualPause(BASE_TIME + 10_000);
    accumulator.ingestPoint(pointAtMeters(20, 200), BASE_TIME + 20_000);

    const snapshot = accumulator.finish(BASE_TIME + 30_000);

    expect(snapshot.pauseIntervals).toEqual([
      { startedAt: BASE_TIME + 10_000, endedAt: BASE_TIME + 30_000 },
    ]);
    expect(snapshot.metrics.elapsedSeconds).toBe(30);
    expect(snapshot.metrics.pausedSeconds).toBe(20);
    expect(snapshot.metrics.movingSeconds).toBe(10);
    expect(snapshot.routePoints).toHaveLength(2);

    accumulator.refreshTiming(BASE_TIME + 60_000);
    expect(accumulator.getMetrics().elapsedSeconds).toBe(30);
  });

  it('uses accumulator live metrics when finishing with too few points', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.refreshTiming(BASE_TIME + 45_000);
    accumulator.ingestPoint(pointAtMeters(45, 0), BASE_TIME + 45_000);

    const snapshot = accumulator.finish(BASE_TIME + 60_000);

    expect(snapshot.metrics.elapsedSeconds).toBe(60);
    expect(snapshot.metrics.movingSeconds).toBe(60);
    expect(snapshot.metrics.distanceMeters).toBe(0);
    expect(snapshot.metrics.averageSpeedMps).toBe(0);
  });

  it('refreshes calories for total and lap metrics', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({
        autoPause: false,
        riderWeightKg: 82,
        riderHeightCm: 178,
        riderAgeYears: 38,
        riderSex: 'male',
      }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.ingestPoint(pointAtMeters(600, 5000), BASE_TIME + 600_000);

    expect(accumulator.getMetrics().activeCaloriesKcal).toBeGreaterThan(0);
    expect(accumulator.getMetrics().lapActiveCaloriesKcal).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/features/ride/rideRecordingAccumulator.test.ts
```

Expected: FAIL until `finish()` commits pauses without double-counting and `replacePointsFromPersistence()` applies replay metrics fully.

- [ ] **Step 3: Harden finish and pause commit behavior**

Modify `finish(now)` in `src/features/ride/rideRecordingAccumulator.ts` so it does not call `endManualPause()` after `stoppedAt` is assigned. Use this exact body:

```ts
    finish(now = Date.now()) {
      const timingNow = getTimingNow(now);
      commitAutoPausedTime(timingNow);

      if (manualPausedStartedAt != null) {
        const startedAt = manualPausedStartedAt;
        manualPausedStartedAt = null;
        commitPauseInterval(startedAt, timingNow);
      }

      stoppedAt = timingNow;
      refreshTimingState(timingNow);

      return {
        metrics: cloneMetrics(metrics),
        routePoints: [...routePoints],
        pauseIntervals: getPauseIntervals(timingNow),
      };
    },
```

Keep `finish()` on `refreshTimingState(timingNow)` rather than public `refreshTiming(timingNow)` so stopping a ride does not trigger a new time-based auto-lap.

- [ ] **Step 4: Run accumulator tests**

Run:

```bash
npm test -- src/features/ride/rideRecordingAccumulator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ride/rideRecordingAccumulator.ts src/features/ride/rideRecordingAccumulator.test.ts
git commit -m "Add ride recording accumulator finish snapshots"
```

---

### Task 4: Storage Consumes Finish Snapshot

**Files:**

- Modify: `src/features/ride/rideStorage.ts`
- Modify: `src/features/ride/useForegroundRideRecorder.ts`

- [ ] **Step 1: Update storage signature to accept the accumulator snapshot**

Modify imports in `src/features/ride/rideStorage.ts`:

```ts
import type { RideRecordingFinishSnapshot } from './rideRecordingAccumulator';
```

Replace `finishRide` signature:

```ts
export async function finishRide(
  rideId: string,
  finishSnapshot: RideRecordingFinishSnapshot,
  settings: RideSettings,
): Promise<FinishedRideSummary> {
```

Replace the beginning of the function through `const splits = ...` with:

```ts
const points = await loadRidePoints(rideId);
const metrics = withEstimatedCalories(finishSnapshot.metrics, settings);
const splits =
  points.length > 1
    ? buildRideSplits(points, settings, finishSnapshot.pauseIntervals)
    : [];
```

Keep the existing DB update, `replaceRideSplits`, `savedMetrics`, `loadRideSummary`, and fallback summary logic, but make them use `metrics`.

- [ ] **Step 2: Update the recorder stop path to pass a finish snapshot**

In `src/features/ride/useForegroundRideRecorder.ts`, import:

```ts
import type { RideRecordingFinishSnapshot } from './rideRecordingAccumulator';
```

Temporarily adapt the current stop path by creating a snapshot from the existing refs just before `finishRide(...)`:

```ts
const finishSnapshot: RideRecordingFinishSnapshot = {
  metrics: finalMetrics,
  routePoints: routePointsRef.current,
  pauseIntervals: getPauseIntervals(stoppedAt),
};
```

Then call:

```ts
finishedRide = await finishRide(rideIdRef.current, finishSnapshot, settings);
```

This task changes storage ownership first without changing the live recorder internals yet. Task 5 removes this temporary adapter snapshot and uses the accumulator directly.

- [ ] **Step 3: Run tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/ride/rideStorage.ts src/features/ride/useForegroundRideRecorder.ts
git commit -m "Persist ride recording finish snapshots"
```

---

### Task 5: Foreground Recorder Uses The Accumulator

**Files:**

- Modify: `src/features/ride/useForegroundRideRecorder.ts`
- Modify: `src/features/ride/rideRecordingAccumulator.ts` only if integration exposes a missing accumulator method.

- [ ] **Step 1: Replace recorder-owned metric refs with an accumulator ref**

In `src/features/ride/useForegroundRideRecorder.ts`, replace imports from `./metrics` and `./rideStorage`:

```ts
import {
  createRideRecordingAccumulator,
  initialRideRecordingMetrics,
  type RideRecordingAccumulator,
} from './rideRecordingAccumulator';
```

Remove direct imports of `distanceBetweenMeters`, `positiveElevationGainMeters`, `withEstimatedCalories`, and `calculateMetricsFromPoints` from this file.

Replace local `initialMetrics` with `initialRideRecordingMetrics`. Keep the state declaration as:

```ts
const [metrics, setMetrics] = useState<RideMetrics>(
  initialRideRecordingMetrics,
);
const metricsRef = useRef<RideMetrics>(initialRideRecordingMetrics);
const accumulatorRef = useRef<RideRecordingAccumulator | null>(null);
```

- [ ] **Step 2: Add accumulator state publisher helpers**

Add these helpers after `updateRoutePoints`:

```ts
function getAccumulator() {
  return accumulatorRef.current;
}

function publishAccumulatorState() {
  const accumulator = getAccumulator();

  if (!accumulator) {
    return;
  }

  updateMetrics(accumulator.getMetrics());
  updateRoutePoints(accumulator.getRoutePoints());
  setCurrentCoordinate(accumulator.getCurrentCoordinate());
  isAutoPausedRef.current = accumulator.getIsAutoPaused();
  setIsAutoPaused(accumulator.getIsAutoPaused());
}
```

- [ ] **Step 3: Delete recorder-owned metric policy helpers**

Remove these functions and refs from `useForegroundRideRecorder.ts`:

- `previousPointRef`
- `pausedStartedAtRef`
- `autoPausedStartedAtRef`
- `pauseIntervalsRef`
- `committedPausedSecondsRef`
- `committedLapPausedSecondsRef`
- `secondsBetween`
- `getTimingNow`
- `getElapsedSeconds`
- `getLapElapsedSeconds`
- `getLapPauseSeconds`
- `getInProgressAutoPauseSeconds`
- `getInProgressManualPauseSeconds`
- `getTimingMetrics`
- `refreshTimingMetrics`
- `recordPauseInterval`
- `commitPauseInterval`
- `commitManualPausedTime`
- `commitAutoPausedTime`
- `setAutoPausedStatus`
- `resetTimingState`
- `getPauseIntervals`
- `refreshRouteMetricsFromPoints`

Keep a public `markLap()` wrapper with:

```ts
function markLap() {
  getAccumulator()?.markLap(Date.now());
  publishAccumulatorState();
}
```

- [ ] **Step 4: Update timer behavior**

Replace the timer body:

```ts
const accumulator = getAccumulator();

if (accumulator) {
  accumulator.refreshTiming(Date.now());
  publishAccumulatorState();
}

ensureForegroundLocationWatch();
```

The accumulator owns time-based auto-lap during `refreshTiming`.

- [ ] **Step 5: Update start ride**

In `startRide()`, replace metric/reset initialization with:

```ts
accumulatorRef.current = createRideRecordingAccumulator({
  settings,
  startedAt,
});
shouldSyncBeforeNextLocationRef.current = false;
clearResumePointSync();
publishAccumulatorState();
setCurrentCoordinate(null);
isAutoPausedRef.current = false;
setIsAutoPaused(false);
```

Do not remove the existing ride id, database, background permission, status, timer, barometer, location watch, and keep-awake behavior.

- [ ] **Step 6: Update location ingestion**

Inside the `Location.watchPositionAsync` callback, keep the permission/watch/platform code but replace the metric-heavy recording branch with:

```ts
const point = toRidePoint(location, barometerAltitudeRef.current);
const accumulator = getAccumulator();

if (!accumulator) {
  return;
}

const result = accumulator.ingestPoint(point, Date.now());

if (!result.didChangeRoutePoints) {
  return;
}

publishAccumulatorState();

if (!result.shouldPersistPoint) {
  return;
}

await insertRidePoint(rideIdRef.current, point, 'foreground-gps');
```

Keep the pre-existing `shouldSyncBeforeNextLocationRef` sync before this block.

- [ ] **Step 7: Update persisted point sync**

Replace `syncPersistedRidePoints()` internals with:

```ts
const persistedPoints = await loadRidePoints(rideIdRef.current);
const accumulator = getAccumulator();
const currentPoints = accumulator
  ? accumulator.getRoutePoints()
  : routePointsRef.current;
const nextRoutePoints = mergeRidePoints(currentPoints, persistedPoints);

if (areRidePointListsEqual(currentPoints, nextRoutePoints)) {
  return;
}

if (accumulator) {
  accumulator.replacePointsFromPersistence(nextRoutePoints, Date.now());
  publishAccumulatorState();
  return;
}

updateRoutePoints(nextRoutePoints);

const latestPoint = nextRoutePoints.at(-1) ?? null;
setCurrentCoordinate(
  latestPoint ? toRouteCoordinateFromPoint(latestPoint) : null,
);
```

- [ ] **Step 8: Update pause and resume**

In `pauseRide()` replace pause metric operations with:

```ts
const pausedStartedAt = Date.now();
getAccumulator()?.setAutoPaused(false, pausedStartedAt);
getAccumulator()?.beginManualPause(pausedStartedAt);
publishAccumulatorState();
```

In `resumeRide()` replace manual pause commit and `previousPointRef` reset with:

```ts
getAccumulator()?.endManualPause(Date.now());
publishAccumulatorState();
```

Keep active ride id, background recording, watch/barometer, and keep-awake behavior unchanged.

- [ ] **Step 9: Update stop ride**

In `stopRide()`, replace metric finalization and finish snapshot creation with:

```ts
const stoppedAt = Date.now();
const finishSnapshot = getAccumulator()?.finish(stoppedAt);

if (finishSnapshot) {
  updateMetrics(finishSnapshot.metrics);
}

setRideStatus('stopped');
stopTimer();
```

Keep the watch/background sync sequence. After the final `syncPersistedRidePoints()` call and before `finishRide(...)`, refresh the snapshot:

```ts
const finalSnapshot = getAccumulator()?.finish(stoppedAt);

if (finalSnapshot) {
  updateMetrics(finalSnapshot.metrics);
}
```

Then call:

```ts
finishedRide = finalSnapshot
  ? await finishRide(rideIdRef.current, finalSnapshot, settings)
  : null;
```

Keep the existing post-finish `updateMetrics({ ... })` from the saved summary.

- [ ] **Step 10: Update settings changes**

In the `useEffect` that updates `settingsRef`, add:

```ts
accumulatorRef.current?.updateSettings(settings);
```

Do not publish accumulator state from this settings effect. Existing behavior applies settings changes on the next timing refresh or point ingestion, and this keeps the effect from creating a render loop.

- [ ] **Step 11: Run focused tests and typecheck**

Run:

```bash
npm test -- src/features/ride/rideRecordingAccumulator.test.ts src/features/ride/rideCalculations.test.ts src/features/ride/ridePoints.test.ts src/features/ride/metrics.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/features/ride/useForegroundRideRecorder.ts src/features/ride/rideRecordingAccumulator.ts
git commit -m "Use ride recording accumulator in foreground recorder"
```

---

### Task 6: Verification And Ownership Cleanup

**Files:**

- Modify only files needed to remove stale ownership or fix verification failures.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run format check**

Run:

```bash
npm run format:check
```

Expected: PASS. If it fails, run:

```bash
npm run format
npm run format:check
```

Expected after formatting: PASS.

- [ ] **Step 5: Confirm recorder no longer owns metric policy helpers**

Run:

```bash
rg -n "distanceBetweenMeters|positiveElevationGainMeters|withEstimatedCalories|calculateMetricsFromPoints|pauseIntervalsRef|committedPausedSecondsRef|committedLapPausedSecondsRef|previousPointRef|refreshRouteMetricsFromPoints|getTimingMetrics|setAutoPausedStatus" src/features/ride/useForegroundRideRecorder.ts
```

Expected: no matches.

- [ ] **Step 6: Confirm storage no longer calculates finish summary metrics**

Run:

```bash
rg -n "calculateMetricsFromPoints|fallbackMetrics|pointMetrics" src/features/ride/rideStorage.ts
```

Expected: no matches for `fallbackMetrics` or `pointMetrics`; `calculateMetricsFromPoints` should not be imported by `rideStorage.ts`.

- [ ] **Step 7: Confirm accumulator owns recording metric policy**

Run:

```bash
rg -n "RIDE_RECORDING_STOPPED_SPEED_MPS|createRideRecordingAccumulator|RideRecordingFinishSnapshot|beginManualPause|setAutoPaused|replacePointsFromPersistence|finish\\(" src/features/ride/rideRecordingAccumulator.ts src/features/ride/useForegroundRideRecorder.ts src/features/ride/rideStorage.ts
```

Expected: accumulator definitions in `rideRecordingAccumulator.ts`, adapter calls in `useForegroundRideRecorder.ts`, and snapshot type usage in `rideStorage.ts`.

- [ ] **Step 8: Commit verification fixes if needed**

If verification changed files, run:

```bash
git add src/features/ride
git commit -m "Verify ride recording accumulator integration"
```

If no files changed, do not create an empty commit.
