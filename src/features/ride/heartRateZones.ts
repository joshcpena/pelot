import type { RideSettings } from './types';

export type HeartRateZoneNumber = 1 | 2 | 3 | 4 | 5;

export type HeartRateZoneDefinition = {
  zone: HeartRateZoneNumber;
  minPercent: number;
  maxPercent: number;
  perceivedExertion: string;
  benefit: string;
};

export type MaxHeartRateSource = 'configured' | 'estimated';

export type EffectiveMaxHeartRate = {
  bpm: number;
  source: MaxHeartRateSource;
};

export type HeartRateZoneResult = {
  bpm: number;
  maxHeartRateBpm: number;
  percentOfMax: number;
  markerProgress: number;
  zone: HeartRateZoneDefinition | null;
  state: 'below' | 'in-zone' | 'above';
};

export const GARMIN_HEART_RATE_ZONES: HeartRateZoneDefinition[] = [
  {
    zone: 1,
    minPercent: 50,
    maxPercent: 60,
    perceivedExertion: 'Relaxed, easy pace',
    benefit: 'Beginning-level aerobic training',
  },
  {
    zone: 2,
    minPercent: 60,
    maxPercent: 70,
    perceivedExertion: 'Comfortable pace',
    benefit: 'Basic cardiovascular training',
  },
  {
    zone: 3,
    minPercent: 70,
    maxPercent: 80,
    perceivedExertion: 'Moderate pace',
    benefit: 'Improved aerobic capacity',
  },
  {
    zone: 4,
    minPercent: 80,
    maxPercent: 90,
    perceivedExertion: 'Fast pace',
    benefit: 'Improved anaerobic threshold',
  },
  {
    zone: 5,
    minPercent: 90,
    maxPercent: 100,
    perceivedExertion: 'Sprinting pace',
    benefit: 'Anaerobic endurance',
  },
];

export const HEART_RATE_ZONE_COLORS = [
  '#2f80ed',
  '#2db7d7',
  '#27ae60',
  '#f2994a',
  '#d94b4b',
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function estimateMaxHeartRateBpm(ageYears: number | null) {
  if (ageYears == null || !Number.isFinite(ageYears) || ageYears <= 0) {
    return null;
  }

  return Math.max(1, Math.round(220 - ageYears));
}

export function getEffectiveMaxHeartRateBpm(
  settings: Pick<RideSettings, 'riderAgeYears' | 'riderMaxHeartRateBpm'>,
): EffectiveMaxHeartRate | null {
  if (
    settings.riderMaxHeartRateBpm != null &&
    Number.isFinite(settings.riderMaxHeartRateBpm) &&
    settings.riderMaxHeartRateBpm > 0
  ) {
    return {
      bpm: Math.round(settings.riderMaxHeartRateBpm),
      source: 'configured',
    };
  }

  const estimated = estimateMaxHeartRateBpm(settings.riderAgeYears);

  return estimated == null ? null : { bpm: estimated, source: 'estimated' };
}

export function getHeartRateZone(
  heartRateBpm: number,
  maxHeartRateBpm: number,
): HeartRateZoneResult | null {
  if (
    !Number.isFinite(heartRateBpm) ||
    heartRateBpm <= 0 ||
    !Number.isFinite(maxHeartRateBpm) ||
    maxHeartRateBpm <= 0
  ) {
    return null;
  }

  const percentOfMax = (heartRateBpm / maxHeartRateBpm) * 100;
  const zone =
    GARMIN_HEART_RATE_ZONES.find((candidate, index) => {
      const isLastZone = index === GARMIN_HEART_RATE_ZONES.length - 1;

      return (
        percentOfMax >= candidate.minPercent &&
        (percentOfMax < candidate.maxPercent ||
          (isLastZone && percentOfMax <= candidate.maxPercent))
      );
    }) ?? null;

  return {
    bpm: Math.round(heartRateBpm),
    maxHeartRateBpm: Math.round(maxHeartRateBpm),
    percentOfMax,
    markerProgress: clamp((percentOfMax - 50) / 50, 0, 1),
    zone,
    state:
      percentOfMax < 50 ? 'below' : percentOfMax > 100 ? 'above' : 'in-zone',
  };
}

export function getHeartRateZoneLabel(result: HeartRateZoneResult) {
  if (result.zone) {
    return `Zone ${result.zone.zone}`;
  }

  return result.state === 'below' ? 'Zone 1' : 'Zone 5';
}

export function getHeartRateZoneRangeBpm(
  zone: HeartRateZoneDefinition,
  maxHeartRateBpm: number,
) {
  return {
    minBpm: Math.round((zone.minPercent / 100) * maxHeartRateBpm),
    maxBpm: Math.round((zone.maxPercent / 100) * maxHeartRateBpm),
  };
}
