import { useCallback, useEffect, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { Barometer } from 'expo-sensors';
import { AppState } from 'react-native';

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
import { createRideRecordingAccumulator } from './rideRecordingAccumulator';
import {
  createRideRecordingRuntime,
  type RideRecordingBackgroundRecordingAdapter,
  type RideRecordingForegroundLocationAdapter,
  type RideRecordingRuntimeAdapters,
  initialRideRecordingRuntimeSnapshot,
  type RideRecordingRuntime,
  type RideRecordingRuntimeSnapshot,
} from './rideRecordingRuntime';
import type { RidePoint, RideSettings } from './types';

const KEEP_AWAKE_TAG = 'pelot-active-ride';
const STANDARD_GPS_DISTANCE_INTERVAL_METERS = 10;
const BEST_GPS_DISTANCE_INTERVAL_METERS = 5;
const STANDARD_GPS_TIME_INTERVAL_MS = 5000;
const BEST_GPS_TIME_INTERVAL_MS = 1000;
const LOCATION_WATCH_RECOVERY_INTERVAL_MS = 5000;
const LOCATION_WATCH_STALE_MS = 30000;
const BAROMETER_UPDATE_INTERVAL_MS = 5000;
const RESUME_POINT_SYNC_DELAY_MS = 1500;

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

async function requestBackgroundLocationPermission() {
  const requestedPermission =
    await Location.requestBackgroundPermissionsAsync();

  if (requestedPermission.status === Location.PermissionStatus.GRANTED) {
    return requestedPermission;
  }

  return Location.getBackgroundPermissionsAsync();
}

function createAltitudeSensorAdapter(): RideRecordingRuntimeAdapters['altitudeSensor'] {
  let barometerWatch: { remove: () => void } | null = null;
  let baselinePressure: number | null = null;
  let barometerAltitude: number | null = null;

  function stop() {
    barometerWatch?.remove();
    barometerWatch = null;
    baselinePressure = null;
    barometerAltitude = null;
  }

  return {
    async start(settings) {
      stop();

      if (settings.ascentSource !== 'barometer-preferred') {
        return;
      }

      const isAvailable = await Barometer.isAvailableAsync();

      if (!isAvailable) {
        return;
      }

      Barometer.setUpdateInterval(BAROMETER_UPDATE_INTERVAL_MS);
      barometerWatch = Barometer.addListener(({ pressure }) => {
        if (!baselinePressure) {
          baselinePressure = pressure;
        }

        barometerAltitude = pressureToRelativeAltitudeMeters(
          pressure,
          baselinePressure,
        );
      });
    },
    stop,
    getAltitudeOverride() {
      return barometerAltitude;
    },
  };
}

function createForegroundLocationAdapter(): RideRecordingForegroundLocationAdapter {
  let watch: Location.LocationSubscription | null = null;

  async function stop() {
    watch?.remove();
    watch = null;
  }

  return {
    async requestPermission() {
      return Location.requestForegroundPermissionsAsync();
    },
    async startWatching({ settings, onPoint }) {
      await stop();

      watch = await Location.watchPositionAsync(
        {
          accuracy: getLocationAccuracy(settings),
          distanceInterval: getLocationDistanceInterval(settings),
          timeInterval: getLocationTimeInterval(settings),
        },
        (location) => {
          void onPoint(toRidePoint(location, null));
        },
      );

      return {
        remove() {
          watch?.remove();
          watch = null;
        },
      };
    },
  };
}

function createBackgroundRecordingAdapter(): RideRecordingBackgroundRecordingAdapter {
  return {
    getPermission: () => Location.getBackgroundPermissionsAsync(),
    requestPermission: requestBackgroundLocationPermission,
    start: startBackgroundRideRecording,
    stop: stopBackgroundRideRecording,
    isStarted: isBackgroundRideRecordingStarted,
  };
}

function createRecordingStoreAdapter(): RideRecordingRuntimeAdapters['recordingStore'] {
  return {
    initialize: initializeDatabase,
    createRideId,
    async createRide(rideId, settings) {
      await createRide(rideId, settings.unitSystem);
    },
    setActiveRideId,
    async insertRidePoint(rideId, point, source = 'foreground-gps') {
      await insertRidePoint(rideId, point, source);
    },
    loadRidePoints,
    finishRide,
  };
}

function createWakeLockAdapter(): RideRecordingRuntimeAdapters['wakeLock'] {
  return {
    async activate() {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    },
    async deactivate() {
      await deactivateKeepAwake(KEEP_AWAKE_TAG);
    },
  };
}

function createSchedulerAdapter(): RideRecordingRuntimeAdapters['scheduler'] {
  return {
    setInterval(callback, delayMs) {
      const handle = setInterval(() => {
        void callback();
      }, delayMs);

      return {
        cancel: () => clearInterval(handle),
      };
    },
    setTimeout(callback, delayMs) {
      const handle = setTimeout(() => {
        void callback();
      }, delayMs);

      return {
        cancel: () => clearTimeout(handle),
      };
    },
  };
}

function createRideRecordingRuntimeOptions(
  settings: RideSettings,
): Parameters<typeof createRideRecordingRuntime>[0] {
  const altitudeSensor = createAltitudeSensorAdapter();

  return {
    settings,
    adapters: {
      foregroundLocation: createForegroundLocationAdapter(),
      backgroundRecording: createBackgroundRecordingAdapter(),
      recordingStore: createRecordingStoreAdapter(),
      altitudeSensor,
      wakeLock: createWakeLockAdapter(),
      scheduler: createSchedulerAdapter(),
      clock: {
        now: Date.now,
      },
      accumulatorFactory: createRideRecordingAccumulator,
    },
    locationWatchRecoveryIntervalMs: LOCATION_WATCH_RECOVERY_INTERVAL_MS,
    locationWatchStaleMs: LOCATION_WATCH_STALE_MS,
    resumePointSyncDelayMs: RESUME_POINT_SYNC_DELAY_MS,
  };
}

function createExpoRideRecordingRuntime(settings: RideSettings) {
  return createRideRecordingRuntime(
    createRideRecordingRuntimeOptions(settings),
  );
}

export function useForegroundRideRecorder(settings: RideSettings) {
  const [snapshot, setSnapshot] = useState<RideRecordingRuntimeSnapshot>(
    initialRideRecordingRuntimeSnapshot,
  );
  const [runtime] = useState<RideRecordingRuntime>(() =>
    createExpoRideRecordingRuntime(settings),
  );

  useEffect(() => {
    runtime.updateSettings(settings);
  }, [runtime, settings]);

  useEffect(() => {
    const unsubscribe = runtime.subscribe(setSnapshot);
    const subscription = AppState.addEventListener('change', (nextState) => {
      runtime.handleAppStateChange(nextState).catch(() => undefined);
    });

    return () => {
      subscription.remove();
      unsubscribe();
      runtime.dispose().catch(() => undefined);
    };
  }, [runtime]);

  const startRide = useCallback(() => runtime.startRide(), [runtime]);
  const pauseRide = useCallback(() => runtime.pauseRide(), [runtime]);
  const resumeRide = useCallback(() => runtime.resumeRide(), [runtime]);
  const stopRide = useCallback(
    (): Promise<FinishedRideSummary | null> => runtime.stopRide(),
    [runtime],
  );
  const markLap = useCallback(() => {
    runtime.markLap();
  }, [runtime]);

  return {
    status: snapshot.status,
    metrics: snapshot.metrics,
    routePoints: snapshot.routePoints,
    currentCoordinate: snapshot.currentCoordinate,
    error: snapshot.error,
    isAutoPaused: snapshot.isAutoPaused,
    startRide,
    pauseRide,
    resumeRide,
    stopRide,
    markLap,
  };
}
