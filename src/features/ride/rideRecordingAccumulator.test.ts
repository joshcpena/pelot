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

const EARTH_RADIUS_METERS = 6_371_000;

function pointAtMeters(
  seconds: number,
  metersEast: number,
  overrides: Partial<RidePoint> = {},
): RidePoint {
  return point(seconds, {
    longitude: (metersEast / EARTH_RADIUS_METERS) * (180 / Math.PI),
    ...overrides,
  });
}

describe('ride point ingestion', () => {
  it('increments live route metrics for counted movement', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    expect(
      accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME),
    ).toMatchObject({
      didChangeRoutePoints: true,
      shouldPersistPoint: true,
      didAutoLap: false,
    });
    accumulator.ingestPoint(
      pointAtMeters(10, 100, { altitude: 10 }),
      BASE_TIME + 10_000,
    );
    accumulator.ingestPoint(
      pointAtMeters(20, 250, { altitude: 14 }),
      BASE_TIME + 20_000,
    );

    expect(accumulator.getRoutePoints()).toHaveLength(3);
    expect(accumulator.getCurrentCoordinate()).toEqual({
      latitude: 0,
      longitude: (250 / EARTH_RADIUS_METERS) * (180 / Math.PI),
    });
    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(250, 6);
    expect(accumulator.getMetrics().ascentMeters).toBe(4);
    expect(accumulator.getMetrics().movingSeconds).toBe(20);
    expect(accumulator.getMetrics().currentSpeedMps).toBeCloseTo(15, 6);
    expect(accumulator.getMetrics().averageSpeedMps).toBeCloseTo(12.5, 6);
    expect(accumulator.getMetrics().maxSpeedMps).toBeCloseTo(15, 6);
    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(250, 6);
    expect(accumulator.getMetrics().lapAscentMeters).toBe(4);
  });

  it('uses reported speed for current and max speed when present', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.ingestPoint(
      pointAtMeters(10, 100, { speedMps: 22 }),
      BASE_TIME + 10_000,
    );

    expect(accumulator.getMetrics().currentSpeedMps).toBe(22);
    expect(accumulator.getMetrics().maxSpeedMps).toBe(22);
  });

  it('replays zero reported speed with calculated speed like live ingestion', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });
    const routePoints = [
      pointAtMeters(0, 0),
      pointAtMeters(10, 100, { speedMps: 0 }),
    ];

    accumulator.ingestPoint(routePoints[0], BASE_TIME);
    accumulator.ingestPoint(routePoints[1], BASE_TIME + 10_000);

    const liveCurrentSpeedMps = accumulator.getMetrics().currentSpeedMps;
    const liveMaxSpeedMps = accumulator.getMetrics().maxSpeedMps;

    expect(liveCurrentSpeedMps).toBeCloseTo(10, 6);
    expect(liveMaxSpeedMps).toBeCloseTo(10, 6);

    accumulator.replacePointsFromPersistence(routePoints, BASE_TIME + 10_000);

    expect(accumulator.getMetrics().currentSpeedMps).toBeCloseTo(
      liveCurrentSpeedMps,
      6,
    );
    expect(accumulator.getMetrics().maxSpeedMps).toBeCloseTo(
      liveMaxSpeedMps,
      6,
    );
  });

  it('does not count the segment that enters or leaves auto-pause', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: true }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.ingestPoint(
      pointAtMeters(10, 2, { speedMps: 0.2 }),
      BASE_TIME + 10_000,
    );

    expect(accumulator.getIsAutoPaused()).toBe(true);
    expect(accumulator.getMetrics().distanceMeters).toBe(0);
    expect(accumulator.getMetrics().movingSeconds).toBe(0);
    expect(accumulator.getMetrics().pausedSeconds).toBe(10);

    accumulator.ingestPoint(
      pointAtMeters(20, 102, { speedMps: 10 }),
      BASE_TIME + 20_000,
    );

    expect(accumulator.getIsAutoPaused()).toBe(false);
    expect(accumulator.getMetrics().distanceMeters).toBe(0);
    expect(accumulator.getPauseIntervals()).toEqual([
      { startedAt: BASE_TIME, endedAt: BASE_TIME + 20_000 },
    ]);

    accumulator.ingestPoint(
      pointAtMeters(30, 202, { speedMps: 10 }),
      BASE_TIME + 30_000,
    );

    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(100, 6);
    expect(accumulator.getMetrics().movingSeconds).toBe(10);
  });

  it('marks laps manually and through distance and time auto-lap rules', () => {
    const distanceAccumulator = createRideRecordingAccumulator({
      settings: settings({
        autoPause: false,
        autoLap: true,
        splitType: 'distance',
        splitDistanceMeters: 100,
      }),
      startedAt: BASE_TIME,
    });

    distanceAccumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    const distanceResult = distanceAccumulator.ingestPoint(
      pointAtMeters(10, 110),
      BASE_TIME + 10_000,
    );

    expect(distanceResult.didAutoLap).toBe(true);
    expect(distanceAccumulator.getMetrics()).toMatchObject({
      lapNumber: 2,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapMovingSeconds: 0,
    });

    const timeAccumulator = createRideRecordingAccumulator({
      settings: settings({
        autoPause: false,
        autoLap: true,
        splitType: 'time',
        splitDurationSeconds: 10,
      }),
      startedAt: BASE_TIME,
    });

    expect(timeAccumulator.refreshTiming(BASE_TIME + 10_000)).toEqual({
      didAutoLap: true,
    });

    expect(timeAccumulator.getMetrics()).toMatchObject({
      lapNumber: 2,
      lapElapsedSeconds: 0,
      lapMovingSeconds: 0,
    });

    timeAccumulator.markLap(BASE_TIME + 20_000);

    expect(timeAccumulator.getMetrics()).toMatchObject({
      lapNumber: 3,
      lapStartedAt: BASE_TIME + 20_000,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapAverageSpeedMps: 0,
      lapMaxSpeedMps: 0,
    });
  });

  it('does not bridge distance across a manual pause resume', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.beginManualPause(BASE_TIME + 5_000);
    accumulator.endManualPause(BASE_TIME + 20_000);
    accumulator.ingestPoint(pointAtMeters(30, 300), BASE_TIME + 30_000);

    expect(accumulator.getMetrics().distanceMeters).toBe(0);
    expect(accumulator.getMetrics().lapDistanceMeters).toBe(0);

    accumulator.ingestPoint(pointAtMeters(40, 400), BASE_TIME + 40_000);

    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(100, 6);
    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(100, 6);
  });

  it('preserves manual pause baseline reset across replay before resume movement', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    const prePausePoint = pointAtMeters(0, 0);
    const replayedPrePausePoint = pointAtMeters(10, 100);

    accumulator.ingestPoint(prePausePoint, BASE_TIME);
    accumulator.ingestPoint(replayedPrePausePoint, BASE_TIME + 10_000);
    accumulator.beginManualPause(BASE_TIME + 15_000);
    accumulator.endManualPause(BASE_TIME + 30_000);
    accumulator.replacePointsFromPersistence(
      [prePausePoint, replayedPrePausePoint],
      BASE_TIME + 35_000,
    );
    accumulator.ingestPoint(pointAtMeters(40, 400), BASE_TIME + 40_000);

    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(100, 6);
    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(100, 6);

    accumulator.ingestPoint(pointAtMeters(50, 500), BASE_TIME + 50_000);

    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(200, 6);
    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(200, 6);
  });

  it('uses replayed post-resume points as the manual pause baseline', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    const prePausePoint = pointAtMeters(0, 0);
    const replayedPrePausePoint = pointAtMeters(10, 100);
    const replayedPostResumePoint = pointAtMeters(40, 400);

    accumulator.ingestPoint(prePausePoint, BASE_TIME);
    accumulator.ingestPoint(replayedPrePausePoint, BASE_TIME + 10_000);
    accumulator.beginManualPause(BASE_TIME + 15_000);
    accumulator.endManualPause(BASE_TIME + 30_000);
    accumulator.replacePointsFromPersistence(
      [prePausePoint, replayedPrePausePoint, replayedPostResumePoint],
      BASE_TIME + 45_000,
    );

    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(100, 6);

    accumulator.ingestPoint(pointAtMeters(50, 500), BASE_TIME + 50_000);

    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(200, 6);
    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(200, 6);
  });

  it('resets route metrics when replay replaces movement with one point', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.ingestPoint(
      pointAtMeters(10, 100, { altitude: 10 }),
      BASE_TIME + 10_000,
    );
    accumulator.ingestPoint(
      pointAtMeters(20, 200, { altitude: 14 }),
      BASE_TIME + 20_000,
    );

    accumulator.replacePointsFromPersistence(
      [pointAtMeters(30, 300, { altitude: 20, speedMps: 7 })],
      BASE_TIME + 40_000,
    );

    expect(accumulator.getRoutePoints()).toHaveLength(1);
    expect(accumulator.getCurrentCoordinate()).toEqual({
      latitude: 0,
      longitude: (300 / EARTH_RADIUS_METERS) * (180 / Math.PI),
    });
    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 40,
      movingSeconds: 40,
      distanceMeters: 0,
      ascentMeters: 0,
      currentSpeedMps: 7,
      averageSpeedMps: 0,
      maxSpeedMps: 0,
      lapDistanceMeters: 0,
      lapAscentMeters: 0,
      lapAverageSpeedMps: 0,
      lapMaxSpeedMps: 0,
    });
  });

  it('replays metrics when inserting a non-chronological point', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0, { altitude: 0 }), BASE_TIME);
    accumulator.ingestPoint(
      pointAtMeters(20, 200, { altitude: 0 }),
      BASE_TIME + 20_000,
    );

    expect(
      accumulator.ingestPoint(
        pointAtMeters(10, 250, { altitude: 10 }),
        BASE_TIME + 30_000,
      ),
    ).toEqual({
      didChangeRoutePoints: true,
      shouldPersistPoint: true,
      didAutoLap: false,
    });

    expect(
      accumulator.getRoutePoints().map((routePoint) => routePoint.recordedAt),
    ).toEqual([BASE_TIME, BASE_TIME + 10_000, BASE_TIME + 20_000]);
    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(300, 6);
    expect(accumulator.getMetrics().ascentMeters).toBe(10);
  });

  it('ignores exact duplicate points without persistence', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });
    const firstPoint = pointAtMeters(0, 0);

    accumulator.ingestPoint(firstPoint, BASE_TIME);

    expect(accumulator.ingestPoint(firstPoint, BASE_TIME + 1_000)).toEqual({
      didChangeRoutePoints: false,
      shouldPersistPoint: false,
      didAutoLap: false,
    });
    expect(accumulator.getRoutePoints()).toHaveLength(1);
  });

  it('keeps live timing when replay point span is shorter than now', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.replacePointsFromPersistence(
      [pointAtMeters(0, 0), pointAtMeters(10, 100)],
      BASE_TIME + 60_000,
    );

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 60,
      movingSeconds: 60,
      lapElapsedSeconds: 60,
      lapMovingSeconds: 60,
    });
  });

  it('does not auto-lap while replaying persisted points', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({
        autoPause: false,
        autoLap: true,
        splitType: 'distance',
        splitDistanceMeters: 100,
      }),
      startedAt: BASE_TIME,
    });

    expect(
      accumulator.replacePointsFromPersistence(
        [pointAtMeters(0, 0), pointAtMeters(10, 110)],
        BASE_TIME + 10_000,
      ),
    ).toEqual({ didAutoLap: false });

    expect(accumulator.getMetrics()).toMatchObject({
      lapNumber: 1,
    });
    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(110, 6);
  });

  it('replays manual lap boundary segments like live ingestion', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });
    const routePoints = [
      pointAtMeters(0, 0, { altitude: 0 }),
      pointAtMeters(10, 100, { altitude: 0 }),
      pointAtMeters(20, 250, { altitude: 4, speedMps: 0 }),
    ];

    accumulator.ingestPoint(routePoints[0], BASE_TIME);
    accumulator.ingestPoint(routePoints[1], BASE_TIME + 10_000);
    accumulator.markLap(BASE_TIME + 15_000);
    accumulator.ingestPoint(routePoints[2], BASE_TIME + 20_000);

    const liveMetrics = accumulator.getMetrics();

    expect(liveMetrics.lapDistanceMeters).toBeCloseTo(150, 6);
    expect(liveMetrics.lapAscentMeters).toBe(4);
    expect(liveMetrics.lapMaxSpeedMps).toBeCloseTo(15, 6);

    accumulator.replacePointsFromPersistence(routePoints, BASE_TIME + 30_000);

    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(
      liveMetrics.lapDistanceMeters,
      6,
    );
    expect(accumulator.getMetrics().lapAscentMeters).toBe(
      liveMetrics.lapAscentMeters,
    );
    expect(accumulator.getMetrics().lapMaxSpeedMps).toBeCloseTo(
      liveMetrics.lapMaxSpeedMps,
      6,
    );
  });

  it('anchors auto-pause entry at sample time so replay keeps stopped segment excluded', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: true }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(
      pointAtMeters(0, 0, { speedMps: 10 }),
      BASE_TIME + 500,
    );
    accumulator.ingestPoint(
      pointAtMeters(10, 2, { speedMps: 0.2 }),
      BASE_TIME + 10_500,
    );

    expect(accumulator.getIsAutoPaused()).toBe(true);
    expect(accumulator.getMetrics().distanceMeters).toBe(0);
    expect(accumulator.getPauseIntervals(BASE_TIME + 10_500)).toEqual([
      { startedAt: BASE_TIME, endedAt: BASE_TIME + 10_500 },
    ]);

    accumulator.replacePointsFromPersistence(
      [pointAtMeters(0, 0), pointAtMeters(10, 2, { speedMps: 0.2 })],
      BASE_TIME + 10_500,
    );

    expect(accumulator.getMetrics().distanceMeters).toBe(0);
    expect(accumulator.getPauseIntervals(BASE_TIME + 10_500)).toEqual([
      { startedAt: BASE_TIME, endedAt: BASE_TIME + 10_500 },
    ]);
  });

  it('anchors auto-pause exit at sample time so replay keeps resumed movement', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: true }),
      startedAt: BASE_TIME,
    });
    const routePoints = [
      pointAtMeters(0, 0, { speedMps: 10 }),
      pointAtMeters(10, 2, { speedMps: 0.2 }),
      pointAtMeters(20, 102, { speedMps: 10 }),
      pointAtMeters(30, 202, { speedMps: 10 }),
    ];

    accumulator.ingestPoint(routePoints[0], BASE_TIME + 500);
    accumulator.ingestPoint(routePoints[1], BASE_TIME + 10_500);
    accumulator.ingestPoint(routePoints[2], BASE_TIME + 20_500);
    accumulator.ingestPoint(routePoints[3], BASE_TIME + 30_500);

    expect(accumulator.getIsAutoPaused()).toBe(false);
    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(100, 6);
    expect(accumulator.getPauseIntervals(BASE_TIME + 30_500)).toEqual([
      { startedAt: BASE_TIME, endedAt: BASE_TIME + 20_000 },
    ]);

    accumulator.replacePointsFromPersistence(routePoints, BASE_TIME + 30_500);

    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(100, 6);
    expect(accumulator.getMetrics().lapDistanceMeters).toBeCloseTo(100, 6);
  });

  it('replays max speed from auto-pause boundary segments like live ingestion', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: true }),
      startedAt: BASE_TIME,
    });
    const routePoints = [
      pointAtMeters(0, 0, { speedMps: 10 }),
      pointAtMeters(10, 2, { speedMps: 0.2 }),
      pointAtMeters(20, 102, { speedMps: 18 }),
    ];

    accumulator.ingestPoint(routePoints[0], BASE_TIME);
    accumulator.ingestPoint(routePoints[1], BASE_TIME + 10_000);
    accumulator.ingestPoint(routePoints[2], BASE_TIME + 20_000);

    const liveMetrics = accumulator.getMetrics();

    expect(liveMetrics.distanceMeters).toBe(0);
    expect(liveMetrics.lapDistanceMeters).toBe(0);
    expect(liveMetrics.maxSpeedMps).toBe(18);
    expect(liveMetrics.lapMaxSpeedMps).toBe(18);

    accumulator.replacePointsFromPersistence(routePoints, BASE_TIME + 20_000);

    expect(accumulator.getMetrics().distanceMeters).toBe(0);
    expect(accumulator.getMetrics().lapDistanceMeters).toBe(0);
    expect(accumulator.getMetrics().maxSpeedMps).toBe(liveMetrics.maxSpeedMps);
    expect(accumulator.getMetrics().lapMaxSpeedMps).toBe(
      liveMetrics.lapMaxSpeedMps,
    );
  });
});

describe('persisted point replay and finish snapshots', () => {
  it('replays persisted points while keeping live timing as authority', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.refreshTiming(BASE_TIME + 100_000);
    accumulator.replacePointsFromPersistence(
      [pointAtMeters(0, 0), pointAtMeters(20, 100), pointAtMeters(40, 250)],
      BASE_TIME + 100_000,
    );

    expect(accumulator.getMetrics()).toMatchObject({
      elapsedSeconds: 100,
      movingSeconds: 100,
      lapElapsedSeconds: 100,
      lapMovingSeconds: 100,
    });
    expect(accumulator.getMetrics().distanceMeters).toBeCloseTo(250, 6);
    expect(accumulator.getMetrics().averageSpeedMps).toBeCloseTo(2.5, 6);
    expect(accumulator.getMetrics().maxSpeedMps).toBeCloseTo(7.5, 6);
  });

  it('commits open pauses and freezes finish metrics', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.beginManualPause(BASE_TIME + 10_000);
    accumulator.ingestPoint(pointAtMeters(20, 200), BASE_TIME + 20_000);

    const snapshot = accumulator.finish(BASE_TIME + 30_000);

    expect(snapshot.pauseIntervals).toEqual([
      { startedAt: BASE_TIME + 10_000, endedAt: BASE_TIME + 30_000 },
    ]);
    expect(snapshot.metrics.elapsedSeconds).toBe(30);
    expect(snapshot.metrics.pausedSeconds).toBe(20);
    expect(snapshot.metrics.movingSeconds).toBe(10);
    expect(snapshot.routePoints).toHaveLength(2);

    accumulator.refreshTiming(BASE_TIME + 60_000);
    expect(accumulator.getMetrics().elapsedSeconds).toBe(30);
  });

  it('uses accumulator live metrics when finishing with too few points', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({ autoPause: false }),
      startedAt: BASE_TIME,
    });

    accumulator.refreshTiming(BASE_TIME + 45_000);
    accumulator.ingestPoint(pointAtMeters(45, 0), BASE_TIME + 45_000);

    const snapshot = accumulator.finish(BASE_TIME + 60_000);

    expect(snapshot.metrics.elapsedSeconds).toBe(60);
    expect(snapshot.metrics.movingSeconds).toBe(60);
    expect(snapshot.metrics.distanceMeters).toBe(0);
    expect(snapshot.metrics.averageSpeedMps).toBe(0);
  });

  it('refreshes calories for total and lap metrics', () => {
    const accumulator = createRideRecordingAccumulator({
      settings: settings({
        autoPause: false,
        autoLap: false,
        riderWeightKg: 82,
        riderHeightCm: 178,
        riderAgeYears: 38,
        riderSex: 'male',
      }),
      startedAt: BASE_TIME,
    });

    accumulator.ingestPoint(pointAtMeters(0, 0), BASE_TIME);
    accumulator.ingestPoint(pointAtMeters(600, 5000), BASE_TIME + 600_000);

    expect(accumulator.getMetrics().activeCaloriesKcal).toBeGreaterThan(0);
    expect(accumulator.getMetrics().lapActiveCaloriesKcal).toBeGreaterThan(0);
  });
});
