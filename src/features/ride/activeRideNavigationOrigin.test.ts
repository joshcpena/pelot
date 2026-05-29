import { describe, expect, it, vi } from 'vitest';

import {
  ACTIVE_RIDE_NAVIGATION_LOCATION_PERMISSION_ERROR,
  type ActiveRideNavigationSnapshot,
} from './activeRideNavigation';
import { createExpoRouteOriginAdapter } from './activeRideNavigationOrigin';

vi.mock('expo-location', () => ({
  Accuracy: { High: 6 },
  PermissionStatus: { GRANTED: 'granted' },
  requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
  getLastKnownPositionAsync: async () => null,
  getCurrentPositionAsync: async () => ({
    coords: { latitude: 0, longitude: 0 },
  }),
}));

type LocationPosition = {
  coords: {
    latitude: number;
    longitude: number;
  };
};

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
    getLastKnownPositionAsync: vi.fn(
      async (): Promise<LocationPosition | null> => null,
    ),
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
