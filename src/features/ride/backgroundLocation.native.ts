import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { initializeDatabase } from '../../lib/database';
import { getActiveRideId, insertRidePoints } from './rideStorage';
import type { RideSettings } from './types';

export const BACKGROUND_RIDE_LOCATION_TASK = 'pelot-background-ride-location';

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

  await Location.startLocationUpdatesAsync(BACKGROUND_RIDE_LOCATION_TASK, {
    accuracy:
      settings.gpsAccuracy === 'best'
        ? Location.Accuracy.BestForNavigation
        : Location.Accuracy.Balanced,
    activityType: Location.ActivityType.Fitness,
    deferredUpdatesDistance: settings.gpsAccuracy === 'best' ? 10 : 50,
    deferredUpdatesInterval: settings.gpsAccuracy === 'best' ? 1000 : 30000,
    distanceInterval: settings.gpsAccuracy === 'best' ? 5 : 25,
    foregroundService: {
      notificationTitle: 'Pelot is recording your ride',
      notificationBody: 'Location is being used to keep tracking your route.',
      notificationColor: '#238636',
    },
    pausesUpdatesAutomatically: settings.gpsAccuracy !== 'best',
    showsBackgroundLocationIndicator: true,
    timeInterval: settings.gpsAccuracy === 'best' ? 1000 : 10000,
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
