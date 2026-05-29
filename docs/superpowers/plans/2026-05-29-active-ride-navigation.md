# Active Ride Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Active Ride Navigation policy out of `app/index.tsx` into a deep, tested ride module with explicit provider, origin, recents, and clock adapters.

**Architecture:** Build a testable controller plus a thin React hook wrapper in `src/features/ride/activeRideNavigation.ts`. Keep Expo location mechanics in `activeRideNavigationOrigin.ts`, wrap existing MapTiler/OpenRouteService/SQLite behavior in explicit adapters, and then replace Home route search/select/cancel/reroute state with the new interface. Preserve current behavior and UI.

**Tech Stack:** Expo React Native, Expo Router, TypeScript, Vitest, existing `expo-location`, existing MapTiler/OpenRouteService functions in `routePlanning.ts`.

---

## File Structure

- Create `src/features/ride/activeRideNavigation.ts`: Active Ride Navigation types, constants, geometry helpers, testable controller, and `useActiveRideNavigation` hook.
- Create `src/features/ride/activeRideNavigation.test.ts`: controller-level behavior tests with fake adapters.
- Create `src/features/ride/activeRideNavigationOrigin.ts`: production origin adapter that hides Expo permission and current-position mechanics.
- Create `src/features/ride/activeRideNavigationOrigin.test.ts`: origin fallback-order tests with a fake location module.
- Create `src/features/ride/activeRideNavigationAdapters.ts`: production adapters for MapTiler place search, OpenRouteService route planning, recent destination storage, and clock.
- Create `src/features/ride/activeRideNavigationAdapters.test.ts`: recents adapter test for synchronous normalization plus async persistence.
- Modify `app/index.tsx`: remove Active Ride Navigation state/policy and consume `useActiveRideNavigation`.
- Keep `src/features/ride/routePlanning.ts` provider parsing behavior intact for the first pass; expose it only through the new adapter module from the Home route.

---

### Task 1: Active Ride Navigation Core Geometry

**Files:**
- Create: `src/features/ride/activeRideNavigation.ts`
- Create: `src/features/ride/activeRideNavigation.test.ts`

- [ ] **Step 1: Write failing geometry and reroute-gate tests**

Create `src/features/ride/activeRideNavigation.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import {
  ACTIVE_RIDE_NAVIGATION_OFF_ROUTE_DISTANCE_METERS,
  ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS,
  distanceToRouteMeters,
  getRerouteCandidate,
} from './activeRideNavigation';
import type { PlannedRoute, RidePoint, RouteCoordinate } from './types';

function coordinate(
  latitude: number,
  longitude: number,
): RouteCoordinate {
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

function plannedRoute(
  coordinates: RouteCoordinate[],
): PlannedRoute {
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
        now:
          ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS -
          1,
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
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm test -- src/features/ride/activeRideNavigation.test.ts
```

Expected: FAIL because `activeRideNavigation.ts` does not exist.

- [ ] **Step 3: Add minimal core exports**

Create `src/features/ride/activeRideNavigation.ts` with:

```ts
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

export type ActiveRideNavigationSnapshot = {
  rideStatus: RideStatus;
  routePoints: RidePoint[];
  currentCoordinate: RouteCoordinate | null;
  routeProfile: RouteProfile;
};

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

function distanceBetweenCoordinates(a: RouteCoordinate, b: RouteCoordinate) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(deltaLongitude / 2) ** 2;

  return (
    earthRadiusMeters *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function distanceToRouteMeters(
  coordinate: RouteCoordinate,
  routeCoordinates: RouteCoordinate[],
) {
  if (routeCoordinates.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (routeCoordinates.length === 1) {
    return distanceBetweenCoordinates(coordinate, routeCoordinates[0]);
  }

  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude =
    metersPerDegreeLatitude * Math.cos((coordinate.latitude * Math.PI) / 180);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const start = routeCoordinates[index];
    const end = routeCoordinates[index + 1];
    const startX =
      (start.longitude - coordinate.longitude) * metersPerDegreeLongitude;
    const startY =
      (start.latitude - coordinate.latitude) * metersPerDegreeLatitude;
    const endX =
      (end.longitude - coordinate.longitude) * metersPerDegreeLongitude;
    const endY = (end.latitude - coordinate.latitude) * metersPerDegreeLatitude;
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const projection =
      segmentLengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              -(startX * segmentX + startY * segmentY) / segmentLengthSquared,
            ),
          );
    const closestX = startX + segmentX * projection;
    const closestY = startY + segmentY * projection;

    bestDistance = Math.min(bestDistance, Math.hypot(closestX, closestY));
  }

  return bestDistance;
}

function toRouteCoordinate(point: RidePoint): RouteCoordinate {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

export function getRerouteCandidate({
  now,
  lastRerouteAt,
  isRerouteInFlight,
  snapshot,
  plannedRoute,
  selectedDestination,
}: RerouteCandidateInput): RerouteCandidate | null {
  if (
    snapshot.rideStatus !== 'recording' ||
    !plannedRoute ||
    !selectedDestination ||
    plannedRoute.coordinates.length < 2
  ) {
    return null;
  }

  const latestPoint = snapshot.routePoints.at(-1);
  const currentCoordinate =
    snapshot.currentCoordinate ?? (latestPoint ? toRouteCoordinate(latestPoint) : null);

  if (!currentCoordinate) {
    return null;
  }

  const distanceFromRoute = distanceToRouteMeters(
    currentCoordinate,
    plannedRoute.coordinates,
  );

  if (distanceFromRoute < ACTIVE_RIDE_NAVIGATION_OFF_ROUTE_DISTANCE_METERS) {
    return null;
  }

  if (
    isRerouteInFlight ||
    now - lastRerouteAt < ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS
  ) {
    return null;
  }

  return {
    origin: currentCoordinate,
    routeProfile: snapshot.routeProfile,
  };
}
```

- [ ] **Step 4: Run the tests**

Run:

```bash
npm test -- src/features/ride/activeRideNavigation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/ride/activeRideNavigation.ts src/features/ride/activeRideNavigation.test.ts
git commit -m "Add active ride navigation geometry"
```

---

### Task 2: Origin Adapter

**Files:**
- Create: `src/features/ride/activeRideNavigationOrigin.ts`
- Create: `src/features/ride/activeRideNavigationOrigin.test.ts`
- Modify: `src/features/ride/activeRideNavigation.ts`

- [ ] **Step 1: Add adapter types to the core module**

Modify `src/features/ride/activeRideNavigation.ts` by adding these exports after `ActiveRideNavigationSnapshot`:

```ts
export type ActiveRideNavigationOriginAdapter = {
  getOrigin: (
    snapshot: ActiveRideNavigationSnapshot,
  ) => Promise<RouteCoordinate>;
};

export const ACTIVE_RIDE_NAVIGATION_LOCATION_PERMISSION_ERROR =
  'Location permission is required to plan a route.';
```

- [ ] **Step 2: Write failing origin adapter tests**

Create `src/features/ride/activeRideNavigationOrigin.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  ACTIVE_RIDE_NAVIGATION_LOCATION_PERMISSION_ERROR,
  type ActiveRideNavigationSnapshot,
} from './activeRideNavigation';
import { createExpoRouteOriginAdapter } from './activeRideNavigationOrigin';

function snapshot(
  overrides: Partial<ActiveRideNavigationSnapshot> = {},
): ActiveRideNavigationSnapshot {
  return {
    rideStatus: 'idle',
    routePoints: [],
    currentCoordinate: null,
    routeProfile: 'bike',
    ...overrides,
  };
}

function locationModule() {
  return {
    Accuracy: { High: 6 },
    PermissionStatus: { GRANTED: 'granted' },
    requestForegroundPermissionsAsync: vi.fn(async () => ({
      status: 'granted',
    })),
    getLastKnownPositionAsync: vi.fn(async () => null),
    getCurrentPositionAsync: vi.fn(async () => ({
      coords: { latitude: 38.1, longitude: -77.1 },
    })),
  };
}

describe('createExpoRouteOriginAdapter', () => {
  it('throws a ride-level error when foreground location is denied', async () => {
    const location = locationModule();
    location.requestForegroundPermissionsAsync.mockResolvedValueOnce({
      status: 'denied',
    });
    const adapter = createExpoRouteOriginAdapter(location);

    await expect(adapter.getOrigin(snapshot())).rejects.toThrow(
      ACTIVE_RIDE_NAVIGATION_LOCATION_PERMISSION_ERROR,
    );
  });

  it('uses the active ride coordinate before platform location', async () => {
    const location = locationModule();
    const adapter = createExpoRouteOriginAdapter(location);

    await expect(
      adapter.getOrigin(
        snapshot({
          rideStatus: 'recording',
          currentCoordinate: { latitude: 38, longitude: -77 },
        }),
      ),
    ).resolves.toEqual({ latitude: 38, longitude: -77 });
    expect(location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('falls back through last ride point, last known position, cached origin, and current position', async () => {
    const location = locationModule();
    const adapter = createExpoRouteOriginAdapter(location);

    await expect(
      adapter.getOrigin(
        snapshot({
          rideStatus: 'paused',
          routePoints: [
            {
              recordedAt: 1,
              latitude: 38.2,
              longitude: -77.2,
              altitude: null,
              speedMps: null,
              heading: null,
              horizontalAccuracy: null,
              verticalAccuracy: null,
            },
          ],
        }),
      ),
    ).resolves.toEqual({ latitude: 38.2, longitude: -77.2 });

    location.getLastKnownPositionAsync.mockResolvedValueOnce({
      coords: { latitude: 38.3, longitude: -77.3 },
    });

    await expect(adapter.getOrigin(snapshot())).resolves.toEqual({
      latitude: 38.3,
      longitude: -77.3,
    });

    await expect(adapter.getOrigin(snapshot())).resolves.toEqual({
      latitude: 38.3,
      longitude: -77.3,
    });

    const freshLocation = locationModule();
    const freshAdapter = createExpoRouteOriginAdapter(freshLocation);

    await expect(freshAdapter.getOrigin(snapshot())).resolves.toEqual({
      latitude: 38.1,
      longitude: -77.1,
    });
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run:

```bash
npm test -- src/features/ride/activeRideNavigationOrigin.test.ts
```

Expected: FAIL because `activeRideNavigationOrigin.ts` does not exist.

- [ ] **Step 4: Implement the origin adapter**

Create `src/features/ride/activeRideNavigationOrigin.ts` with:

```ts
import * as Location from 'expo-location';

import {
  ACTIVE_RIDE_NAVIGATION_LOCATION_PERMISSION_ERROR,
  type ActiveRideNavigationOriginAdapter,
  type ActiveRideNavigationSnapshot,
} from './activeRideNavigation';
import type { RouteCoordinate } from './types';

type ExpoRouteOriginLocationModule = {
  Accuracy: Pick<typeof Location.Accuracy, 'High'>;
  PermissionStatus: Pick<typeof Location.PermissionStatus, 'GRANTED'>;
  requestForegroundPermissionsAsync: typeof Location.requestForegroundPermissionsAsync;
  getLastKnownPositionAsync: typeof Location.getLastKnownPositionAsync;
  getCurrentPositionAsync: typeof Location.getCurrentPositionAsync;
};

function toRouteCoordinate(location: {
  coords: { latitude: number; longitude: number };
}): RouteCoordinate {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

function getLastRidePointOrigin({
  rideStatus,
  routePoints,
}: ActiveRideNavigationSnapshot): RouteCoordinate | null {
  if (rideStatus !== 'recording' && rideStatus !== 'paused') {
    return null;
  }

  const lastRidePoint = routePoints.at(-1);

  return lastRidePoint
    ? {
        latitude: lastRidePoint.latitude,
        longitude: lastRidePoint.longitude,
      }
    : null;
}

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

      if (
        (snapshot.rideStatus === 'recording' ||
          snapshot.rideStatus === 'paused') &&
        snapshot.currentCoordinate
      ) {
        cachedOrigin = snapshot.currentCoordinate;
        return snapshot.currentCoordinate;
      }

      const lastRidePointOrigin = getLastRidePointOrigin(snapshot);

      if (lastRidePointOrigin) {
        cachedOrigin = lastRidePointOrigin;
        return lastRidePointOrigin;
      }

      const lastKnownPosition = await location.getLastKnownPositionAsync({
        maxAge: 5 * 60 * 1000,
        requiredAccuracy: 2000,
      });

      if (lastKnownPosition) {
        cachedOrigin = toRouteCoordinate(lastKnownPosition);
        return cachedOrigin;
      }

      if (cachedOrigin) {
        return cachedOrigin;
      }

      const position = await location.getCurrentPositionAsync({
        accuracy: location.Accuracy.High,
      });

      cachedOrigin = toRouteCoordinate(position);
      return cachedOrigin;
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run:

```bash
npm test -- src/features/ride/activeRideNavigationOrigin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ride/activeRideNavigation.ts src/features/ride/activeRideNavigationOrigin.ts src/features/ride/activeRideNavigationOrigin.test.ts
git commit -m "Add active ride navigation origin adapter"
```

---

### Task 3: Production Provider And Recents Adapters

**Files:**
- Create: `src/features/ride/activeRideNavigationAdapters.ts`
- Create: `src/features/ride/activeRideNavigationAdapters.test.ts`
- Modify: `src/features/ride/activeRideNavigation.ts`

- [ ] **Step 1: Add adapter interfaces to the core module**

Modify `src/features/ride/activeRideNavigation.ts` by adding these exports after `ActiveRideNavigationOriginAdapter`:

```ts
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
```

- [ ] **Step 2: Write failing adapter tests**

Create `src/features/ride/activeRideNavigationAdapters.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';

import { createActiveRideNavigationAdapters } from './activeRideNavigationAdapters';
import type { ActiveRideNavigationOriginAdapter } from './activeRideNavigation';

const origin: ActiveRideNavigationOriginAdapter = {
  getOrigin: async () => ({ latitude: 38, longitude: -77 }),
};

describe('createActiveRideNavigationAdapters', () => {
  it('wraps routePlanning functions behind explicit adapters', async () => {
    const searchBikeDestinations = vi.fn(async () => [
      {
        id: 'coffee',
        name: 'Coffee',
        address: null,
        coordinate: { latitude: 38, longitude: -77 },
      },
    ]);
    const planBikeRoute = vi.fn(async () => ({
      destination: 'Coffee',
      distanceText: '1.0 mi',
      durationText: '5 min',
      coordinates: [
        { latitude: 38, longitude: -77 },
        { latitude: 38.01, longitude: -77.01 },
      ],
      steps: [],
    }));
    const loadRecentRouteDestinations = vi.fn(async () => []);
    const saveRecentRouteDestinations = vi.fn(async () => undefined);
    const getUpdatedRecentRouteDestinations = vi.fn(() => [
      {
        id: 'coffee',
        name: 'Coffee',
        address: null,
        coordinate: { latitude: 38, longitude: -77 },
      },
    ]);

    const adapters = createActiveRideNavigationAdapters({
      origin,
      routePlanning: {
        searchBikeDestinations,
        planBikeRoute,
        loadRecentRouteDestinations,
        saveRecentRouteDestinations,
        getUpdatedRecentRouteDestinations,
      },
      clock: { now: () => 1234 },
    });

    await expect(
      adapters.placeSearch.search({
        query: 'coffee',
        origin: { latitude: 38, longitude: -77 },
      }),
    ).resolves.toHaveLength(1);
    expect(searchBikeDestinations).toHaveBeenCalledWith({
      query: 'coffee',
      origin: { latitude: 38, longitude: -77 },
    });

    await expect(
      adapters.routePlanner.plan({
        destination: {
          id: 'coffee',
          name: 'Coffee',
          address: null,
          coordinate: { latitude: 38, longitude: -77 },
        },
        origin: { latitude: 38, longitude: -77 },
        routeProfile: 'bike',
      }),
    ).resolves.toMatchObject({ destination: 'Coffee' });
    expect(planBikeRoute).toHaveBeenCalledOnce();

    const updated = adapters.recents.getUpdated(
      {
        id: 'coffee',
        name: 'Coffee',
        address: null,
        coordinate: { latitude: 38, longitude: -77 },
      },
      [],
    );
    await adapters.recents.save(updated);
    await expect(adapters.recents.load()).resolves.toEqual([]);
    expect(getUpdatedRecentRouteDestinations).toHaveBeenCalledOnce();
    expect(saveRecentRouteDestinations).toHaveBeenCalledWith(updated);
    expect(loadRecentRouteDestinations).toHaveBeenCalledOnce();
    expect(adapters.clock.now()).toBe(1234);
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run:

```bash
npm test -- src/features/ride/activeRideNavigationAdapters.test.ts
```

Expected: FAIL because `activeRideNavigationAdapters.ts` does not exist.

- [ ] **Step 4: Implement production adapter factory**

Create `src/features/ride/activeRideNavigationAdapters.ts` with:

```ts
import type {
  ActiveRideNavigationAdapters,
  ActiveRideNavigationClock,
  ActiveRideNavigationOriginAdapter,
} from './activeRideNavigation';
import {
  getUpdatedRecentRouteDestinations,
  loadRecentRouteDestinations,
  planBikeRoute,
  saveRecentRouteDestinations,
  searchBikeDestinations,
} from './routePlanning';

type RoutePlanningFunctions = {
  searchBikeDestinations: typeof searchBikeDestinations;
  planBikeRoute: typeof planBikeRoute;
  loadRecentRouteDestinations: typeof loadRecentRouteDestinations;
  saveRecentRouteDestinations: typeof saveRecentRouteDestinations;
  getUpdatedRecentRouteDestinations: typeof getUpdatedRecentRouteDestinations;
};

const defaultClock: ActiveRideNavigationClock = {
  now: () => Date.now(),
};

const defaultRoutePlanning: RoutePlanningFunctions = {
  searchBikeDestinations,
  planBikeRoute,
  loadRecentRouteDestinations,
  saveRecentRouteDestinations,
  getUpdatedRecentRouteDestinations,
};

export function createActiveRideNavigationAdapters({
  origin,
  routePlanning = defaultRoutePlanning,
  clock = defaultClock,
}: {
  origin: ActiveRideNavigationOriginAdapter;
  routePlanning?: RoutePlanningFunctions;
  clock?: ActiveRideNavigationClock;
}): ActiveRideNavigationAdapters {
  return {
    origin,
    placeSearch: {
      search: routePlanning.searchBikeDestinations,
    },
    routePlanner: {
      plan: routePlanning.planBikeRoute,
    },
    recents: {
      load: routePlanning.loadRecentRouteDestinations,
      getUpdated: routePlanning.getUpdatedRecentRouteDestinations,
      save: routePlanning.saveRecentRouteDestinations,
    },
    clock,
  };
}
```

- [ ] **Step 5: Run the tests**

Run:

```bash
npm test -- src/features/ride/activeRideNavigationAdapters.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ride/activeRideNavigation.ts src/features/ride/activeRideNavigationAdapters.ts src/features/ride/activeRideNavigationAdapters.test.ts
git commit -m "Add active ride navigation adapters"
```

---

### Task 4: Testable Controller And Hook

**Files:**
- Modify: `src/features/ride/activeRideNavigation.ts`
- Modify: `src/features/ride/activeRideNavigation.test.ts`

- [ ] **Step 1: Append failing controller tests**

First update the existing imports at the top of `src/features/ride/activeRideNavigation.test.ts` so they include the controller and adapter types:

```ts
import {
  createActiveRideNavigationController,
  ACTIVE_RIDE_NAVIGATION_OFF_ROUTE_DISTANCE_METERS,
  ACTIVE_RIDE_NAVIGATION_REROUTE_COOLDOWN_MS,
  distanceToRouteMeters,
  getRerouteCandidate,
  type ActiveRideNavigationAdapters,
} from './activeRideNavigation';
import type {
  DestinationOption,
  PlannedRoute,
  RidePoint,
  RouteCoordinate,
} from './types';
```

Then append this controller test code below the existing reroute-gate tests:

```ts

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

    await controller.selectDestination(controller.getState().destinationOptions[0]);

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
```

- [ ] **Step 2: Run the failing controller tests**

Run:

```bash
npm test -- src/features/ride/activeRideNavigation.test.ts
```

Expected: FAIL because `createActiveRideNavigationController` is missing.

- [ ] **Step 3: Implement controller state and actions**

Modify `src/features/ride/activeRideNavigation.ts`:

1. Add React imports at the top:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

2. Add these exports after the adapter types:

```ts
export type ActiveRideNavigationState = {
  destinationInput: string;
  destinationOptions: DestinationOption[];
  recentDestinations: DestinationOption[];
  plannedRoute: PlannedRoute | null;
  selectedDestination: DestinationOption | null;
  isPlannerOpen: boolean;
  routePlanError: string | null;
  isSearchingDestinations: boolean;
  isPlanningRoute: boolean;
};

export type ActiveRideNavigationController = ActiveRideNavigationState & {
  setDestinationInput: (value: string) => void;
  openPlanner: () => Promise<void>;
  closePlanner: () => void;
  searchDestinations: () => Promise<void>;
  clearDestinationInput: () => void;
  selectDestination: (destination: DestinationOption) => Promise<void>;
  cancelNavigation: () => void;
  maybeReroute: () => Promise<void>;
};

type ActiveRideNavigationControllerInternal = {
  getState: () => ActiveRideNavigationState;
  updateSnapshot: (snapshot: ActiveRideNavigationSnapshot) => void;
} & Omit<ActiveRideNavigationController, keyof ActiveRideNavigationState>;

const initialActiveRideNavigationState: ActiveRideNavigationState = {
  destinationInput: '',
  destinationOptions: [],
  recentDestinations: [],
  plannedRoute: null,
  selectedDestination: null,
  isPlannerOpen: false,
  routePlanError: null,
  isSearchingDestinations: false,
  isPlanningRoute: false,
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
```

3. Add the controller factory above `useActiveRideNavigation`:

```ts
export function createActiveRideNavigationController({
  adapters,
  snapshot,
  initialState = {},
  onChange,
}: {
  adapters: ActiveRideNavigationAdapters;
  snapshot: ActiveRideNavigationSnapshot;
  initialState?: Partial<ActiveRideNavigationState>;
  onChange?: (state: ActiveRideNavigationState) => void;
}): ActiveRideNavigationControllerInternal {
  let state = { ...initialActiveRideNavigationState, ...initialState };
  let currentSnapshot = snapshot;
  let routeSearchOrigin: RouteCoordinate | null = null;
  let isRerouteInFlight = false;
  let lastRerouteAt = 0;

  function emit(nextState: ActiveRideNavigationState) {
    state = nextState;
    onChange?.(state);
  }

  function patchState(patch: Partial<ActiveRideNavigationState>) {
    emit({ ...state, ...patch });
  }

  function updateSnapshot(nextSnapshot: ActiveRideNavigationSnapshot) {
    currentSnapshot = nextSnapshot;
  }

  function setDestinationInput(value: string) {
    patchState({
      destinationInput: value,
      destinationOptions: [],
      routePlanError: null,
    });
  }

  async function openPlanner() {
    patchState({ isPlannerOpen: true });

    try {
      patchState({ recentDestinations: await adapters.recents.load() });
    } catch {
      // Preserve current behavior: recent destination loading is nonblocking.
    }
  }

  function closePlanner() {
    patchState({ isPlannerOpen: false });
  }

  async function searchDestinations() {
    const query = state.destinationInput.trim();

    if (!query) {
      patchState({ routePlanError: 'Enter a destination first.' });
      return;
    }

    patchState({
      routePlanError: null,
      isSearchingDestinations: true,
      plannedRoute: null,
      selectedDestination: null,
    });

    try {
      const origin = await adapters.origin.getOrigin(currentSnapshot);
      const destinationOptions = await adapters.placeSearch.search({
        query,
        origin,
      });

      routeSearchOrigin = origin;
      patchState({ destinationOptions });
    } catch (error) {
      patchState({
        routePlanError: getErrorMessage(
          error,
          'Could not search destinations.',
        ),
      });
    } finally {
      patchState({ isSearchingDestinations: false });
    }
  }

  function rememberRecentDestination(destination: DestinationOption) {
    const updatedDestinations = adapters.recents.getUpdated(
      destination,
      state.recentDestinations,
    );

    patchState({ recentDestinations: updatedDestinations });
    adapters.recents.save(updatedDestinations).catch(() => undefined);
  }

  async function selectDestination(destination: DestinationOption) {
    patchState({
      destinationInput: destination.name,
      routePlanError: null,
      isPlanningRoute: true,
    });

    try {
      const origin =
        routeSearchOrigin ?? (await adapters.origin.getOrigin(currentSnapshot));
      const plannedRoute = await adapters.routePlanner.plan({
        destination,
        origin,
        routeProfile: currentSnapshot.routeProfile,
      });

      routeSearchOrigin = null;
      patchState({
        plannedRoute,
        selectedDestination: destination,
        destinationOptions: [],
        isPlannerOpen: false,
      });
      rememberRecentDestination(destination);
    } catch (error) {
      patchState({
        routePlanError: getErrorMessage(error, 'Could not plan bike route.'),
      });
    } finally {
      patchState({ isPlanningRoute: false });
    }
  }

  function clearDestinationInput() {
    routeSearchOrigin = null;
    patchState({
      destinationInput: '',
      destinationOptions: [],
      routePlanError: null,
    });
  }

  function cancelNavigation() {
    routeSearchOrigin = null;
    patchState({
      plannedRoute: null,
      selectedDestination: null,
      destinationOptions: [],
      routePlanError: null,
    });
  }

  async function maybeReroute() {
    const now = adapters.clock.now();
    const candidate = getRerouteCandidate({
      now,
      lastRerouteAt,
      isRerouteInFlight,
      snapshot: currentSnapshot,
      plannedRoute: state.plannedRoute,
      selectedDestination: state.selectedDestination,
    });

    if (!candidate || !state.selectedDestination) {
      return;
    }

    isRerouteInFlight = true;
    lastRerouteAt = now;

    try {
      const plannedRoute = await adapters.routePlanner.plan({
        destination: state.selectedDestination,
        origin: candidate.origin,
        routeProfile: candidate.routeProfile,
      });

      patchState({ plannedRoute, routePlanError: null });
    } catch (error) {
      patchState({
        routePlanError: getErrorMessage(error, 'Could not reroute.'),
      });
    } finally {
      isRerouteInFlight = false;
    }
  }

  return {
    getState: () => state,
    updateSnapshot,
    setDestinationInput,
    openPlanner,
    closePlanner,
    searchDestinations,
    clearDestinationInput,
    selectDestination,
    cancelNavigation,
    maybeReroute,
  };
}
```

4. Add the hook wrapper at the bottom:

```ts
export function useActiveRideNavigation({
  adapters,
  rideStatus,
  routePoints,
  currentCoordinate,
  routeProfile,
}: {
  adapters: ActiveRideNavigationAdapters;
} & ActiveRideNavigationSnapshot): ActiveRideNavigationController {
  const snapshot = useMemo(
    () => ({
      rideStatus,
      routePoints,
      currentCoordinate,
      routeProfile,
    }),
    [currentCoordinate, rideStatus, routePoints, routeProfile],
  );
  const controllerRef = useRef<ActiveRideNavigationControllerInternal | null>(
    null,
  );
  const [state, setState] = useState(initialActiveRideNavigationState);

  if (!controllerRef.current) {
    controllerRef.current = createActiveRideNavigationController({
      adapters,
      snapshot,
      onChange: setState,
    });
  }

  useEffect(() => {
    controllerRef.current?.updateSnapshot(snapshot);
  }, [snapshot]);

  const controller = controllerRef.current;

  const setDestinationInput = useCallback(
    (value: string) => controller?.setDestinationInput(value),
    [controller],
  );
  const openPlanner = useCallback(
    () => controller?.openPlanner() ?? Promise.resolve(),
    [controller],
  );
  const closePlanner = useCallback(
    () => controller?.closePlanner(),
    [controller],
  );
  const searchDestinations = useCallback(
    () => controller?.searchDestinations() ?? Promise.resolve(),
    [controller],
  );
  const clearDestinationInput = useCallback(
    () => controller?.clearDestinationInput(),
    [controller],
  );
  const selectDestination = useCallback(
    (destination: DestinationOption) =>
      controller?.selectDestination(destination) ?? Promise.resolve(),
    [controller],
  );
  const cancelNavigation = useCallback(
    () => controller?.cancelNavigation(),
    [controller],
  );
  const maybeReroute = useCallback(
    () => controller?.maybeReroute() ?? Promise.resolve(),
    [controller],
  );

  return {
    ...state,
    setDestinationInput,
    openPlanner,
    closePlanner,
    searchDestinations,
    clearDestinationInput,
    selectDestination,
    cancelNavigation,
    maybeReroute,
  };
}
```

- [ ] **Step 4: Run the controller tests**

Run:

```bash
npm test -- src/features/ride/activeRideNavigation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/ride/activeRideNavigation.ts src/features/ride/activeRideNavigation.test.ts
git commit -m "Add active ride navigation controller"
```

---

### Task 5: Home Route Integration

**Files:**
- Modify: `app/index.tsx`

- [ ] **Step 1: Update route-planning imports**

In `app/index.tsx`, replace the React import:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
```

with:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

In `app/index.tsx`, replace the existing routePlanning import:

```ts
import {
  getUpdatedRecentRouteDestinations,
  loadRecentRouteDestinations,
  planBikeRoute,
  saveRecentRouteDestinations,
  searchBikeDestinations,
} from '../src/features/ride/routePlanning';
```

with:

```ts
import { createActiveRideNavigationAdapters } from '../src/features/ride/activeRideNavigationAdapters';
import { createExpoRouteOriginAdapter } from '../src/features/ride/activeRideNavigationOrigin';
import { useActiveRideNavigation } from '../src/features/ride/activeRideNavigation';
```

- [ ] **Step 2: Remove local route geometry and reroute constants**

Delete from `app/index.tsx`:

```ts
const OFF_ROUTE_DISTANCE_METERS = 75;
const REROUTE_COOLDOWN_MS = 30_000;
```

Delete the local `distanceBetweenCoordinates()` and `distanceToRouteMeters()` functions at `app/index.tsx:161-230`.

- [ ] **Step 3: Replace route navigation refs and state**

In `HomeScreen`, delete:

```ts
const lastRouteOriginRef = useRef<RouteCoordinate | null>(null);
const rerouteInFlightRef = useRef(false);
const lastRerouteAtRef = useRef(0);
```

Delete these state declarations:

```ts
const [isRoutePlannerOpen, setIsRoutePlannerOpen] = useState(false);
const [destinationInput, setDestinationInput] = useState('');
const [destinationOptions, setDestinationOptions] = useState<
  DestinationOption[]
>([]);
const [recentRouteDestinations, setRecentRouteDestinations] = useState<
  DestinationOption[]
>([]);
const [routeSearchOrigin, setRouteSearchOrigin] =
  useState<RouteCoordinate | null>(null);
const [plannedRoute, setPlannedRoute] = useState<PlannedRoute | null>(null);
const [selectedDestination, setSelectedDestination] =
  useState<DestinationOption | null>(null);
const [isSearchingDestinations, setIsSearchingDestinations] = useState(false);
const [isPlanningRoute, setIsPlanningRoute] = useState(false);
const [routePlanError, setRoutePlanError] = useState<string | null>(null);
```

Add after `const recorder = useForegroundRideRecorder(settings);`:

```ts
const activeRideNavigationOriginRef =
  useRef<ReturnType<typeof createExpoRouteOriginAdapter> | null>(null);

if (!activeRideNavigationOriginRef.current) {
  activeRideNavigationOriginRef.current = createExpoRouteOriginAdapter();
}

const activeRideNavigationAdapters = useMemo(
  () =>
    createActiveRideNavigationAdapters({
      origin: activeRideNavigationOriginRef.current!,
    }),
  [],
);
const activeRideNavigation = useActiveRideNavigation({
  adapters: activeRideNavigationAdapters,
  rideStatus: recorder.status,
  routePoints: recorder.routePoints,
  currentCoordinate: recorder.currentCoordinate,
  routeProfile: settings.routeProfile,
});
const {
  destinationInput,
  destinationOptions,
  recentDestinations,
  plannedRoute,
  isPlannerOpen: isRoutePlannerOpen,
  routePlanError,
  isSearchingDestinations,
  isPlanningRoute,
} = activeRideNavigation;
```

- [ ] **Step 4: Replace derived navigation values**

Replace:

```ts
const visibleRecentRouteDestinations =
  destinationOptions.length === 0 && !isSearchingDestinations
    ? recentRouteDestinations
    : [];
```

with:

```ts
const visibleRecentRouteDestinations =
  destinationOptions.length === 0 && !isSearchingDestinations
    ? recentDestinations
    : [];
```

- [ ] **Step 5: Replace planner keyboard and recents effects**

Keep the keyboard-height effect, but its dependency remains `isRoutePlannerOpen`.

Delete the effect that calls `loadRecentRouteDestinations()` at `app/index.tsx:779-797`, because `activeRideNavigation.openPlanner()` now loads recents.

Replace the reroute effect body at `app/index.tsx:799-867` with:

```ts
useEffect(() => {
  activeRideNavigation.maybeReroute().catch(() => undefined);
}, [
  activeRideNavigation.maybeReroute,
  plannedRoute,
  recorder.currentCoordinate,
  recorder.routePoints,
  recorder.status,
  settings.routeProfile,
]);
```

- [ ] **Step 6: Replace route action functions**

Delete `getRouteOrigin`, `handleSearchDestinations`, and `handleSelectDestination`.

Replace local functions with:

```ts
function clearDestinationInput() {
  activeRideNavigation.clearDestinationInput();
  destinationInputRef.current?.focus();
}

function closeRoutePlanner() {
  Keyboard.dismiss();
  setRoutePlannerKeyboardHeight(0);
  activeRideNavigation.closePlanner();
}

function openRoutePlanner() {
  activeRideNavigation.openPlanner().catch(() => undefined);
}

function handleSearchDestinations() {
  Keyboard.dismiss();
  activeRideNavigation.searchDestinations().catch(() => undefined);
}

function handleSelectDestination(destination: DestinationOption) {
  Keyboard.dismiss();
  activeRideNavigation.selectDestination(destination).catch(() => undefined);
}

function cancelNavigation() {
  activeRideNavigation.cancelNavigation();
}
```

Delete `rememberRecentRouteDestination`.

- [ ] **Step 7: Replace TextInput and button event wiring**

Replace the `TextInput` `onChangeText` prop:

```tsx
onChangeText={(value) => {
  setDestinationInput(value);
  setDestinationOptions([]);
  setRoutePlanError(null);
}}
```

with:

```tsx
onChangeText={activeRideNavigation.setDestinationInput}
```

Search for `setIsRoutePlannerOpen(true)` or route planner open call sites. Replace each with:

```ts
openRoutePlanner();
```

If there is no helper and only inline UI opening exists, use:

```tsx
onPress={openRoutePlanner}
```

- [ ] **Step 8: Run typecheck and apply the reference map**

Run:

```bash
npm run typecheck
```

Expected: PASS.

If TypeScript reports a stale Active Ride Navigation reference, use this exact replacement map and rerun `npm run typecheck`:

```ts
// stale local value -> replacement
recentRouteDestinations -> recentDestinations
isRoutePlannerOpen -> isRoutePlannerOpen // already destructured from activeRideNavigation
destinationInput -> destinationInput // already destructured from activeRideNavigation
destinationOptions -> destinationOptions // already destructured from activeRideNavigation
plannedRoute -> plannedRoute // already destructured from activeRideNavigation
routePlanError -> routePlanError // already destructured from activeRideNavigation
setDestinationInput(value) -> activeRideNavigation.setDestinationInput(value)
setDestinationOptions([]) -> remove; setDestinationInput/clearDestinationInput clear options
setRoutePlanError(null) -> remove; activeRideNavigation actions clear errors
setPlannedRoute(null) -> activeRideNavigation.cancelNavigation()
setSelectedDestination(null) -> activeRideNavigation.cancelNavigation()
routeSearchOrigin -> remove; it is internal to activeRideNavigation
```

- [ ] **Step 9: Run focused tests and typecheck**

Run:

```bash
npm test -- src/features/ride/activeRideNavigation.test.ts src/features/ride/activeRideNavigationOrigin.test.ts src/features/ride/activeRideNavigationAdapters.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add app/index.tsx
git commit -m "Use active ride navigation in home route"
```

---

### Task 6: Full Verification And Cleanup

**Files:**
- Modify only if verification exposes a necessary behavior-preserving fix.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run format check**

Run:

```bash
npm run format:check
```

Expected: PASS. If it fails, run:

```bash
npm run format
npm run format:check
```

Expected after formatting: PASS.

- [ ] **Step 5: Confirm Home no longer imports routePlanning directly**

Run:

```bash
rg -n "routePlanning|planBikeRoute|searchBikeDestinations|loadRecentRouteDestinations|saveRecentRouteDestinations|getUpdatedRecentRouteDestinations" app/index.tsx
```

Expected: no matches.

- [ ] **Step 6: Confirm Active Ride Navigation owns route behavior**

Run:

```bash
rg -n "OFF_ROUTE_DISTANCE_METERS|REROUTE_COOLDOWN_MS|distanceToRouteMeters|routeSearchOrigin|lastRouteOriginRef|lastRerouteAtRef|rerouteInFlightRef" app/index.tsx src/features/ride
```

Expected: matches only in `src/features/ride/activeRideNavigation.ts` or its tests, plus no stale matches in `app/index.tsx`.

- [ ] **Step 7: Commit verification fixes if needed**

If verification required code or formatting changes, commit them:

```bash
git add app/index.tsx src/features/ride
git commit -m "Verify active ride navigation integration"
```

If no files changed, do not create an empty commit.
