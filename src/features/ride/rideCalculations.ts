import { distanceBetweenMeters, positiveElevationGainMeters } from './metrics';
import type { RideMetrics, RidePoint, RideSettings, SplitType } from './types';

export type RideSplit = {
  splitType: SplitType;
  splitIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  averageSpeedMps: number;
  ascentMeters: number;
};

export type RidePauseInterval = {
  startedAt: number;
  endedAt: number;
};

const SPLIT_EPSILON = 0.000001;

function doesSegmentOverlapPause(
  segmentStartedAt: number,
  segmentEndedAt: number,
  pauseIntervals: RidePauseInterval[],
) {
  return pauseIntervals.some(
    (pause) =>
      segmentStartedAt < pause.endedAt && segmentEndedAt > pause.startedAt,
  );
}

export function calculateMetricsFromPoints(
  points: RidePoint[],
  pauseIntervals: RidePauseInterval[] = [],
): RideMetrics {
  let distanceMeters = 0;
  let ascentMeters = 0;
  let movingSeconds = 0;
  let maxSpeedMps = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const seconds = Math.max(
      0,
      Math.round((next.recordedAt - previous.recordedAt) / 1000),
    );

    if (
      doesSegmentOverlapPause(
        previous.recordedAt,
        next.recordedAt,
        pauseIntervals,
      )
    ) {
      continue;
    }

    const distance = distanceBetweenMeters(previous, next);
    const speed = next.speedMps ?? (seconds > 0 ? distance / seconds : 0);

    distanceMeters += distance;
    ascentMeters += positiveElevationGainMeters(previous, next);
    movingSeconds += seconds;
    maxSpeedMps = Math.max(maxSpeedMps, speed);
  }

  const elapsedSeconds =
    points.length > 1
      ? Math.max(
          0,
          Math.round(
            (points[points.length - 1].recordedAt - points[0].recordedAt) /
              1000,
          ),
        )
      : 0;

  return {
    startedAt: points[0]?.recordedAt ?? null,
    elapsedSeconds,
    movingSeconds,
    pausedSeconds: 0,
    distanceMeters,
    ascentMeters,
    activeCaloriesKcal: null,
    currentSpeedMps: points[points.length - 1]?.speedMps ?? 0,
    averageSpeedMps: movingSeconds > 0 ? distanceMeters / movingSeconds : 0,
    maxSpeedMps,
    lapNumber: 1,
    lapStartedAt: points[0]?.recordedAt ?? null,
    lapElapsedSeconds: elapsedSeconds,
    lapPausedSeconds: 0,
    lapMovingSeconds: movingSeconds,
    lapDistanceMeters: distanceMeters,
    lapAscentMeters: ascentMeters,
    lapActiveCaloriesKcal: null,
    lapAverageSpeedMps: movingSeconds > 0 ? distanceMeters / movingSeconds : 0,
    lapMaxSpeedMps: maxSpeedMps,
  };
}

function createSplit(
  splitType: SplitType,
  splitIndex: number,
  distanceMeters: number,
  durationSeconds: number,
  ascentMeters: number,
): RideSplit {
  const roundedDurationSeconds = Math.max(0, Math.round(durationSeconds));

  return {
    splitType,
    splitIndex,
    distanceMeters,
    durationSeconds: roundedDurationSeconds,
    averageSpeedMps: durationSeconds > 0 ? distanceMeters / durationSeconds : 0,
    ascentMeters,
  };
}

export function buildRideSplits(
  points: RidePoint[],
  settings: Pick<
    RideSettings,
    'splitDistanceMeters' | 'splitDurationSeconds' | 'splitType'
  >,
  pauseIntervals: RidePauseInterval[] = [],
): RideSplit[] {
  const target =
    settings.splitType === 'distance'
      ? settings.splitDistanceMeters
      : settings.splitDurationSeconds;

  if (target <= 0) {
    return [];
  }

  const splits: RideSplit[] = [];
  let splitDistanceMeters = 0;
  let splitDurationSeconds = 0;
  let splitAscentMeters = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    const durationSeconds = Math.max(
      0,
      Math.round((next.recordedAt - previous.recordedAt) / 1000),
    );

    if (
      doesSegmentOverlapPause(
        previous.recordedAt,
        next.recordedAt,
        pauseIntervals,
      )
    ) {
      continue;
    }

    let remainingDistanceMeters = distanceBetweenMeters(previous, next);
    let remainingDurationSeconds = durationSeconds;
    let remainingAscentMeters = positiveElevationGainMeters(previous, next);

    while (
      remainingDistanceMeters > SPLIT_EPSILON ||
      remainingDurationSeconds > SPLIT_EPSILON
    ) {
      const splitProgress =
        settings.splitType === 'distance'
          ? splitDistanceMeters
          : splitDurationSeconds;
      const remainingProgress =
        settings.splitType === 'distance'
          ? remainingDistanceMeters
          : remainingDurationSeconds;

      if (remainingProgress <= SPLIT_EPSILON) {
        splitDistanceMeters += remainingDistanceMeters;
        splitDurationSeconds += remainingDurationSeconds;
        splitAscentMeters += remainingAscentMeters;
        break;
      }

      const progressToTarget = target - splitProgress;
      const consumedProgress = Math.min(progressToTarget, remainingProgress);
      const consumedRatio = consumedProgress / remainingProgress;
      const consumedDistanceMeters = remainingDistanceMeters * consumedRatio;
      const consumedDurationSeconds = remainingDurationSeconds * consumedRatio;
      const consumedAscentMeters = remainingAscentMeters * consumedRatio;

      splitDistanceMeters += consumedDistanceMeters;
      splitDurationSeconds += consumedDurationSeconds;
      splitAscentMeters += consumedAscentMeters;
      remainingDistanceMeters -= consumedDistanceMeters;
      remainingDurationSeconds -= consumedDurationSeconds;
      remainingAscentMeters -= consumedAscentMeters;

      const didReachTarget =
        splitProgress + consumedProgress >= target - SPLIT_EPSILON;

      if (didReachTarget) {
        splits.push(
          createSplit(
            settings.splitType,
            splits.length + 1,
            splitDistanceMeters,
            splitDurationSeconds,
            splitAscentMeters,
          ),
        );
        splitDistanceMeters = 0;
        splitDurationSeconds = 0;
        splitAscentMeters = 0;
      }
    }
  }

  if (
    splitDistanceMeters > SPLIT_EPSILON ||
    splitDurationSeconds > SPLIT_EPSILON
  ) {
    splits.push(
      createSplit(
        settings.splitType,
        splits.length + 1,
        splitDistanceMeters,
        splitDurationSeconds,
        splitAscentMeters,
      ),
    );
  }

  return splits;
}
