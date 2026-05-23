import { getDatabase, initializeDatabase } from '../../lib/database';
import { distanceBetweenMeters, positiveElevationGainMeters } from './metrics';
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
};

export type RideSummary = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  elapsedSeconds: number;
  movingSeconds: number;
  distanceMeters: number;
  ascentMeters: number;
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

type RideSummaryRow = {
  id: string;
  started_at: number;
  ended_at: number | null;
  elapsed_seconds: number;
  moving_seconds: number;
  distance_meters: number;
  ascent_meters: number;
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
  source: 'foreground-gps' | 'background-gps',
) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO ride_points (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            vertical_accuracy
     FROM ride_points
     WHERE ride_id = ?
     ORDER BY recorded_at ASC`,
    rideId,
  );

  return rows.map((row) => ({
    recordedAt: row.recorded_at,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
    speedMps: row.speed_mps,
    heading: row.heading,
    horizontalAccuracy: row.horizontal_accuracy,
    verticalAccuracy: row.vertical_accuracy,
  }));
}

export function calculateMetricsFromPoints(points: RidePoint[]): RideMetrics {
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
    elapsedSeconds,
    movingSeconds,
    distanceMeters,
    ascentMeters,
    currentSpeedMps: points[points.length - 1]?.speedMps ?? 0,
    averageSpeedMps: movingSeconds > 0 ? distanceMeters / movingSeconds : 0,
    maxSpeedMps,
  };
}

function buildSplits(points: RidePoint[], settings: RideSettings): RideSplit[] {
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
) {
  const points = await loadRidePoints(rideId);
  const metrics =
    points.length > 1 ? calculateMetricsFromPoints(points) : fallbackMetrics;
  const splits = points.length > 1 ? buildSplits(points, settings) : [];
  const db = await getDatabase();

  await db.runAsync(
    `UPDATE rides
     SET ended_at = ?,
         elapsed_seconds = ?,
         moving_seconds = ?,
         distance_meters = ?,
         ascent_meters = ?,
         average_speed_mps = ?,
         max_speed_mps = ?
     WHERE id = ?`,
    Date.now(),
    metrics.elapsedSeconds || fallbackMetrics.elapsedSeconds,
    metrics.movingSeconds,
    metrics.distanceMeters,
    metrics.ascentMeters,
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
