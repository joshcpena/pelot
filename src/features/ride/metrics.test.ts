import { describe, expect, it } from 'vitest';

import {
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  positiveElevationGainMeters,
} from './metrics';
import type { RidePoint } from './types';

function ridePoint(overrides: Partial<RidePoint> = {}): RidePoint {
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

describe('ride metric formatting', () => {
  it('formats elapsed durations without an hour prefix until needed', () => {
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('formats distance and speed in the selected unit system', () => {
    expect(formatDistance(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatDistance(1000, 'metric')).toBe('1.00 km');
    expect(formatSpeed(10, 'imperial')).toBe('22.4 mph');
    expect(formatSpeed(10, 'metric')).toBe('36.0 km/h');
  });

  it('formats missing pace as a placeholder', () => {
    expect(formatPace(0, 'imperial')).toBe('--');
    expect(formatPace(-1, 'metric')).toBe('--');
  });

  it('carries rounded pace seconds into the next minute', () => {
    const metersPerSecond = 1609.344 / 479.6;

    expect(formatPace(metersPerSecond, 'imperial')).toBe('8:00 /mi');
  });
});

describe('elevation gain', () => {
  it('ignores small altitude changes as noise', () => {
    expect(
      positiveElevationGainMeters(
        ridePoint({ altitude: 100 }),
        ridePoint({ altitude: 102.9 }),
      ),
    ).toBe(0);
  });

  it('counts positive gains at or above the threshold', () => {
    expect(
      positiveElevationGainMeters(
        ridePoint({ altitude: 100 }),
        ridePoint({ altitude: 103 }),
      ),
    ).toBe(3);
  });

  it('ignores points without altitude data', () => {
    expect(
      positiveElevationGainMeters(
        ridePoint({ altitude: 100 }),
        ridePoint({ altitude: null }),
      ),
    ).toBe(0);
  });
});
