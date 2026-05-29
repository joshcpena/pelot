import { getDatabase, initializeDatabase } from '../../lib/database';
import { withEstimatedCalories } from './metrics';
import { buildRideSplits, type RideSplit } from './rideCalculations';
import type { RideRecordingFinishSnapshot } from './rideRecordingAccumulator';
import type { RidePoint, RideSettings, UnitSystem } from './types';

export { calculateMetricsFromPoints } from './rideCalculations';
export type { RidePauseInterval, RideSplit } from './rideCalculations';

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
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  elapsedSeconds: number;
  movingSeconds: number;
  distanceMeters: number;
  ascentMeters: number;
  activeCaloriesKcal: number | null;
  feelingRating: number | null;
  averageSpeedMps: number;
  maxSpeedMps: number;
  unitPreference: UnitSystem;
};

export type FinishedRideSummary = {
  summary: RideSummary;
  points: RidePoint[];
  splits: RideSplit[];
};

type RideSummaryRow = {
  id: string;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  elapsed_seconds: number;
  moving_seconds: number;
  distance_meters: number;
  ascent_meters: number;
  active_calories_kcal: number | null;
  feeling_rating: number | null;
  average_speed_mps: number;
  max_speed_mps: number;
  unit_preference: UnitSystem;
};

type RideSplitRow = {
  split_type: RideSplit['splitType'];
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

export async function updateRideDetails(
  rideId: string,
  details: { title?: string | null; feelingRating?: number | null },
) {
  await initializeDatabase();
  const db = await getDatabase();
  const title =
    details.title === undefined ? undefined : details.title?.trim() || null;
  const feelingRating =
    details.feelingRating == null
      ? null
      : Math.min(10, Math.max(0, Math.round(details.feelingRating)));

  if (title !== undefined && details.feelingRating !== undefined) {
    await db.runAsync(
      'UPDATE rides SET title = ?, feeling_rating = ? WHERE id = ?',
      title,
      feelingRating,
      rideId,
    );
    return;
  }

  if (title !== undefined) {
    await db.runAsync('UPDATE rides SET title = ? WHERE id = ?', title, rideId);
    return;
  }

  if (details.feelingRating !== undefined) {
    await db.runAsync(
      'UPDATE rides SET feeling_rating = ? WHERE id = ?',
      feelingRating,
      rideId,
    );
  }
}

async function replaceRideSplits(rideId: string, splits: RideSplit[]) {
  const db = await getDatabase();
  await db.execAsync('BEGIN TRANSACTION');

  try {
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

    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}

export async function finishRide(
  rideId: string,
  finishSnapshot: RideRecordingFinishSnapshot,
  settings: RideSettings,
): Promise<FinishedRideSummary> {
  const points = await loadRidePoints(rideId);
  const metrics = withEstimatedCalories(finishSnapshot.metrics, settings);
  const splits =
    points.length > 1
      ? buildRideSplits(points, settings, finishSnapshot.pauseIntervals)
      : [];
  const db = await getDatabase();
  const endedAt = Date.now();

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
    endedAt,
    metrics.elapsedSeconds || finishSnapshot.metrics.elapsedSeconds,
    metrics.movingSeconds,
    metrics.distanceMeters,
    metrics.ascentMeters,
    metrics.activeCaloriesKcal,
    metrics.averageSpeedMps,
    metrics.maxSpeedMps,
    rideId,
  );

  await replaceRideSplits(rideId, splits);

  const savedMetrics = metrics.elapsedSeconds
    ? metrics
    : {
        ...metrics,
        elapsedSeconds: finishSnapshot.metrics.elapsedSeconds,
      };

  const summary = await loadRideSummary(rideId);

  return {
    summary: summary ?? {
      id: rideId,
      title: null,
      startedAt:
        savedMetrics.startedAt ?? finishSnapshot.metrics.startedAt ?? endedAt,
      endedAt,
      elapsedSeconds: savedMetrics.elapsedSeconds,
      movingSeconds: savedMetrics.movingSeconds,
      distanceMeters: savedMetrics.distanceMeters,
      ascentMeters: savedMetrics.ascentMeters,
      activeCaloriesKcal: savedMetrics.activeCaloriesKcal,
      feelingRating: null,
      averageSpeedMps: savedMetrics.averageSpeedMps,
      maxSpeedMps: savedMetrics.maxSpeedMps,
      unitPreference: settings.unitSystem,
    },
    points,
    splits,
  };
}

function toRideSummary(row: RideSummaryRow): RideSummary {
  return {
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    elapsedSeconds: row.elapsed_seconds,
    movingSeconds: row.moving_seconds,
    distanceMeters: row.distance_meters,
    ascentMeters: row.ascent_meters,
    activeCaloriesKcal: row.active_calories_kcal,
    feelingRating: row.feeling_rating,
    averageSpeedMps: row.average_speed_mps,
    maxSpeedMps: row.max_speed_mps,
    unitPreference: row.unit_preference,
  };
}

export async function loadRideSummary(rideId: string) {
  await initializeDatabase();
  const db = await getDatabase();
  const rows = await db.getAllAsync<RideSummaryRow>(
    `SELECT id,
            title,
            started_at,
            ended_at,
            elapsed_seconds,
            moving_seconds,
            distance_meters,
            ascent_meters,
            active_calories_kcal,
            feeling_rating,
            average_speed_mps,
            max_speed_mps,
            unit_preference
     FROM rides
     WHERE id = ?
     LIMIT 1`,
    rideId,
  );

  return rows[0] ? toRideSummary(rows[0]) : null;
}

export async function loadRecentRides(limit = 10) {
  await initializeDatabase();
  const db = await getDatabase();
  const rows = await db.getAllAsync<RideSummaryRow>(
    `SELECT id,
            title,
            started_at,
            ended_at,
            elapsed_seconds,
            moving_seconds,
            distance_meters,
            ascent_meters,
            active_calories_kcal,
            feeling_rating,
            average_speed_mps,
            max_speed_mps,
            unit_preference
     FROM rides
     WHERE ended_at IS NOT NULL
     ORDER BY started_at DESC
     LIMIT ?`,
    limit,
  );

  return rows.map(toRideSummary);
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
