import {
  distanceBetweenMeters,
  positiveElevationGainMeters,
  withEstimatedCalories,
} from './metrics';
import {
  calculateMetricsFromPoints,
  type RidePauseInterval,
} from './rideCalculations';
import { areRidePointListsEqual, mergeRidePoints } from './ridePoints';
import type {
  RideMetrics,
  RidePoint,
  RideSettings,
  RouteCoordinate,
} from './types';

export const RIDE_RECORDING_STOPPED_SPEED_MPS = 0.75;

export const initialRideRecordingMetrics: RideMetrics = {
  startedAt: null,
  elapsedSeconds: 0,
  movingSeconds: 0,
  pausedSeconds: 0,
  distanceMeters: 0,
  ascentMeters: 0,
  activeCaloriesKcal: null,
  currentSpeedMps: 0,
  averageSpeedMps: 0,
  maxSpeedMps: 0,
  lapNumber: 1,
  lapStartedAt: null,
  lapElapsedSeconds: 0,
  lapPausedSeconds: 0,
  lapMovingSeconds: 0,
  lapDistanceMeters: 0,
  lapAscentMeters: 0,
  lapActiveCaloriesKcal: null,
  lapAverageSpeedMps: 0,
  lapMaxSpeedMps: 0,
};

export type RideRecordingPointIngestionResult = {
  didChangeRoutePoints: boolean;
  shouldPersistPoint: boolean;
  didAutoLap: boolean;
};

export type RideRecordingTimingResult = {
  didAutoLap: boolean;
};

export type RideRecordingFinishSnapshot = {
  metrics: RideMetrics;
  routePoints: RidePoint[];
  pauseIntervals: RidePauseInterval[];
};

export type RideRecordingAccumulator = {
  updateSettings(settings: RideSettings): void;
  getMetrics(): RideMetrics;
  getRoutePoints(): RidePoint[];
  getCurrentCoordinate(): RouteCoordinate | null;
  getIsAutoPaused(): boolean;
  getPauseIntervals(now?: number): RidePauseInterval[];
  refreshTiming(now?: number): RideRecordingTimingResult;
  beginManualPause(now?: number): RideRecordingTimingResult;
  endManualPause(now?: number): RideRecordingTimingResult;
  setAutoPaused(
    nextIsAutoPaused: boolean,
    now?: number,
  ): RideRecordingTimingResult;
  markLap(now?: number): RideRecordingTimingResult;
  ingestPoint(
    point: RidePoint,
    now?: number,
  ): RideRecordingPointIngestionResult;
  replacePointsFromPersistence(
    points: RidePoint[],
    now?: number,
  ): RideRecordingTimingResult;
  finish(now?: number): RideRecordingFinishSnapshot;
};

type TimingMetrics = Pick<
  RideMetrics,
  | 'elapsedSeconds'
  | 'movingSeconds'
  | 'pausedSeconds'
  | 'lapElapsedSeconds'
  | 'lapPausedSeconds'
  | 'lapMovingSeconds'
>;

function secondsBetween(startedAt: number, endedAt: number) {
  return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
}

function toRouteCoordinate(point: RidePoint): RouteCoordinate {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function cloneMetrics(metrics: RideMetrics): RideMetrics {
  return { ...metrics };
}

function normalizePauseIntervals(
  pauseIntervals: RidePauseInterval[],
): RidePauseInterval[] {
  const sortedPauseIntervals = pauseIntervals
    .filter((pauseInterval) => pauseInterval.endedAt > pauseInterval.startedAt)
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt);
  const normalizedPauseIntervals: RidePauseInterval[] = [];

  for (const pauseInterval of sortedPauseIntervals) {
    const previousPauseInterval = normalizedPauseIntervals.at(-1);

    if (
      previousPauseInterval == null ||
      pauseInterval.startedAt > previousPauseInterval.endedAt
    ) {
      normalizedPauseIntervals.push({ ...pauseInterval });
      continue;
    }

    previousPauseInterval.endedAt = Math.max(
      previousPauseInterval.endedAt,
      pauseInterval.endedAt,
    );
  }

  return normalizedPauseIntervals;
}

function withAccumulatorEstimatedCalories(
  metrics: RideMetrics,
  settings: RideSettings,
): RideMetrics {
  const nextMetrics = withEstimatedCalories(metrics, settings);

  return {
    ...nextMetrics,
    activeCaloriesKcal:
      metrics.distanceMeters > 0 ? nextMetrics.activeCaloriesKcal : 0,
    lapActiveCaloriesKcal:
      metrics.lapDistanceMeters > 0 ? nextMetrics.lapActiveCaloriesKcal : 0,
  };
}

export function createRideRecordingAccumulator({
  settings: initialSettings,
  startedAt,
}: {
  settings: RideSettings;
  startedAt: number;
}): RideRecordingAccumulator {
  let settings = initialSettings;
  let metrics: RideMetrics = {
    ...initialRideRecordingMetrics,
    startedAt,
    lapStartedAt: startedAt,
  };
  let routePoints: RidePoint[] = [];
  let currentCoordinate: RouteCoordinate | null = null;
  let isAutoPaused = false;
  let previousPoint: RidePoint | null = null;
  let manualPausedStartedAt: number | null = null;
  let autoPausedStartedAt: number | null = null;
  let pauseIntervals: RidePauseInterval[] = [];
  let committedPausedSeconds = 0;
  let committedLapPausedSeconds = 0;
  let stoppedAt: number | null = null;
  let hasPendingManualPauseBaselineReset = false;

  function getTimingNow(now = Date.now()) {
    return stoppedAt ?? now;
  }

  function getElapsedSeconds(now = Date.now()) {
    if (metrics.startedAt == null) {
      return 0;
    }

    return secondsBetween(metrics.startedAt, getTimingNow(now));
  }

  function getLapElapsedSeconds(now = Date.now()) {
    if (metrics.lapStartedAt == null) {
      return 0;
    }

    return secondsBetween(metrics.lapStartedAt, getTimingNow(now));
  }

  function getLapPauseSeconds(startedAt: number, endedAt: number) {
    const lapStartedAt = metrics.lapStartedAt;
    const scopedStartedAt =
      lapStartedAt == null ? startedAt : Math.max(startedAt, lapStartedAt);

    return secondsBetween(scopedStartedAt, endedAt);
  }

  function getPauseSeconds(pauseIntervals: RidePauseInterval[]) {
    return pauseIntervals.reduce(
      (total, pauseInterval) =>
        total + secondsBetween(pauseInterval.startedAt, pauseInterval.endedAt),
      0,
    );
  }

  function getLapPauseSecondsFromIntervals(
    pauseIntervals: RidePauseInterval[],
  ) {
    return pauseIntervals.reduce(
      (total, pauseInterval) =>
        total +
        getLapPauseSeconds(pauseInterval.startedAt, pauseInterval.endedAt),
      0,
    );
  }

  function openPauseInterval(startedAt: number | null, now = Date.now()) {
    return startedAt != null && getTimingNow(now) > startedAt
      ? [{ startedAt, endedAt: getTimingNow(now) }]
      : [];
  }

  function getNormalizedPauseIntervals(now = Date.now()) {
    return normalizePauseIntervals([
      ...pauseIntervals,
      ...openPauseInterval(manualPausedStartedAt, now),
      ...openPauseInterval(autoPausedStartedAt, now),
    ]);
  }

  function refreshCommittedPauseSeconds() {
    committedPausedSeconds = getPauseSeconds(pauseIntervals);
    committedLapPausedSeconds = getLapPauseSecondsFromIntervals(pauseIntervals);
  }

  function applyMetrics(nextMetrics: RideMetrics) {
    metrics = cloneMetrics(nextMetrics);
  }

  function refreshTimingState(now = Date.now()) {
    const timingMetrics = getTimingMetrics(now);

    applyMetrics(
      withAccumulatorEstimatedCalories(
        {
          ...metrics,
          ...timingMetrics,
          averageSpeedMps:
            timingMetrics.movingSeconds > 0
              ? metrics.distanceMeters / timingMetrics.movingSeconds
              : 0,
          lapAverageSpeedMps:
            timingMetrics.lapMovingSeconds > 0
              ? metrics.lapDistanceMeters / timingMetrics.lapMovingSeconds
              : 0,
        },
        settings,
      ),
    );

    return timingMetrics;
  }

  function getTimingMetrics(now = Date.now()): TimingMetrics {
    const elapsedSeconds = getElapsedSeconds(now);
    const lapElapsedSeconds = getLapElapsedSeconds(now);
    const hasOpenPause =
      manualPausedStartedAt != null || autoPausedStartedAt != null;
    const normalizedPauseIntervals = getNormalizedPauseIntervals(now);
    const pausedSeconds = Math.min(
      elapsedSeconds,
      hasOpenPause
        ? getPauseSeconds(normalizedPauseIntervals)
        : committedPausedSeconds,
    );
    const lapPausedSeconds = Math.min(
      lapElapsedSeconds,
      hasOpenPause
        ? getLapPauseSecondsFromIntervals(normalizedPauseIntervals)
        : committedLapPausedSeconds,
    );

    return {
      elapsedSeconds,
      movingSeconds: Math.max(0, elapsedSeconds - pausedSeconds),
      pausedSeconds,
      lapElapsedSeconds,
      lapPausedSeconds,
      lapMovingSeconds: Math.max(0, lapElapsedSeconds - lapPausedSeconds),
    };
  }

  function recordPauseInterval(startedAt: number, endedAt: number) {
    if (endedAt <= startedAt) {
      return;
    }

    pauseIntervals = normalizePauseIntervals([
      ...pauseIntervals,
      { startedAt, endedAt },
    ]);
    refreshCommittedPauseSeconds();
  }

  function commitPauseInterval(startedAt: number, endedAt: number) {
    if (endedAt <= startedAt) {
      return;
    }

    recordPauseInterval(startedAt, endedAt);
  }

  function commitManualPausedTime(now = Date.now()) {
    if (manualPausedStartedAt == null) {
      return false;
    }

    const pausedStartedAt = manualPausedStartedAt;
    manualPausedStartedAt = null;
    const pausedEndedAt = getTimingNow(now);
    commitPauseInterval(pausedStartedAt, pausedEndedAt);

    return pausedEndedAt > pausedStartedAt;
  }

  function commitAutoPausedTime(now = Date.now()) {
    if (autoPausedStartedAt == null) {
      return;
    }

    const pausedStartedAt = autoPausedStartedAt;
    autoPausedStartedAt = null;
    commitPauseInterval(pausedStartedAt, getTimingNow(now));
  }

  function setAutoPausedState(nextIsAutoPaused: boolean, now = Date.now()) {
    if (nextIsAutoPaused !== isAutoPaused) {
      if (nextIsAutoPaused) {
        autoPausedStartedAt = getTimingNow(now);
      } else {
        commitAutoPausedTime(now);
      }

      isAutoPaused = nextIsAutoPaused;
    }

    refreshTimingState(now);

    return { didAutoLap: false };
  }

  function markLap(now = Date.now()) {
    const timingNow = getTimingNow(now);
    const timingMetrics = getTimingMetrics(timingNow);
    committedLapPausedSeconds = 0;

    applyMetrics(
      withAccumulatorEstimatedCalories(
        {
          ...metrics,
          ...timingMetrics,
          lapNumber: metrics.lapNumber + 1,
          lapStartedAt: timingNow,
          lapElapsedSeconds: 0,
          lapPausedSeconds: 0,
          lapMovingSeconds: 0,
          lapDistanceMeters: 0,
          lapAscentMeters: 0,
          lapActiveCaloriesKcal: null,
          lapAverageSpeedMps: 0,
          lapMaxSpeedMps: 0,
        },
        settings,
      ),
    );

    return { didAutoLap: false };
  }

  function maybeAutoLap(now = Date.now()) {
    if (!settings.autoLap) {
      return false;
    }

    if (
      settings.splitType === 'time' &&
      metrics.lapMovingSeconds >= settings.splitDurationSeconds
    ) {
      markLap(now);
      return true;
    }

    if (
      settings.splitType === 'distance' &&
      metrics.lapDistanceMeters >= settings.splitDistanceMeters
    ) {
      markLap(now);
      return true;
    }

    return false;
  }

  function replacePointsFromPersistenceState(
    points: RidePoint[],
    now = Date.now(),
  ) {
    routePoints = [...points];
    const latestRoutePoint = routePoints.at(-1) ?? null;
    previousPoint = hasPendingManualPauseBaselineReset
      ? null
      : latestRoutePoint;
    currentCoordinate =
      latestRoutePoint == null ? null : toRouteCoordinate(latestRoutePoint);

    if (routePoints.length <= 1) {
      const timingMetrics = getTimingMetrics(now);

      applyMetrics(
        withAccumulatorEstimatedCalories(
          {
            ...metrics,
            ...timingMetrics,
            distanceMeters: 0,
            ascentMeters: 0,
            currentSpeedMps: latestRoutePoint?.speedMps ?? 0,
            averageSpeedMps: 0,
            maxSpeedMps: 0,
            lapDistanceMeters: 0,
            lapAscentMeters: 0,
            lapAverageSpeedMps: 0,
            lapMaxSpeedMps: 0,
          },
          settings,
        ),
      );

      return { didAutoLap: false };
    }

    const pauseIntervalsForReplay = getNormalizedPauseIntervals(now);
    const totalMetrics = calculateMetricsFromPoints(
      routePoints,
      pauseIntervalsForReplay,
    );
    const timingMetrics = getTimingMetrics(now);
    const lapStartedAt = metrics.lapStartedAt;
    const lapPoints =
      lapStartedAt == null
        ? routePoints
        : routePoints.filter(
            (routePoint) => routePoint.recordedAt >= lapStartedAt,
          );
    const lapMetrics = calculateMetricsFromPoints(
      lapPoints,
      pauseIntervalsForReplay,
    );

    applyMetrics(
      withAccumulatorEstimatedCalories(
        {
          ...metrics,
          ...timingMetrics,
          elapsedSeconds: Math.max(
            timingMetrics.elapsedSeconds,
            totalMetrics.elapsedSeconds,
          ),
          distanceMeters: totalMetrics.distanceMeters,
          ascentMeters: totalMetrics.ascentMeters,
          currentSpeedMps: totalMetrics.currentSpeedMps,
          averageSpeedMps:
            timingMetrics.movingSeconds > 0
              ? totalMetrics.distanceMeters / timingMetrics.movingSeconds
              : 0,
          maxSpeedMps: totalMetrics.maxSpeedMps,
          lapDistanceMeters: lapMetrics.distanceMeters,
          lapAscentMeters: lapMetrics.ascentMeters,
          lapAverageSpeedMps:
            timingMetrics.lapMovingSeconds > 0
              ? lapMetrics.distanceMeters / timingMetrics.lapMovingSeconds
              : 0,
          lapMaxSpeedMps: lapMetrics.maxSpeedMps,
        },
        settings,
      ),
    );

    return { didAutoLap: false };
  }

  return {
    updateSettings(nextSettings) {
      settings = nextSettings;
      refreshTimingState();
    },
    getMetrics() {
      return cloneMetrics(metrics);
    },
    getRoutePoints() {
      return [...routePoints];
    },
    getCurrentCoordinate() {
      return currentCoordinate == null ? null : { ...currentCoordinate };
    },
    getIsAutoPaused() {
      return isAutoPaused;
    },
    getPauseIntervals(now = Date.now()) {
      return getNormalizedPauseIntervals(now);
    },
    refreshTiming(now = Date.now()) {
      refreshTimingState(now);

      return { didAutoLap: maybeAutoLap(now) };
    },
    beginManualPause(now = Date.now()) {
      if (manualPausedStartedAt == null) {
        manualPausedStartedAt = getTimingNow(now);
      }

      refreshTimingState(now);

      return { didAutoLap: false };
    },
    endManualPause(now = Date.now()) {
      const didCloseManualPause = commitManualPausedTime(now);

      if (didCloseManualPause) {
        hasPendingManualPauseBaselineReset = true;
        previousPoint = null;
      }

      refreshTimingState(now);

      return { didAutoLap: false };
    },
    setAutoPaused(nextIsAutoPaused, now = Date.now()) {
      return setAutoPausedState(nextIsAutoPaused, now);
    },
    markLap(now = Date.now()) {
      return markLap(now);
    },
    ingestPoint(point, now = Date.now()) {
      const latestRoutePoint = routePoints.at(-1) ?? null;
      const isChronologicallyNewPoint =
        latestRoutePoint == null ||
        point.recordedAt > latestRoutePoint.recordedAt;

      if (!isChronologicallyNewPoint) {
        const nextRoutePoints = mergeRidePoints(routePoints, [point]);
        const didChangeRoutePoints = !areRidePointListsEqual(
          routePoints,
          nextRoutePoints,
        );

        if (!didChangeRoutePoints) {
          return {
            didChangeRoutePoints: false,
            shouldPersistPoint: false,
            didAutoLap: false,
          };
        }

        replacePointsFromPersistenceState(nextRoutePoints, now);

        return {
          didChangeRoutePoints: true,
          shouldPersistPoint: true,
          didAutoLap: false,
        };
      }

      currentCoordinate = toRouteCoordinate(point);
      const previous = previousPoint;
      const reportedSpeed = point.speedMps ?? 0;
      const wasAutoPaused = isAutoPaused;
      const secondsSincePrevious = previous
        ? Math.max(
            0,
            Math.round((point.recordedAt - previous.recordedAt) / 1000),
          )
        : 0;
      const distanceMeters = previous
        ? distanceBetweenMeters(previous, point)
        : 0;
      const calculatedSpeed =
        secondsSincePrevious > 0 ? distanceMeters / secondsSincePrevious : 0;
      const currentSpeedMps = Math.max(0, reportedSpeed || calculatedSpeed);
      const nextAutoPaused =
        settings.autoPause &&
        currentSpeedMps < RIDE_RECORDING_STOPPED_SPEED_MPS;
      const autoPauseTransitionNow =
        nextAutoPaused && !wasAutoPaused && previous != null
          ? previous.recordedAt
          : now;

      setAutoPausedState(nextAutoPaused, autoPauseTransitionNow);
      const timingMetrics = getTimingMetrics(now);
      const isManualPaused = manualPausedStartedAt != null;
      const shouldCountMovement =
        !isManualPaused &&
        !nextAutoPaused &&
        !wasAutoPaused &&
        previous != null;
      const movingSeconds = timingMetrics.movingSeconds;
      const lapMovingSeconds = timingMetrics.lapMovingSeconds;
      const nextDistanceMeters = shouldCountMovement
        ? metrics.distanceMeters + distanceMeters
        : metrics.distanceMeters;
      const ascentMeters = shouldCountMovement
        ? metrics.ascentMeters + positiveElevationGainMeters(previous, point)
        : metrics.ascentMeters;
      const lapAscentGain = previous
        ? positiveElevationGainMeters(previous, point)
        : 0;
      const lapDistanceMeters = shouldCountMovement
        ? metrics.lapDistanceMeters + distanceMeters
        : metrics.lapDistanceMeters;
      const lapAscentMeters = shouldCountMovement
        ? metrics.lapAscentMeters + lapAscentGain
        : metrics.lapAscentMeters;
      const averageSpeedMps =
        movingSeconds > 0 ? nextDistanceMeters / movingSeconds : 0;
      const lapAverageSpeedMps =
        lapMovingSeconds > 0 ? lapDistanceMeters / lapMovingSeconds : 0;
      const maxSpeedMps = Math.max(metrics.maxSpeedMps, currentSpeedMps);
      const lapMaxSpeedMps = Math.max(metrics.lapMaxSpeedMps, currentSpeedMps);

      routePoints = [...routePoints, point];
      previousPoint = point;
      hasPendingManualPauseBaselineReset = false;
      applyMetrics(
        withAccumulatorEstimatedCalories(
          {
            ...metrics,
            ...timingMetrics,
            movingSeconds,
            distanceMeters: nextDistanceMeters,
            ascentMeters,
            currentSpeedMps,
            averageSpeedMps,
            maxSpeedMps,
            lapMovingSeconds,
            lapDistanceMeters,
            lapAscentMeters,
            lapAverageSpeedMps,
            lapMaxSpeedMps,
          },
          settings,
        ),
      );
      const didAutoLap = maybeAutoLap(now);

      return {
        didChangeRoutePoints: true,
        shouldPersistPoint: true,
        didAutoLap,
      };
    },
    replacePointsFromPersistence(points, now = Date.now()) {
      return replacePointsFromPersistenceState(points, now);
    },
    finish(now = Date.now()) {
      const timingNow = getTimingNow(now);

      commitManualPausedTime(timingNow);
      commitAutoPausedTime(timingNow);
      isAutoPaused = false;
      stoppedAt = timingNow;
      refreshTimingState(timingNow);

      return {
        metrics: cloneMetrics(metrics),
        routePoints: [...routePoints],
        pauseIntervals: [...pauseIntervals],
      };
    },
  };
}
