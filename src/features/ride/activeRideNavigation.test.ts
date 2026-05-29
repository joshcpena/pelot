import { describe, expect, it } from 'vitest';

import {
  ACTIVE_RIDE_NAVIGATION_OFF_ROUTE_DISTANCE_METERS,
  ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS,
  distanceToRouteMeters,
  getRerouteCandidate,
} from './activeRideNavigation';
import type { PlannedRoute, RidePoint, RouteCoordinate } from './types';

function coordinate(latitude: number, longitude: number): RouteCoordinate {
  return { latitude, longitude };
}

function point(overrides: Partial<RidePoint> = {}): RidePoint {
  return {
    recordedAt: 0,
    latitude: 0,
    longitude: 0,
    altitude: null,
    speedMps: null,
    heading: null,
    horizontalAccuracy: null,
    verticalAccuracy: null,
    ...overrides,
  };
}

function plannedRoute(coordinates: RouteCoordinate[]): PlannedRoute {
  return {
    destination: 'Coffee',
    distanceText: '1.0 mi',
    durationText: '5 min',
    coordinates,
    steps: [],
  };
}

describe('distanceToRouteMeters', () => {
  it('returns infinity when no route coordinates exist', () => {
    expect(distanceToRouteMeters(coordinate(38, -77), [])).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('measures distance to a route segment', () => {
    const distance = distanceToRouteMeters(coordinate(0.001, 0.005), [
      coordinate(0, 0),
      coordinate(0, 0.01),
    ]);

    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });
});

describe('getRerouteCandidate', () => {
  it('does nothing without recording, route, and destination state', () => {
    expect(
      getRerouteCandidate({
        now: 1_000,
        lastRerouteAt: 0,
        isRerouteInFlight: false,
        snapshot: {
          rideStatus: 'paused',
          routePoints: [],
          currentCoordinate: coordinate(0.01, 0.01),
          routeProfile: 'bike',
        },
        plannedRoute: plannedRoute([coordinate(0, 0), coordinate(0, 0.01)]),
        selectedDestination: {
          id: 'coffee',
          name: 'Coffee',
          address: null,
          coordinate: coordinate(0, 0.01),
        },
      }),
    ).toBeNull();
  });

  it('uses the current coordinate when the rider is off route', () => {
    const candidate = getRerouteCandidate({
      now: 40_000,
      lastRerouteAt: 0,
      isRerouteInFlight: false,
      snapshot: {
        rideStatus: 'recording',
        routePoints: [point({ latitude: 0, longitude: 0 })],
        currentCoordinate: coordinate(0.01, 0.01),
        routeProfile: 'roadbike',
      },
      plannedRoute: plannedRoute([coordinate(0, 0), coordinate(0, 0.01)]),
      selectedDestination: {
        id: 'coffee',
        name: 'Coffee',
        address: null,
        coordinate: coordinate(0, 0.01),
      },
    });

    expect(candidate).toEqual({
      origin: coordinate(0.01, 0.01),
      routeProfile: 'roadbike',
    });
  });

  it('suppresses reroutes inside the distance threshold and cooldown', () => {
    const route = plannedRoute([coordinate(0, 0), coordinate(0, 0.01)]);
    const destination = {
      id: 'coffee',
      name: 'Coffee',
      address: null,
      coordinate: coordinate(0, 0.01),
    };

    expect(
      getRerouteCandidate({
        now: 40_000,
        lastRerouteAt: 0,
        isRerouteInFlight: false,
        snapshot: {
          rideStatus: 'recording',
          routePoints: [],
          currentCoordinate: coordinate(0.0001, 0.005),
          routeProfile: 'bike',
        },
        plannedRoute: route,
        selectedDestination: destination,
      }),
    ).toBeNull();

    expect(
      getRerouteCandidate({
        now: ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS - 1,
        lastRerouteAt: 0,
        isRerouteInFlight: false,
        snapshot: {
          rideStatus: 'recording',
          routePoints: [],
          currentCoordinate: coordinate(0.01, 0.01),
          routeProfile: 'bike',
        },
        plannedRoute: route,
        selectedDestination: destination,
      }),
    ).toBeNull();

    expect(ACTIVE_RIDE_NAVIGATION_OFF_ROUTE_DISTANCE_METERS).toBe(75);
  });
});
