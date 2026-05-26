import { useEffect, useRef, useState } from 'react';

import type { RidePoint, RideStatus } from './types';

const WEATHER_REFRESH_MS = 7.5 * 60 * 1000;

export type WeatherSample = {
  recordedAt: number;
  temperatureC: number | null;
  windSpeedKph: number | null;
};

type OpenMeteoCurrentWeather = {
  current?: {
    time?: string;
    temperature_2m?: number;
    wind_speed_10m?: number;
  };
};

async function fetchCurrentWeather(point: RidePoint): Promise<WeatherSample> {
  const params = new URLSearchParams({
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    current: 'temperature_2m,wind_speed_10m',
  });
  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params}`,
  );

  if (!response.ok) {
    throw new Error('Could not load weather.');
  }

  const data = (await response.json()) as OpenMeteoCurrentWeather;

  return {
    recordedAt: data.current?.time
      ? new Date(data.current.time).getTime()
      : Date.now(),
    temperatureC:
      typeof data.current?.temperature_2m === 'number'
        ? data.current.temperature_2m
        : null,
    windSpeedKph:
      typeof data.current?.wind_speed_10m === 'number'
        ? data.current.wind_speed_10m
        : null,
  };
}

export function useRideWeatherSamples(
  routePoints: RidePoint[],
  status: RideStatus,
  enabled = true,
) {
  const [currentWeather, setCurrentWeather] = useState<WeatherSample | null>(
    null,
  );
  const [weatherSamples, setWeatherSamples] = useState<WeatherSample[]>([]);
  const lastFetchAtRef = useRef(0);
  const lastFetchPointRef = useRef<RidePoint | null>(null);
  const latestPoint = routePoints.at(-1) ?? null;

  useEffect(() => {
    if (!enabled || status === 'idle' || status === 'stopped') {
      lastFetchAtRef.current = 0;
      lastFetchPointRef.current = null;
      const resetTimeout = setTimeout(() => {
        setCurrentWeather(null);
        setWeatherSamples([]);
      }, 0);

      return () => clearTimeout(resetTimeout);
    }
  }, [enabled, status]);

  useEffect(() => {
    if (!enabled || status !== 'recording' || !latestPoint) {
      return;
    }

    const lastFetchAt = lastFetchAtRef.current;
    const isStale = Date.now() - lastFetchAt >= WEATHER_REFRESH_MS;

    if (!isStale) {
      return;
    }

    let isCancelled = false;
    lastFetchAtRef.current = Date.now();
    lastFetchPointRef.current = latestPoint;

    fetchCurrentWeather(latestPoint)
      .then((sample) => {
        if (isCancelled) {
          return;
        }

        setCurrentWeather(sample);
        setWeatherSamples((current) => [...current, sample]);
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [enabled, latestPoint, status]);

  return { currentWeather, weatherSamples };
}
