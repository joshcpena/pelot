import { describe, expect, it } from 'vitest';

import { parseCurrentWeather } from './weather';

describe('parseCurrentWeather', () => {
  it('uses unix timestamps from Open-Meteo as UTC seconds', () => {
    const sample = parseCurrentWeather({
      current: {
        time: 1_700_000_000,
        temperature_2m: 22.4,
        wind_speed_10m: 13.2,
      },
    });

    expect(sample).toEqual({
      recordedAt: 1_700_000_000_000,
      temperatureC: 22.4,
      windSpeedKph: 13.2,
    });
  });

  it('treats offsetless API timestamps as UTC instead of device-local time', () => {
    const sample = parseCurrentWeather({
      current: {
        time: '2026-05-27T14:15',
        temperature_2m: 20,
        wind_speed_10m: 10,
      },
    });

    expect(sample.recordedAt).toBe(Date.UTC(2026, 4, 27, 14, 15));
  });

  it('falls back to now and nulls missing nonnumeric values', () => {
    const sample = parseCurrentWeather(
      {
        current: {
          time: 'not-a-date',
        },
      },
      123456,
    );

    expect(sample).toEqual({
      recordedAt: 123456,
      temperatureC: null,
      windSpeedKph: null,
    });
  });
});
