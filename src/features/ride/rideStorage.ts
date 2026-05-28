import { getDatabase, initializeDatabase } from '../../lib/database';
import {
  distanceBetweenMeters,
  positiveElevationGainMeters,
  withEstimatedCalories,
} from './metrics';
import type {
  RideMetrics,
  RidePoint,
  RideSettings,
  SplitType,
  UnitSystem,
} from './types';

type RidePointRow = {
  recorded_at: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed_mps: number | null;
  heading: number | null;
  horizontal_accuracy: number | null;
  vertical_accuracy: number | null;
  source: RidePointSource;
};

type RidePointSource = 'foreground-gps' | 'background-gps';

const insertRidePointSql = `INSERT INTO ride_points (
  ride_id,
  recorded_at,
  latitude,
  longitude,
  altitude,
  speed_mps,
  heading,
  horizontal_accuracy,
  vertical_accuracy,
  source
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function toRidePoint(row: RidePointRow): RidePoint {
  return {
    recordedAt: row.recorded_at,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
    speedMps: row.speed_mps,
    heading: row.heading,
    horizontalAccuracy: row.horizontal_accuracy,
    verticalAccuracy: row.vertical_accuracy,
  };
}

function getRidePointRowKey(row: RidePointRow) {
  return [row.recorded_at, row.latitude, row.longitude].join(':');
}

function dedupeRidePointRows(rows: RidePointRow[]) {
  const rowsByKey = new Map<string, RidePointRow>();

  for (const row of rows) {
    const key = getRidePointRowKey(row);
    const existingRow = rowsByKey.get(key);

    if (!existingRow || row.source === 'foreground-gps') {
      rowsByKey.set(key, row);
    }
  }

  return [...rowsByKey.values()].sort(
    (first, second) => first.recorded_at - second.recorded_at,
  );
}

export type RideSummary = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  elapsedSeconds: number;
  movingSeconds: number;
  distanceMeters: number;
  ascentMeters: number;
  activeCaloriesKcal: number | null;
  averageSpeedMps: number;
  maxSpeedMps: number;
  unitPreference: UnitSystem;
};

export type RideSplit = {
  splitType: SplitType;
  splitIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  averageSpeedMps: number;
  ascentMeters: number;
};

export type RidePauseInterval = {
  startedAt: number;
  endedAt: number;
};

type RideSummaryRow = {
  id: string;
  started_at: number;
  ended_at: number | null;
  elapsed_seconds: number;
  moving_seconds: number;
  distance_meters: number;
  ascent_meters: number;
  active_calories_kcal: number | null;
  average_speed_mps: number;
  max_speed_mps: number;
  unit_preference: UnitSystem;
};

type RideSplitRow = {
  split_type: SplitType;
  split_index: number;
  distance_meters: number;
  duration_seconds: number;
  average_speed_mps: number;
  ascent_meters: number;
};

export function createRideId() {
  return `ride-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function createRide(rideId: string, unitSystem: UnitSystem) {
  await initializeDatabase();
  const db = await getDatabase();
  await db.runAsync(
    'INSERT INTO rides (id, started_at, unit_preference) VALUES (?, ?, ?)',
    rideId,
    Date.now(),
    unitSystem,
  );
}

export async function setActiveRideId(rideId: string | null) {
  await initializeDatabase();
  const db = await getDatabase();

  if (rideId == null) {
    await db.runAsync('DELETE FROM settings WHERE key = ?', 'activeRideId');
    return;
  }

  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    'activeRideId',
    JSON.stringify(rideId),
  );
}

export async function getActiveRideId() {
  await initializeDatabase();
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    'activeRideId',
  );

  return rows[0]?.value ? (JSON.parse(rows[0].value) as string) : null;
}

export async function insertRidePoint(
  rideId: string,
  point: RidePoint,
  source: RidePointSource,
) {
  const db = await getDatabase();
  await db.runAsync(
    insertRidePointSql,
    rideId,
    point.recordedAt,
    point.latitude,
    point.longitude,
    point.altitude,
    point.speedMps,
    point.heading,
    point.horizontalAccuracy,
    point.verticalAccuracy,
    source,
  );
}

export async function insertRidePoints(
  rideId: string,
  points: RidePoint[],
  source: RidePointSource,
) {
  if (points.length === 0) {
    return;
  }

  const db = await getDatabase();

  await db.execAsync('BEGIN TRANSACTION');

  try {
    for (const point of points) {
      await db.runAsync(
        insertRidePointSql,
        rideId,
        point.recordedAt,
        point.latitude,
        point.longitude,
        point.altitude,
        point.speedMps,
        point.heading,
        point.horizontalAccuracy,
        point.verticalAccuracy,
        source,
      );
    }

    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}

export async function loadRidePoints(rideId: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RidePointRow>(
    `SELECT recorded_at,
            latitude,
            longitude,
            altitude,
            speed_mps,
            heading,
            horizontal_accuracy,
            vertical_accuracy,
            source
     FROM ride_points
     WHERE ride_id = ?
     ORDER BY recorded_at ASC`,
    rideId,
  );

  return dedupeRidePointRows(rows).map(toRidePoint);
}

export async function loadRidePointsAfter(rideId: string, recordedAt: number) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RidePointRow>(
    `SELECT recorded_at,
            latitude,
            longitude,
            altitude,
            speed_mps,
            heading,
            horizontal_accuracy,
            vertical_accuracy,
            source
     FROM ride_points
     WHERE ride_id = ? AND recorded_at > ?
     ORDER BY recorded_at ASC`,
    rideId,
    recordedAt,
  );

  return dedupeRidePointRows(rows).map(toRidePoint);
}

export async function deleteRide(rideId: string) {
  await initializeDatabase();
  const db = await getDatabase();

  await db.runAsync('DELETE FROM ride_splits WHERE ride_id = ?', rideId);
  await db.runAsync('DELETE FROM ride_points WHERE ride_id = ?', rideId);
  await db.runAsync('DELETE FROM rides WHERE id = ?', rideId);
}

function doesSegmentOverlapPause(
  segmentStartedAt: number,
  segmentEndedAt: number,
  pauseIntervals: RidePauseInterval[],
) {
  return pauseIntervals.some(
    (pause) =>
      segmentStartedAt < pause.endedAt && segmentEndedAt > pause.startedAt,
  );
}

export function calculateMetricsFromPoints(
  points: RidePoint[],
  pauseIntervals: RidePauseInterval[] = [],
): RideMetrics {
  let distanceMeters = 0;
  let ascentMeters = 0;
  let movingSeconds = 0;
  let maxSpeedMps = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const seconds = Math.max(
      0,
      Math.round((next.recordedAt - previous.recordedAt) / 1000),
    );

    if (
      doesSegmentOverlapPause(
        previous.recordedAt,
        next.recordedAt,
        pauseIntervals,
      )
    ) {
      continue;
    }

    const distance = distanceBetweenMeters(previous, next);
    const speed = next.speedMps ?? (seconds > 0 ? distance / seconds : 0);

    distanceMeters += distance;
    ascentMeters += positiveElevationGainMeters(previous, next);
    movingSeconds += seconds;
    maxSpeedMps = Math.max(maxSpeedMps, speed);
  }

  const elapsedSeconds =
    points.length > 1
      ? Math.max(
          0,
          Math.round(
            (points[points.length - 1].recordedAt - points[0].recordedAt) /
              1000,
          ),
        )
      : 0;

  return {
    startedAt: points[0]?.recordedAt ?? null,
    elapsedSeconds,
    movingSeconds,
    pausedSeconds: 0,
    distanceMeters,
    ascentMeters,
    activeCaloriesKcal: null,
    currentSpeedMps: points[points.length - 1]?.speedMps ?? 0,
    averageSpeedMps: movingSeconds > 0 ? distanceMeters / movingSeconds : 0,
    maxSpeedMps,
    lapNumber: 1,
    lapStartedAt: points[0]?.recordedAt ?? null,
    lapElapsedSeconds: elapsedSeconds,
    lapPausedSeconds: 0,
    lapMovingSeconds: movingSeconds,
    lapDistanceMeters: distanceMeters,
    lapAscentMeters: ascentMeters,
    lapActiveCaloriesKcal: null,
    lapAverageSpeedMps: movingSeconds > 0 ? distanceMeters / movingSeconds : 0,
    lapMaxSpeedMps: maxSpeedMps,
  };
}

function buildSplits(
  points: RidePoint[],
  settings: RideSettings,
  pauseIntervals: RidePauseInterval[] = [],
): RideSplit[] {
  const target =
    settings.splitType === 'distance'
      ? settings.splitDistanceMeters
      : settings.splitDurationSeconds;
  const splits: RideSplit[] = [];
  let splitDistanceMeters = 0;
  let splitDurationSeconds = 0;
  let splitAscentMeters = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const durationSeconds = Math.max(
      0,
      Math.round((next.recordedAt - previous.recordedAt) / 1000),
    );

    if (
      doesSegmentOverlapPause(
        previous.recordedAt,
        next.recordedAt,
        pauseIntervals,
      )
    ) {
      continue;
    }

    const distanceMeters = distanceBetweenMeters(previous, next);
    const ascentMeters = positiveElevationGainMeters(previous, next);

    splitDistanceMeters += distanceMeters;
    splitDurationSeconds += durationSeconds;
    splitAscentMeters += ascentMeters;

    const progress =
      settings.splitType === 'distance'
        ? splitDistanceMeters
        : splitDurationSeconds;

    if (progress >= target) {
      splits.push({
        splitType: settings.splitType,
        splitIndex: splits.length + 1,
        distanceMeters: splitDistanceMeters,
        durationSeconds: splitDurationSeconds,
        averageSpeedMps:
          splitDurationSeconds > 0
            ? splitDistanceMeters / splitDurationSeconds
            : 0,
        ascentMeters: splitAscentMeters,
      });
      splitDistanceMeters = 0;
      splitDurationSeconds = 0;
      splitAscentMeters = 0;
    }
  }

  if (splitDistanceMeters > 0 || splitDurationSeconds > 0) {
    splits.push({
      splitType: settings.splitType,
      splitIndex: splits.length + 1,
      distanceMeters: splitDistanceMeters,
      durationSeconds: splitDurationSeconds,
      averageSpeedMps:
        splitDurationSeconds > 0
          ? splitDistanceMeters / splitDurationSeconds
          : 0,
      ascentMeters: splitAscentMeters,
    });
  }

  return splits;
}

async function replaceRideSplits(rideId: string, splits: RideSplit[]) {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM ride_splits WHERE ride_id = ?', rideId);

  for (const split of splits) {
    await db.runAsync(
      `INSERT INTO ride_splits (
        ride_id,
        split_type,
        split_index,
        distance_meters,
        duration_seconds,
        average_speed_mps,
        ascent_meters
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      rideId,
      split.splitType,
      split.splitIndex,
      split.distanceMeters,
      split.durationSeconds,
      split.averageSpeedMps,
      split.ascentMeters,
    );
  }
}

export async function finishRide(
  rideId: string,
  fallbackMetrics: RideMetrics,
  settings: RideSettings,
  pauseIntervals: RidePauseInterval[] = [],
) {
  const points = await loadRidePoints(rideId);
  const pointMetrics =
    points.length > 1
      ? calculateMetricsFromPoints(points, pauseIntervals)
      : null;
  const distanceMeters =
    pointMetrics?.distanceMeters ?? fallbackMetrics.distanceMeters;
  const movingSeconds = Math.max(
    0,
    Math.min(fallbackMetrics.movingSeconds, fallbackMetrics.elapsedSeconds),
  );
  const metrics = withEstimatedCalories(
    pointMetrics
      ? {
          ...fallbackMetrics,
          startedAt: pointMetrics.startedAt ?? fallbackMetrics.startedAt,
          distanceMeters,
          ascentMeters: pointMetrics.ascentMeters,
          currentSpeedMps: pointMetrics.currentSpeedMps,
          averageSpeedMps:
            movingSeconds > 0 ? distanceMeters / movingSeconds : 0,
          maxSpeedMps: Math.max(
            fallbackMetrics.maxSpeedMps,
            pointMetrics.maxSpeedMps,
          ),
          movingSeconds,
        }
      : fallbackMetrics,
    settings,
  );
  const splits =
    points.length > 1 ? buildSplits(points, settings, pauseIntervals) : [];
  const db = await getDatabase();

  await db.runAsync(
    `UPDATE rides
     SET ended_at = ?,
         elapsed_seconds = ?,
         moving_seconds = ?,
         distance_meters = ?,
         ascent_meters = ?,
         active_calories_kcal = ?,
         average_speed_mps = ?,
         max_speed_mps = ?
     WHERE id = ?`,
    Date.now(),
    metrics.elapsedSeconds || fallbackMetrics.elapsedSeconds,
    metrics.movingSeconds,
    metrics.distanceMeters,
    metrics.ascentMeters,
    metrics.activeCaloriesKcal,
    metrics.averageSpeedMps,
    metrics.maxSpeedMps,
    rideId,
  );

  await replaceRideSplits(rideId, splits);

  return metrics.elapsedSeconds
    ? metrics
    : { ...metrics, elapsedSeconds: fallbackMetrics.elapsedSeconds };
}

export async function loadRecentRides(limit = 10) {
  await initializeDatabase();
  const db = await getDatabase();
  const rows = await db.getAllAsync<RideSummaryRow>(
    `SELECT id,
            started_at,
            ended_at,
            elapsed_seconds,
            moving_seconds,
            distance_meters,
            ascent_meters,
            active_calories_kcal,
            average_speed_mps,
            max_speed_mps,
            unit_preference
     FROM rides
     WHERE ended_at IS NOT NULL
     ORDER BY started_at DESC
     LIMIT ?`,
    limit,
  );

  return rows.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    elapsedSeconds: row.elapsed_seconds,
    movingSeconds: row.moving_seconds,
    distanceMeters: row.distance_meters,
    ascentMeters: row.ascent_meters,
    activeCaloriesKcal: row.active_calories_kcal,
    averageSpeedMps: row.average_speed_mps,
    maxSpeedMps: row.max_speed_mps,
    unitPreference: row.unit_preference,
  }));
}

export async function loadRideSplits(rideId: string) {
  await initializeDatabase();
  const db = await getDatabase();
  const rows = await db.getAllAsync<RideSplitRow>(
    `SELECT split_type,
            split_index,
            distance_meters,
            duration_seconds,
            average_speed_mps,
            ascent_meters
     FROM ride_splits
     WHERE ride_id = ?
     ORDER BY split_index ASC`,
    rideId,
  );

  return rows.map((row) => ({
    splitType: row.split_type,
    splitIndex: row.split_index,
    distanceMeters: row.distance_meters,
    durationSeconds: row.duration_seconds,
    averageSpeedMps: row.average_speed_mps,
    ascentMeters: row.ascent_meters,
  }));
}
