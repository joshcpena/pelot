import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { initializeDatabase } from '../../lib/database';
import { getActiveRideId, insertRidePoints } from './rideStorage';
import type { RideSettings } from './types';

export const BACKGROUND_RIDE_LOCATION_TASK = 'pelot-background-ride-location';
const STANDARD_BACKGROUND_DISTANCE_INTERVAL_METERS = 10;
const BEST_BACKGROUND_DISTANCE_INTERVAL_METERS = 5;
const STANDARD_BACKGROUND_TIME_INTERVAL_MS = 5000;
const BEST_BACKGROUND_TIME_INTERVAL_MS = 1000;

function toRidePoint(location: Location.LocationObject) {
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

TaskManager.defineTask<{
  locations?: Location.LocationObject[];
}>(BACKGROUND_RIDE_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) {
    return;
  }

  await initializeDatabase();
  const rideId = await getActiveRideId();

  if (!rideId) {
    return;
  }

  await insertRidePoints(
    rideId,
    data.locations.map(toRidePoint),
    'background-gps',
  );
});

export async function isBackgroundRideRecordingAvailable() {
  const backgroundPermission = await Location.getBackgroundPermissionsAsync();
  return backgroundPermission.status === Location.PermissionStatus.GRANTED;
}

export async function startBackgroundRideRecording(settings: RideSettings) {
  const backgroundPermission = await Location.getBackgroundPermissionsAsync();

  if (backgroundPermission.status !== Location.PermissionStatus.GRANTED) {
    return false;
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(
    BACKGROUND_RIDE_LOCATION_TASK,
  );
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_RIDE_LOCATION_TASK);
  }

  const isBestAccuracy = settings.gpsAccuracy === 'best';

  await Location.startLocationUpdatesAsync(BACKGROUND_RIDE_LOCATION_TASK, {
    accuracy: isBestAccuracy
      ? Location.Accuracy.BestForNavigation
      : Location.Accuracy.High,
    activityType: Location.ActivityType.Fitness,
    distanceInterval: isBestAccuracy
      ? BEST_BACKGROUND_DISTANCE_INTERVAL_METERS
      : STANDARD_BACKGROUND_DISTANCE_INTERVAL_METERS,
    foregroundService: {
      notificationTitle: 'Pelot is recording your ride',
      notificationBody: 'Location is being used to keep tracking your route.',
      notificationColor: '#238636',
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    timeInterval: isBestAccuracy
      ? BEST_BACKGROUND_TIME_INTERVAL_MS
      : STANDARD_BACKGROUND_TIME_INTERVAL_MS,
  });

  return true;
}

export async function stopBackgroundRideRecording() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(
    BACKGROUND_RIDE_LOCATION_TASK,
  );

  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_RIDE_LOCATION_TASK);
  }
}
