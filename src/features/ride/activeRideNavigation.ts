import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
      return;
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
    const recentDestinations = adapters.recents.getUpdated(
      destination,
      state.recentDestinations,
    );

    patchState({ recentDestinations });
    adapters.recents.save(recentDestinations).catch(() => undefined);
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

export function useActiveRideNavigation({
  adapters,
  rideStatus,
  routePoints,
  currentCoordinate,
  routeProfile,
}: {
  adapters: ActiveRideNavigationAdapters;
  rideStatus: RideStatus;
  routePoints: RidePoint[];
  currentCoordinate: RouteCoordinate | null;
  routeProfile: RouteProfile;
}): ActiveRideNavigationController {
  const snapshot = useMemo(
    () => ({
      rideStatus,
      routePoints,
      currentCoordinate,
      routeProfile,
    }),
    [rideStatus, routePoints, currentCoordinate, routeProfile],
  );
  const controllerRef = useRef<ActiveRideNavigationControllerInternal | null>(
    null,
  );
  const [state, setState] = useState<ActiveRideNavigationState>(
    initialActiveRideNavigationState,
  );

  if (controllerRef.current == null) {
    controllerRef.current = createActiveRideNavigationController({
      adapters,
      snapshot,
      onChange: setState,
    });
  }

  useEffect(() => {
    controllerRef.current?.updateSnapshot(snapshot);
  }, [snapshot]);

  const setDestinationInput = useCallback((value: string) => {
    controllerRef.current?.setDestinationInput(value);
  }, []);

  const openPlanner = useCallback(
    () => controllerRef.current?.openPlanner() ?? Promise.resolve(),
    [],
  );

  const closePlanner = useCallback(() => {
    controllerRef.current?.closePlanner();
  }, []);

  const searchDestinations = useCallback(
    () => controllerRef.current?.searchDestinations() ?? Promise.resolve(),
    [],
  );

  const clearDestinationInput = useCallback(() => {
    controllerRef.current?.clearDestinationInput();
  }, []);

  const selectDestination = useCallback(
    (destination: DestinationOption) =>
      controllerRef.current?.selectDestination(destination) ??
      Promise.resolve(),
    [],
  );

  const cancelNavigation = useCallback(() => {
    controllerRef.current?.cancelNavigation();
  }, []);

  const maybeReroute = useCallback(
    () => controllerRef.current?.maybeReroute() ?? Promise.resolve(),
    [],
  );

  return useMemo(
    () => ({
      ...state,
      setDestinationInput,
      openPlanner,
      closePlanner,
      searchDestinations,
      clearDestinationInput,
      selectDestination,
      cancelNavigation,
      maybeReroute,
    }),
    [
      state,
      setDestinationInput,
      openPlanner,
      closePlanner,
      searchDestinations,
      clearDestinationInput,
      selectDestination,
      cancelNavigation,
      maybeReroute,
    ],
  );
}
