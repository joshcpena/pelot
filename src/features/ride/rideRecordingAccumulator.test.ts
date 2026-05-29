import { describe, expect, it } from 'vitest';

import {
  createRideRecordingAccumulator,
  initialRideRecordingMetrics,
} from './rideRecordingAccumulator';
import type { RidePoint, RideSettings } from './types';

const BASE_TIME = 1_700_000_000_000;

function settings(overrides: Partial<RideSettings> = {}): RideSettings {
  return {
    hasCompletedWelcome: true,
    unitSystem: 'imperial',
    keepAwakeDuringRide: true,
    autoDimScreen: false,
    autoPause: true,
    autoLap: true,
    ascentSource: 'gps-only',
    gpsAccuracy: 'standard',
    splitType: 'distance',
    splitDistanceMeters: 1000,
    splitDurationSeconds: 60,
    theme: 'system',
    mapType: 'standard',
    routeProfile: 'bike',
    dashboardLayout: [],
    dashboardScreens: [],
    connectedHeartRateDevice: null,
    riderWeightKg: null,
    riderHeightCm: null,
    riderAgeYears: null,
    riderMaxHeartRateBpm: null,
    riderSex: null,
    ...overrides,
  };
}

function point(seconds: number, overrides: Partial<RidePoint> = {}): RidePoint {
  return {
    recordedAt: BASE_TIME + seconds * 1000,
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

describe('ride recording accumulator timing', () => {
  it('starts with the existing initial ride metrics shape', () => {
    expect(initialRideRecordingMetrics).toEqual({
      startedAt: null,
      elapsedSeconds: 0,
      movingSeconds: 0,
      pausedSeconds: 0,
      distanceMeters: 0,
      ascentMeters: 0,
      activeCaloriesKcal: null,
      currentSpeedMps: 0,
      averageSpeedMps: 0,
      maxSpeedMps: 0,
      lapNumber: 1,
      lapStartedAt: null,
      lapElapsedSeconds: 0,
      lapPausedSeconds: 0,
      lapMovingSeconds: 0,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapActiveCaloriesKcal: null,
      lapAverageSpeedMps: 0,
      lapMaxSpeedMps: 0,
    });

    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    expect(accumulator.getMetrics()).toMatchObject({
      startedAt: BASE_TIME,
      lapStartedAt: BASE_TIME,
      lapNumber: 1,
      elapsedSeconds: 0,
      movingSeconds: 0,
      pausedSeconds: 0,
      lapElapsedSeconds: 0,
      lapMovingSeconds: 0,
      lapPausedSeconds: 0,
    });
    expect(accumulator.getRoutePoints()).toEqual([]);
    expect(accumulator.getCurrentCoordinate()).toBeNull();
    expect(accumulator.getPauseIntervals(BASE_TIME)).toEqual([]);
  });

  it('refreshes elapsed and moving time from the live clock', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.refreshTiming(BASE_TIME + 75_500);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 75,
      movingSeconds: 75,
      pausedSeconds: 0,
      lapElapsedSeconds: 75,
      lapMovingSeconds: 75,
      lapPausedSeconds: 0,
    });
  });

  it('commits manual pause intervals into total and lap paused time', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.refreshTiming(BASE_TIME + 10_000);
    accumulator.beginManualPause(BASE_TIME + 10_000);
    accumulator.refreshTiming(BASE_TIME + 25_000);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 25,
      movingSeconds: 10,
      pausedSeconds: 15,
      lapElapsedSeconds: 25,
      lapMovingSeconds: 10,
      lapPausedSeconds: 15,
    });

    accumulator.endManualPause(BASE_TIME + 30_000);
    accumulator.refreshTiming(BASE_TIME + 50_000);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 50,
      movingSeconds: 30,
      pausedSeconds: 20,
      lapElapsedSeconds: 50,
      lapMovingSeconds: 30,
      lapPausedSeconds: 20,
    });
    expect(accumulator.getPauseIntervals()).toEqual([
      { startedAt: BASE_TIME + 10_000, endedAt: BASE_TIME + 30_000 },
    ]);
  });

  it('scopes manual pause seconds to the current lap after markLap', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.beginManualPause(BASE_TIME + 10_000);
    accumulator.endManualPause(BASE_TIME + 20_000);
    accumulator.markLap(BASE_TIME + 30_000);
    accumulator.beginManualPause(BASE_TIME + 35_000);
    accumulator.refreshTiming(BASE_TIME + 45_000);

    expect(accumulator.getMetrics()).toMatchObject({
      lapNumber: 2,
      elapsedSeconds: 45,
      pausedSeconds: 20,
      movingSeconds: 25,
      lapElapsedSeconds: 15,
      lapPausedSeconds: 10,
      lapMovingSeconds: 5,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapAverageSpeedMps: 0,
      lapMaxSpeedMps: 0,
      lapActiveCaloriesKcal: 0,
    });
  });
});
