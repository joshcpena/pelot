import {
  initialRideRecordingMetrics,
  type RideRecordingAccumulator,
  type RideRecordingFinishSnapshot,
} from './rideRecordingAccumulator';
import { areRidePointListsEqual, mergeRidePoints } from './ridePoints';
import type { FinishedRideSummary } from './rideStorage';
import type {
  RideMetrics,
  RidePoint,
  RideSettings,
  RideStatus,
  RouteCoordinate,
} from './types';

export const LOCATION_PERMISSION_ERROR =
  'Location permission is required to record a ride.';
export const CURRENT_LOCATION_UNAVAILABLE_ERROR =
  'Current location is unavailable. Make sure that location services are enabled.';
export const BACKGROUND_LOCATION_UNAVAILABLE_ERROR =
  'Background location is not enabled, so the ride may not keep recording while Pelot is not open.';
export const BACKGROUND_LOCATION_START_WARNING =
  'Ride started, but background location is not enabled yet.';

const RIDE_RECORDING_TIMER_INTERVAL_MS = 1000;
const LOCATION_WATCH_RECOVERY_INTERVAL_MS = 5000;
const LOCATION_WATCH_STALE_MS = 30000;
const RESUME_POINT_SYNC_DELAY_MS = 1500;

export type RideRecordingRuntimeSnapshot = {
  status: RideStatus;
  metrics: RideMetrics;
  routePoints: RidePoint[];
  currentCoordinate: RouteCoordinate | null;
  error: string | null;
  isAutoPaused: boolean;
};

export const initialRideRecordingRuntimeSnapshot: RideRecordingRuntimeSnapshot =
  {
    status: 'idle',
    metrics: { ...initialRideRecordingMetrics },
    routePoints: [],
    currentCoordinate: null,
    error: null,
    isAutoPaused: false,
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

export type RideRecordingPermission = {
  status: string;
};

export type RideRecordingLocationWatch = {
  remove(): void | Promise<void>;
};

export type RideRecordingForegroundLocationAdapter = {
  requestPermission(): Promise<RideRecordingPermission>;
  startWatching(params: {
    settings: RideSettings;
    onPoint: (point: RidePoint) => void | Promise<void>;
  }): Promise<RideRecordingLocationWatch>;
};

export type RideRecordingBackgroundRecordingAdapter = {
  getPermission(): Promise<RideRecordingPermission>;
  requestPermission(): Promise<RideRecordingPermission>;
  isStarted(): Promise<boolean>;
  start(settings: RideSettings): Promise<boolean>;
  stop(): Promise<void>;
};

export type RideRecordingPointSource = 'foreground-gps' | 'background-gps';

export type RideRecordingStoreAdapter = {
  initialize(): Promise<void>;
  createRideId(): string;
  createRide(rideId: string, settings: RideSettings): Promise<void>;
  setActiveRideId(rideId: string | null): Promise<void>;
  insertRidePoint(
    rideId: string,
    point: RidePoint,
    source?: RideRecordingPointSource,
  ): Promise<void>;
  loadRidePoints(rideId: string): Promise<RidePoint[]>;
  finishRide(
    rideId: string,
    snapshot: RideRecordingFinishSnapshot,
    settings: RideSettings,
  ): Promise<FinishedRideSummary | null>;
};

export type RideRecordingAltitudeSensorAdapter = {
  start(settings: RideSettings): Promise<void>;
  stop(): void | Promise<void>;
  getAltitudeOverride(): number | null;
};

export type RideRecordingWakeLockAdapter = {
  activate(): Promise<void>;
  deactivate(): Promise<void>;
};

export type RideRecordingScheduledTask = {
  cancel(): void;
};

export type RideRecordingSchedulerAdapter = {
  setInterval(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): RideRecordingScheduledTask;
  setTimeout(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): RideRecordingScheduledTask;
};

export type RideRecordingClockAdapter = {
  now(): number;
};

export type RideRecordingAccumulatorFactory = (params: {
  settings: RideSettings;
  startedAt: number;
}) => RideRecordingAccumulator;

export type RideRecordingRuntimeAdapters = {
  foregroundLocation: RideRecordingForegroundLocationAdapter;
  backgroundRecording: RideRecordingBackgroundRecordingAdapter;
  recordingStore: RideRecordingStoreAdapter;
  altitudeSensor: RideRecordingAltitudeSensorAdapter;
  wakeLock: RideRecordingWakeLockAdapter;
  scheduler: RideRecordingSchedulerAdapter;
  clock: RideRecordingClockAdapter;
  accumulatorFactory: RideRecordingAccumulatorFactory;
};

export type RideRecordingRuntimeMessages = {
  locationUnavailable: string;
  locationPermissionRequired: string;
  backgroundLocationUnavailable: string;
  backgroundLocationStartWarning: string;
};

export type CreateRideRecordingRuntimeOptions = {
  settings: RideSettings;
  adapters: RideRecordingRuntimeAdapters;
  initialAppState?: string;
  locationWatchRecoveryIntervalMs?: number;
  locationWatchStaleMs?: number;
  resumePointSyncDelayMs?: number;
  messages?: Partial<RideRecordingRuntimeMessages>;
};

const defaultMessages: RideRecordingRuntimeMessages = {
  locationUnavailable: CURRENT_LOCATION_UNAVAILABLE_ERROR,
  locationPermissionRequired: LOCATION_PERMISSION_ERROR,
  backgroundLocationUnavailable: BACKGROUND_LOCATION_UNAVAILABLE_ERROR,
  backgroundLocationStartWarning: BACKGROUND_LOCATION_START_WARNING,
};

function cloneSnapshot(
  snapshot: RideRecordingRuntimeSnapshot,
): RideRecordingRuntimeSnapshot {
  return {
    ...snapshot,
    metrics: { ...snapshot.metrics },
    routePoints: [...snapshot.routePoints],
    currentCoordinate:
      snapshot.currentCoordinate == null
        ? null
        : { ...snapshot.currentCoordinate },
  };
}

function isPermissionGranted(permission: RideRecordingPermission) {
  return permission.status === 'granted';
}

function toRouteCoordinate(point: RidePoint): RouteCoordinate {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function isBackgroundLocationWarning(
  error: string | null,
  messages: RideRecordingRuntimeMessages = defaultMessages,
) {
  return (
    error === messages.backgroundLocationUnavailable ||
    error === messages.backgroundLocationStartWarning
  );
}

export function createRideRecordingRuntime({
  settings: initialSettings,
  adapters,
  initialAppState = 'active',
  locationWatchRecoveryIntervalMs = LOCATION_WATCH_RECOVERY_INTERVAL_MS,
  locationWatchStaleMs = LOCATION_WATCH_STALE_MS,
  resumePointSyncDelayMs = RESUME_POINT_SYNC_DELAY_MS,
  messages = {},
}: CreateRideRecordingRuntimeOptions): RideRecordingRuntime {
  let settings = initialSettings;
  let appState = initialAppState;
  const runtimeMessages = { ...defaultMessages, ...messages };
  let accumulator: RideRecordingAccumulator | null = null;
  let rideId: string | null = null;
  let locationWatch: RideRecordingLocationWatch | null = null;
  let timer: RideRecordingScheduledTask | null = null;
  let resumePointSyncTimeout: RideRecordingScheduledTask | null = null;
  let isAltitudeSensorStarted = false;
  let isBackgroundRecording = false;
  let isEnsuringLocationWatch = false;
  let isRideTransitioning = false;
  let shouldSyncBeforeNextLocation = false;
  let appStateTransitionId = 0;
  let locationWatchStartedAt: number | null = null;
  let lastLocationUpdateAt: number | null = null;
  let lastLocationWatchRecoveryAt = 0;
  let snapshot: RideRecordingRuntimeSnapshot = {
    status: 'idle',
    metrics: { ...initialRideRecordingMetrics },
    routePoints: [],
    currentCoordinate: null,
    error: null,
    isAutoPaused: false,
  };
  const listeners = new Set<(snapshot: RideRecordingRuntimeSnapshot) => void>();

  function publish(nextSnapshot: RideRecordingRuntimeSnapshot) {
    snapshot = nextSnapshot;
    const publishedSnapshot = cloneSnapshot(snapshot);

    for (const listener of listeners) {
      listener(publishedSnapshot);
    }
  }

  function setSnapshot(partial: Partial<RideRecordingRuntimeSnapshot>) {
    publish({
      ...snapshot,
      ...partial,
    });
  }

  function publishAccumulatorState(
    partial: Partial<RideRecordingRuntimeSnapshot> = {},
  ) {
    if (!accumulator) {
      setSnapshot(partial);
      return;
    }

    setSnapshot({
      metrics: accumulator.getMetrics(),
      routePoints: accumulator.getRoutePoints(),
      currentCoordinate: accumulator.getCurrentCoordinate(),
      isAutoPaused: accumulator.getIsAutoPaused(),
      ...partial,
    });
  }

  function beginRideTransition() {
    if (isRideTransitioning) {
      return false;
    }

    isRideTransitioning = true;
    return true;
  }

  function endRideTransition() {
    isRideTransitioning = false;
  }

  function clearResumePointSync() {
    resumePointSyncTimeout?.cancel();
    resumePointSyncTimeout = null;
  }

  async function stopWatchingLocation() {
    if (!locationWatch) {
      return;
    }

    const watch = locationWatch;
    locationWatch = null;
    locationWatchStartedAt = null;
    lastLocationUpdateAt = null;
    await watch.remove();
  }

  async function handleForegroundPoint(rawPoint: RidePoint) {
    lastLocationUpdateAt = adapters.clock.now();
    const altitudeOverride = adapters.altitudeSensor.getAltitudeOverride();
    const point =
      altitudeOverride == null
        ? rawPoint
        : { ...rawPoint, altitude: altitudeOverride };
    const coordinate = toRouteCoordinate(point);

    if (snapshot.status !== 'recording' || rideId == null) {
      setSnapshot({ currentCoordinate: coordinate });
      return;
    }

    if (shouldSyncBeforeNextLocation) {
      shouldSyncBeforeNextLocation = false;
      await syncPersistedRidePoints();
    }

    if (!accumulator) {
      return;
    }

    const result = accumulator.ingestPoint(point, adapters.clock.now());

    if (!result.didChangeRoutePoints) {
      return;
    }

    publishAccumulatorState();

    if (result.shouldPersistPoint) {
      await adapters.recordingStore.insertRidePoint(
        rideId,
        point,
        'foreground-gps',
      );
    }
  }

  async function startWatchingLocation() {
    await stopWatchingLocation();

    locationWatch = await adapters.foregroundLocation.startWatching({
      settings,
      onPoint: handleForegroundPoint,
    });
    locationWatchStartedAt = adapters.clock.now();
    lastLocationUpdateAt = adapters.clock.now();
  }

  function ensureForegroundLocationWatch() {
    if (
      snapshot.status !== 'recording' ||
      appState !== 'active' ||
      isEnsuringLocationWatch
    ) {
      return;
    }

    const now = adapters.clock.now();
    const lastLocationActivity = lastLocationUpdateAt ?? locationWatchStartedAt;
    const isWatchMissing = locationWatch == null;
    const isWatchStale =
      lastLocationActivity != null &&
      now - lastLocationActivity > locationWatchStaleMs;

    if (!isWatchMissing && !isWatchStale) {
      return;
    }

    if (now - lastLocationWatchRecoveryAt < locationWatchRecoveryIntervalMs) {
      return;
    }

    lastLocationWatchRecoveryAt = now;
    isEnsuringLocationWatch = true;

    startWatchingLocation()
      .catch(() => {
        setSnapshot({ error: runtimeMessages.locationUnavailable });
      })
      .finally(() => {
        isEnsuringLocationWatch = false;
      });
  }

  function stopTimer() {
    timer?.cancel();
    timer = null;
  }

  function startTimer() {
    stopTimer();
    timer = adapters.scheduler.setInterval(() => {
      if (snapshot.status !== 'recording') {
        return;
      }

      accumulator?.refreshTiming(adapters.clock.now());
      publishAccumulatorState();
      ensureForegroundLocationWatch();
    }, RIDE_RECORDING_TIMER_INTERVAL_MS);
  }

  async function startWatchingBarometer() {
    if (isAltitudeSensorStarted) {
      await adapters.altitudeSensor.stop();
      isAltitudeSensorStarted = false;
    }

    if (settings.ascentSource !== 'barometer-preferred') {
      return;
    }

    await adapters.altitudeSensor.start(settings);
    isAltitudeSensorStarted = true;
  }

  async function stopWatchingBarometer() {
    if (!isAltitudeSensorStarted) {
      return;
    }

    await adapters.altitudeSensor.stop();
    isAltitudeSensorStarted = false;
  }

  async function syncKeepAwake(nextAppState = appState) {
    const shouldKeepScreenAwake =
      settings.keepAwakeDuringRide &&
      nextAppState === 'active' &&
      (snapshot.status === 'recording' || snapshot.status === 'paused');

    if (shouldKeepScreenAwake) {
      await adapters.wakeLock.activate();
      return;
    }

    await adapters.wakeLock.deactivate();
  }

  async function requestBackgroundLocationPermission() {
    const requestedPermission =
      await adapters.backgroundRecording.requestPermission();

    if (isPermissionGranted(requestedPermission)) {
      return requestedPermission;
    }

    return adapters.backgroundRecording.getPermission();
  }

  async function startBackgroundRecordingIfNeeded() {
    try {
      if (isBackgroundRecording) {
        const isStarted = await adapters.backgroundRecording.isStarted();

        if (isStarted) {
          return true;
        }

        isBackgroundRecording = false;
      }

      const backgroundStarted =
        await adapters.backgroundRecording.start(settings);
      isBackgroundRecording = backgroundStarted;

      if (
        backgroundStarted &&
        isBackgroundLocationWarning(snapshot.error, runtimeMessages)
      ) {
        setSnapshot({ error: null });
      }

      return backgroundStarted;
    } catch {
      isBackgroundRecording = false;
      return false;
    }
  }

  async function stopBackgroundRecordingIfNeeded() {
    if (!isBackgroundRecording) {
      return;
    }

    await adapters.backgroundRecording.stop();
    isBackgroundRecording = false;
  }

  async function syncPersistedRidePoints() {
    if (!rideId) {
      return;
    }

    const persistedPoints =
      await adapters.recordingStore.loadRidePoints(rideId);
    const currentPoints = accumulator
      ? accumulator.getRoutePoints()
      : snapshot.routePoints;
    const nextRoutePoints = mergeRidePoints(currentPoints, persistedPoints);

    if (areRidePointListsEqual(currentPoints, nextRoutePoints)) {
      return;
    }

    if (accumulator) {
      accumulator.replacePointsFromPersistence(
        nextRoutePoints,
        adapters.clock.now(),
      );
      publishAccumulatorState();
      return;
    }

    const latestPoint = nextRoutePoints.at(-1) ?? null;
    setSnapshot({
      routePoints: nextRoutePoints,
      currentCoordinate: latestPoint ? toRouteCoordinate(latestPoint) : null,
    });
  }

  function scheduleResumePointSync() {
    clearResumePointSync();
    resumePointSyncTimeout = adapters.scheduler.setTimeout(() => {
      resumePointSyncTimeout = null;

      if (snapshot.status !== 'recording') {
        return;
      }

      syncPersistedRidePoints().catch(() => undefined);
    }, resumePointSyncDelayMs);
  }

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    updateSettings(nextSettings) {
      settings = nextSettings;
      accumulator?.updateSettings(nextSettings);

      if (accumulator) {
        publishAccumulatorState();
      }
    },
    async startRide() {
      if (
        (snapshot.status !== 'idle' && snapshot.status !== 'stopped') ||
        !beginRideTransition()
      ) {
        return;
      }

      setSnapshot({ error: null });

      try {
        const permission =
          await adapters.foregroundLocation.requestPermission();

        if (!isPermissionGranted(permission)) {
          setSnapshot({ error: runtimeMessages.locationPermissionRequired });
          return;
        }

        const backgroundPermission =
          await requestBackgroundLocationPermission();

        await adapters.recordingStore.initialize();
        const nextRideId = adapters.recordingStore.createRideId();
        await adapters.recordingStore.createRide(nextRideId, settings);
        await adapters.recordingStore.setActiveRideId(nextRideId);

        const startedAt = adapters.clock.now();
        rideId = nextRideId;
        accumulator = adapters.accumulatorFactory({ settings, startedAt });
        shouldSyncBeforeNextLocation = false;
        clearResumePointSync();
        publishAccumulatorState({
          status: 'recording',
          currentCoordinate: null,
          isAutoPaused: false,
        });
        startTimer();
        await startWatchingBarometer();

        if (!isPermissionGranted(backgroundPermission)) {
          setSnapshot({
            error: runtimeMessages.backgroundLocationStartWarning,
          });
        } else {
          const backgroundStarted = await startBackgroundRecordingIfNeeded();

          if (!backgroundStarted) {
            setSnapshot({
              error: runtimeMessages.backgroundLocationUnavailable,
            });
          }
        }

        await startWatchingLocation();
        await syncKeepAwake();
      } finally {
        endRideTransition();
      }
    },
    async pauseRide() {
      if (snapshot.status !== 'recording' || !beginRideTransition()) {
        return;
      }

      try {
        const pausedStartedAt = adapters.clock.now();
        accumulator?.setAutoPaused(false, pausedStartedAt);
        accumulator?.beginManualPause(pausedStartedAt);
        publishAccumulatorState({ status: 'paused' });
        stopTimer();
        await stopWatchingBarometer();
        await adapters.recordingStore.setActiveRideId(null);
        await stopBackgroundRecordingIfNeeded();
        await syncPersistedRidePoints();
        clearResumePointSync();
        shouldSyncBeforeNextLocation = false;

        if (appState === 'active' && locationWatch == null) {
          await startWatchingLocation();
        }

        await syncKeepAwake();
      } finally {
        endRideTransition();
      }
    },
    async resumeRide() {
      if (snapshot.status !== 'paused' || !beginRideTransition()) {
        return;
      }

      try {
        if (rideId) {
          await adapters.recordingStore.setActiveRideId(rideId);
        }

        accumulator?.endManualPause(adapters.clock.now());
        publishAccumulatorState({ status: 'recording' });
        startTimer();
        await startWatchingBarometer();

        const backgroundPermission =
          await adapters.backgroundRecording.getPermission();

        if (isPermissionGranted(backgroundPermission)) {
          const backgroundStarted = await startBackgroundRecordingIfNeeded();

          if (!backgroundStarted) {
            setSnapshot({
              error: runtimeMessages.backgroundLocationUnavailable,
            });
          }
        } else {
          setSnapshot({
            error: runtimeMessages.backgroundLocationStartWarning,
          });
        }

        if (locationWatch == null) {
          await startWatchingLocation();
        }

        await syncKeepAwake();
      } finally {
        endRideTransition();
      }
    },
    async stopRide() {
      if (
        snapshot.status === 'idle' ||
        snapshot.status === 'stopped' ||
        !beginRideTransition()
      ) {
        return null;
      }

      try {
        const stoppedAt = adapters.clock.now();
        const finishSnapshot = accumulator?.finish(stoppedAt);

        if (finishSnapshot) {
          setSnapshot({
            status: 'stopped',
            metrics: finishSnapshot.metrics,
          });
        } else {
          setSnapshot({ status: 'stopped' });
        }

        stopTimer();
        await stopWatchingLocation();
        await stopWatchingBarometer();
        await syncPersistedRidePoints();
        await stopBackgroundRecordingIfNeeded();
        await syncPersistedRidePoints();
        clearResumePointSync();
        shouldSyncBeforeNextLocation = false;
        await adapters.wakeLock.deactivate();

        const finalSnapshot = accumulator?.finish(stoppedAt);

        if (finalSnapshot) {
          setSnapshot({ metrics: finalSnapshot.metrics });
        }

        let finishedRide: FinishedRideSummary | null = null;

        if (rideId) {
          finishedRide = finalSnapshot
            ? await adapters.recordingStore.finishRide(
                rideId,
                finalSnapshot,
                settings,
              )
            : null;

          if (finishedRide && finalSnapshot) {
            setSnapshot({
              metrics: {
                ...finalSnapshot.metrics,
                elapsedSeconds: finishedRide.summary.elapsedSeconds,
                movingSeconds: finishedRide.summary.movingSeconds,
                distanceMeters: finishedRide.summary.distanceMeters,
                ascentMeters: finishedRide.summary.ascentMeters,
                activeCaloriesKcal: finishedRide.summary.activeCaloriesKcal,
                averageSpeedMps: finishedRide.summary.averageSpeedMps,
                maxSpeedMps: finishedRide.summary.maxSpeedMps,
              },
            });
          }

          await adapters.recordingStore.setActiveRideId(null);
        }

        accumulator = null;
        rideId = null;
        setSnapshot({
          status: 'stopped',
          currentCoordinate: null,
          isAutoPaused: false,
        });

        return finishedRide;
      } finally {
        endRideTransition();
      }
    },
    markLap() {
      accumulator?.markLap(adapters.clock.now());
      publishAccumulatorState();
    },
    async handleAppStateChange(nextState) {
      appState = nextState;
      await syncKeepAwake(nextState);

      const currentStatus = snapshot.status;

      if (currentStatus !== 'recording' && currentStatus !== 'paused') {
        return;
      }

      const transitionId = appStateTransitionId + 1;
      appStateTransitionId = transitionId;
      const isCurrentTransition = (status: RideStatus) =>
        appStateTransitionId === transitionId && snapshot.status === status;

      if (currentStatus === 'paused') {
        clearResumePointSync();
        shouldSyncBeforeNextLocation = false;

        if (nextState === 'active') {
          if (locationWatch == null) {
            await startWatchingLocation();
          }

          return;
        }

        await stopWatchingLocation();
        return;
      }

      if (nextState === 'active') {
        shouldSyncBeforeNextLocation = true;
        const backgroundPermission =
          await adapters.backgroundRecording.getPermission();

        if (
          isPermissionGranted(backgroundPermission) &&
          isBackgroundLocationWarning(snapshot.error, runtimeMessages)
        ) {
          setSnapshot({ error: null });
        }

        await syncPersistedRidePoints();
        if (!isCurrentTransition('recording')) {
          return;
        }

        await startWatchingLocation();
        if (!isCurrentTransition('recording')) {
          return;
        }

        await syncPersistedRidePoints();
        scheduleResumePointSync();
        return;
      }

      clearResumePointSync();
      shouldSyncBeforeNextLocation = false;
      const backgroundStarted = await startBackgroundRecordingIfNeeded();

      if (!isCurrentTransition('recording')) {
        return;
      }

      if (!backgroundStarted) {
        setSnapshot({ error: runtimeMessages.backgroundLocationUnavailable });
        return;
      }

      await stopWatchingLocation();
    },
    async dispose() {
      stopTimer();
      clearResumePointSync();
      await stopWatchingLocation();
      await stopWatchingBarometer();
      await stopBackgroundRecordingIfNeeded();
      await adapters.wakeLock.deactivate();
      listeners.clear();
    },
  };
}
