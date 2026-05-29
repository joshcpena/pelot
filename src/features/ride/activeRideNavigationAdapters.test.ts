import { describe, expect, it, vi } from 'vitest';

import type { ActiveRideNavigationOriginAdapter } from './activeRideNavigation';
import { createActiveRideNavigationAdapters } from './activeRideNavigationAdapters';

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn(),
}));

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
