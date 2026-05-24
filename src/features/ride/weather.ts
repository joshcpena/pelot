import { useEffect, useRef, useState } from 'react';

import type { RidePoint, RideStatus } from './types';

const WEATHER_REFRESH_MS = 5 * 60 * 1000;
const WEATHER_REFRESH_DISTANCE_METERS = 1000;

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

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function distanceBetweenCoordinates(a: RidePoint, b: RidePoint) {
  const earthRadiusMeters = 6_371_000;
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
) {
  const [currentWeather, setCurrentWeather] = useState<WeatherSample | null>(
    null,
  );
  const [weatherSamples, setWeatherSamples] = useState<WeatherSample[]>([]);
  const lastFetchAtRef = useRef(0);
  const lastFetchPointRef = useRef<RidePoint | null>(null);
  const latestPoint = routePoints.at(-1) ?? null;

  useEffect(() => {
    if (status === 'idle' || status === 'stopped') {
      lastFetchAtRef.current = 0;
      lastFetchPointRef.current = null;
      const resetTimeout = setTimeout(() => {
        setCurrentWeather(null);
        setWeatherSamples([]);
      }, 0);

      return () => clearTimeout(resetTimeout);
    }
  }, [status]);

  useEffect(() => {
    if (status !== 'recording' || !latestPoint) {
      return;
    }

    const lastFetchPoint = lastFetchPointRef.current;
    const lastFetchAt = lastFetchAtRef.current;
    const hasMovedEnough = lastFetchPoint
      ? distanceBetweenCoordinates(lastFetchPoint, latestPoint) >=
        WEATHER_REFRESH_DISTANCE_METERS
      : true;
    const isStale = Date.now() - lastFetchAt >= WEATHER_REFRESH_MS;

    if (!hasMovedEnough && !isStale) {
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
  }, [latestPoint, status]);

  return { currentWeather, weatherSamples };
}
