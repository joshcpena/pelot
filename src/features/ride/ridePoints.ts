import type { RidePoint } from './types';

export function getRidePointKey(point: RidePoint) {
  return [point.recordedAt, point.latitude, point.longitude].join(':');
}

function compareRidePoints(first: RidePoint, second: RidePoint) {
  return first.recordedAt - second.recordedAt;
}

export function mergeRidePoints(...pointLists: RidePoint[][]) {
  const pointsByKey = new Map<string, RidePoint>();

  for (const points of pointLists) {
    for (const point of points) {
      pointsByKey.set(getRidePointKey(point), point);
    }
  }

  return [...pointsByKey.values()].sort(compareRidePoints);
}

function areOptionalNumbersEqual(first: number | null, second: number | null) {
  return Object.is(first, second);
}

export function areRidePointsEqual(first: RidePoint, second: RidePoint) {
  return (
    Object.is(first.recordedAt, second.recordedAt) &&
    Object.is(first.latitude, second.latitude) &&
    Object.is(first.longitude, second.longitude) &&
    areOptionalNumbersEqual(first.altitude, second.altitude) &&
    areOptionalNumbersEqual(first.speedMps, second.speedMps) &&
    areOptionalNumbersEqual(first.heading, second.heading) &&
    areOptionalNumbersEqual(
      first.horizontalAccuracy,
      second.horizontalAccuracy,
    ) &&
    areOptionalNumbersEqual(first.verticalAccuracy, second.verticalAccuracy)
  );
}

export function areRidePointListsEqual(
  firstPoints: RidePoint[],
  secondPoints: RidePoint[],
) {
  return (
    firstPoints.length === secondPoints.length &&
    firstPoints.every((point, index) =>
      areRidePointsEqual(point, secondPoints[index]),
    )
  );
}
