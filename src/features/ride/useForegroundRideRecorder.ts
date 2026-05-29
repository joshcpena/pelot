import { useCallback, useEffect, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { Barometer } from 'expo-sensors';
import { AppState, type AppStateStatus } from 'react-native';

import { initializeDatabase } from '../../lib/database';
import {
  isBackgroundRideRecordingStarted,
  startBackgroundRideRecording,
  stopBackgroundRideRecording,
} from './backgroundLocation';
import {
  createRide,
  createRideId,
  finishRide,
  insertRidePoint,
  loadRidePoints,
  setActiveRideId,
  type FinishedRideSummary,
} from './rideStorage';
import {
  createRideRecordingAccumulator,
  initialRideRecordingMetrics,
  type RideRecordingAccumulator,
} from './rideRecordingAccumulator';
import { areRidePointListsEqual, mergeRidePoints } from './ridePoints';
import type {
  RideMetrics,
  RidePoint,
  RideSettings,
  RideStatus,
  RouteCoordinate,
} from './types';

const KEEP_AWAKE_TAG = 'pelot-active-ride';
const STANDARD_GPS_DISTANCE_INTERVAL_METERS = 10;
const BEST_GPS_DISTANCE_INTERVAL_METERS = 5;
const STANDARD_GPS_TIME_INTERVAL_MS = 5000;
const BEST_GPS_TIME_INTERVAL_MS = 1000;
const LOCATION_WATCH_RECOVERY_INTERVAL_MS = 5000;
const LOCATION_WATCH_STALE_MS = 30000;
const BAROMETER_UPDATE_INTERVAL_MS = 5000;
const RESUME_POINT_SYNC_DELAY_MS = 1500;
const BACKGROUND_LOCATION_UNAVAILABLE_ERROR =
  'Background location is not enabled, so the ride may not keep recording while Pelot is not open.';
const BACKGROUND_LOCATION_START_WARNING =
  'Ride started, but background location is not enabled yet.';

function pressureToRelativeAltitudeMeters(
  pressure: number,
  baselinePressure: number,
) {
  return 44330 * (1 - (pressure / baselinePressure) ** (1 / 5.255));
}

function toRidePoint(
  location: Location.LocationObject,
  altitudeOverride: number | null,
): RidePoint {
  return {
    recordedAt: location.timestamp,
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    altitude: altitudeOverride ?? location.coords.altitude,
    speedMps: location.coords.speed,
    heading: location.coords.heading,
    horizontalAccuracy: location.coords.accuracy,
    verticalAccuracy: location.coords.altitudeAccuracy,
  };
}

function toRouteCoordinate(location: Location.LocationObject): RouteCoordinate {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

function toRouteCoordinateFromPoint(point: RidePoint): RouteCoordinate {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function getLocationAccuracy(settings: RideSettings) {
  return settings.gpsAccuracy === 'best'
    ? Location.Accuracy.BestForNavigation
    : Location.Accuracy.High;
}

function getLocationDistanceInterval(settings: RideSettings) {
  return settings.gpsAccuracy === 'best'
    ? BEST_GPS_DISTANCE_INTERVAL_METERS
    : STANDARD_GPS_DISTANCE_INTERVAL_METERS;
}

function getLocationTimeInterval(settings: RideSettings) {
  return settings.gpsAccuracy === 'best'
    ? BEST_GPS_TIME_INTERVAL_MS
    : STANDARD_GPS_TIME_INTERVAL_MS;
}

function isBackgroundLocationWarning(error: string | null) {
  return (
    error === BACKGROUND_LOCATION_UNAVAILABLE_ERROR ||
    error === BACKGROUND_LOCATION_START_WARNING
  );
}

async function getBackgroundLocationPermission() {
  return Location.getBackgroundPermissionsAsync();
}

async function requestBackgroundLocationPermission() {
  const requestedPermission =
    await Location.requestBackgroundPermissionsAsync();

  if (requestedPermission.status === Location.PermissionStatus.GRANTED) {
    return requestedPermission;
  }

  return getBackgroundLocationPermission();
}

export function useForegroundRideRecorder(settings: RideSettings) {
  const [status, setStatus] = useState<RideStatus>('idle');
  const [metrics, setMetrics] = useState<RideMetrics>(
    initialRideRecordingMetrics,
  );
  const [routePoints, setRoutePoints] = useState<RidePoint[]>([]);
  const [currentCoordinate, setCurrentCoordinate] =
    useState<RouteCoordinate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAutoPaused, setIsAutoPaused] = useState(false);

  const settingsRef = useRef(settings);
  const statusRef = useRef<RideStatus>('idle');
  const handleAppStateChangeRef = useRef<
    ((nextState: AppStateStatus) => Promise<void>) | null
  >(null);
  const metricsRef = useRef<RideMetrics>(initialRideRecordingMetrics);
  const accumulatorRef = useRef<RideRecordingAccumulator | null>(null);
  const routePointsRef = useRef<RidePoint[]>([]);
  const isAutoPausedRef = useRef(false);
  const rideIdRef = useRef<string | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const isEnsuringLocationWatchRef = useRef(false);
  const isBackgroundRecordingRef = useRef(false);
  const barometerWatchRef = useRef<{ remove: () => void } | null>(null);
  const baselinePressureRef = useRef<number | null>(null);
  const barometerAltitudeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumePointSyncTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const locationWatchStartedAtRef = useRef<number | null>(null);
  const lastLocationUpdateAtRef = useRef<number | null>(null);
  const lastLocationWatchRecoveryAtRef = useRef(0);
  const shouldSyncBeforeNextLocationRef = useRef(false);
  const appStateTransitionIdRef = useRef(0);
  const isRideTransitioningRef = useRef(false);

  useEffect(() => {
    settingsRef.current = settings;
    accumulatorRef.current?.updateSettings(settings);
  }, [settings]);

  function setRideStatus(nextStatus: RideStatus) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  function beginRideTransition() {
    if (isRideTransitioningRef.current) {
      return false;
    }

    isRideTransitioningRef.current = true;
    return true;
  }

  function endRideTransition() {
    isRideTransitioningRef.current = false;
  }

  const syncKeepAwake = useCallback(
    async (appState: AppStateStatus = AppState.currentState) => {
      const shouldKeepScreenAwake =
        settingsRef.current.keepAwakeDuringRide &&
        appState === 'active' &&
        (statusRef.current === 'recording' || statusRef.current === 'paused');

      if (!shouldKeepScreenAwake) {
        await deactivateKeepAwake(KEEP_AWAKE_TAG);
        return;
      }

      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    },
    [],
  );

  function updateMetrics(nextMetrics: RideMetrics) {
    metricsRef.current = nextMetrics;
    setMetrics(nextMetrics);
  }

  function updateRoutePoints(nextRoutePoints: RidePoint[]) {
    routePointsRef.current = nextRoutePoints;
    setRoutePoints(nextRoutePoints);

    return nextRoutePoints;
  }

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

  function markLap() {
    getAccumulator()?.markLap(Date.now());
    publishAccumulatorState();
  }

  async function stopWatchingLocation() {
    watchRef.current?.remove();
    watchRef.current = null;
    locationWatchStartedAtRef.current = null;
    lastLocationUpdateAtRef.current = null;
  }

  async function startWatchingBarometer() {
    barometerWatchRef.current?.remove();
    barometerWatchRef.current = null;
    baselinePressureRef.current = null;
    barometerAltitudeRef.current = null;

    if (settingsRef.current.ascentSource !== 'barometer-preferred') {
      return;
    }

    const isAvailable = await Barometer.isAvailableAsync();

    if (!isAvailable) {
      return;
    }

    Barometer.setUpdateInterval(BAROMETER_UPDATE_INTERVAL_MS);
    barometerWatchRef.current = Barometer.addListener(({ pressure }) => {
      if (!baselinePressureRef.current) {
        baselinePressureRef.current = pressure;
      }

      barometerAltitudeRef.current = pressureToRelativeAltitudeMeters(
        pressure,
        baselinePressureRef.current,
      );
    });
  }

  function stopWatchingBarometer() {
    barometerWatchRef.current?.remove();
    barometerWatchRef.current = null;
    baselinePressureRef.current = null;
    barometerAltitudeRef.current = null;
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startTimer() {
    stopTimer();
    timerRef.current = setInterval(() => {
      if (statusRef.current !== 'recording') {
        return;
      }

      const accumulator = getAccumulator();

      if (accumulator) {
        accumulator.refreshTiming(Date.now());
        publishAccumulatorState();
      }

      ensureForegroundLocationWatch();
    }, 1000);
  }

  async function startWatchingLocation() {
    await stopWatchingLocation();

    const currentSettings = settingsRef.current;

    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: getLocationAccuracy(currentSettings),
        distanceInterval: getLocationDistanceInterval(currentSettings),
        timeInterval: getLocationTimeInterval(currentSettings),
      },
      async (location) => {
        lastLocationUpdateAtRef.current = Date.now();
        const coordinate = toRouteCoordinate(location);

        if (statusRef.current !== 'recording' || rideIdRef.current == null) {
          setCurrentCoordinate(coordinate);
          return;
        }

        if (shouldSyncBeforeNextLocationRef.current) {
          shouldSyncBeforeNextLocationRef.current = false;
          await syncPersistedRidePoints();
        }

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
      },
    );
    locationWatchStartedAtRef.current = Date.now();
    lastLocationUpdateAtRef.current = Date.now();
  }

  function ensureForegroundLocationWatch() {
    if (
      statusRef.current !== 'recording' ||
      AppState.currentState !== 'active' ||
      isEnsuringLocationWatchRef.current
    ) {
      return;
    }

    const now = Date.now();
    const lastLocationActivity =
      lastLocationUpdateAtRef.current ?? locationWatchStartedAtRef.current;
    const isWatchMissing = watchRef.current == null;
    const isWatchStale =
      lastLocationActivity != null &&
      now - lastLocationActivity > LOCATION_WATCH_STALE_MS;

    if (!isWatchMissing && !isWatchStale) {
      return;
    }

    if (
      now - lastLocationWatchRecoveryAtRef.current <
      LOCATION_WATCH_RECOVERY_INTERVAL_MS
    ) {
      return;
    }

    lastLocationWatchRecoveryAtRef.current = now;
    isEnsuringLocationWatchRef.current = true;

    startWatchingLocation()
      .catch(() => {
        setError(
          'Current location is unavailable. Make sure that location services are enabled.',
        );
      })
      .finally(() => {
        isEnsuringLocationWatchRef.current = false;
      });
  }

  async function startBackgroundRecordingIfNeeded() {
    try {
      if (isBackgroundRecordingRef.current) {
        const isStarted = await isBackgroundRideRecordingStarted();

        if (isStarted) {
          return true;
        }

        isBackgroundRecordingRef.current = false;
      }

      const backgroundStarted = await startBackgroundRideRecording(
        settingsRef.current,
      );
      isBackgroundRecordingRef.current = backgroundStarted;

      if (backgroundStarted) {
        setError((currentError) =>
          isBackgroundLocationWarning(currentError) ? null : currentError,
        );
      }

      return backgroundStarted;
    } catch {
      isBackgroundRecordingRef.current = false;
      return false;
    }
  }

  async function stopBackgroundRecordingIfNeeded() {
    if (!isBackgroundRecordingRef.current) {
      return;
    }

    await stopBackgroundRideRecording();
    isBackgroundRecordingRef.current = false;
  }

  async function syncPersistedRidePoints() {
    if (!rideIdRef.current) {
      return;
    }

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
  }

  function clearResumePointSync() {
    if (!resumePointSyncTimeoutRef.current) {
      return;
    }

    clearTimeout(resumePointSyncTimeoutRef.current);
    resumePointSyncTimeoutRef.current = null;
  }

  function scheduleResumePointSync() {
    clearResumePointSync();
    resumePointSyncTimeoutRef.current = setTimeout(() => {
      resumePointSyncTimeoutRef.current = null;

      if (statusRef.current !== 'recording') {
        return;
      }

      syncPersistedRidePoints().catch(() => undefined);
    }, RESUME_POINT_SYNC_DELAY_MS);
  }

  async function handleAppStateChange(nextState: AppStateStatus) {
    await syncKeepAwake(nextState);

    const currentStatus = statusRef.current;

    if (currentStatus !== 'recording' && currentStatus !== 'paused') {
      return;
    }

    const transitionId = appStateTransitionIdRef.current + 1;
    appStateTransitionIdRef.current = transitionId;
    const isCurrentTransition = (status: RideStatus) =>
      appStateTransitionIdRef.current === transitionId &&
      statusRef.current === status;

    if (currentStatus === 'paused') {
      clearResumePointSync();
      shouldSyncBeforeNextLocationRef.current = false;

      if (nextState === 'active') {
        if (watchRef.current == null) {
          await startWatchingLocation();
        }

        return;
      }

      await stopWatchingLocation();
      return;
    }

    if (nextState === 'active') {
      shouldSyncBeforeNextLocationRef.current = true;
      const backgroundPermission = await getBackgroundLocationPermission();

      if (backgroundPermission.status === Location.PermissionStatus.GRANTED) {
        setError((currentError) =>
          isBackgroundLocationWarning(currentError) ? null : currentError,
        );
      }

      // Pull in background samples before and after the handoff so foreground
      // resumes from the latest persisted point while the Android background
      // service stays registered for the next background transition.
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
    shouldSyncBeforeNextLocationRef.current = false;
    const backgroundStarted = await startBackgroundRecordingIfNeeded();

    if (!isCurrentTransition('recording')) {
      return;
    }

    if (!backgroundStarted) {
      setError(BACKGROUND_LOCATION_UNAVAILABLE_ERROR);
      return;
    }

    await stopWatchingLocation();
  }

  useEffect(() => {
    handleAppStateChangeRef.current = handleAppStateChange;
  });

  useEffect(() => {
    syncKeepAwake().catch(() => undefined);
  }, [settings.keepAwakeDuringRide, status, syncKeepAwake]);

  async function startRide() {
    if (
      (statusRef.current !== 'idle' && statusRef.current !== 'stopped') ||
      !beginRideTransition()
    ) {
      return;
    }

    try {
      setError(null);
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setError('Location permission is required to record a ride.');
        return;
      }

      const backgroundPermission = await requestBackgroundLocationPermission();

      await initializeDatabase();
      const rideId = createRideId();
      await createRide(rideId, settings.unitSystem);
      await setActiveRideId(rideId);
      const startedAt = Date.now();

      rideIdRef.current = rideId;
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
      setRideStatus('recording');
      startTimer();
      await startWatchingBarometer();

      if (backgroundPermission.status !== Location.PermissionStatus.GRANTED) {
        setError(BACKGROUND_LOCATION_START_WARNING);
      } else {
        const backgroundStarted = await startBackgroundRecordingIfNeeded();

        if (!backgroundStarted) {
          setError(BACKGROUND_LOCATION_UNAVAILABLE_ERROR);
        }
      }

      await startWatchingLocation();
      await syncKeepAwake();
    } finally {
      endRideTransition();
    }
  }

  async function pauseRide() {
    if (statusRef.current !== 'recording' || !beginRideTransition()) {
      return;
    }

    try {
      const pausedStartedAt = Date.now();
      getAccumulator()?.setAutoPaused(false, pausedStartedAt);
      getAccumulator()?.beginManualPause(pausedStartedAt);
      publishAccumulatorState();
      setRideStatus('paused');
      stopTimer();
      stopWatchingBarometer();
      await setActiveRideId(null);
      await stopBackgroundRecordingIfNeeded();
      await syncPersistedRidePoints();
      clearResumePointSync();
      shouldSyncBeforeNextLocationRef.current = false;

      if (AppState.currentState === 'active' && watchRef.current == null) {
        await startWatchingLocation();
      }

      await syncKeepAwake();
    } finally {
      endRideTransition();
    }
  }

  async function resumeRide() {
    if (statusRef.current !== 'paused' || !beginRideTransition()) {
      return;
    }

    try {
      if (rideIdRef.current) {
        await setActiveRideId(rideIdRef.current);
      }

      getAccumulator()?.endManualPause(Date.now());
      publishAccumulatorState();
      setRideStatus('recording');
      startTimer();
      await startWatchingBarometer();
      const backgroundPermission = await getBackgroundLocationPermission();

      if (backgroundPermission.status === Location.PermissionStatus.GRANTED) {
        const backgroundStarted = await startBackgroundRecordingIfNeeded();

        if (!backgroundStarted) {
          setError(BACKGROUND_LOCATION_UNAVAILABLE_ERROR);
        }
      } else {
        setError(BACKGROUND_LOCATION_START_WARNING);
      }

      if (watchRef.current == null) {
        await startWatchingLocation();
      }

      await syncKeepAwake();
    } finally {
      endRideTransition();
    }
  }

  async function stopRide(): Promise<FinishedRideSummary | null> {
    if (
      statusRef.current === 'idle' ||
      statusRef.current === 'stopped' ||
      !beginRideTransition()
    ) {
      return null;
    }

    try {
      const stoppedAt = Date.now();
      const finishSnapshot = getAccumulator()?.finish(stoppedAt);

      if (finishSnapshot) {
        updateMetrics(finishSnapshot.metrics);
      }

      setRideStatus('stopped');
      stopTimer();
      await stopWatchingLocation();
      stopWatchingBarometer();
      await syncPersistedRidePoints();
      await stopBackgroundRecordingIfNeeded();
      await syncPersistedRidePoints();
      clearResumePointSync();
      shouldSyncBeforeNextLocationRef.current = false;
      await deactivateKeepAwake(KEEP_AWAKE_TAG);
      const finalSnapshot = getAccumulator()?.finish(stoppedAt);

      if (finalSnapshot) {
        updateMetrics(finalSnapshot.metrics);
      }

      let finishedRide: FinishedRideSummary | null = null;

      if (rideIdRef.current) {
        finishedRide = finalSnapshot
          ? await finishRide(rideIdRef.current, finalSnapshot, settings)
          : null;

        if (finishedRide && finalSnapshot) {
          updateMetrics({
            ...finalSnapshot.metrics,
            elapsedSeconds: finishedRide.summary.elapsedSeconds,
            movingSeconds: finishedRide.summary.movingSeconds,
            distanceMeters: finishedRide.summary.distanceMeters,
            ascentMeters: finishedRide.summary.ascentMeters,
            activeCaloriesKcal: finishedRide.summary.activeCaloriesKcal,
            averageSpeedMps: finishedRide.summary.averageSpeedMps,
            maxSpeedMps: finishedRide.summary.maxSpeedMps,
          });
        }
        await setActiveRideId(null);
      }

      accumulatorRef.current = null;
      isAutoPausedRef.current = false;
      setIsAutoPaused(false);
      rideIdRef.current = null;
      setCurrentCoordinate(null);
      return finishedRide;
    } finally {
      endRideTransition();
    }
  }

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      handleAppStateChangeRef.current?.(nextState).catch(() => undefined);
    });

    return () => {
      subscription.remove();
      stopTimer();
      clearResumePointSync();
      watchRef.current?.remove();
      barometerWatchRef.current?.remove();
      stopBackgroundRideRecording().catch(() => {});
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  return {
    status,
    metrics,
    routePoints,
    currentCoordinate,
    error,
    isAutoPaused,
    startRide,
    pauseRide,
    resumeRide,
    stopRide,
    markLap,
  };
}
