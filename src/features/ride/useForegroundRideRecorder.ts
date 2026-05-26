import { useEffect, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { Barometer } from 'expo-sensors';
import { AppState, type AppStateStatus } from 'react-native';

import { initializeDatabase } from '../../lib/database';
import {
  startBackgroundRideRecording,
  stopBackgroundRideRecording,
} from './backgroundLocation';
import {
  distanceBetweenMeters,
  positiveElevationGainMeters,
  withEstimatedCalories,
} from './metrics';
import {
  createRide,
  createRideId,
  finishRide,
  insertRidePoint,
  calculateMetricsFromPoints,
  loadRidePoints,
  setActiveRideId,
} from './rideStorage';
import type {
  RideMetrics,
  RidePoint,
  RideSettings,
  RideStatus,
  RouteCoordinate,
} from './types';

const KEEP_AWAKE_TAG = 'pelot-active-ride';
const STOPPED_SPEED_MPS = 0.75;
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

const initialMetrics: RideMetrics = {
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

function getRidePointKey(point: RidePoint) {
  return [point.recordedAt, point.latitude, point.longitude].join(':');
}

function mergeRidePoints(
  currentPoints: RidePoint[],
  persistedPoints: RidePoint[],
) {
  const pointsByKey = new Map<string, RidePoint>();

  for (const point of [...currentPoints, ...persistedPoints]) {
    pointsByKey.set(getRidePointKey(point), point);
  }

  return [...pointsByKey.values()].sort(
    (first, second) => first.recordedAt - second.recordedAt,
  );
}

function areRidePointListsEqual(
  firstPoints: RidePoint[],
  secondPoints: RidePoint[],
) {
  return (
    firstPoints.length === secondPoints.length &&
    firstPoints.every(
      (point, index) =>
        getRidePointKey(point) === getRidePointKey(secondPoints[index]),
    )
  );
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
  const [metrics, setMetrics] = useState<RideMetrics>(initialMetrics);
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
  const metricsRef = useRef<RideMetrics>(initialMetrics);
  const routePointsRef = useRef<RidePoint[]>([]);
  const isAutoPausedRef = useRef(false);
  const rideIdRef = useRef<string | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const isEnsuringLocationWatchRef = useRef(false);
  const isBackgroundRecordingRef = useRef(false);
  const barometerWatchRef = useRef<{ remove: () => void } | null>(null);
  const baselinePressureRef = useRef<number | null>(null);
  const barometerAltitudeRef = useRef<number | null>(null);
  const previousPointRef = useRef<RidePoint | null>(null);
  const activeStartedAtRef = useRef<number | null>(null);
  const pausedStartedAtRef = useRef<number | null>(null);
  const accumulatedElapsedSecondsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumePointSyncTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const locationWatchStartedAtRef = useRef<number | null>(null);
  const lastLocationUpdateAtRef = useRef<number | null>(null);
  const lastLocationWatchRecoveryAtRef = useRef(0);
  const shouldSyncBeforeNextLocationRef = useRef(false);
  const appStateTransitionIdRef = useRef(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  function setRideStatus(nextStatus: RideStatus) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  function updateMetrics(nextMetrics: RideMetrics) {
    metricsRef.current = nextMetrics;
    setMetrics(nextMetrics);
  }

  function updateRoutePoints(nextRoutePoints: RidePoint[]) {
    routePointsRef.current = nextRoutePoints;
    setRoutePoints(nextRoutePoints);
  }

  function markLap() {
    const now = Date.now();

    updateMetrics(
      withEstimatedCalories(
        {
          ...metricsRef.current,
          lapNumber: metricsRef.current.lapNumber + 1,
          lapStartedAt: now,
          lapElapsedSeconds: 0,
          lapPausedSeconds: 0,
          lapMovingSeconds: 0,
          lapDistanceMeters: 0,
          lapAscentMeters: 0,
          lapActiveCaloriesKcal: null,
          lapAverageSpeedMps: 0,
          lapMaxSpeedMps: 0,
        },
        settingsRef.current,
      ),
    );
  }

  function accumulatePausedTime() {
    if (pausedStartedAtRef.current == null) {
      return;
    }

    const pausedSeconds = Math.floor(
      (Date.now() - pausedStartedAtRef.current) / 1000,
    );
    pausedStartedAtRef.current = null;
    updateMetrics({
      ...metricsRef.current,
      pausedSeconds: metricsRef.current.pausedSeconds + pausedSeconds,
      lapPausedSeconds: metricsRef.current.lapPausedSeconds + pausedSeconds,
    });
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
    activeStartedAtRef.current = Date.now();
    timerRef.current = setInterval(() => {
      if (activeStartedAtRef.current == null) {
        return;
      }

      const activeSeconds = Math.floor(
        (Date.now() - activeStartedAtRef.current) / 1000,
      );
      const elapsedSeconds =
        accumulatedElapsedSecondsRef.current + activeSeconds;
      const movingSeconds = isAutoPausedRef.current
        ? metricsRef.current.movingSeconds
        : elapsedSeconds - metricsRef.current.pausedSeconds;
      const lapElapsedSeconds = Math.max(
        0,
        Math.floor(
          (Date.now() - (metricsRef.current.lapStartedAt ?? Date.now())) / 1000,
        ),
      );
      const lapMovingSeconds = isAutoPausedRef.current
        ? metricsRef.current.lapMovingSeconds
        : Math.max(0, lapElapsedSeconds - metricsRef.current.lapPausedSeconds);

      updateMetrics(
        withEstimatedCalories(
          {
            ...metricsRef.current,
            elapsedSeconds,
            movingSeconds,
            lapElapsedSeconds,
            lapMovingSeconds,
          },
          settingsRef.current,
        ),
      );

      if (
        settingsRef.current.autoLap &&
        settingsRef.current.splitType === 'time' &&
        lapElapsedSeconds >= settingsRef.current.splitDurationSeconds
      ) {
        markLap();
      }

      ensureForegroundLocationWatch();
    }, 1000);
  }

  function accumulateElapsedTime() {
    if (activeStartedAtRef.current == null) {
      return;
    }

    accumulatedElapsedSecondsRef.current += Math.floor(
      (Date.now() - activeStartedAtRef.current) / 1000,
    );
    activeStartedAtRef.current = null;
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
        setCurrentCoordinate(toRouteCoordinate(location));
        const activeSettings = settingsRef.current;

        if (statusRef.current !== 'recording' || rideIdRef.current == null) {
          return;
        }

        if (shouldSyncBeforeNextLocationRef.current) {
          shouldSyncBeforeNextLocationRef.current = false;
          await syncPersistedRidePoints();
        }

        const point = toRidePoint(location, barometerAltitudeRef.current);
        const previousPoint = previousPointRef.current;
        const reportedSpeed = point.speedMps ?? 0;
        const secondsSincePrevious = previousPoint
          ? Math.max(
              0,
              Math.round((point.recordedAt - previousPoint.recordedAt) / 1000),
            )
          : 0;
        const distanceMeters = previousPoint
          ? distanceBetweenMeters(previousPoint, point)
          : 0;
        const calculatedSpeed =
          secondsSincePrevious > 0 ? distanceMeters / secondsSincePrevious : 0;
        const currentSpeedMps = Math.max(0, reportedSpeed || calculatedSpeed);
        const autoPaused =
          activeSettings.autoPause && currentSpeedMps < STOPPED_SPEED_MPS;
        const shouldCountMovement = !autoPaused && previousPoint != null;
        const movingSeconds = metricsRef.current.movingSeconds;
        const lapMovingSeconds = metricsRef.current.lapMovingSeconds;
        const nextDistanceMeters = shouldCountMovement
          ? metricsRef.current.distanceMeters + distanceMeters
          : metricsRef.current.distanceMeters;
        const ascentMeters = shouldCountMovement
          ? metricsRef.current.ascentMeters +
            positiveElevationGainMeters(previousPoint, point)
          : metricsRef.current.ascentMeters;
        const lapAscentGain = previousPoint
          ? positiveElevationGainMeters(previousPoint, point)
          : 0;
        const lapDistanceMeters = shouldCountMovement
          ? metricsRef.current.lapDistanceMeters + distanceMeters
          : metricsRef.current.lapDistanceMeters;
        const lapAscentMeters = shouldCountMovement
          ? metricsRef.current.lapAscentMeters + lapAscentGain
          : metricsRef.current.lapAscentMeters;
        const averageSpeedMps =
          movingSeconds > 0 ? nextDistanceMeters / movingSeconds : 0;
        const lapAverageSpeedMps =
          lapMovingSeconds > 0 ? lapDistanceMeters / lapMovingSeconds : 0;
        const maxSpeedMps = Math.max(
          metricsRef.current.maxSpeedMps,
          currentSpeedMps,
        );
        const lapMaxSpeedMps = Math.max(
          metricsRef.current.lapMaxSpeedMps,
          currentSpeedMps,
        );

        isAutoPausedRef.current = autoPaused;
        setIsAutoPaused(autoPaused);
        previousPointRef.current = point;
        updateRoutePoints([...routePointsRef.current, point]);

        updateMetrics(
          withEstimatedCalories(
            {
              ...metricsRef.current,
              movingSeconds,
              distanceMeters: nextDistanceMeters,
              ascentMeters,
              currentSpeedMps,
              averageSpeedMps,
              maxSpeedMps,
              lapMovingSeconds,
              lapDistanceMeters,
              lapAscentMeters,
              lapAverageSpeedMps,
              lapMaxSpeedMps,
            },
            activeSettings,
          ),
        );

        if (
          activeSettings.autoLap &&
          activeSettings.splitType === 'distance' &&
          lapDistanceMeters >= activeSettings.splitDistanceMeters
        ) {
          markLap();
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
    if (isBackgroundRecordingRef.current) {
      return true;
    }

    try {
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
    const nextRoutePoints = mergeRidePoints(
      routePointsRef.current,
      persistedPoints,
    );
    const latestPoint = nextRoutePoints.at(-1) ?? null;

    previousPointRef.current = latestPoint;

    if (areRidePointListsEqual(routePointsRef.current, nextRoutePoints)) {
      return;
    }

    updateRoutePoints(nextRoutePoints);

    if (nextRoutePoints.length > 1) {
      const totalMetrics = calculateMetricsFromPoints(nextRoutePoints);
      const currentMetrics = metricsRef.current;
      const lapStartedAt = currentMetrics.lapStartedAt;
      const lapPoints = lapStartedAt
        ? nextRoutePoints.filter((point) => point.recordedAt >= lapStartedAt)
        : nextRoutePoints;
      const lapMetrics = calculateMetricsFromPoints(lapPoints);

      updateMetrics(
        withEstimatedCalories(
          {
            ...currentMetrics,
            elapsedSeconds: Math.max(
              currentMetrics.elapsedSeconds,
              totalMetrics.elapsedSeconds,
            ),
            movingSeconds: totalMetrics.movingSeconds,
            distanceMeters: totalMetrics.distanceMeters,
            ascentMeters: totalMetrics.ascentMeters,
            currentSpeedMps: totalMetrics.currentSpeedMps,
            averageSpeedMps: totalMetrics.averageSpeedMps,
            maxSpeedMps: totalMetrics.maxSpeedMps,
            lapElapsedSeconds: lapMetrics.elapsedSeconds,
            lapMovingSeconds: lapMetrics.movingSeconds,
            lapDistanceMeters: lapMetrics.distanceMeters,
            lapAscentMeters: lapMetrics.ascentMeters,
            lapAverageSpeedMps: lapMetrics.averageSpeedMps,
            lapMaxSpeedMps: lapMetrics.maxSpeedMps,
          },
          settingsRef.current,
        ),
      );
    }
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
    if (statusRef.current !== 'recording') {
      return;
    }

    const transitionId = appStateTransitionIdRef.current + 1;
    appStateTransitionIdRef.current = transitionId;
    const isCurrentTransition = () =>
      appStateTransitionIdRef.current === transitionId &&
      statusRef.current === 'recording';

    if (nextState === 'active') {
      shouldSyncBeforeNextLocationRef.current = true;
      const backgroundPermission = await getBackgroundLocationPermission();

      if (backgroundPermission.status === Location.PermissionStatus.GRANTED) {
        setError((currentError) =>
          isBackgroundLocationWarning(currentError) ? null : currentError,
        );
      }

      await syncPersistedRidePoints();
      if (!isCurrentTransition()) {
        return;
      }
      await startWatchingLocation();
      if (!isCurrentTransition()) {
        return;
      }
      scheduleResumePointSync();
      return;
    }

    clearResumePointSync();
    shouldSyncBeforeNextLocationRef.current = false;
    const backgroundStarted = await startBackgroundRecordingIfNeeded();

    if (!isCurrentTransition() || AppState.currentState === 'active') {
      return;
    }

    await stopWatchingLocation();

    if (!backgroundStarted) {
      setError(BACKGROUND_LOCATION_UNAVAILABLE_ERROR);
    }
  }

  useEffect(() => {
    handleAppStateChangeRef.current = handleAppStateChange;
  });

  async function startRide() {
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

    rideIdRef.current = rideId;
    previousPointRef.current = null;
    shouldSyncBeforeNextLocationRef.current = false;
    clearResumePointSync();
    pausedStartedAtRef.current = null;
    accumulatedElapsedSecondsRef.current = 0;
    updateMetrics(
      withEstimatedCalories(
        {
          ...initialMetrics,
          startedAt: Date.now(),
          lapStartedAt: Date.now(),
        },
        settings,
      ),
    );
    updateRoutePoints([]);
    setCurrentCoordinate(null);
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    setRideStatus('recording');
    startTimer();
    await startWatchingBarometer();
    await startWatchingLocation();

    if (backgroundPermission.status !== Location.PermissionStatus.GRANTED) {
      setError(BACKGROUND_LOCATION_START_WARNING);
    } else {
      const backgroundStarted = await startBackgroundRecordingIfNeeded();

      if (!backgroundStarted) {
        setError(BACKGROUND_LOCATION_UNAVAILABLE_ERROR);
      }
    }

    if (settings.keepAwakeDuringRide) {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    }
  }

  async function pauseRide() {
    if (statusRef.current !== 'recording') {
      return;
    }

    accumulateElapsedTime();
    stopTimer();
    await stopWatchingLocation();
    stopWatchingBarometer();
    await syncPersistedRidePoints();
    await stopBackgroundRecordingIfNeeded();
    await syncPersistedRidePoints();
    clearResumePointSync();
    shouldSyncBeforeNextLocationRef.current = false;
    await deactivateKeepAwake(KEEP_AWAKE_TAG);
    pausedStartedAtRef.current = Date.now();
    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    setRideStatus('paused');
  }

  async function resumeRide() {
    if (statusRef.current !== 'paused') {
      return;
    }

    accumulatePausedTime();
    setRideStatus('recording');
    startTimer();
    await startWatchingBarometer();
    await startWatchingLocation();

    if (settings.keepAwakeDuringRide) {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    }
  }

  async function stopRide() {
    if (statusRef.current === 'idle' || statusRef.current === 'stopped') {
      return;
    }

    accumulateElapsedTime();
    accumulatePausedTime();
    stopTimer();
    await stopWatchingLocation();
    stopWatchingBarometer();
    await syncPersistedRidePoints();
    await stopBackgroundRecordingIfNeeded();
    await syncPersistedRidePoints();
    clearResumePointSync();
    shouldSyncBeforeNextLocationRef.current = false;
    await deactivateKeepAwake(KEEP_AWAKE_TAG);
    const finalMetrics = withEstimatedCalories(
      {
        ...metricsRef.current,
        elapsedSeconds: accumulatedElapsedSecondsRef.current,
      },
      settings,
    );
    updateMetrics(finalMetrics);

    if (rideIdRef.current) {
      const savedMetrics = await finishRide(
        rideIdRef.current,
        finalMetrics,
        settings,
      );
      updateMetrics(savedMetrics);
      await setActiveRideId(null);
    }

    isAutoPausedRef.current = false;
    setIsAutoPaused(false);
    setRideStatus('stopped');
    rideIdRef.current = null;
    setCurrentCoordinate(null);
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
