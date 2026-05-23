import { useEffect, useState } from 'react';

import { getDatabase, initializeDatabase } from '../../lib/database';
import type { RideSettings } from '../ride/types';

export const defaultRideSettings: RideSettings = {
  unitSystem: 'imperial',
  keepAwakeDuringRide: true,
  autoPause: false,
  ascentSource: 'barometer-preferred',
  gpsAccuracy: 'best',
  splitType: 'distance',
  splitDistanceMeters: 1609.344,
  splitDurationSeconds: 300,
  theme: 'system',
  mapType: 'standard',
};

type SettingKey = keyof RideSettings;

type SettingRow = {
  key: string;
  value: string;
};

function decodeSetting<K extends SettingKey>(
  key: K,
  value: string,
): RideSettings[K] {
  if (
    key === 'keepAwakeDuringRide' ||
    key === 'autoPause' ||
    key === 'splitDistanceMeters' ||
    key === 'splitDurationSeconds'
  ) {
    return JSON.parse(value) as RideSettings[K];
  }

  return value as RideSettings[K];
}

export async function loadRideSettings() {
  await initializeDatabase();
  const db = await getDatabase();
  const rows = await db.getAllAsync<SettingRow>(
    'SELECT key, value FROM settings',
  );
  const settings = { ...defaultRideSettings };

  for (const row of rows) {
    if (row.key in settings) {
      const key = row.key as SettingKey;
      Object.assign(settings, { [key]: decodeSetting(key, row.value) });
    }
  }

  return settings;
}

export async function saveRideSetting<K extends SettingKey>(
  key: K,
  value: RideSettings[K],
) {
  await initializeDatabase();
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    key,
    JSON.stringify(value),
  );
}

export function useRideSettings() {
  const [settings, setSettings] = useState<RideSettings>(defaultRideSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    loadRideSettings()
      .then((loadedSettings) => {
        if (isMounted) {
          setSettings(loadedSettings);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function updateSetting<K extends SettingKey>(
    key: K,
    value: RideSettings[K],
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
    await saveRideSetting(key, value);
  }

  return { settings, isLoading, updateSetting };
}
