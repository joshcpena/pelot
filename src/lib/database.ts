import * as SQLite from 'expo-sqlite';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase() {
  databasePromise ??= SQLite.openDatabaseAsync('pelot.db');
  return databasePromise;
}

export async function initializeDatabase() {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      elapsed_seconds INTEGER NOT NULL DEFAULT 0,
      moving_seconds INTEGER NOT NULL DEFAULT 0,
      distance_meters REAL NOT NULL DEFAULT 0,
      ascent_meters REAL NOT NULL DEFAULT 0,
      active_calories_kcal REAL,
      feeling_rating INTEGER,
      average_speed_mps REAL NOT NULL DEFAULT 0,
      max_speed_mps REAL NOT NULL DEFAULT 0,
      unit_preference TEXT NOT NULL DEFAULT 'imperial'
    );

    CREATE TABLE IF NOT EXISTS ride_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude REAL,
      speed_mps REAL,
      heading REAL,
      horizontal_accuracy REAL,
      vertical_accuracy REAL,
      source TEXT NOT NULL DEFAULT 'foreground-gps',
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS ride_points_ride_id_recorded_at_idx
      ON ride_points (ride_id, recorded_at);

    CREATE TABLE IF NOT EXISTS ride_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id TEXT NOT NULL,
      split_type TEXT NOT NULL,
      split_index INTEGER NOT NULL,
      distance_meters REAL NOT NULL,
      duration_seconds INTEGER NOT NULL,
      average_speed_mps REAL NOT NULL,
      ascent_meters REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  const rideColumns = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(rides)',
  );
  const rideColumnNames = new Set(rideColumns.map((column) => column.name));

  if (!rideColumnNames.has('title')) {
    await db.execAsync('ALTER TABLE rides ADD COLUMN title TEXT');
  }

  if (!rideColumnNames.has('ended_at')) {
    await db.execAsync('ALTER TABLE rides ADD COLUMN ended_at INTEGER');
  }

  if (!rideColumnNames.has('elapsed_seconds')) {
    await db.execAsync(
      'ALTER TABLE rides ADD COLUMN elapsed_seconds INTEGER NOT NULL DEFAULT 0',
    );
  }

  if (!rideColumnNames.has('moving_seconds')) {
    await db.execAsync(
      'ALTER TABLE rides ADD COLUMN moving_seconds INTEGER NOT NULL DEFAULT 0',
    );
  }

  if (!rideColumnNames.has('distance_meters')) {
    await db.execAsync(
      'ALTER TABLE rides ADD COLUMN distance_meters REAL NOT NULL DEFAULT 0',
    );
  }

  if (!rideColumnNames.has('ascent_meters')) {
    await db.execAsync(
      'ALTER TABLE rides ADD COLUMN ascent_meters REAL NOT NULL DEFAULT 0',
    );
  }

  if (!rideColumnNames.has('active_calories_kcal')) {
    await db.execAsync(
      'ALTER TABLE rides ADD COLUMN active_calories_kcal REAL',
    );
  }

  if (!rideColumnNames.has('feeling_rating')) {
    await db.execAsync('ALTER TABLE rides ADD COLUMN feeling_rating INTEGER');
  }

  if (!rideColumnNames.has('average_speed_mps')) {
    await db.execAsync(
      'ALTER TABLE rides ADD COLUMN average_speed_mps REAL NOT NULL DEFAULT 0',
    );
  }

  if (!rideColumnNames.has('max_speed_mps')) {
    await db.execAsync(
      'ALTER TABLE rides ADD COLUMN max_speed_mps REAL NOT NULL DEFAULT 0',
    );
  }

  if (!rideColumnNames.has('unit_preference')) {
    await db.execAsync(
      "ALTER TABLE rides ADD COLUMN unit_preference TEXT NOT NULL DEFAULT 'imperial'",
    );
  }
}
