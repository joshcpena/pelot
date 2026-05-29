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

  it('counts overlapping manual and auto pauses once for total and lap timing', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.setAutoPaused(true, BASE_TIME + 10_000);
    accumulator.beginManualPause(BASE_TIME + 20_000);
    accumulator.refreshTiming(BASE_TIME + 25_000);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 25,
      pausedSeconds: 15,
      movingSeconds: 10,
      lapElapsedSeconds: 25,
      lapPausedSeconds: 15,
      lapMovingSeconds: 10,
    });
    expect(accumulator.getPauseIntervals(BASE_TIME + 25_000)).toEqual([
      { startedAt: BASE_TIME + 10_000, endedAt: BASE_TIME + 25_000 },
    ]);

    accumulator.setAutoPaused(false, BASE_TIME + 30_000);
    accumulator.refreshTiming(BASE_TIME + 35_000);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 35,
      pausedSeconds: 25,
      movingSeconds: 10,
      lapElapsedSeconds: 35,
      lapPausedSeconds: 25,
      lapMovingSeconds: 10,
    });
    expect(accumulator.getPauseIntervals(BASE_TIME + 35_000)).toEqual([
      { startedAt: BASE_TIME + 10_000, endedAt: BASE_TIME + 35_000 },
    ]);

    accumulator.endManualPause(BASE_TIME + 40_000);
    accumulator.refreshTiming(BASE_TIME + 50_000);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 50,
      pausedSeconds: 30,
      movingSeconds: 20,
      lapElapsedSeconds: 50,
      lapPausedSeconds: 30,
      lapMovingSeconds: 20,
    });
    expect(accumulator.getPauseIntervals()).toEqual([
      { startedAt: BASE_TIME + 10_000, endedAt: BASE_TIME + 40_000 },
    ]);
  });

  it('preserves positive sub-second pauses when they merge into longer intervals', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.setAutoPaused(true, BASE_TIME + 10_250);
    accumulator.setAutoPaused(false, BASE_TIME + 10_750);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 10,
      pausedSeconds: 0,
      movingSeconds: 10,
      lapElapsedSeconds: 10,
      lapPausedSeconds: 0,
      lapMovingSeconds: 10,
    });
    expect(accumulator.getPauseIntervals()).toEqual([
      { startedAt: BASE_TIME + 10_250, endedAt: BASE_TIME + 10_750 },
    ]);

    accumulator.beginManualPause(BASE_TIME + 10_500);
    accumulator.endManualPause(BASE_TIME + 12_000);

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 12,
      pausedSeconds: 1,
      movingSeconds: 11,
      lapElapsedSeconds: 12,
      lapPausedSeconds: 1,
      lapMovingSeconds: 11,
    });
    expect(accumulator.getPauseIntervals()).toEqual([
      { startedAt: BASE_TIME + 10_250, endedAt: BASE_TIME + 12_000 },
    ]);
  });

  it('clears auto pause state when finishing while auto-paused', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings(),
      startedAt: BASE_TIME,
    });

    accumulator.setAutoPaused(true, BASE_TIME + 10_000);
    const snapshot = accumulator.finish(BASE_TIME + 40_000);

    expect(snapshot.metrics).toMatchObject({
      elapsedSeconds: 40,
      pausedSeconds: 30,
      movingSeconds: 10,
      lapElapsedSeconds: 40,
      lapPausedSeconds: 30,
      lapMovingSeconds: 10,
    });
    expect(snapshot.pauseIntervals).toEqual([
      { startedAt: BASE_TIME + 10_000, endedAt: BASE_TIME + 40_000 },
    ]);
    expect(accumulator.getIsAutoPaused()).toBe(false);
    expect(accumulator.getPauseIntervals(BASE_TIME + 50_000)).toEqual([
      { startedAt: BASE_TIME + 10_000, endedAt: BASE_TIME + 40_000 },
    ]);
  });
});
