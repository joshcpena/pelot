import type {
  AscentSource,
  RideMetrics,
  RidePoint,
  RideSettings,
} from './types';

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_SECOND_TO_MILES_PER_HOUR = 2.236936;
const GPS_ELEVATION_GAIN_THRESHOLD_METERS = 1.5;
const BAROMETER_ELEVATION_GAIN_THRESHOLD_METERS = 1;

type ElevationTrend = 'unknown' | 'ascending' | 'descending';

export type ElevationGainAccumulator = {
  addAltitude(altitude: number | null): number;
  addSegment(
    previous: Pick<RidePoint, 'altitude'>,
    next: Pick<RidePoint, 'altitude'>,
  ): number;
  resetBaseline(altitude: number | null): number;
  getGainMeters(): number;
};

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function distanceBetweenMeters(a: RidePoint, b: RidePoint) {
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function positiveElevationGainMeters(
  previous: RidePoint,
  next: RidePoint,
  thresholdMeters = GPS_ELEVATION_GAIN_THRESHOLD_METERS,
) {
  if (previous.altitude == null || next.altitude == null) {
    return 0;
  }

  const gain = next.altitude - previous.altitude;
  return gain >= thresholdMeters ? gain : 0;
}

export function getElevationGainThresholdMeters(ascentSource: AscentSource) {
  return ascentSource === 'barometer-preferred'
    ? BAROMETER_ELEVATION_GAIN_THRESHOLD_METERS
    : GPS_ELEVATION_GAIN_THRESHOLD_METERS;
}

export function createElevationGainAccumulator(
  thresholdMeters = GPS_ELEVATION_GAIN_THRESHOLD_METERS,
): ElevationGainAccumulator {
  let committedGainMeters = 0;
  let lowAltitude: number | null = null;
  let highAltitude: number | null = null;
  let trend: ElevationTrend = 'unknown';

  function setBaseline(altitude: number) {
    lowAltitude = altitude;
    highAltitude = altitude;
    trend = 'unknown';
  }

  function getActiveClimbMeters() {
    if (trend !== 'ascending' || lowAltitude == null || highAltitude == null) {
      return 0;
    }

    const activeClimbMeters = highAltitude - lowAltitude;

    return activeClimbMeters >= thresholdMeters ? activeClimbMeters : 0;
  }

  function commitActiveClimb() {
    committedGainMeters += getActiveClimbMeters();
  }

  function getGainMeters() {
    return committedGainMeters + getActiveClimbMeters();
  }

  function addAltitude(altitude: number | null) {
    if (altitude == null) {
      return getGainMeters();
    }

    if (lowAltitude == null || highAltitude == null) {
      setBaseline(altitude);
      return getGainMeters();
    }

    if (trend === 'ascending') {
      if (altitude > highAltitude) {
        highAltitude = altitude;
      } else if (highAltitude - altitude >= thresholdMeters) {
        commitActiveClimb();
        setBaseline(altitude);
        trend = 'descending';
      }

      return getGainMeters();
    }

    if (trend === 'descending') {
      if (altitude < lowAltitude) {
        lowAltitude = altitude;
        highAltitude = altitude;
      } else if (altitude - lowAltitude >= thresholdMeters) {
        highAltitude = altitude;
        trend = 'ascending';
      }

      return getGainMeters();
    }

    if (altitude > highAltitude) {
      highAltitude = altitude;
    }

    if (altitude < lowAltitude) {
      lowAltitude = altitude;
    }

    if (highAltitude - lowAltitude >= thresholdMeters) {
      if (altitude >= highAltitude) {
        trend = 'ascending';
      } else {
        setBaseline(altitude);
        trend = 'descending';
      }
    }

    return getGainMeters();
  }

  return {
    addAltitude,
    addSegment(previous, next) {
      addAltitude(previous.altitude);
      return addAltitude(next.altitude);
    },
    resetBaseline(altitude) {
      commitActiveClimb();
      lowAltitude = null;
      highAltitude = null;
      trend = 'unknown';

      if (altitude != null) {
        setBaseline(altitude);
      }

      return getGainMeters();
    },
    getGainMeters,
  };
}

export function calculateElevationGainMeters<
  TPoint extends Pick<RidePoint, 'altitude'>,
>(
  points: TPoint[],
  shouldCountSegment: (previous: TPoint, next: TPoint) => boolean = () => true,
  thresholdMeters = GPS_ELEVATION_GAIN_THRESHOLD_METERS,
) {
  const accumulator = createElevationGainAccumulator(thresholdMeters);

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];

    if (!shouldCountSegment(previous, next)) {
      accumulator.resetBaseline(next.altitude);
      continue;
    }

    accumulator.addSegment(previous, next);
  }

  return accumulator.getGainMeters();
}

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatDistance(
  meters: number,
  unitSystem: 'imperial' | 'metric',
) {
  if (unitSystem === 'metric') {
    return `${(meters / 1000).toFixed(2)} km`;
  }

  return `${(meters / 1609.344).toFixed(2)} mi`;
}

export function formatSpeed(mps: number, unitSystem: 'imperial' | 'metric') {
  if (unitSystem === 'metric') {
    return `${(mps * 3.6).toFixed(1)} km/h`;
  }

  return `${(mps * 2.236936).toFixed(1)} mph`;
}

export function formatPace(mps: number, unitSystem: 'imperial' | 'metric') {
  if (mps <= 0) {
    return '--';
  }

  const metersPerUnit = unitSystem === 'metric' ? 1000 : 1609.344;
  const roundedSecondsPerUnit = Math.round(metersPerUnit / mps);
  const minutes = Math.floor(roundedSecondsPerUnit / 60);
  const seconds = roundedSecondsPerUnit % 60;
  const unit = unitSystem === 'metric' ? 'km' : 'mi';

  return `${minutes}:${seconds.toString().padStart(2, '0')} /${unit}`;
}

export function formatAscent(
  meters: number,
  unitSystem: 'imperial' | 'metric',
) {
  if (unitSystem === 'metric') {
    return `${Math.round(meters)} m`;
  }

  return `${Math.round(meters * 3.28084)} ft`;
}

export function getCyclingMet(averageSpeedMps: number) {
  const mph = averageSpeedMps * METERS_PER_SECOND_TO_MILES_PER_HOUR;

  if (mph < 10) {
    return 4;
  }

  if (mph < 12) {
    return 6.8;
  }

  if (mph < 14) {
    return 8;
  }

  if (mph < 16) {
    return 10;
  }

  if (mph < 20) {
    return 12;
  }

  return 16.8;
}

function getMifflinStJeorRmrKcalPerDay(settings: RideSettings) {
  if (
    settings.riderWeightKg == null ||
    settings.riderHeightCm == null ||
    settings.riderAgeYears == null ||
    settings.riderSex == null
  ) {
    return null;
  }

  const sexOffset = settings.riderSex === 'male' ? 5 : -161;

  return (
    10 * settings.riderWeightKg +
    6.25 * settings.riderHeightCm -
    5 * settings.riderAgeYears +
    sexOffset
  );
}

function getEstimatedWeightKg(settings: RideSettings) {
  return settings.riderWeightKg ?? 75;
}

export function estimateActiveCyclingCaloriesKcal(
  movingSeconds: number,
  averageSpeedMps: number,
  settings: RideSettings,
) {
  if (movingSeconds <= 0) {
    return 0;
  }

  const rmrKcalPerDay = getMifflinStJeorRmrKcalPerDay(settings);

  if (rmrKcalPerDay == null) {
    const met = getCyclingMet(averageSpeedMps);
    const movingMinutes = movingSeconds / 60;

    return (
      (Math.max(0, met - 1) *
        3.5 *
        getEstimatedWeightKg(settings) *
        movingMinutes) /
      200
    );
  }

  const met = getCyclingMet(averageSpeedMps);
  const rmrKcalPerMinute = rmrKcalPerDay / 1440;
  const movingMinutes = movingSeconds / 60;

  return Math.max(0, met - 1) * rmrKcalPerMinute * movingMinutes;
}

export function withEstimatedCalories(
  metrics: RideMetrics,
  settings: RideSettings,
): RideMetrics {
  return {
    ...metrics,
    activeCaloriesKcal: estimateActiveCyclingCaloriesKcal(
      metrics.movingSeconds,
      metrics.averageSpeedMps,
      settings,
    ),
    lapActiveCaloriesKcal: estimateActiveCyclingCaloriesKcal(
      metrics.lapMovingSeconds,
      metrics.lapAverageSpeedMps,
      settings,
    ),
  };
}

export function formatCalories(kcal: number | null) {
  if (kcal == null) {
    return '--';
  }

  return `${Math.round(kcal)} kcal`;
}

export function formatTimeOfDay(timestamp: number | null) {
  if (timestamp == null) {
    return '--';
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}
