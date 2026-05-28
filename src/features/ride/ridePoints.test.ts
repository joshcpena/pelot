import { describe, expect, it } from 'vitest';

import {
  areRidePointListsEqual,
  areRidePointsEqual,
  mergeRidePoints,
} from './ridePoints';
import type { RidePoint } from './types';

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

describe('mergeRidePoints', () => {
  it('sorts merged foreground and background points chronologically', () => {
    const merged = mergeRidePoints(
      [
        point({ recordedAt: 3000, latitude: 3 }),
        point({ recordedAt: 1000, latitude: 1 }),
      ],
      [point({ recordedAt: 2000, latitude: 2 })],
    );

    expect(merged.map((item) => item.recordedAt)).toEqual([1000, 2000, 3000]);
  });

  it('replaces exact duplicate keys with the later list point', () => {
    const merged = mergeRidePoints(
      [point({ recordedAt: 2000, latitude: 1, longitude: 1, altitude: 10 })],
      [point({ recordedAt: 2000, latitude: 1, longitude: 1, altitude: 12 })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].altitude).toBe(12);
  });

  it('keeps same-timestamp points with different coordinates distinct', () => {
    const merged = mergeRidePoints([
      point({ recordedAt: 2000, latitude: 1, longitude: 1 }),
      point({ recordedAt: 2000, latitude: 1.0001, longitude: 1 }),
    ]);

    expect(merged).toHaveLength(2);
  });
});

describe('ride point equality', () => {
  it('compares all ride point fields', () => {
    const first = point({ recordedAt: 1000, latitude: 1, altitude: 10 });
    const second = point({ recordedAt: 1000, latitude: 1, altitude: 10 });
    const third = point({ recordedAt: 1000, latitude: 1, altitude: 11 });

    expect(areRidePointsEqual(first, second)).toBe(true);
    expect(areRidePointsEqual(first, third)).toBe(false);
    expect(areRidePointListsEqual([first], [second])).toBe(true);
    expect(areRidePointListsEqual([first], [third])).toBe(false);
  });
});
