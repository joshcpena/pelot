export type UnitSystem = 'imperial' | 'metric';

export type AscentSource = 'barometer-preferred' | 'gps-only';

export type GpsAccuracyPreference = 'balanced' | 'best';

export type SplitType = 'distance' | 'time';

export type RideStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export type RidePoint = {
  recordedAt: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speedMps: number | null;
  heading: number | null;
  horizontalAccuracy: number | null;
  verticalAccuracy: number | null;
};

export type RideMetrics = {
  elapsedSeconds: number;
  movingSeconds: number;
  distanceMeters: number;
  ascentMeters: number;
  currentSpeedMps: number;
  averageSpeedMps: number;
  maxSpeedMps: number;
};

export type RideSettings = {
  unitSystem: UnitSystem;
  keepAwakeDuringRide: boolean;
  autoPause: boolean;
  ascentSource: AscentSource;
  gpsAccuracy: GpsAccuracyPreference;
  splitType: SplitType;
  splitDistanceMeters: number;
  splitDurationSeconds: number;
  theme: 'system' | 'light' | 'dark';
  mapType: 'standard' | 'satellite' | 'hybrid';
};
