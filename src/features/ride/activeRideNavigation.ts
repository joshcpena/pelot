import type {
  DestinationOption,
  PlannedRoute,
  RidePoint,
  RideStatus,
  RouteCoordinate,
  RouteProfile,
} from './types';

export const ACTIVE_RIDE_NAVIGATION_OFF_ROUTE_DISTANCE_METERS = 75;
export const ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS = 30_000;

const METERS_PER_DEGREE_LATITUDE = 111_320;
const EARTH_RADIUS_METERS = 6_371_000;

export type ActiveRideNavigationSnapshot = {
  rideStatus: RideStatus;
  routePoints: RidePoint[];
  currentCoordinate: RouteCoordinate | null;
  routeProfile: RouteProfile;
};

export type ActiveRideNavigationOriginAdapter = {
  getOrigin: (
    snapshot: ActiveRideNavigationSnapshot,
  ) => Promise<RouteCoordinate>;
};

export type ActiveRideNavigationPlaceSearchAdapter = {
  search: (input: {
    query: string;
    origin: RouteCoordinate;
  }) => Promise<DestinationOption[]>;
};

export type ActiveRideNavigationRoutePlannerAdapter = {
  plan: (input: {
    destination: DestinationOption;
    origin: RouteCoordinate;
    routeProfile: RouteProfile;
  }) => Promise<PlannedRoute>;
};

export type ActiveRideNavigationRecentsAdapter = {
  load: () => Promise<DestinationOption[]>;
  getUpdated: (
    destination: DestinationOption,
    currentDestinations: DestinationOption[],
  ) => DestinationOption[];
  save: (destinations: DestinationOption[]) => Promise<void>;
};

export type ActiveRideNavigationClock = {
  now: () => number;
};

export type ActiveRideNavigationAdapters = {
  origin: ActiveRideNavigationOriginAdapter;
  placeSearch: ActiveRideNavigationPlaceSearchAdapter;
  routePlanner: ActiveRideNavigationRoutePlannerAdapter;
  recents: ActiveRideNavigationRecentsAdapter;
  clock: ActiveRideNavigationClock;
};

export const ACTIVE_RIDE_NAVIGATION_LOCATION_PERMISSION_ERROR =
  'Location permission is required to plan a route.';

export type RerouteCandidateInput = {
  now: number;
  lastRerouteAt: number;
  isRerouteInFlight: boolean;
  snapshot: ActiveRideNavigationSnapshot;
  plannedRoute: PlannedRoute | null;
  selectedDestination: DestinationOption | null;
};

export type RerouteCandidate = {
  origin: RouteCoordinate;
  routeProfile: RouteProfile;
};

export function distanceToRouteMeters(
  coordinate: RouteCoordinate,
  routeCoordinates: RouteCoordinate[],
): number {
  if (routeCoordinates.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (routeCoordinates.length === 1) {
    return haversineDistanceMeters(coordinate, routeCoordinates[0]);
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    shortestDistance = Math.min(
      shortestDistance,
      distanceToRouteSegmentMeters(
        coordinate,
        routeCoordinates[index],
        routeCoordinates[index + 1],
      ),
    );
  }

  return shortestDistance;
}

export function getRerouteCandidate(
  input: RerouteCandidateInput,
): RerouteCandidate | null {
  const { snapshot, plannedRoute, selectedDestination } = input;

  if (
    snapshot.rideStatus !== 'recording' ||
    !plannedRoute ||
    !selectedDestination ||
    plannedRoute.coordinates.length < 2
  ) {
    return null;
  }

  const currentCoordinate =
    snapshot.currentCoordinate ??
    latestRoutePointCoordinate(snapshot.routePoints);

  if (!currentCoordinate) {
    return null;
  }

  if (
    distanceToRouteMeters(currentCoordinate, plannedRoute.coordinates) <
    ACTIVE_RIDE_NAVIGATION_OFF_ROUTE_DISTANCE_METERS
  ) {
    return null;
  }

  if (
    input.isRerouteInFlight ||
    input.now - input.lastRerouteAt < ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS
  ) {
    return null;
  }

  return {
    origin: currentCoordinate,
    routeProfile: snapshot.routeProfile,
  };
}

function latestRoutePointCoordinate(
  routePoints: RidePoint[],
): RouteCoordinate | null {
  const latestRoutePoint = routePoints[routePoints.length - 1];

  if (!latestRoutePoint) {
    return null;
  }

  return {
    latitude: latestRoutePoint.latitude,
    longitude: latestRoutePoint.longitude,
  };
}

function distanceToRouteSegmentMeters(
  coordinate: RouteCoordinate,
  segmentStart: RouteCoordinate,
  segmentEnd: RouteCoordinate,
): number {
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE *
    Math.cos(degreesToRadians(coordinate.latitude));

  const start = projectCoordinate(
    coordinate,
    segmentStart,
    metersPerDegreeLongitude,
  );
  const end = projectCoordinate(
    coordinate,
    segmentEnd,
    metersPerDegreeLongitude,
  );
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;

  if (segmentLengthSquared === 0) {
    return Math.hypot(start.x, start.y);
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      -(start.x * segmentX + start.y * segmentY) / segmentLengthSquared,
    ),
  );
  const projectedX = start.x + projection * segmentX;
  const projectedY = start.y + projection * segmentY;

  return Math.hypot(projectedX, projectedY);
}

function projectCoordinate(
  origin: RouteCoordinate,
  coordinate: RouteCoordinate,
  metersPerDegreeLongitude: number,
): { x: number; y: number } {
  return {
    x: (coordinate.longitude - origin.longitude) * metersPerDegreeLongitude,
    y: (coordinate.latitude - origin.latitude) * METERS_PER_DEGREE_LATITUDE,
  };
}

function haversineDistanceMeters(
  origin: RouteCoordinate,
  destination: RouteCoordinate,
): number {
  const latitudeDelta = degreesToRadians(
    destination.latitude - origin.latitude,
  );
  const longitudeDelta = degreesToRadians(
    destination.longitude - origin.longitude,
  );
  const originLatitude = degreesToRadians(origin.latitude);
  const destinationLatitude = degreesToRadians(destination.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
