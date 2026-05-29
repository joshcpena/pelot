import { describe, expect, it } from 'vitest';

import {
  createActiveRideNavigationController,
  ACTIVE_RIDE_NAVIGATION_OFF_ROUTE_DISTANCE_METERS,
  ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS,
  distanceToRouteMeters,
  getRerouteCandidate,
  type ActiveRideNavigationAdapters,
  type ActiveRideNavigationSnapshot,
} from './activeRideNavigation';
import type {
  DestinationOption,
  PlannedRoute,
  RidePoint,
  RouteCoordinate,
} from './types';

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

// @ts-expect-error currentCoordinate must be present even when it is null.
const snapshotWithoutCurrentCoordinate: ActiveRideNavigationSnapshot = {
  rideStatus: 'recording',
  routePoints: [],
  routeProfile: 'bike',
};
void snapshotWithoutCurrentCoordinate;

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
    const route = plannedRoute([coordinate(0, 0), coordinate(0, 0.01)]);
    const destination = {
      id: 'coffee',
      name: 'Coffee',
      address: null,
      coordinate: coordinate(0, 0.01),
    };

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
        plannedRoute: route,
        selectedDestination: destination,
      }),
    ).toBeNull();

    expect(
      getRerouteCandidate({
        now: 40_000,
        lastRerouteAt: 0,
        isRerouteInFlight: false,
        snapshot: {
          rideStatus: 'recording',
          routePoints: [],
          currentCoordinate: coordinate(0.01, 0.01),
          routeProfile: 'bike',
        },
        plannedRoute: null,
        selectedDestination: destination,
      }),
    ).toBeNull();

    expect(
      getRerouteCandidate({
        now: 40_000,
        lastRerouteAt: 0,
        isRerouteInFlight: false,
        snapshot: {
          rideStatus: 'recording',
          routePoints: [],
          currentCoordinate: coordinate(0.01, 0.01),
          routeProfile: 'bike',
        },
        plannedRoute: route,
        selectedDestination: null,
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

function createAdapters(): {
  adapters: ActiveRideNavigationAdapters;
  calls: {
    savedRecents: DestinationOption[][];
    plannedOrigins: RouteCoordinate[];
  };
} {
  const calls = {
    savedRecents: [] as DestinationOption[][],
    plannedOrigins: [] as RouteCoordinate[],
  };

  return {
    calls,
    adapters: {
      origin: {
        getOrigin: async () => coordinate(38, -77),
      },
      placeSearch: {
        search: async ({ query, origin }) => [
          {
            id: query,
            name: query,
            address: `${origin.latitude},${origin.longitude}`,
            coordinate: coordinate(38.1, -77.1),
          },
        ],
      },
      routePlanner: {
        plan: async ({ destination, origin }) => {
          calls.plannedOrigins.push(origin);
          return plannedRoute([origin, destination.coordinate]);
        },
      },
      recents: {
        load: async () => [
          {
            id: 'recent',
            name: 'Recent',
            address: null,
            coordinate: coordinate(38.2, -77.2),
          },
        ],
        getUpdated: (destination, current) => [destination, ...current],
        save: async (destinations) => {
          calls.savedRecents.push(destinations);
        },
      },
      clock: {
        now: () => 60_000,
      },
    },
  };
}

describe('createActiveRideNavigationController', () => {
  it('searches, stores search origin, selects a destination, and remembers it', async () => {
    const { adapters, calls } = createAdapters();
    const controller = createActiveRideNavigationController({
      adapters,
      snapshot: {
        rideStatus: 'idle',
        routePoints: [],
        currentCoordinate: null,
        routeProfile: 'bike',
      },
    });

    controller.setDestinationInput(' Coffee ');
    await controller.searchDestinations();

    expect(controller.getState()).toMatchObject({
      destinationInput: ' Coffee ',
      routePlanError: null,
      isSearchingDestinations: false,
    });
    expect(controller.getState().destinationOptions).toHaveLength(1);

    await controller.selectDestination(
      controller.getState().destinationOptions[0],
    );

    expect(controller.getState().plannedRoute?.destination).toBe('Coffee');
    expect(controller.getState().selectedDestination?.name).toBe('Coffee');
    expect(controller.getState().destinationOptions).toEqual([]);
    expect(controller.getState().isPlannerOpen).toBe(false);
    expect(calls.plannedOrigins).toEqual([coordinate(38, -77)]);
    expect(calls.savedRecents[0][0].name).toBe('Coffee');
  });

  it('handles empty search and cancel state', async () => {
    const { adapters } = createAdapters();
    const controller = createActiveRideNavigationController({
      adapters,
      snapshot: {
        rideStatus: 'idle',
        routePoints: [],
        currentCoordinate: null,
        routeProfile: 'bike',
      },
    });

    await controller.searchDestinations();
    expect(controller.getState().routePlanError).toBe(
      'Enter a destination first.',
    );

    controller.cancelNavigation();
    expect(controller.getState()).toMatchObject({
      plannedRoute: null,
      selectedDestination: null,
      destinationOptions: [],
      routePlanError: null,
    });
  });

  it('loads recents when the planner opens and ignores load failures', async () => {
    const { adapters } = createAdapters();
    const controller = createActiveRideNavigationController({
      adapters,
      snapshot: {
        rideStatus: 'idle',
        routePoints: [],
        currentCoordinate: null,
        routeProfile: 'bike',
      },
    });

    await controller.openPlanner();
    expect(controller.getState().isPlannerOpen).toBe(true);
    expect(controller.getState().recentDestinations).toHaveLength(1);

    const failingController = createActiveRideNavigationController({
      adapters: {
        ...adapters,
        recents: {
          ...adapters.recents,
          load: async () => {
            throw new Error('nope');
          },
        },
      },
      snapshot: {
        rideStatus: 'idle',
        routePoints: [],
        currentCoordinate: null,
        routeProfile: 'bike',
      },
    });

    await failingController.openPlanner();
    expect(failingController.getState().isPlannerOpen).toBe(true);
    expect(failingController.getState().recentDestinations).toEqual([]);
  });

  it('reroutes outside the threshold and preserves the route on failure', async () => {
    const { adapters } = createAdapters();
    const destination = {
      id: 'coffee',
      name: 'Coffee',
      address: null,
      coordinate: coordinate(0, 0.01),
    };
    const controller = createActiveRideNavigationController({
      adapters,
      snapshot: {
        rideStatus: 'recording',
        routePoints: [],
        currentCoordinate: coordinate(0.01, 0.01),
        routeProfile: 'bike',
      },
      initialState: {
        plannedRoute: plannedRoute([coordinate(0, 0), coordinate(0, 0.01)]),
        selectedDestination: destination,
      },
    });

    await controller.maybeReroute();
    expect(controller.getState().plannedRoute?.coordinates[0]).toEqual(
      coordinate(0.01, 0.01),
    );

    const currentRoute = controller.getState().plannedRoute;
    controller.updateSnapshot({
      rideStatus: 'recording',
      routePoints: [],
      currentCoordinate: coordinate(0.02, 0.02),
      routeProfile: 'bike',
    });

    const failingController = createActiveRideNavigationController({
      adapters: {
        ...adapters,
        routePlanner: {
          plan: async () => {
            throw new Error('Could not reroute.');
          },
        },
        clock: { now: () => 120_000 },
      },
      snapshot: {
        rideStatus: 'recording',
        routePoints: [],
        currentCoordinate: coordinate(0.02, 0.02),
        routeProfile: 'bike',
      },
      initialState: {
        plannedRoute: currentRoute,
        selectedDestination: destination,
      },
    });

    await failingController.maybeReroute();
    expect(failingController.getState().plannedRoute).toBe(currentRoute);
    expect(failingController.getState().routePlanError).toBe(
      'Could not reroute.',
    );
  });
});
