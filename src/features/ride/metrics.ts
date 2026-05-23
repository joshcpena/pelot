import type { RidePoint } from './types';

const EARTH_RADIUS_METERS = 6_371_000;

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
) {
  if (previous.altitude == null || next.altitude == null) {
    return 0;
  }

  const gain = next.altitude - previous.altitude;
  return gain >= 3 ? gain : 0;
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

export function formatAscent(
  meters: number,
  unitSystem: 'imperial' | 'metric',
) {
  if (unitSystem === 'metric') {
    return `${Math.round(meters)} m`;
  }

  return `${Math.round(meters * 3.28084)} ft`;
}
