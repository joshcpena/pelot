import { useEffect, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';

import { initializeDatabase } from '../../lib/database';
import {
  startBackgroundRideRecording,
  stopBackgroundRideRecording,
} from './backgroundLocation';
import { distanceBetweenMeters, positiveElevationGainMeters } from './metrics';
import {
  createRide,
  createRideId,
  finishRide,
  insertRidePoint,
  setActiveRideId,
} from './rideStorage';
import type { RideMetrics, RidePoint, RideSettings, RideStatus } from './types';

const KEEP_AWAKE_TAG = 'pelot-active-ride';
const STOPPED_SPEED_MPS = 0.75;

const initialMetrics: RideMetrics = {
  elapsedSeconds: 0,
  movingSeconds: 0,
  distanceMeters: 0,
  ascentMeters: 0,
  currentSpeedMps: 0,
  averageSpeedMps: 0,
  maxSpeedMps: 0,
};

function toRidePoint(location: Location.LocationObject): RidePoint {
  return {
    recordedAt: location.timestamp,
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    altitude: location.coords.altitude,
    speedMps: location.coords.speed,
    heading: location.coords.heading,
    horizontalAccuracy: location.coords.accuracy,
    verticalAccuracy: location.coords.altitudeAccuracy,
  };
}

function getLocationAccuracy(settings: RideSettings) {
  return settings.gpsAccuracy === 'best'
    ? Location.Accuracy.BestForNavigation
    : Location.Accuracy.Balanced;
}

export function useForegroundRideRecorder(settings: RideSettings) {
  const [status, setStatus] = useState<RideStatus>('idle');
  const [metrics, setMetrics] = useState<RideMetrics>(initialMetrics);
  const [pointCount, setPointCount] = useState(0);
  const [routePoints, setRoutePoints] = useState<RidePoint[]>([]);
  const [lastPoint, setLastPoint] = useState<RidePoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAutoPaused, setIsAutoPaused] = useState(false);

  const statusRef = useRef<RideStatus>('idle');
  const metricsRef = useRef<RideMetrics>(initialMetrics);
  const rideIdRef = useRef<string | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const previousPointRef = useRef<RidePoint | null>(null);
  const activeStartedAtRef = useRef<number | null>(null);
  const accumulatedElapsedSecondsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function setRideStatus(nextStatus: RideStatus) {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }

  function updateMetrics(nextMetrics: RideMetrics) {
    metricsRef.current = nextMetrics;
    setMetrics(nextMetrics);
  }

  async function stopWatchingLocation() {
    watchRef.current?.remove();
    watchRef.current = null;
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
      updateMetrics({ ...metricsRef.current, elapsedSeconds });
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

    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: getLocationAccuracy(settings),
        distanceInterval: 5,
        timeInterval: settings.gpsAccuracy === 'best' ? 1000 : 3000,
      },
      async (location) => {
        if (statusRef.current !== 'recording' || rideIdRef.current == null) {
          return;
        }

        const point = toRidePoint(location);
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
          settings.autoPause && currentSpeedMps < STOPPED_SPEED_MPS;
        const shouldCountMovement = !autoPaused && previousPoint != null;
        const movingSeconds = shouldCountMovement
          ? metricsRef.current.movingSeconds + secondsSincePrevious
          : metricsRef.current.movingSeconds;
        const nextDistanceMeters = shouldCountMovement
          ? metricsRef.current.distanceMeters + distanceMeters
          : metricsRef.current.distanceMeters;
        const ascentMeters = shouldCountMovement
          ? metricsRef.current.ascentMeters +
            positiveElevationGainMeters(previousPoint, point)
          : metricsRef.current.ascentMeters;
        const averageSpeedMps =
          movingSeconds > 0 ? nextDistanceMeters / movingSeconds : 0;
        const maxSpeedMps = Math.max(
          metricsRef.current.maxSpeedMps,
          currentSpeedMps,
        );

        setIsAutoPaused(autoPaused);
        previousPointRef.current = point;
        setLastPoint(point);
        setPointCount((current) => current + 1);
        setRoutePoints((current) => [...current, point]);

        updateMetrics({
          ...metricsRef.current,
          movingSeconds,
          distanceMeters: nextDistanceMeters,
          ascentMeters,
          currentSpeedMps,
          averageSpeedMps,
          maxSpeedMps,
        });

        await insertRidePoint(rideIdRef.current, point, 'foreground-gps');
      },
    );
  }

  async function startRide() {
    setError(null);
    const permission = await Location.requestForegroundPermissionsAsync();

    if (permission.status !== Location.PermissionStatus.GRANTED) {
      setError('Location permission is required to record a ride.');
      return;
    }

    const backgroundPermission =
      await Location.requestBackgroundPermissionsAsync();

    await initializeDatabase();
    const rideId = createRideId();
    await createRide(rideId, settings.unitSystem);
    await setActiveRideId(rideId);

    rideIdRef.current = rideId;
    previousPointRef.current = null;
    accumulatedElapsedSecondsRef.current = 0;
    updateMetrics(initialMetrics);
    setPointCount(0);
    setRoutePoints([]);
    setLastPoint(null);
    setIsAutoPaused(false);
    setRideStatus('recording');
    startTimer();
    await startWatchingLocation();
    const backgroundStarted = await startBackgroundRideRecording(settings);

    if (
      backgroundPermission.status !== Location.PermissionStatus.GRANTED ||
      !backgroundStarted
    ) {
      setError('Ride started, but background location is not enabled yet.');
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
    await stopBackgroundRideRecording();
    await deactivateKeepAwake(KEEP_AWAKE_TAG);
    setIsAutoPaused(false);
    setRideStatus('paused');
  }

  async function resumeRide() {
    if (statusRef.current !== 'paused') {
      return;
    }

    setRideStatus('recording');
    startTimer();
    await startWatchingLocation();
    await startBackgroundRideRecording(settings);

    if (settings.keepAwakeDuringRide) {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    }
  }

  async function stopRide() {
    if (statusRef.current === 'idle' || statusRef.current === 'stopped') {
      return;
    }

    accumulateElapsedTime();
    stopTimer();
    await stopWatchingLocation();
    await stopBackgroundRideRecording();
    await deactivateKeepAwake(KEEP_AWAKE_TAG);
    const finalMetrics = {
      ...metricsRef.current,
      elapsedSeconds: accumulatedElapsedSecondsRef.current,
    };
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

    setIsAutoPaused(false);
    setRideStatus('stopped');
    rideIdRef.current = null;
  }

  useEffect(() => {
    return () => {
      stopTimer();
      watchRef.current?.remove();
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  return {
    status,
    metrics,
    pointCount,
    routePoints,
    lastPoint,
    error,
    isAutoPaused,
    startRide,
    pauseRide,
    resumeRide,
    stopRide,
  };
}
