import { useEffect, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { Barometer } from 'expo-sensors';

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
  startedAt: null,
  elapsedSeconds: 0,
  movingSeconds: 0,
  pausedSeconds: 0,
  distanceMeters: 0,
  ascentMeters: 0,
  currentSpeedMps: 0,
  averageSpeedMps: 0,
  maxSpeedMps: 0,
  lapNumber: 1,
  lapStartedAt: null,
  lapElapsedSeconds: 0,
  lapMovingSeconds: 0,
  lapDistanceMeters: 0,
  lapAscentMeters: 0,
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

function getLocationAccuracy(settings: RideSettings) {
  return settings.gpsAccuracy === 'best'
    ? Location.Accuracy.BestForNavigation
    : Location.Accuracy.Balanced;
}

export function useForegroundRideRecorder(settings: RideSettings) {
  const [status, setStatus] = useState<RideStatus>('idle');
  const [metrics, setMetrics] = useState<RideMetrics>(initialMetrics);
  const [routePoints, setRoutePoints] = useState<RidePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAutoPaused, setIsAutoPaused] = useState(false);

  const statusRef = useRef<RideStatus>('idle');
  const metricsRef = useRef<RideMetrics>(initialMetrics);
  const rideIdRef = useRef<string | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const barometerWatchRef = useRef<{ remove: () => void } | null>(null);
  const baselinePressureRef = useRef<number | null>(null);
  const barometerAltitudeRef = useRef<number | null>(null);
  const previousPointRef = useRef<RidePoint | null>(null);
  const activeStartedAtRef = useRef<number | null>(null);
  const pausedStartedAtRef = useRef<number | null>(null);
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

  function markLap() {
    const now = Date.now();

    updateMetrics({
      ...metricsRef.current,
      lapNumber: metricsRef.current.lapNumber + 1,
      lapStartedAt: now,
      lapElapsedSeconds: 0,
      lapMovingSeconds: 0,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapAverageSpeedMps: 0,
      lapMaxSpeedMps: 0,
    });
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
    });
  }

  async function stopWatchingLocation() {
    watchRef.current?.remove();
    watchRef.current = null;
  }

  async function startWatchingBarometer() {
    barometerWatchRef.current?.remove();
    barometerWatchRef.current = null;
    baselinePressureRef.current = null;
    barometerAltitudeRef.current = null;

    if (settings.ascentSource !== 'barometer-preferred') {
      return;
    }

    const isAvailable = await Barometer.isAvailableAsync();

    if (!isAvailable) {
      return;
    }

    Barometer.setUpdateInterval(1000);
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
      const lapElapsedSeconds = Math.max(
        0,
        Math.floor(
          (Date.now() - (metricsRef.current.lapStartedAt ?? Date.now())) / 1000,
        ),
      );

      updateMetrics({
        ...metricsRef.current,
        elapsedSeconds,
        lapElapsedSeconds,
      });

      if (
        settings.autoLap &&
        settings.splitType === 'time' &&
        lapElapsedSeconds >= settings.splitDurationSeconds
      ) {
        markLap();
      }
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
        const lapAscentGain = previousPoint
          ? positiveElevationGainMeters(previousPoint, point)
          : 0;
        const lapMovingSeconds = shouldCountMovement
          ? metricsRef.current.lapMovingSeconds + secondsSincePrevious
          : metricsRef.current.lapMovingSeconds;
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

        setIsAutoPaused(autoPaused);
        previousPointRef.current = point;
        setRoutePoints((current) => [...current, point]);

        updateMetrics({
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
        });

        if (
          settings.autoLap &&
          settings.splitType === 'distance' &&
          lapDistanceMeters >= settings.splitDistanceMeters
        ) {
          markLap();
        }

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
    pausedStartedAtRef.current = null;
    accumulatedElapsedSecondsRef.current = 0;
    updateMetrics({
      ...initialMetrics,
      startedAt: Date.now(),
      lapStartedAt: Date.now(),
    });
    setRoutePoints([]);
    setIsAutoPaused(false);
    setRideStatus('recording');
    startTimer();
    await startWatchingBarometer();
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
    stopWatchingBarometer();
    await stopBackgroundRideRecording();
    await deactivateKeepAwake(KEEP_AWAKE_TAG);
    pausedStartedAtRef.current = Date.now();
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
    accumulatePausedTime();
    stopTimer();
    await stopWatchingLocation();
    stopWatchingBarometer();
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
      barometerWatchRef.current?.remove();
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  return {
    status,
    metrics,
    routePoints,
    error,
    isAutoPaused,
    startRide,
    pauseRide,
    resumeRide,
    stopRide,
    markLap,
  };
}
