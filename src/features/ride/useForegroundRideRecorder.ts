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
  type FinishedRideSummary,
  type RidePauseInterval,
} from './rideStorage';
import { areRidePointListsEqual, mergeRidePoints } from './ridePoints';
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
  const pausedStartedAtRef = useRef<number | null>(null);
  const autoPausedStartedAtRef = useRef<number | null>(null);
  const pauseIntervalsRef = useRef<RidePauseInterval[]>([]);
  const committedPausedSecondsRef = useRef(0);
  const committedLapPausedSecondsRef = useRef(0);
  const stoppedAtRef = useRef<number | null>(null);
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

  function secondsBetween(startedAt: number, endedAt: number) {
    return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  }

  function getTimingNow(now = Date.now()) {
    return stoppedAtRef.current ?? now;
  }

  function getElapsedSeconds(now = Date.now()) {
    const startedAt = metricsRef.current.startedAt;

    if (startedAt == null) {
      return 0;
    }

    return secondsBetween(startedAt, getTimingNow(now));
  }

  function getLapElapsedSeconds(now = Date.now()) {
    const lapStartedAt = metricsRef.current.lapStartedAt;

    if (lapStartedAt == null) {
      return 0;
    }

    return secondsBetween(lapStartedAt, getTimingNow(now));
  }

  function getLapPauseSeconds(startedAt: number, endedAt: number) {
    const lapStartedAt = metricsRef.current.lapStartedAt;
    const scopedStartedAt =
      lapStartedAt == null ? startedAt : Math.max(startedAt, lapStartedAt);

    return secondsBetween(scopedStartedAt, endedAt);
  }

  function getInProgressAutoPauseSeconds(now = Date.now()) {
    const autoPausedStartedAt = autoPausedStartedAtRef.current;

    if (autoPausedStartedAt == null) {
      return {
        pausedSeconds: 0,
        lapPausedSeconds: 0,
      };
    }

    const timingNow = getTimingNow(now);

    return {
      pausedSeconds: secondsBetween(autoPausedStartedAt, timingNow),
      lapPausedSeconds: getLapPauseSeconds(autoPausedStartedAt, timingNow),
    };
  }

  function getInProgressManualPauseSeconds(now = Date.now()) {
    const pausedStartedAt = pausedStartedAtRef.current;

    if (pausedStartedAt == null) {
      return {
        pausedSeconds: 0,
        lapPausedSeconds: 0,
      };
    }

    const timingNow = getTimingNow(now);

    return {
      pausedSeconds: secondsBetween(pausedStartedAt, timingNow),
      lapPausedSeconds: getLapPauseSeconds(pausedStartedAt, timingNow),
    };
  }

  function getTimingMetrics(now = Date.now()) {
    const elapsedSeconds = getElapsedSeconds(now);
    const lapElapsedSeconds = getLapElapsedSeconds(now);
    const inProgressAutoPauseSeconds = getInProgressAutoPauseSeconds(now);
    const inProgressManualPauseSeconds = getInProgressManualPauseSeconds(now);
    const pausedSeconds = Math.min(
      elapsedSeconds,
      committedPausedSecondsRef.current +
        inProgressAutoPauseSeconds.pausedSeconds +
        inProgressManualPauseSeconds.pausedSeconds,
    );
    const lapPausedSeconds = Math.min(
      lapElapsedSeconds,
      committedLapPausedSecondsRef.current +
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

  function refreshTimingMetrics(now = Date.now()) {
    const timingMetrics = getTimingMetrics(now);

    updateMetrics(
      withEstimatedCalories(
        {
          ...metricsRef.current,
          ...timingMetrics,
          averageSpeedMps:
            timingMetrics.movingSeconds > 0
              ? metricsRef.current.distanceMeters / timingMetrics.movingSeconds
              : 0,
          lapAverageSpeedMps:
            timingMetrics.lapMovingSeconds > 0
              ? metricsRef.current.lapDistanceMeters /
                timingMetrics.lapMovingSeconds
              : 0,
        },
        settingsRef.current,
      ),
    );

    return timingMetrics;
  }

  function recordPauseInterval(startedAt: number, endedAt: number) {
    if (endedAt <= startedAt) {
      return;
    }

    pauseIntervalsRef.current = [
      ...pauseIntervalsRef.current,
      { startedAt, endedAt },
    ];
  }

  function commitPauseInterval(startedAt: number, endedAt: number) {
    const pausedSeconds = secondsBetween(startedAt, endedAt);

    if (pausedSeconds <= 0) {
      return;
    }

    committedPausedSecondsRef.current += pausedSeconds;
    committedLapPausedSecondsRef.current += getLapPauseSeconds(
      startedAt,
      endedAt,
    );
    recordPauseInterval(startedAt, endedAt);
  }

  function commitManualPausedTime(now = Date.now()) {
    const pausedStartedAt = pausedStartedAtRef.current;

    if (pausedStartedAt == null) {
      return;
    }

    pausedStartedAtRef.current = null;
    commitPauseInterval(pausedStartedAt, getTimingNow(now));
  }

  function commitAutoPausedTime(now = Date.now()) {
    const autoPausedStartedAt = autoPausedStartedAtRef.current;

    if (autoPausedStartedAt == null) {
      return;
    }

    autoPausedStartedAtRef.current = null;
    commitPauseInterval(autoPausedStartedAt, getTimingNow(now));
  }

  function setAutoPausedStatus(nextIsAutoPaused: boolean, now = Date.now()) {
    if (nextIsAutoPaused === isAutoPausedRef.current) {
      return;
    }

    if (nextIsAutoPaused) {
      autoPausedStartedAtRef.current = getTimingNow(now);
    } else {
      commitAutoPausedTime(now);
    }

    isAutoPausedRef.current = nextIsAutoPaused;
    setIsAutoPaused(nextIsAutoPaused);
  }

  function resetTimingState() {
    pausedStartedAtRef.current = null;
    autoPausedStartedAtRef.current = null;
    pauseIntervalsRef.current = [];
    committedPausedSecondsRef.current = 0;
    committedLapPausedSecondsRef.current = 0;
    stoppedAtRef.current = null;
  }

  function getPauseIntervals(now = Date.now()) {
    const timingNow = getTimingNow(now);
    const pauseIntervals = [...pauseIntervalsRef.current];

    if (
      pausedStartedAtRef.current != null &&
      timingNow > pausedStartedAtRef.current
    ) {
      pauseIntervals.push({
        startedAt: pausedStartedAtRef.current,
        endedAt: timingNow,
      });
    }

    if (
      autoPausedStartedAtRef.current != null &&
      timingNow > autoPausedStartedAtRef.current
    ) {
      pauseIntervals.push({
        startedAt: autoPausedStartedAtRef.current,
        endedAt: timingNow,
      });
    }

    return pauseIntervals;
  }

  function markLap() {
    const now = Date.now();
    const timingMetrics = getTimingMetrics(now);

    committedLapPausedSecondsRef.current = 0;

    updateMetrics(
      withEstimatedCalories(
        {
          ...metricsRef.current,
          ...timingMetrics,
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

  function refreshRouteMetricsFromPoints(nextRoutePoints: RidePoint[]) {
    if (nextRoutePoints.length <= 1) {
      return;
    }

    const pauseIntervals = getPauseIntervals();
    const totalMetrics = calculateMetricsFromPoints(
      nextRoutePoints,
      pauseIntervals,
    );
    const currentMetrics = metricsRef.current;
    const timingMetrics = getTimingMetrics();
    const lapStartedAt = currentMetrics.lapStartedAt;
    const lapPoints = lapStartedAt
      ? nextRoutePoints.filter((point) => point.recordedAt >= lapStartedAt)
      : nextRoutePoints;
    const lapMetrics = calculateMetricsFromPoints(lapPoints, pauseIntervals);

    updateMetrics(
      withEstimatedCalories(
        {
          ...currentMetrics,
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
        },
        settingsRef.current,
      ),
    );
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

      const timingMetrics = refreshTimingMetrics();

      if (
        settingsRef.current.autoLap &&
        settingsRef.current.splitType === 'time' &&
        timingMetrics.lapMovingSeconds >=
          settingsRef.current.splitDurationSeconds
      ) {
        markLap();
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

        const activeSettings = settingsRef.current;

        if (shouldSyncBeforeNextLocationRef.current) {
          shouldSyncBeforeNextLocationRef.current = false;
          await syncPersistedRidePoints();
        }

        const point = toRidePoint(location, barometerAltitudeRef.current);
        const latestRoutePoint = routePointsRef.current.at(-1) ?? null;
        const isChronologicallyNewPoint =
          latestRoutePoint == null ||
          point.recordedAt > latestRoutePoint.recordedAt;

        if (!isChronologicallyNewPoint) {
          const currentRoutePoints = routePointsRef.current;
          const nextRoutePoints = mergeRidePoints(currentRoutePoints, [point]);
          const didChangeRoutePoints = !areRidePointListsEqual(
            currentRoutePoints,
            nextRoutePoints,
          );

          if (!didChangeRoutePoints) {
            return;
          }

          const latestPoint = nextRoutePoints.at(-1) ?? null;

          updateRoutePoints(nextRoutePoints);
          previousPointRef.current = latestPoint;
          setCurrentCoordinate(
            latestPoint ? toRouteCoordinateFromPoint(latestPoint) : coordinate,
          );
          refreshRouteMetricsFromPoints(nextRoutePoints);

          await insertRidePoint(rideIdRef.current, point, 'foreground-gps');
          return;
        }

        setCurrentCoordinate(coordinate);
        const previousPoint = previousPointRef.current;
        const reportedSpeed = point.speedMps ?? 0;
        const wasAutoPaused = isAutoPausedRef.current;
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
        setAutoPausedStatus(autoPaused, Date.now());
        const timingMetrics = getTimingMetrics();
        const shouldCountMovement =
          !autoPaused && !wasAutoPaused && previousPoint != null;
        const movingSeconds = timingMetrics.movingSeconds;
        const lapMovingSeconds = timingMetrics.lapMovingSeconds;
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

        const nextRoutePoints = [...routePointsRef.current, point];
        updateRoutePoints(nextRoutePoints);
        previousPointRef.current = nextRoutePoints.at(-1) ?? null;

        updateMetrics(
          withEstimatedCalories(
            {
              ...metricsRef.current,
              ...timingMetrics,
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

    if (latestPoint) {
      setCurrentCoordinate(toRouteCoordinateFromPoint(latestPoint));
    }

    refreshRouteMetricsFromPoints(nextRoutePoints);
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
      previousPointRef.current = null;
      shouldSyncBeforeNextLocationRef.current = false;
      clearResumePointSync();
      resetTimingState();
      updateMetrics(
        withEstimatedCalories(
          {
            ...initialMetrics,
            startedAt,
            lapStartedAt: startedAt,
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
      commitAutoPausedTime(pausedStartedAt);
      setAutoPausedStatus(false, pausedStartedAt);
      refreshTimingMetrics(pausedStartedAt);
      pausedStartedAtRef.current = pausedStartedAt;
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

      commitManualPausedTime();
      refreshTimingMetrics();
      previousPointRef.current = null;
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
      commitAutoPausedTime(stoppedAt);
      commitManualPausedTime(stoppedAt);
      setAutoPausedStatus(false, stoppedAt);
      stoppedAtRef.current = stoppedAt;
      refreshTimingMetrics(stoppedAt);
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
      const finalMetrics = withEstimatedCalories(
        {
          ...metricsRef.current,
          ...getTimingMetrics(stoppedAt),
        },
        settings,
      );
      updateMetrics(finalMetrics);

      let finishedRide: FinishedRideSummary | null = null;

      if (rideIdRef.current) {
        finishedRide = await finishRide(
          rideIdRef.current,
          finalMetrics,
          settings,
          getPauseIntervals(stoppedAt),
        );
        updateMetrics({
          ...finalMetrics,
          elapsedSeconds: finishedRide.summary.elapsedSeconds,
          movingSeconds: finishedRide.summary.movingSeconds,
          distanceMeters: finishedRide.summary.distanceMeters,
          ascentMeters: finishedRide.summary.ascentMeters,
          activeCaloriesKcal: finishedRide.summary.activeCaloriesKcal,
          averageSpeedMps: finishedRide.summary.averageSpeedMps,
          maxSpeedMps: finishedRide.summary.maxSpeedMps,
        });
        await setActiveRideId(null);
      }

      setAutoPausedStatus(false, stoppedAt);
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
