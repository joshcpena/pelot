import {
  formatAscent,
  formatCalories,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatTimeOfDay,
} from './metrics';
import type {
  DashboardCard,
  DashboardCardSpan,
  DashboardMetricId,
  PlannedRoute,
  RideMetrics,
  RidePoint,
  RideSettings,
} from './types';

export type DashboardMetricCategory =
  | 'Calories'
  | 'Device'
  | 'Health'
  | 'Distance'
  | 'Elevation'
  | 'Lap'
  | 'Maps & Navigation'
  | 'Speed & Pace'
  | 'Time'
  | 'Weather';

export type DashboardValueContext = {
  metrics: RideMetrics;
  settings: RideSettings;
  routePoints: RidePoint[];
  plannedRoute: PlannedRoute | null;
  now: number | null;
  heartRateBpm: number | null;
  heartRateStatus:
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'unavailable'
    | 'error';
  heartRateError: string | null;
};

export type DashboardMetricDefinition = {
  id: DashboardMetricId;
  label: string;
  category: DashboardMetricCategory;
  supportedSpans: DashboardCardSpan[];
  defaultSpan: DashboardCardSpan;
  getValue: (context: DashboardValueContext) => string;
};

export const dashboardSpans: DashboardCardSpan[] = [
  '1x1',
  '1x2',
  '1x3',
  '1x4',
  '1x5',
  '1.5x1',
  '1.5x2',
  '1.5x3',
  '1.5x4',
  '1.5x5',
  '2x1',
  '2x2',
  '2x3',
  '2x4',
  '2x5',
  '3x1',
  '3x2',
  '3x3',
  '3x4',
  '3x5',
];

export const defaultDashboardLayout: DashboardCard[] = [
  { id: 'card-map', metricId: 'map', span: '3x3' },
  { id: 'card-total-distance', metricId: 'totalDistance', span: '1.5x2' },
  { id: 'card-total-time', metricId: 'totalTimeRecorded', span: '1.5x2' },
  { id: 'card-speed-current', metricId: 'speedCurrent', span: '3x2' },
  { id: 'card-pace-current', metricId: 'paceCurrent', span: '1.5x2' },
  { id: 'card-calories-total', metricId: 'caloriesTotal', span: '1.5x2' },
];

const allSpans = dashboardSpans;
const metricSpans = dashboardSpans;

function unavailable() {
  return '-!-';
}

function createUnavailableMetric(
  id: DashboardMetricId,
  label: string,
  category: DashboardMetricCategory,
  todo: string,
): DashboardMetricDefinition {
  void todo;
  // TODO: Implement the metric described by the `todo` argument before replacing this placeholder.
  return {
    id,
    label,
    category,
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: unavailable,
  };
}

export const dashboardMetricCatalog: DashboardMetricDefinition[] = [
  {
    id: 'caloriesTotal',
    label: 'Calories Total',
    category: 'Calories',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatCalories(metrics.activeCaloriesKcal),
  },
  {
    id: 'caloriesLap',
    label: 'Calories Lap',
    category: 'Calories',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatCalories(metrics.lapActiveCaloriesKcal),
  },
  createUnavailableMetric(
    'deviceBatteryLevel',
    'Device Battery Level',
    'Device',
    'Read device battery using expo-battery.',
  ),
  {
    id: 'totalDistance',
    label: 'Total Distance',
    category: 'Distance',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatDistance(metrics.distanceMeters, settings.unitSystem),
  },
  {
    id: 'lapTotalDistance',
    label: 'Lap Total Distance',
    category: 'Distance',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatDistance(metrics.lapDistanceMeters, settings.unitSystem),
  },
  {
    id: 'totalAscent',
    label: 'Total Ascent',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatAscent(metrics.ascentMeters, settings.unitSystem),
  },
  {
    id: 'lapTotalAscent',
    label: 'Lap Total Ascent',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatAscent(metrics.lapAscentMeters, settings.unitSystem),
  },
  createUnavailableMetric(
    'totalDescent',
    'Total Descent',
    'Elevation',
    'Track negative elevation changes with smoothing.',
  ),
  createUnavailableMetric(
    'lapTotalDescent',
    'Lap Total Descent',
    'Elevation',
    'Track lap negative elevation changes with smoothing.',
  ),
  createUnavailableMetric(
    'elevationCurrent',
    'Elevation Current',
    'Elevation',
    'Expose the latest smoothed barometer/GPS elevation.',
  ),
  createUnavailableMetric(
    'elevationAverage',
    'Elevation Average',
    'Elevation',
    'Aggregate average elevation across recorded points.',
  ),
  createUnavailableMetric(
    'elevationLapAverage',
    'Elevation Lap Average',
    'Elevation',
    'Aggregate average elevation across current lap points.',
  ),
  createUnavailableMetric(
    'elevationMax',
    'Elevation Max',
    'Elevation',
    'Track maximum smoothed elevation.',
  ),
  createUnavailableMetric(
    'elevationLapMax',
    'Elevation Lap Max',
    'Elevation',
    'Track maximum smoothed elevation for the current lap.',
  ),
  createUnavailableMetric(
    'elevationMin',
    'Elevation Min',
    'Elevation',
    'Track minimum smoothed elevation.',
  ),
  createUnavailableMetric(
    'elevationLapMin',
    'Elevation Lap Min',
    'Elevation',
    'Track minimum smoothed elevation for the current lap.',
  ),
  createUnavailableMetric(
    'elevationTotalChange',
    'Elevation Total Change',
    'Elevation',
    'Compare current elevation against ride start elevation.',
  ),
  createUnavailableMetric(
    'gradeCurrent',
    'Grade Current',
    'Elevation',
    'Calculate smoothed grade over a rolling distance window.',
  ),
  createUnavailableMetric(
    'gradeAverage',
    'Grade Average',
    'Elevation',
    'Calculate ride average grade from elevation and distance.',
  ),
  createUnavailableMetric(
    'gradeLapAverage',
    'Grade Lap Average',
    'Elevation',
    'Calculate current lap average grade.',
  ),
  createUnavailableMetric(
    'gradeMax',
    'Grade Max',
    'Elevation',
    'Track maximum smoothed grade.',
  ),
  createUnavailableMetric(
    'gradeMin',
    'Grade Min',
    'Elevation',
    'Track minimum smoothed grade.',
  ),
  createUnavailableMetric(
    'gradeLapMin',
    'Grade Lap Min',
    'Elevation',
    'Track current lap minimum smoothed grade.',
  ),
  {
    id: 'lapNumber',
    label: 'Lap Number',
    category: 'Lap',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => String(metrics.lapNumber),
  },
  {
    id: 'map',
    label: 'Map',
    category: 'Maps & Navigation',
    supportedSpans: allSpans,
    defaultSpan: '3x3',
    getValue: () => '',
  },
  {
    id: 'paceCurrent',
    label: 'Pace Current',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.currentSpeedMps, settings.unitSystem),
  },
  {
    id: 'paceAverage',
    label: 'Pace Average',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.averageSpeedMps, settings.unitSystem),
  },
  {
    id: 'paceLapAverage',
    label: 'Pace Lap Average',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.lapAverageSpeedMps, settings.unitSystem),
  },
  {
    id: 'paceMax',
    label: 'Pace Max',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.maxSpeedMps, settings.unitSystem),
  },
  {
    id: 'paceLapMax',
    label: 'Pace Lap Max',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.lapMaxSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedCurrent',
    label: 'Speed Current',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '3x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.currentSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedMax',
    label: 'Speed Max',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.maxSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedAverage',
    label: 'Speed Average',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.averageSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedLapAverage',
    label: 'Speed Lap Average',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.lapAverageSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedLapMax',
    label: 'Speed Lap Max',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.lapMaxSpeedMps, settings.unitSystem),
  },
  {
    id: 'totalTimeRecorded',
    label: 'Total Time Recorded',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.movingSeconds),
  },
  {
    id: 'totalLapTimeRecorded',
    label: 'Total Lap Time Recorded',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.lapMovingSeconds),
  },
  {
    id: 'totalElapsed',
    label: 'Total Elapsed',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.elapsedSeconds),
  },
  {
    id: 'totalLapTimeElapsed',
    label: 'Total Lap Time Elapsed',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.lapElapsedSeconds),
  },
  {
    id: 'timeTotalPaused',
    label: 'Time Total Paused',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.pausedSeconds),
  },
  createUnavailableMetric(
    'timeLapTotalPaused',
    'Time Lap Total Paused',
    'Time',
    'Track pause duration scoped to the current lap.',
  ),
  {
    id: 'timeStart',
    label: 'Time Start',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatTimeOfDay(metrics.startedAt),
  },
  {
    id: 'timeLapStart',
    label: 'Time Lap Start',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatTimeOfDay(metrics.lapStartedAt),
  },
  {
    id: 'timeOfDay',
    label: 'Time Of Day',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ now }) => formatTimeOfDay(now),
  },
  createUnavailableMetric(
    'sunrise',
    'Sunrise',
    'Time',
    'Calculate sunrise from date and current coordinates.',
  ),
  createUnavailableMetric(
    'sunset',
    'Sunset',
    'Time',
    'Calculate sunset from date and current coordinates.',
  ),
  createUnavailableMetric(
    'temperatureCurrent',
    'Temperature Current',
    'Weather',
    'Fetch current temperature from a weather provider.',
  ),
  createUnavailableMetric(
    'temperatureAverage',
    'Temp Average',
    'Weather',
    'Aggregate average temperature samples during a ride.',
  ),
  createUnavailableMetric(
    'temperatureLapAverage',
    'Temp Lap Average',
    'Weather',
    'Aggregate average temperature samples during a lap.',
  ),
  createUnavailableMetric(
    'temperatureMax',
    'Temp Max',
    'Weather',
    'Track maximum temperature sample during a ride.',
  ),
  createUnavailableMetric(
    'temperatureLapMax',
    'Temp Lap Max',
    'Weather',
    'Track maximum temperature sample during a lap.',
  ),
  createUnavailableMetric(
    'temperatureMin',
    'Temp Min',
    'Weather',
    'Track minimum temperature sample during a ride.',
  ),
  createUnavailableMetric(
    'temperatureLapMin',
    'Temp Lap Min',
    'Weather',
    'Track minimum temperature sample during a lap.',
  ),
  createUnavailableMetric(
    'windCurrent',
    'Wind Current',
    'Weather',
    'Fetch current wind from a weather provider.',
  ),
  createUnavailableMetric(
    'windAverage',
    'Wind Average',
    'Weather',
    'Aggregate average wind samples during a ride.',
  ),
  createUnavailableMetric(
    'windLapAverage',
    'Wind Lap Average',
    'Weather',
    'Aggregate average wind samples during a lap.',
  ),
  createUnavailableMetric(
    'windMax',
    'Wind Max',
    'Weather',
    'Track maximum wind sample during a ride.',
  ),
  createUnavailableMetric(
    'windMin',
    'Wind Min',
    'Weather',
    'Track minimum wind sample during a ride.',
  ),
  createUnavailableMetric(
    'windLapMin',
    'Wind Lap Min',
    'Weather',
    'Track minimum wind sample during a lap.',
  ),
  {
    id: 'heartRateCurrent',
    label: 'Heart Rate Current',
    category: 'Health',
    supportedSpans: metricSpans,
    defaultSpan: '1.5x2',
    getValue: ({ heartRateBpm, heartRateStatus, heartRateError, settings }) => {
      if (!settings.connectedHeartRateDevice) {
        return 'No device';
      }

      if (heartRateBpm != null) {
        return `${heartRateBpm} bpm`;
      }

      if (heartRateStatus === 'connecting') {
        return 'Connecting';
      }

      if (heartRateStatus === 'connected') {
        return 'Waiting';
      }

      if (heartRateStatus === 'error') {
        return heartRateError ? heartRateError.slice(0, 28) : 'Error';
      }

      return '--';
    },
  },
];

export const dashboardMetricById = new Map(
  dashboardMetricCatalog.map((metric) => [metric.id, metric]),
);

export function createDashboardCard(
  metricId: DashboardMetricId,
): DashboardCard {
  const metric = dashboardMetricById.get(metricId);

  return {
    id: `card-${metricId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    metricId,
    span: metric?.defaultSpan ?? '1x1',
  };
}

export function validateDashboardLayout(value: unknown): DashboardCard[] {
  if (!Array.isArray(value)) {
    return defaultDashboardLayout;
  }

  const validCards = value
    .filter((card): card is DashboardCard => {
      if (!card || typeof card !== 'object') {
        return false;
      }

      const candidate = card as Partial<DashboardCard>;

      if (typeof candidate.span !== 'string') {
        return false;
      }

      const normalizedSpan = candidate.span.replace(
        '1/2x',
        '1.5x',
      ) as DashboardCardSpan;

      return (
        typeof candidate.id === 'string' &&
        typeof candidate.metricId === 'string' &&
        dashboardMetricById.has(candidate.metricId as DashboardMetricId) &&
        dashboardSpans.includes(normalizedSpan)
      );
    })
    .map((card) => ({
      ...card,
      span: card.span.replace('1/2x', '1.5x') as DashboardCardSpan,
    }));

  return validCards.length > 0 ? validCards : defaultDashboardLayout;
}
