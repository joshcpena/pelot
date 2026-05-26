import {
  formatAscent,
  formatCalories,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatTimeOfDay,
} from './metrics';
import {
  getEffectiveMaxHeartRateBpm,
  getHeartRateZone,
  getHeartRateZoneLabel,
} from './heartRateZones';
import type {
  DashboardCard,
  DashboardScreen,
  DashboardCardSpan,
  DashboardMetricId,
  DestinationOption,
  PlannedRoute,
  RideMetrics,
  RidePoint,
  RideSettings,
  RideStatus,
  RouteCoordinate,
} from './types';
import type { WeatherSample } from './weather';

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
  currentCoordinate: RouteCoordinate | null;
  plannedRoute: PlannedRoute | null;
  destinationOptions: DestinationOption[];
  isNavigating: boolean;
  rideStatus: RideStatus;
  now: number | null;
  heartRateBpm: number | null;
  heartRateStatus:
    | 'idle'
    | 'connecting'
    | 'connected'
    | 'unavailable'
    | 'error';
  heartRateError: string | null;
  deviceBatteryLevel: number | null;
  currentWeather: WeatherSample | null;
  weatherSamples: WeatherSample[];
};

export type DashboardMetricDefinition = {
  id: DashboardMetricId;
  label: string;
  category: DashboardMetricCategory;
  supportedSpans: DashboardCardSpan[];
  defaultSpan: DashboardCardSpan;
  getValue: (context: DashboardValueContext) => string;
};

export const DASHBOARD_COLUMNS = 3;
export const DASHBOARD_MAX_ROWS = 10;
const DASHBOARD_LAYOUT_EPSILON = 0.001;

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
  '3x6',
  '3x7',
  '3x8',
  '3x9',
  '3x10',
];

export const metricDashboardSpans: DashboardCardSpan[] = [
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

export const mapDashboardSpans: DashboardCardSpan[] = [
  '3x1',
  '3x2',
  '3x3',
  '3x4',
  '3x5',
  '3x6',
  '3x7',
  '3x8',
  '3x9',
  '3x10',
];

export function getDashboardSpanDimensions(span: DashboardCardSpan) {
  const [columns, rows] = span.split('x').map(Number);

  return { columns, rows };
}

export function getDashboardLayoutRows(layout: Pick<DashboardCard, 'span'>[]) {
  let totalRows = 0;
  let lineColumns = 0;
  let lineRows = 0;

  for (const card of layout) {
    const { columns, rows } = getDashboardSpanDimensions(card.span);

    if (
      lineColumns > 0 &&
      lineColumns + columns > DASHBOARD_COLUMNS + DASHBOARD_LAYOUT_EPSILON
    ) {
      totalRows += lineRows;
      lineColumns = 0;
      lineRows = 0;
    }

    lineColumns += columns;
    lineRows = Math.max(lineRows, rows);
  }

  return totalRows + lineRows;
}

export function dashboardLayoutFits(layout: Pick<DashboardCard, 'span'>[]) {
  return getDashboardLayoutRows(layout) <= DASHBOARD_MAX_ROWS;
}

export function getFittingDashboardLayout(layout: DashboardCard[]) {
  return layout.reduce<DashboardCard[]>((fittingLayout, card) => {
    const nextLayout = [...fittingLayout, card];

    return dashboardLayoutFits(nextLayout) ? nextLayout : fittingLayout;
  }, []);
}

export const defaultDashboardLayout: DashboardCard[] = [
  { id: 'card-map', metricId: 'map', span: '3x5' },
  { id: 'card-total-distance', metricId: 'totalDistance', span: '1.5x2' },
  { id: 'card-total-time', metricId: 'totalTimeRecorded', span: '1.5x2' },
  { id: 'card-speed-current', metricId: 'speedCurrent', span: '3x2' },
  { id: 'card-pace-current', metricId: 'paceCurrent', span: '1.5x1' },
  { id: 'card-calories-total', metricId: 'caloriesTotal', span: '1.5x1' },
];

export const defaultDashboardScreens: DashboardScreen[] = [
  { id: 'screen-main', layout: defaultDashboardLayout },
];

const metricSpans = metricDashboardSpans;
const heartRateZoneBarSpans: DashboardCardSpan[] = [
  '3x1',
  '1.5x2',
  '2x2',
  '3x2',
  '3x3',
  '3x4',
  '3x5',
];
const heartRateZoneGaugeSpans: DashboardCardSpan[] = [
  '1.5x2',
  '2x2',
  '3x2',
  '2x3',
  '3x3',
  '3x4',
  '3x5',
];
const ELEVATION_CHANGE_THRESHOLD_METERS = 3;
const KPH_TO_MPH = 0.621371;

function getLapPoints({ metrics, routePoints }: DashboardValueContext) {
  if (metrics.lapStartedAt == null) {
    return routePoints;
  }

  return routePoints.filter(
    (point) => point.recordedAt >= metrics.lapStartedAt!,
  );
}

function getAltitudePoints(points: RidePoint[]) {
  return points.filter(
    (point): point is RidePoint & { altitude: number } =>
      point.altitude != null,
  );
}

function sumElevationChangeMeters(
  points: RidePoint[],
  direction: 'up' | 'down',
) {
  const altitudePoints = getAltitudePoints(points);
  let total = 0;

  for (let index = 1; index < altitudePoints.length; index += 1) {
    const change =
      altitudePoints[index].altitude - altitudePoints[index - 1].altitude;

    if (direction === 'up' && change >= ELEVATION_CHANGE_THRESHOLD_METERS) {
      total += change;
    }

    if (direction === 'down' && change <= -ELEVATION_CHANGE_THRESHOLD_METERS) {
      total += Math.abs(change);
    }
  }

  return total;
}

function getCurrentElevationMeters(points: RidePoint[]) {
  return getAltitudePoints(points).at(-1)?.altitude ?? null;
}

function getAverageElevationMeters(points: RidePoint[]) {
  const altitudePoints = getAltitudePoints(points);

  if (altitudePoints.length === 0) {
    return null;
  }

  return (
    altitudePoints.reduce((total, point) => total + point.altitude, 0) /
    altitudePoints.length
  );
}

function getElevationExtremeMeters(points: RidePoint[], type: 'max' | 'min') {
  const altitudes = getAltitudePoints(points).map((point) => point.altitude);

  if (altitudes.length === 0) {
    return null;
  }

  return type === 'max' ? Math.max(...altitudes) : Math.min(...altitudes);
}

function getElevationTotalChangeMeters(points: RidePoint[]) {
  const altitudePoints = getAltitudePoints(points);
  const first = altitudePoints[0];
  const last = altitudePoints.at(-1);

  if (!first || !last) {
    return null;
  }

  return last.altitude - first.altitude;
}

function formatOptionalAscent(
  meters: number | null,
  unitSystem: RideSettings['unitSystem'],
) {
  return meters == null ? '--' : formatAscent(meters, unitSystem);
}

function formatGrade(value: number | null) {
  return value == null ? '--' : `${value.toFixed(1)}%`;
}

function formatBatteryLevel(level: number | null) {
  return level == null ? '--' : `${Math.round(level * 100)}%`;
}

function formatCurrentHeartRate({
  heartRateBpm,
  heartRateStatus,
  heartRateError,
  settings,
}: DashboardValueContext) {
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
}

function formatHeartRateZone(context: DashboardValueContext) {
  const currentHeartRate = formatCurrentHeartRate(context);

  if (
    !context.settings.connectedHeartRateDevice ||
    context.heartRateBpm == null
  ) {
    return currentHeartRate;
  }

  const maxHeartRate = getEffectiveMaxHeartRateBpm(context.settings);

  if (!maxHeartRate) {
    return 'Set age or max HR';
  }

  const result = getHeartRateZone(context.heartRateBpm, maxHeartRate.bpm);

  return result ? getHeartRateZoneLabel(result) : '--';
}

function formatTemperature(
  temperatureC: number | null,
  unitSystem: RideSettings['unitSystem'],
) {
  if (temperatureC == null) {
    return '--';
  }

  if (unitSystem === 'metric') {
    return `${Math.round(temperatureC)}°C`;
  }

  return `${Math.round((temperatureC * 9) / 5 + 32)}°F`;
}

function formatWindSpeed(
  windSpeedKph: number | null,
  unitSystem: RideSettings['unitSystem'],
) {
  if (windSpeedKph == null) {
    return '--';
  }

  if (unitSystem === 'metric') {
    return `${Math.round(windSpeedKph)} km/h`;
  }

  return `${Math.round(windSpeedKph * KPH_TO_MPH)} mph`;
}

function getWeatherSamplesForScope(
  context: DashboardValueContext,
  scope: 'ride' | 'lap',
) {
  if (scope === 'ride' || context.metrics.lapStartedAt == null) {
    return context.weatherSamples;
  }

  return context.weatherSamples.filter(
    (sample) => sample.recordedAt >= context.metrics.lapStartedAt!,
  );
}

function getWeatherValue(
  samples: WeatherSample[],
  field: 'temperatureC' | 'windSpeedKph',
  aggregation: 'average' | 'max' | 'min',
) {
  const values = samples
    .map((sample) => sample[field])
    .filter((value): value is number => value != null);

  if (values.length === 0) {
    return null;
  }

  if (aggregation === 'average') {
    return values.reduce((total, value) => total + value, 0) / values.length;
  }

  return aggregation === 'max' ? Math.max(...values) : Math.min(...values);
}

function getSegmentGrades(points: RidePoint[]) {
  const grades: number[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];

    if (previous.altitude == null || next.altitude == null) {
      continue;
    }

    const distanceMeters = distanceBetweenCoordinates(previous, next);

    if (distanceMeters < 5) {
      continue;
    }

    grades.push(((next.altitude - previous.altitude) / distanceMeters) * 100);
  }

  return grades;
}

function getCurrentGrade(points: RidePoint[]) {
  const altitudePoints = getAltitudePoints(points);

  for (let index = altitudePoints.length - 1; index > 0; index -= 1) {
    const previous = altitudePoints[index - 1];
    const next = altitudePoints[index];
    const distanceMeters = distanceBetweenCoordinates(previous, next);

    if (distanceMeters >= 5) {
      return ((next.altitude - previous.altitude) / distanceMeters) * 100;
    }
  }

  return null;
}

function getAverageGrade(points: RidePoint[]) {
  const altitudePoints = getAltitudePoints(points);
  const first = altitudePoints[0];
  const last = altitudePoints.at(-1);

  if (!first || !last) {
    return null;
  }

  const distanceMeters = distanceBetweenCoordinates(first, last);

  return distanceMeters > 0
    ? ((last.altitude - first.altitude) / distanceMeters) * 100
    : null;
}

function getGradeExtreme(points: RidePoint[], type: 'max' | 'min') {
  const grades = getSegmentGrades(points);

  if (grades.length === 0) {
    return null;
  }

  return type === 'max' ? Math.max(...grades) : Math.min(...grades);
}

function distanceBetweenCoordinates(a: RidePoint, b: RidePoint) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(b.latitude - a.latitude);
  const deltaLongitude = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(deltaLongitude / 2) ** 2;

  return (
    earthRadiusMeters *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function getCurrentCoordinate(routePoints: RidePoint[]) {
  return routePoints.at(-1) ?? null;
}

function getSunTime(
  routePoints: RidePoint[],
  timestamp: number | null,
  type: 'sunrise' | 'sunset',
) {
  const coordinate = getCurrentCoordinate(routePoints);

  if (!coordinate || timestamp == null) {
    return null;
  }

  const date = new Date(timestamp);
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (date.getTime() - startOfYear.getTime()) / 86_400_000,
  );
  const longitudeHour = coordinate.longitude / 15;
  const approximateTime =
    dayOfYear + ((type === 'sunrise' ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin(toRadians(meanAnomaly)) +
      0.02 * Math.sin(2 * toRadians(meanAnomaly)) +
      282.634,
  );
  const rightAscension = normalizeDegrees(
    toDegrees(Math.atan(0.91764 * Math.tan(toRadians(trueLongitude)))),
  );
  const adjustedRightAscension =
    rightAscension +
    Math.floor(trueLongitude / 90) * 90 -
    Math.floor(rightAscension / 90) * 90;
  const sinDeclination = 0.39782 * Math.sin(toRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle =
    (Math.cos(toRadians(90.833)) -
      sinDeclination * Math.sin(toRadians(coordinate.latitude))) /
    (cosDeclination * Math.cos(toRadians(coordinate.latitude)));

  if (cosHourAngle < -1 || cosHourAngle > 1) {
    return null;
  }

  const hourAngle =
    type === 'sunrise'
      ? 360 - toDegrees(Math.acos(cosHourAngle))
      : toDegrees(Math.acos(cosHourAngle));
  const localMeanTime =
    hourAngle / 15 +
    adjustedRightAscension / 15 -
    0.06571 * approximateTime -
    6.622;
  const utcHour = normalizeHours(localMeanTime - longitudeHour);
  const result = new Date(date);

  result.setUTCHours(0, 0, 0, 0);
  result.setTime(result.getTime() + utcHour * 3_600_000);

  return result.getTime();
}

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function normalizeDegrees(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

function normalizeHours(hours: number) {
  return ((hours % 24) + 24) % 24;
}

export const dashboardMetricCatalog: DashboardMetricDefinition[] = [
  {
    id: 'caloriesTotal',
    label: 'Total Calories',
    category: 'Calories',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatCalories(metrics.activeCaloriesKcal),
  },
  {
    id: 'caloriesLap',
    label: 'Lap Calories',
    category: 'Calories',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatCalories(metrics.lapActiveCaloriesKcal),
  },
  {
    id: 'deviceBatteryLevel',
    label: 'Device Battery Level',
    category: 'Device',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ deviceBatteryLevel }) =>
      formatBatteryLevel(deviceBatteryLevel),
  },
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
    label: 'Lap Distance',
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
    label: 'Lap Ascent',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatAscent(metrics.lapAscentMeters, settings.unitSystem),
  },
  {
    id: 'totalDescent',
    label: 'Total Descent',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints, settings }) =>
      formatAscent(
        sumElevationChangeMeters(routePoints, 'down'),
        settings.unitSystem,
      ),
  },
  {
    id: 'lapTotalDescent',
    label: 'Lap Descent',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatAscent(
        sumElevationChangeMeters(getLapPoints(context), 'down'),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'elevationCurrent',
    label: 'Current Elevation',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints, settings }) =>
      formatOptionalAscent(
        getCurrentElevationMeters(routePoints),
        settings.unitSystem,
      ),
  },
  {
    id: 'elevationAverage',
    label: 'Average Elevation',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints, settings }) =>
      formatOptionalAscent(
        getAverageElevationMeters(routePoints),
        settings.unitSystem,
      ),
  },
  {
    id: 'elevationLapAverage',
    label: 'Lap Average Elevation',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatOptionalAscent(
        getAverageElevationMeters(getLapPoints(context)),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'elevationMax',
    label: 'Max Elevation',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints, settings }) =>
      formatOptionalAscent(
        getElevationExtremeMeters(routePoints, 'max'),
        settings.unitSystem,
      ),
  },
  {
    id: 'elevationLapMax',
    label: 'Lap Max Elevation',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatOptionalAscent(
        getElevationExtremeMeters(getLapPoints(context), 'max'),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'elevationMin',
    label: 'Min Elevation',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints, settings }) =>
      formatOptionalAscent(
        getElevationExtremeMeters(routePoints, 'min'),
        settings.unitSystem,
      ),
  },
  {
    id: 'elevationLapMin',
    label: 'Lap Min Elevation',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatOptionalAscent(
        getElevationExtremeMeters(getLapPoints(context), 'min'),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'elevationTotalChange',
    label: 'Total Elevation Change',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints, settings }) =>
      formatOptionalAscent(
        getElevationTotalChangeMeters(routePoints),
        settings.unitSystem,
      ),
  },
  {
    id: 'gradeCurrent',
    label: 'Current Grade',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints }) => formatGrade(getCurrentGrade(routePoints)),
  },
  {
    id: 'gradeAverage',
    label: 'Average Grade',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints }) => formatGrade(getAverageGrade(routePoints)),
  },
  {
    id: 'gradeLapAverage',
    label: 'Lap Average Grade',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) => formatGrade(getAverageGrade(getLapPoints(context))),
  },
  {
    id: 'gradeMax',
    label: 'Max Grade',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints }) =>
      formatGrade(getGradeExtreme(routePoints, 'max')),
  },
  {
    id: 'gradeMin',
    label: 'Min Grade',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints }) =>
      formatGrade(getGradeExtreme(routePoints, 'min')),
  },
  {
    id: 'gradeLapMin',
    label: 'Lap Min Grade',
    category: 'Elevation',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatGrade(getGradeExtreme(getLapPoints(context), 'min')),
  },
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
    supportedSpans: mapDashboardSpans,
    defaultSpan: '3x3',
    getValue: () => '',
  },
  {
    id: 'paceCurrent',
    label: 'Current Pace',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.currentSpeedMps, settings.unitSystem),
  },
  {
    id: 'paceAverage',
    label: 'Average Pace',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.averageSpeedMps, settings.unitSystem),
  },
  {
    id: 'paceLapAverage',
    label: 'Lap Average Pace',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.lapAverageSpeedMps, settings.unitSystem),
  },
  {
    id: 'paceMax',
    label: 'Max Pace',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.maxSpeedMps, settings.unitSystem),
  },
  {
    id: 'paceLapMax',
    label: 'Lap Max Pace',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatPace(metrics.lapMaxSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedCurrent',
    label: 'Current Speed',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '3x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.currentSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedMax',
    label: 'Max Speed',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.maxSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedAverage',
    label: 'Average Speed',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.averageSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedLapAverage',
    label: 'Lap Average Speed',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.lapAverageSpeedMps, settings.unitSystem),
  },
  {
    id: 'speedLapMax',
    label: 'Lap Max Speed',
    category: 'Speed & Pace',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics, settings }) =>
      formatSpeed(metrics.lapMaxSpeedMps, settings.unitSystem),
  },
  {
    id: 'totalTimeRecorded',
    label: 'Moving Time',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.movingSeconds),
  },
  {
    id: 'totalLapTimeRecorded',
    label: 'Lap Moving Time',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.lapMovingSeconds),
  },
  {
    id: 'totalElapsed',
    label: 'Elapsed Time',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.elapsedSeconds),
  },
  {
    id: 'totalLapTimeElapsed',
    label: 'Lap Elapsed Time',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.lapElapsedSeconds),
  },
  {
    id: 'timeTotalPaused',
    label: 'Total Paused Time',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.pausedSeconds),
  },
  {
    id: 'timeLapTotalPaused',
    label: 'Lap Paused Time',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatDuration(metrics.lapPausedSeconds),
  },
  {
    id: 'timeStart',
    label: 'Start Time',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatTimeOfDay(metrics.startedAt),
  },
  {
    id: 'timeLapStart',
    label: 'Lap Start Time',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ metrics }) => formatTimeOfDay(metrics.lapStartedAt),
  },
  {
    id: 'timeOfDay',
    label: 'Time of Day',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ now }) => formatTimeOfDay(now),
  },
  {
    id: 'sunrise',
    label: 'Sunrise',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints, metrics, now }) =>
      formatTimeOfDay(
        getSunTime(routePoints, now ?? metrics.startedAt, 'sunrise'),
      ),
  },
  {
    id: 'sunset',
    label: 'Sunset',
    category: 'Time',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ routePoints, metrics, now }) =>
      formatTimeOfDay(
        getSunTime(routePoints, now ?? metrics.startedAt, 'sunset'),
      ),
  },
  {
    id: 'temperatureCurrent',
    label: 'Current Temperature',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ currentWeather, settings }) =>
      formatTemperature(
        currentWeather?.temperatureC ?? null,
        settings.unitSystem,
      ),
  },
  {
    id: 'temperatureAverage',
    label: 'Average Temp',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatTemperature(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'ride'),
          'temperatureC',
          'average',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'temperatureLapAverage',
    label: 'Lap Average Temp',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatTemperature(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'lap'),
          'temperatureC',
          'average',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'temperatureMax',
    label: 'Max Temp',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatTemperature(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'ride'),
          'temperatureC',
          'max',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'temperatureLapMax',
    label: 'Lap Max Temp',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatTemperature(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'lap'),
          'temperatureC',
          'max',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'temperatureMin',
    label: 'Min Temp',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatTemperature(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'ride'),
          'temperatureC',
          'min',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'temperatureLapMin',
    label: 'Lap Min Temp',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatTemperature(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'lap'),
          'temperatureC',
          'min',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'windCurrent',
    label: 'Current Wind',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: ({ currentWeather, settings }) =>
      formatWindSpeed(
        currentWeather?.windSpeedKph ?? null,
        settings.unitSystem,
      ),
  },
  {
    id: 'windAverage',
    label: 'Average Wind',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatWindSpeed(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'ride'),
          'windSpeedKph',
          'average',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'windLapAverage',
    label: 'Lap Average Wind',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatWindSpeed(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'lap'),
          'windSpeedKph',
          'average',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'windMax',
    label: 'Max Wind',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatWindSpeed(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'ride'),
          'windSpeedKph',
          'max',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'windLapMax',
    label: 'Lap Max Wind',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatWindSpeed(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'lap'),
          'windSpeedKph',
          'max',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'windMin',
    label: 'Min Wind',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatWindSpeed(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'ride'),
          'windSpeedKph',
          'min',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'windLapMin',
    label: 'Lap Min Wind',
    category: 'Weather',
    supportedSpans: metricSpans,
    defaultSpan: '1x1',
    getValue: (context) =>
      formatWindSpeed(
        getWeatherValue(
          getWeatherSamplesForScope(context, 'lap'),
          'windSpeedKph',
          'min',
        ),
        context.settings.unitSystem,
      ),
  },
  {
    id: 'heartRateCurrent',
    label: 'Current Heart Rate',
    category: 'Health',
    supportedSpans: metricSpans,
    defaultSpan: '1.5x2',
    getValue: formatCurrentHeartRate,
  },
  {
    id: 'heartRateZoneBar',
    label: 'Heart Rate Zone Bar',
    category: 'Health',
    supportedSpans: heartRateZoneBarSpans,
    defaultSpan: '3x2',
    getValue: formatHeartRateZone,
  },
  {
    id: 'heartRateZoneGauge',
    label: 'Heart Rate Zone Gauge',
    category: 'Health',
    supportedSpans: heartRateZoneGaugeSpans,
    defaultSpan: '1.5x2',
    getValue: formatHeartRateZone,
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

export function createDashboardScreen(
  layout: DashboardCard[] = [],
): DashboardScreen {
  return {
    id: `screen-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    layout: getFittingDashboardLayout(layout),
  };
}

export function canAddDashboardMetric(
  layout: DashboardCard[],
  metricId: DashboardMetricId,
) {
  const metric = dashboardMetricById.get(metricId);

  if (!metric) {
    return false;
  }

  return dashboardLayoutFits([
    ...layout,
    {
      id: 'card-preview',
      metricId,
      span: metric.defaultSpan,
    },
  ]);
}

export function validateDashboardLayout(
  value: unknown,
  fallback: DashboardCard[] = defaultDashboardLayout,
): DashboardCard[] {
  if (!Array.isArray(value)) {
    return fallback;
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

      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.metricId !== 'string'
      ) {
        return false;
      }

      const metric = dashboardMetricById.get(
        candidate.metricId as DashboardMetricId,
      );

      return metric ? metric.supportedSpans.includes(normalizedSpan) : false;
    })
    .map((card) => ({
      ...card,
      span: card.span.replace('1/2x', '1.5x') as DashboardCardSpan,
    }));
  const fittingCards = getFittingDashboardLayout(validCards);

  return fittingCards.length > 0 ? fittingCards : fallback;
}

export function validateDashboardScreens(value: unknown): DashboardScreen[] {
  if (!Array.isArray(value)) {
    return defaultDashboardScreens;
  }

  const validScreens = value
    .filter((screen): screen is DashboardScreen => {
      if (!screen || typeof screen !== 'object') {
        return false;
      }

      const candidate = screen as Partial<DashboardScreen>;

      return (
        typeof candidate.id === 'string' && Array.isArray(candidate.layout)
      );
    })
    .map((screen) => ({
      id: screen.id,
      layout: validateDashboardLayout(screen.layout, []),
    }));

  return validScreens.length > 0 ? validScreens : defaultDashboardScreens;
}
