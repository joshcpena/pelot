import { describe, expect, it } from 'vitest';

import {
  buildRideSplits,
  calculateMetricsFromPoints,
  type RidePauseInterval,
} from './rideCalculations';
import type { RidePoint } from './types';

const BASE_TIME = 1_700_000_000_000;
const EARTH_RADIUS_METERS = 6_371_000;

function point(
  seconds: number,
  metersEast: number,
  overrides: Partial<RidePoint> = {},
): RidePoint {
  return {
    recordedAt: BASE_TIME + seconds * 1000,
    latitude: 0,
    longitude: (metersEast / EARTH_RADIUS_METERS) * (180 / Math.PI),
    altitude: null,
    speedMps: null,
    heading: null,
    horizontalAccuracy: null,
    verticalAccuracy: null,
    ...overrides,
  };
}

function pause(startSeconds: number, endSeconds: number): RidePauseInterval {
  return {
    startedAt: BASE_TIME + startSeconds * 1000,
    endedAt: BASE_TIME + endSeconds * 1000,
  };
}

describe('calculateMetricsFromPoints', () => {
  it('uses unpaused moving time for average speed', () => {
    const metrics = calculateMetricsFromPoints([
      point(0, 0),
      point(10, 100),
      point(20, 250),
      point(30, 450),
    ]);

    expect(metrics.elapsedSeconds).toBe(30);
    expect(metrics.movingSeconds).toBe(30);
    expect(metrics.distanceMeters).toBeCloseTo(450, 6);
    expect(metrics.averageSpeedMps).toBeCloseTo(15, 6);
    expect(metrics.maxSpeedMps).toBeCloseTo(20, 6);
  });

  it('excludes segments that overlap a pause interval', () => {
    const metrics = calculateMetricsFromPoints(
      [point(0, 0), point(10, 100), point(20, 200)],
      [pause(10, 20)],
    );

    expect(metrics.elapsedSeconds).toBe(20);
    expect(metrics.movingSeconds).toBe(10);
    expect(metrics.distanceMeters).toBeCloseTo(100, 6);
    expect(metrics.averageSpeedMps).toBeCloseTo(10, 6);
  });
});

describe('buildRideSplits', () => {
  it('carries distance overshoot into following splits', () => {
    const splits = buildRideSplits([point(0, 0), point(100, 250)], {
      splitType: 'distance',
      splitDistanceMeters: 100,
      splitDurationSeconds: 60,
    });

    expect(splits).toHaveLength(3);
    expect(splits[0].distanceMeters).toBeCloseTo(100, 6);
    expect(splits[0].durationSeconds).toBe(40);
    expect(splits[0].averageSpeedMps).toBeCloseTo(2.5, 6);
    expect(splits[1].distanceMeters).toBeCloseTo(100, 6);
    expect(splits[1].durationSeconds).toBe(40);
    expect(splits[2].distanceMeters).toBeCloseTo(50, 6);
    expect(splits[2].durationSeconds).toBe(20);
  });

  it('carries time overshoot into following splits', () => {
    const splits = buildRideSplits([point(0, 0), point(150, 300)], {
      splitType: 'time',
      splitDistanceMeters: 1000,
      splitDurationSeconds: 60,
    });

    expect(splits).toHaveLength(3);
    expect(splits[0].durationSeconds).toBe(60);
    expect(splits[0].distanceMeters).toBeCloseTo(120, 6);
    expect(splits[1].durationSeconds).toBe(60);
    expect(splits[1].distanceMeters).toBeCloseTo(120, 6);
    expect(splits[2].durationSeconds).toBe(30);
    expect(splits[2].distanceMeters).toBeCloseTo(60, 6);
  });

  it('does not include paused segments in split progress', () => {
    const splits = buildRideSplits(
      [point(0, 0), point(10, 100), point(20, 200), point(30, 300)],
      {
        splitType: 'distance',
        splitDistanceMeters: 100,
        splitDurationSeconds: 60,
      },
      [pause(10, 20)],
    );

    expect(splits).toHaveLength(2);
    expect(splits[0].distanceMeters).toBeCloseTo(100, 6);
    expect(splits[0].durationSeconds).toBe(10);
    expect(splits[1].distanceMeters).toBeCloseTo(100, 6);
    expect(splits[1].durationSeconds).toBe(10);
  });
});
