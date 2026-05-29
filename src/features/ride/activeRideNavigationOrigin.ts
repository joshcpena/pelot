import * as Location from 'expo-location';

import {
  ACTIVE_RIDE_NAVIGATION_LOCATION_PERMISSION_ERROR,
  type ActiveRideNavigationOriginAdapter,
  type ActiveRideNavigationSnapshot,
} from './activeRideNavigation';
import type { RouteCoordinate } from './types';

type ExpoRouteOriginPosition = {
  coords: RouteCoordinate;
};

export type ExpoRouteOriginLocationModule = {
  Accuracy: {
    High: number;
  };
  PermissionStatus: {
    GRANTED: string;
  };
  requestForegroundPermissionsAsync: () => Promise<{
    status: string;
  }>;
  getLastKnownPositionAsync: (options: {
    maxAge: number;
    requiredAccuracy: number;
  }) => Promise<ExpoRouteOriginPosition | null>;
  getCurrentPositionAsync: (options: {
    accuracy: number;
  }) => Promise<ExpoRouteOriginPosition>;
};

const LAST_KNOWN_POSITION_MAX_AGE_MS = 5 * 60 * 1000;
const LAST_KNOWN_POSITION_REQUIRED_ACCURACY_METERS = 2000;

export function createExpoRouteOriginAdapter(
  location: ExpoRouteOriginLocationModule = Location,
): ActiveRideNavigationOriginAdapter {
  let cachedOrigin: RouteCoordinate | null = null;

  return {
    async getOrigin(snapshot) {
      const permission = await location.requestForegroundPermissionsAsync();

      if (permission.status !== location.PermissionStatus.GRANTED) {
        throw new Error(ACTIVE_RIDE_NAVIGATION_LOCATION_PERMISSION_ERROR);
      }

      const rideOrigin = getActiveRideOrigin(snapshot);

      if (rideOrigin) {
        cachedOrigin = rideOrigin;
        return rideOrigin;
      }

      const lastKnownPosition = await location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_POSITION_MAX_AGE_MS,
        requiredAccuracy: LAST_KNOWN_POSITION_REQUIRED_ACCURACY_METERS,
      });

      if (lastKnownPosition) {
        const origin = toRouteCoordinate(lastKnownPosition);
        cachedOrigin = origin;
        return origin;
      }

      if (cachedOrigin) {
        return cachedOrigin;
      }

      const position = await location.getCurrentPositionAsync({
        accuracy: location.Accuracy.High,
      });
      const origin = toRouteCoordinate(position);
      cachedOrigin = origin;

      return origin;
    },
  };
}

function getActiveRideOrigin(
  snapshot: ActiveRideNavigationSnapshot,
): RouteCoordinate | null {
  if (snapshot.rideStatus !== 'recording' && snapshot.rideStatus !== 'paused') {
    return null;
  }

  if (snapshot.currentCoordinate) {
    return snapshot.currentCoordinate;
  }

  const lastRidePoint = snapshot.routePoints.at(-1);

  if (!lastRidePoint) {
    return null;
  }

  return {
    latitude: lastRidePoint.latitude,
    longitude: lastRidePoint.longitude,
  };
}

function toRouteCoordinate(position: ExpoRouteOriginPosition): RouteCoordinate {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}
