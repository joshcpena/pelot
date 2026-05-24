export type UnitSystem = 'imperial' | 'metric';

export type AscentSource = 'barometer-preferred' | 'gps-only';

export type GpsAccuracyPreference = 'balanced' | 'best';

export type SplitType = 'distance' | 'time';

export type RideStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export type RiderSex = 'female' | 'male';

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
  activeCaloriesKcal: number | null;
  currentSpeedMps: number;
  averageSpeedMps: number;
  maxSpeedMps: number;
  lapNumber: number;
  lapStartedAt: number | null;
  lapElapsedSeconds: number;
  lapPausedSeconds: number;
  lapMovingSeconds: number;
  lapDistanceMeters: number;
  lapAscentMeters: number;
  lapActiveCaloriesKcal: number | null;
  lapAverageSpeedMps: number;
  lapMaxSpeedMps: number;
};

export type HeartRateDevice = {
  id: string;
  name: string;
};

export type DashboardCardSpan =
  | '1x1'
  | '1x2'
  | '1x3'
  | '1x4'
  | '1x5'
  | '1.5x1'
  | '1.5x2'
  | '1.5x3'
  | '1.5x4'
  | '1.5x5'
  | '2x1'
  | '2x2'
  | '2x3'
  | '2x4'
  | '2x5'
  | '3x1'
  | '3x2'
  | '3x3'
  | '3x4'
  | '3x5';

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
  | 'windLapMin'
  | 'heartRateCurrent';

export type DashboardCard = {
  id: string;
  metricId: DashboardMetricId;
  span: DashboardCardSpan;
};

export type RouteCoordinate = {
  latitude: number;
  longitude: number;
};

export type DestinationOption = {
  id: string;
  name: string;
  address: string | null;
  coordinate: RouteCoordinate;
};

export type PlannedRoute = {
  destination: string;
  distanceText: string;
  durationText: string;
  coordinates: RouteCoordinate[];
  steps: PlannedRouteStep[];
};

export type PlannedRouteStep = {
  instruction: string;
  distanceMeters: number | null;
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
  connectedHeartRateDevice: HeartRateDevice | null;
  riderWeightKg: number | null;
  riderHeightCm: number | null;
  riderAgeYears: number | null;
  riderSex: RiderSex | null;
};
