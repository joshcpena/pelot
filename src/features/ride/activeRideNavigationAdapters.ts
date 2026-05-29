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
