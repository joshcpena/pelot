import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_LOCATION_START_WARNING,
  BACKGROUND_LOCATION_UNAVAILABLE_ERROR,
  createRideRecordingRuntime,
  LOCATION_PERMISSION_ERROR,
  type RideRecordingRuntimeAdapters,
  type RideRecordingRuntimeSnapshot,
} from './rideRecordingRuntime';
import {
  initialRideRecordingMetrics,
  type RideRecordingAccumulator,
  type RideRecordingFinishSnapshot,
  type RideRecordingTimingResult,
} from './rideRecordingAccumulator';
import type { FinishedRideSummary } from './rideStorage';
import type { RidePoint, RideSettings } from './types';

const BASE_TIME = 1_700_000_000_000;

function settings(overrides: Partial<RideSettings> = {}): RideSettings {
  return {
    hasCompletedWelcome: true,
    unitSystem: 'imperial',
    keepAwakeDuringRide: true,
    autoDimScreen: false,
    autoPause: true,
    autoLap: false,
    ascentSource: 'barometer-preferred',
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
    latitude: 38,
    longitude: -77,
    altitude: null,
    speedMps: null,
    heading: null,
    horizontalAccuracy: null,
    verticalAccuracy: null,
    ...overrides,
  };
}

function coordinateFromPoint(ridePoint: RidePoint) {
  return {
    latitude: ridePoint.latitude,
    longitude: ridePoint.longitude,
  };
}

function timingResult(): RideRecordingTimingResult {
  return { didAutoLap: false };
}

type FakeScheduledTask = {
  delayMs: number;
  isCanceled: boolean;
  fire(): Promise<void>;
  cancel(): void;
};

function createSchedulerFake() {
  const intervals: FakeScheduledTask[] = [];
  const timeouts: FakeScheduledTask[] = [];

  function createTask(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): FakeScheduledTask {
    return {
      delayMs,
      isCanceled: false,
      async fire() {
        if (!this.isCanceled) {
          await callback();
        }
      },
      cancel() {
        this.isCanceled = true;
      },
    };
  }

  return {
    intervals,
    timeouts,
    adapter: {
      setInterval(callback: () => void | Promise<void>, delayMs: number) {
        const task = createTask(callback, delayMs);
        intervals.push(task);
        return task;
      },
      setTimeout(callback: () => void | Promise<void>, delayMs: number) {
        const task = createTask(callback, delayMs);
        timeouts.push(task);
        return task;
      },
    },
  };
}

type FakeLocationWatch = {
  settings: RideSettings;
  isRemoved: boolean;
  emit(ridePoint: RidePoint): Promise<void>;
  remove(): void;
};

function createForegroundLocationFake(log: string[]) {
  let permissionStatus = 'granted';
  const watches: FakeLocationWatch[] = [];

  return {
    watches,
    setPermissionStatus(nextStatus: string) {
      permissionStatus = nextStatus;
    },
    get currentWatch() {
      return watches.at(-1) ?? null;
    },
    adapter: {
      async requestPermission() {
        return { status: permissionStatus };
      },
      async startWatching({
        settings: watchSettings,
        onPoint,
      }: {
        settings: RideSettings;
        onPoint: (ridePoint: RidePoint) => void | Promise<void>;
      }) {
        log.push(`foreground.start:${watchSettings.gpsAccuracy}`);
        const watch: FakeLocationWatch = {
          settings: watchSettings,
          isRemoved: false,
          async emit(ridePoint: RidePoint) {
            await onPoint(ridePoint);
          },
          remove() {
            this.isRemoved = true;
            log.push('foreground.stop');
          },
        };
        watches.push(watch);
        return watch;
      },
    },
  };
}

function createBackgroundRecordingFake(log: string[]) {
  let permissionStatus = 'granted';
  let requestPermissionStatus: string | null = null;
  let startResult = true;
  let isStarted = false;
  const startCalls: RideSettings[] = [];
  let stopCalls = 0;

  return {
    startCalls,
    get stopCalls() {
      return stopCalls;
    },
    get isStarted() {
      return isStarted;
    },
    setPermissionStatus(nextStatus: string) {
      permissionStatus = nextStatus;
    },
    setRequestPermissionStatus(nextStatus: string | null) {
      requestPermissionStatus = nextStatus;
    },
    setStartResult(nextResult: boolean) {
      startResult = nextResult;
    },
    setIsStarted(nextIsStarted: boolean) {
      isStarted = nextIsStarted;
    },
    adapter: {
      async getPermission() {
        return { status: permissionStatus };
      },
      async requestPermission() {
        return { status: requestPermissionStatus ?? permissionStatus };
      },
      async isStarted() {
        return isStarted;
      },
      async start(nextSettings: RideSettings) {
        startCalls.push(nextSettings);
        log.push(`background.start:${nextSettings.gpsAccuracy}`);
        isStarted = startResult;
        return startResult;
      },
      async stop() {
        stopCalls += 1;
        isStarted = false;
        log.push('background.stop');
      },
    },
  };
}

function createFinishedRideSummary(
  points: RidePoint[] = [],
): FinishedRideSummary {
  return {
    summary: {
      id: 'ride-1',
      title: null,
      startedAt: BASE_TIME,
      endedAt: BASE_TIME + 60_000,
      elapsedSeconds: 60,
      movingSeconds: 55,
      distanceMeters: 123,
      ascentMeters: 4,
      activeCaloriesKcal: 12,
      feelingRating: null,
      averageSpeedMps: 2.2,
      maxSpeedMps: 5,
      unitPreference: 'imperial',
    },
    points,
    splits: [],
  };
}

function createRecordingStoreFake(log: string[]) {
  const createdRides: {
    rideId: string;
    unitSystem: RideSettings['unitSystem'];
  }[] = [];
  const activeRideIds: (string | null)[] = [];
  const insertedPoints: {
    rideId: string;
    point: RidePoint;
    source: 'foreground-gps' | 'background-gps';
  }[] = [];
  const loadRidePointCalls: string[] = [];
  const finishRideCalls: {
    rideId: string;
    snapshot: RideRecordingFinishSnapshot;
    settings: RideSettings;
  }[] = [];
  let rideId = 'ride-1';
  let loadRidePointResults: RidePoint[][] = [[]];
  let finishedRideSummary = createFinishedRideSummary();

  return {
    createdRides,
    activeRideIds,
    insertedPoints,
    loadRidePointCalls,
    finishRideCalls,
    setRideId(nextRideId: string) {
      rideId = nextRideId;
    },
    setLoadRidePointResults(...nextResults: RidePoint[][]) {
      loadRidePointResults = nextResults.length > 0 ? nextResults : [[]];
    },
    setFinishedRideSummary(nextSummary: FinishedRideSummary) {
      finishedRideSummary = nextSummary;
    },
    adapter: {
      async initialize() {
        log.push('store.initialize');
      },
      createRideId() {
        log.push('store.createRideId');
        return rideId;
      },
      async createRide(nextRideId: string, nextSettings: RideSettings) {
        createdRides.push({
          rideId: nextRideId,
          unitSystem: nextSettings.unitSystem,
        });
        log.push(`store.create:${nextRideId}`);
      },
      async setActiveRideId(nextRideId: string | null) {
        activeRideIds.push(nextRideId);
        log.push(`store.active:${nextRideId ?? 'null'}`);
      },
      async insertRidePoint(
        nextRideId: string,
        ridePoint: RidePoint,
        source: 'foreground-gps' | 'background-gps',
      ) {
        insertedPoints.push({ rideId: nextRideId, point: ridePoint, source });
        log.push(`store.insert:${source}`);
      },
      async loadRidePoints(nextRideId: string) {
        loadRidePointCalls.push(nextRideId);
        log.push(`store.load:${nextRideId}`);
        const nextPoints =
          loadRidePointResults.length > 1
            ? loadRidePointResults.shift()
            : loadRidePointResults[0];

        return [...(nextPoints ?? [])];
      },
      async finishRide(
        nextRideId: string,
        snapshot: RideRecordingFinishSnapshot,
        nextSettings: RideSettings,
      ) {
        finishRideCalls.push({
          rideId: nextRideId,
          snapshot,
          settings: nextSettings,
        });
        log.push(`store.finish:${nextRideId}`);
        return finishedRideSummary;
      },
    },
  };
}

function createAltitudeSensorFake(log: string[]) {
  const startCalls: RideSettings[] = [];
  let stopCalls = 0;
  let altitudeOverride: number | null = null;

  return {
    startCalls,
    get stopCalls() {
      return stopCalls;
    },
    setAltitudeOverride(nextAltitudeOverride: number | null) {
      altitudeOverride = nextAltitudeOverride;
    },
    adapter: {
      async start(nextSettings: RideSettings) {
        startCalls.push(nextSettings);
        log.push('altitude.start');
      },
      async stop() {
        stopCalls += 1;
        altitudeOverride = null;
        log.push('altitude.stop');
      },
      getAltitudeOverride() {
        return altitudeOverride;
      },
    },
  };
}

function createWakeLockFake(log: string[]) {
  let activateCalls = 0;
  let deactivateCalls = 0;

  return {
    get activateCalls() {
      return activateCalls;
    },
    get deactivateCalls() {
      return deactivateCalls;
    },
    adapter: {
      async activate() {
        activateCalls += 1;
        log.push('wake.activate');
      },
      async deactivate() {
        deactivateCalls += 1;
        log.push('wake.deactivate');
      },
    },
  };
}

function createClockFake() {
  let currentTime = BASE_TIME;

  return {
    setNow(nextTime: number) {
      currentTime = nextTime;
    },
    advanceBy(milliseconds: number) {
      currentTime += milliseconds;
    },
    adapter: {
      now() {
        return currentTime;
      },
    },
  };
}

type FakeAccumulator = RideRecordingAccumulator & {
  updateSettingsCalls: RideSettings[];
  ingestPointCalls: RidePoint[];
  replacePointsFromPersistenceCalls: RidePoint[][];
  finishCalls: number[];
};

function createFakeAccumulator({
  settings: initialSettings,
  startedAt,
}: {
  settings: RideSettings;
  startedAt: number;
}): FakeAccumulator {
  const updateSettingsCalls: RideSettings[] = [];
  const ingestPointCalls: RidePoint[] = [];
  const replacePointsFromPersistenceCalls: RidePoint[][] = [];
  const finishCalls: number[] = [];
  let routePoints: RidePoint[] = [];
  let currentCoordinate: ReturnType<typeof coordinateFromPoint> | null = null;
  let isAutoPaused = false;
  let manualPauseStartedAt: number | null = null;
  let metrics = {
    ...initialRideRecordingMetrics,
    startedAt,
    lapStartedAt: startedAt,
    activeCaloriesKcal: 0,
    lapActiveCaloriesKcal: 0,
  };

  function refreshElapsed(now: number) {
    metrics = {
      ...metrics,
      elapsedSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)),
    };
  }

  return {
    updateSettings(nextSettings) {
      updateSettingsCalls.push(nextSettings);
      void initialSettings;
    },
    getMetrics() {
      return { ...metrics };
    },
    getRoutePoints() {
      return [...routePoints];
    },
    getCurrentCoordinate() {
      return currentCoordinate == null ? null : { ...currentCoordinate };
    },
    getIsAutoPaused() {
      return isAutoPaused;
    },
    getPauseIntervals(now = startedAt) {
      return manualPauseStartedAt == null
        ? []
        : [{ startedAt: manualPauseStartedAt, endedAt: now }];
    },
    refreshTiming(now = startedAt) {
      refreshElapsed(now);
      return timingResult();
    },
    beginManualPause(now = startedAt) {
      manualPauseStartedAt = now;
      return timingResult();
    },
    endManualPause(now = startedAt) {
      if (manualPauseStartedAt != null) {
        metrics = {
          ...metrics,
          pausedSeconds: Math.floor((now - manualPauseStartedAt) / 1000),
        };
      }
      manualPauseStartedAt = null;
      return timingResult();
    },
    setAutoPaused(nextIsAutoPaused) {
      isAutoPaused = nextIsAutoPaused;
      return timingResult();
    },
    markLap() {
      metrics = {
        ...metrics,
        lapNumber: metrics.lapNumber + 1,
      };
      return timingResult();
    },
    ingestPoint(ridePoint) {
      ingestPointCalls.push(ridePoint);
      routePoints = [...routePoints, ridePoint];
      currentCoordinate = coordinateFromPoint(ridePoint);
      metrics = {
        ...metrics,
        currentSpeedMps: ridePoint.speedMps ?? 0,
        distanceMeters: Math.max(0, routePoints.length - 1),
      };

      return {
        didChangeRoutePoints: true,
        shouldPersistPoint: true,
        didAutoLap: false,
      };
    },
    replacePointsFromPersistence(points) {
      replacePointsFromPersistenceCalls.push(points);
      routePoints = [...points];
      const latestPoint = routePoints.at(-1) ?? null;
      currentCoordinate = latestPoint ? coordinateFromPoint(latestPoint) : null;
      return timingResult();
    },
    finish(now = startedAt) {
      finishCalls.push(now);
      refreshElapsed(now);

      return {
        metrics: { ...metrics },
        routePoints: [...routePoints],
        pauseIntervals: this.getPauseIntervals(now),
      };
    },
    updateSettingsCalls,
    ingestPointCalls,
    replacePointsFromPersistenceCalls,
    finishCalls,
  };
}

function createAccumulatorFactoryFake() {
  const accumulators: FakeAccumulator[] = [];

  return {
    accumulators,
    factory(input: { settings: RideSettings; startedAt: number }) {
      const accumulator = createFakeAccumulator(input);
      accumulators.push(accumulator);
      return accumulator;
    },
  };
}

function createRuntimeHarness({
  initialSettings = settings(),
}: {
  initialSettings?: RideSettings;
} = {}) {
  const log: string[] = [];
  const foregroundLocation = createForegroundLocationFake(log);
  const backgroundRecording = createBackgroundRecordingFake(log);
  const recordingStore = createRecordingStoreFake(log);
  const altitudeSensor = createAltitudeSensorFake(log);
  const wakeLock = createWakeLockFake(log);
  const scheduler = createSchedulerFake();
  const clock = createClockFake();
  const accumulatorFactory = createAccumulatorFactoryFake();
  const adapters: RideRecordingRuntimeAdapters = {
    foregroundLocation: foregroundLocation.adapter,
    backgroundRecording: backgroundRecording.adapter,
    recordingStore: recordingStore.adapter,
    altitudeSensor: altitudeSensor.adapter,
    wakeLock: wakeLock.adapter,
    scheduler: scheduler.adapter,
    clock: clock.adapter,
    accumulatorFactory: accumulatorFactory.factory,
  };
  const runtime = createRideRecordingRuntime({
    settings: initialSettings,
    adapters,
    initialAppState: 'active',
  });

  return {
    runtime,
    log,
    foregroundLocation,
    backgroundRecording,
    recordingStore,
    altitudeSensor,
    wakeLock,
    scheduler,
    clock,
    accumulatorFactory,
  };
}

describe('Ride Recording Runtime', () => {
  it('publishes the existing location permission error when foreground permission is denied', async () => {
    const harness = createRuntimeHarness();
    const snapshots: RideRecordingRuntimeSnapshot[] = [];
    harness.foregroundLocation.setPermissionStatus('denied');
    const unsubscribe = harness.runtime.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    await harness.runtime.startRide();

    expect(harness.runtime.getSnapshot()).toMatchObject({
      status: 'idle',
      error: LOCATION_PERMISSION_ERROR,
    });
    expect(snapshots.at(-1)).toMatchObject({
      status: 'idle',
      error: LOCATION_PERMISSION_ERROR,
    });
    expect(harness.recordingStore.createdRides).toEqual([]);
    expect(harness.backgroundRecording.startCalls).toEqual([]);
    expect(harness.scheduler.intervals).toEqual([]);

    unsubscribe();
  });

  it('starts a ride with storage, accumulator, sensors, background recording, foreground watching, and keep-awake', async () => {
    const harness = createRuntimeHarness();

    await harness.runtime.startRide();

    expect(harness.log).toEqual([
      'store.initialize',
      'store.createRideId',
      'store.create:ride-1',
      'store.active:ride-1',
      'altitude.start',
      'background.start:standard',
      'foreground.start:standard',
      'wake.activate',
    ]);
    expect(harness.recordingStore.createdRides).toEqual([
      { rideId: 'ride-1', unitSystem: 'imperial' },
    ]);
    expect(harness.recordingStore.activeRideIds).toEqual(['ride-1']);
    expect(harness.accumulatorFactory.accumulators).toHaveLength(1);
    expect(
      harness.accumulatorFactory.accumulators[0].getMetrics(),
    ).toMatchObject({
      startedAt: BASE_TIME,
      lapStartedAt: BASE_TIME,
    });
    expect(harness.scheduler.intervals.map((task) => task.delayMs)).toEqual([
      1000,
    ]);
    expect(harness.altitudeSensor.startCalls).toHaveLength(1);
    expect(harness.backgroundRecording.startCalls).toHaveLength(1);
    expect(harness.foregroundLocation.currentWatch?.settings.gpsAccuracy).toBe(
      'standard',
    );
    expect(harness.wakeLock.activateCalls).toBe(1);
    expect(harness.runtime.getSnapshot()).toMatchObject({
      status: 'recording',
      error: null,
      metrics: {
        startedAt: BASE_TIME,
      },
      isAutoPaused: false,
      currentCoordinate: null,
    });
  });

  it('warns with the existing background permission string when background permission is unavailable at ride start', async () => {
    const harness = createRuntimeHarness();
    harness.backgroundRecording.setPermissionStatus('denied');
    harness.backgroundRecording.setRequestPermissionStatus('denied');

    await harness.runtime.startRide();

    expect(harness.runtime.getSnapshot()).toMatchObject({
      status: 'recording',
      error: BACKGROUND_LOCATION_START_WARNING,
    });
    expect(harness.backgroundRecording.startCalls).toEqual([]);
  });

  it('updates the active accumulator and future adapter starts without restarting the current foreground watch', async () => {
    const harness = createRuntimeHarness();
    await harness.runtime.startRide();
    const nextSettings = settings({ gpsAccuracy: 'best' });

    harness.runtime.updateSettings(nextSettings);
    harness.backgroundRecording.setIsStarted(false);
    await harness.runtime.handleAppStateChange('background');

    expect(
      harness.accumulatorFactory.accumulators[0].updateSettingsCalls,
    ).toEqual([nextSettings]);
    expect(harness.foregroundLocation.watches).toHaveLength(1);
    expect(harness.backgroundRecording.startCalls.at(-1)).toBe(nextSettings);
  });

  it('ingests foreground points, applies altitude override, publishes the accumulator snapshot, and persists accepted points', async () => {
    const harness = createRuntimeHarness();
    await harness.runtime.startRide();
    harness.altitudeSensor.setAltitudeOverride(42);
    const gpsPoint = point(5, {
      latitude: 39,
      longitude: -78,
      altitude: 12,
      speedMps: 4,
    });

    await harness.foregroundLocation.currentWatch?.emit(gpsPoint);

    const persistedPoint = {
      ...gpsPoint,
      altitude: 42,
    };
    expect(harness.accumulatorFactory.accumulators[0].ingestPointCalls).toEqual(
      [persistedPoint],
    );
    expect(harness.recordingStore.insertedPoints).toEqual([
      {
        rideId: 'ride-1',
        point: persistedPoint,
        source: 'foreground-gps',
      },
    ]);
    expect(harness.runtime.getSnapshot()).toMatchObject({
      routePoints: [persistedPoint],
      currentCoordinate: { latitude: 39, longitude: -78 },
      metrics: {
        currentSpeedMps: 4,
        distanceMeters: 0,
      },
    });
  });

  it('hands recording from active to background by starting background recording and stopping the foreground watch', async () => {
    const harness = createRuntimeHarness();
    await harness.runtime.startRide();
    const firstWatch = harness.foregroundLocation.currentWatch;
    harness.backgroundRecording.setIsStarted(false);

    await harness.runtime.handleAppStateChange('background');

    expect(harness.backgroundRecording.startCalls).toHaveLength(2);
    expect(firstWatch?.isRemoved).toBe(true);
    expect(harness.runtime.getSnapshot()).toMatchObject({
      status: 'recording',
      error: null,
    });
  });

  it('keeps the foreground watch running and publishes the existing unavailable warning when background handoff cannot start', async () => {
    const harness = createRuntimeHarness();
    await harness.runtime.startRide();
    const firstWatch = harness.foregroundLocation.currentWatch;
    harness.backgroundRecording.setIsStarted(false);
    harness.backgroundRecording.setStartResult(false);

    await harness.runtime.handleAppStateChange('background');

    expect(firstWatch?.isRemoved).toBe(false);
    expect(harness.runtime.getSnapshot()).toMatchObject({
      status: 'recording',
      error: BACKGROUND_LOCATION_UNAVAILABLE_ERROR,
    });
  });

  it('syncs persisted points around background-to-active handoff, restarts foreground watching, and schedules delayed resume sync', async () => {
    const harness = createRuntimeHarness();
    const backgroundPoint = point(30, { latitude: 40, longitude: -79 });
    harness.recordingStore.setLoadRidePointResults([backgroundPoint]);
    await harness.runtime.startRide();
    await harness.runtime.handleAppStateChange('background');

    await harness.runtime.handleAppStateChange('active');

    expect(harness.recordingStore.loadRidePointCalls).toEqual([
      'ride-1',
      'ride-1',
    ]);
    expect(
      harness.accumulatorFactory.accumulators[0]
        .replacePointsFromPersistenceCalls,
    ).toEqual([[backgroundPoint]]);
    expect(harness.foregroundLocation.watches).toHaveLength(2);
    expect(harness.scheduler.timeouts.map((task) => task.delayMs)).toEqual([
      1500,
    ]);
    expect(harness.runtime.getSnapshot()).toMatchObject({
      routePoints: [backgroundPoint],
      currentCoordinate: { latitude: 40, longitude: -79 },
    });

    await harness.scheduler.timeouts[0].fire();

    expect(harness.recordingStore.loadRidePointCalls).toEqual([
      'ride-1',
      'ride-1',
      'ride-1',
    ]);
  });

  it('uses paused app-state handoff only to stop and restart the foreground watch', async () => {
    const harness = createRuntimeHarness();
    await harness.runtime.startRide();
    await harness.runtime.pauseRide();
    const backgroundStartCallsAfterPause =
      harness.backgroundRecording.startCalls.length;
    const firstWatch = harness.foregroundLocation.currentWatch;

    await harness.runtime.handleAppStateChange('background');

    expect(firstWatch?.isRemoved).toBe(true);
    expect(harness.backgroundRecording.startCalls).toHaveLength(
      backgroundStartCallsAfterPause,
    );

    await harness.runtime.handleAppStateChange('active');

    expect(harness.foregroundLocation.watches).toHaveLength(2);
    expect(harness.backgroundRecording.startCalls).toHaveLength(
      backgroundStartCallsAfterPause,
    );
  });

  it('pauses and resumes while preserving the runtime ride id for the active ride store', async () => {
    const harness = createRuntimeHarness();
    await harness.runtime.startRide();
    const firstTimer = harness.scheduler.intervals[0];

    await harness.runtime.pauseRide();

    expect(harness.runtime.getSnapshot().status).toBe('paused');
    expect(harness.recordingStore.activeRideIds).toEqual(['ride-1', null]);
    expect(harness.backgroundRecording.stopCalls).toBe(1);
    expect(harness.altitudeSensor.stopCalls).toBe(1);
    expect(firstTimer.isCanceled).toBe(true);

    await harness.runtime.resumeRide();

    expect(harness.runtime.getSnapshot().status).toBe('recording');
    expect(harness.recordingStore.activeRideIds).toEqual([
      'ride-1',
      null,
      'ride-1',
    ]);
    expect(harness.scheduler.intervals.at(-1)?.isCanceled).toBe(false);
    expect(harness.altitudeSensor.startCalls).toHaveLength(2);
    expect(harness.backgroundRecording.startCalls).toHaveLength(2);
  });

  it('stops by freezing the accumulator, syncing persisted points around background stop, finishing storage, clearing active ride id, and returning the finished ride', async () => {
    const harness = createRuntimeHarness();
    const backgroundPoint = point(45, { latitude: 41, longitude: -80 });
    const finishedRide = createFinishedRideSummary([backgroundPoint]);
    harness.recordingStore.setLoadRidePointResults([backgroundPoint]);
    harness.recordingStore.setFinishedRideSummary(finishedRide);
    await harness.runtime.startRide();

    const result = await harness.runtime.stopRide();

    expect(result).toBe(finishedRide);
    expect(harness.accumulatorFactory.accumulators[0].finishCalls).toEqual([
      BASE_TIME,
      BASE_TIME,
    ]);
    expect(harness.log).toContain('store.load:ride-1');
    expect(harness.log.indexOf('store.load:ride-1')).toBeLessThan(
      harness.log.indexOf('background.stop'),
    );
    expect(harness.log.lastIndexOf('store.load:ride-1')).toBeGreaterThan(
      harness.log.indexOf('background.stop'),
    );
    expect(harness.recordingStore.finishRideCalls).toHaveLength(1);
    expect(
      harness.recordingStore.finishRideCalls[0].snapshot.routePoints,
    ).toEqual([backgroundPoint]);
    expect(harness.recordingStore.activeRideIds.at(-1)).toBeNull();
    expect(harness.runtime.getSnapshot()).toMatchObject({
      status: 'stopped',
      currentCoordinate: null,
      isAutoPaused: false,
      metrics: {
        elapsedSeconds: 60,
        movingSeconds: 55,
        distanceMeters: 123,
        ascentMeters: 4,
        activeCaloriesKcal: 12,
        averageSpeedMps: 2.2,
        maxSpeedMps: 5,
      },
    });
  });

  it('disposes timers, watches, sensors, background recording, and wake lock', async () => {
    const harness = createRuntimeHarness();
    harness.recordingStore.setLoadRidePointResults([]);
    await harness.runtime.startRide();
    await harness.runtime.handleAppStateChange('active');

    await harness.runtime.dispose();

    expect(harness.scheduler.intervals.every((task) => task.isCanceled)).toBe(
      true,
    );
    expect(harness.scheduler.timeouts.every((task) => task.isCanceled)).toBe(
      true,
    );
    expect(
      harness.foregroundLocation.watches.every((watch) => watch.isRemoved),
    ).toBe(true);
    expect(harness.altitudeSensor.stopCalls).toBe(1);
    expect(harness.backgroundRecording.stopCalls).toBe(1);
    expect(harness.wakeLock.deactivateCalls).toBe(1);
  });
});
