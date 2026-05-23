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
  startedAt: number | null;
  elapsedSeconds: number;
  movingSeconds: number;
  pausedSeconds: number;
  distanceMeters: number;
  ascentMeters: number;
  currentSpeedMps: number;
  averageSpeedMps: number;
  maxSpeedMps: number;
  lapNumber: number;
  lapStartedAt: number | null;
  lapElapsedSeconds: number;
  lapMovingSeconds: number;
  lapDistanceMeters: number;
  lapAscentMeters: number;
  lapAverageSpeedMps: number;
  lapMaxSpeedMps: number;
};

export type DashboardCardSpan = '1x1' | '2x1' | '3x1' | '2x2' | '3x2' | '3x3';

export type DashboardMetricId =
  | 'caloriesTotal'
  | 'caloriesLap'
  | 'deviceBatteryLevel'
  | 'totalDistance'
  | 'lapTotalDistance'
  | 'totalAscent'
  | 'lapTotalAscent'
  | 'totalDescent'
  | 'lapTotalDescent'
  | 'elevationCurrent'
  | 'elevationAverage'
  | 'elevationLapAverage'
  | 'elevationMax'
  | 'elevationLapMax'
  | 'elevationMin'
  | 'elevationLapMin'
  | 'elevationTotalChange'
  | 'gradeCurrent'
  | 'gradeAverage'
  | 'gradeLapAverage'
  | 'gradeMax'
  | 'gradeMin'
  | 'gradeLapMin'
  | 'lapNumber'
  | 'map'
  | 'paceCurrent'
  | 'paceAverage'
  | 'paceLapAverage'
  | 'paceMax'
  | 'paceLapMax'
  | 'speedCurrent'
  | 'speedMax'
  | 'speedAverage'
  | 'speedLapAverage'
  | 'speedLapMax'
  | 'totalTimeRecorded'
  | 'totalLapTimeRecorded'
  | 'totalElapsed'
  | 'totalLapTimeElapsed'
  | 'timeTotalPaused'
  | 'timeLapTotalPaused'
  | 'timeStart'
  | 'timeLapStart'
  | 'timeOfDay'
  | 'sunrise'
  | 'sunset'
  | 'temperatureCurrent'
  | 'temperatureAverage'
  | 'temperatureLapAverage'
  | 'temperatureMax'
  | 'temperatureLapMax'
  | 'temperatureMin'
  | 'temperatureLapMin'
  | 'windCurrent'
  | 'windAverage'
  | 'windLapAverage'
  | 'windMax'
  | 'windMin'
  | 'windLapMin';

export type DashboardCard = {
  id: string;
  metricId: DashboardMetricId;
  span: DashboardCardSpan;
};

export type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

export type PlannedRoute = {
  destination: string;
  distanceText: string;
  durationText: string;
  coordinates: RouteCoordinate[];
};

export type RideSettings = {
  unitSystem: UnitSystem;
  keepAwakeDuringRide: boolean;
  autoPause: boolean;
  autoLap: boolean;
  ascentSource: AscentSource;
  gpsAccuracy: GpsAccuracyPreference;
  splitType: SplitType;
  splitDistanceMeters: number;
  splitDurationSeconds: number;
  theme: 'system' | 'light' | 'dark';
  mapType: 'standard' | 'satellite' | 'hybrid';
  dashboardLayout: DashboardCard[];
};
