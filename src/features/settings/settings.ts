import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

import { getDatabase, initializeDatabase } from '../../lib/database';
import {
  defaultDashboardLayout,
  defaultDashboardScreens,
  validateDashboardLayout,
  validateDashboardScreens,
} from '../ride/dashboard';
import type { RideSettings } from '../ride/types';

export const defaultRideSettings: RideSettings = {
  hasCompletedWelcome: false,
  unitSystem: 'imperial',
  keepAwakeDuringRide: true,
  autoDimScreen: true,
  autoPause: false,
  autoLap: true,
  ascentSource: 'gps-only',
  gpsAccuracy: 'standard',
  splitType: 'time',
  splitDistanceMeters: 1609.344,
  splitDurationSeconds: 600,
  theme: 'light',
  mapType: 'standard',
  routeProfile: 'bike',
  dashboardLayout: defaultDashboardLayout,
  dashboardScreens: defaultDashboardScreens,
  connectedHeartRateDevice: null,
  riderWeightKg: null,
  riderHeightCm: null,
  riderAgeYears: null,
  riderSex: null,
};

type SettingKey = keyof RideSettings;

type SettingRow = {
  key: string;
  value: string;
};

type RideSettingsContextValue = {
  settings: RideSettings;
  isLoading: boolean;
  updateSetting: <K extends SettingKey>(
    key: K,
    value: RideSettings[K],
  ) => Promise<void>;
};

export type ThemeColors = {
  background: string;
  card: string;
  elevatedCard: string;
  primaryText: string;
  secondaryText: string;
  mutedText: string;
  border: string;
  accent: string;
  accentSoft: string;
  success: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  inverseBackground: string;
  inverseText: string;
};

export type ResolvedTheme = 'light' | 'dark';

const darkColors: ThemeColors = {
  background: '#0d1117',
  card: '#161b22',
  elevatedCard: '#101a2b',
  primaryText: '#fff',
  secondaryText: '#c9d1d9',
  mutedText: '#8b949e',
  border: '#30363d',
  accent: '#58a6ff',
  accentSoft: '#0d1b2f',
  success: '#238636',
  danger: '#da3633',
  dangerSoft: '#2d1415',
  warning: '#f2cc60',
  inverseBackground: '#f0f6fc',
  inverseText: '#0d1117',
};

const lightColors: ThemeColors = {
  background: '#f6f8fa',
  card: '#ffffff',
  elevatedCard: '#eef6ff',
  primaryText: '#0d1117',
  secondaryText: '#24292f',
  mutedText: '#57606a',
  border: '#d0d7de',
  accent: '#0969da',
  accentSoft: '#ddf4ff',
  success: '#1a7f37',
  danger: '#cf222e',
  dangerSoft: '#ffebe9',
  warning: '#9a6700',
  inverseBackground: '#0d1117',
  inverseText: '#ffffff',
};

const RideSettingsContext = createContext<RideSettingsContextValue | null>(
  null,
);

function isMapType(value: unknown): value is RideSettings['mapType'] {
  return value === 'standard' || value === 'outdoor';
}

function decodeSetting<K extends SettingKey>(
  key: K,
  value: string,
): RideSettings[K] {
  try {
    const decoded = JSON.parse(value) as unknown;

    if (key === 'mapType') {
      return (
        isMapType(decoded) ? decoded : defaultRideSettings.mapType
      ) as RideSettings[K];
    }

    if (key === 'gpsAccuracy' && decoded === 'balanced') {
      return 'standard' as RideSettings[K];
    }

    if (key === 'dashboardLayout') {
      return validateDashboardLayout(decoded) as RideSettings[K];
    }

    if (key === 'dashboardScreens') {
      return validateDashboardScreens(decoded) as RideSettings[K];
    }

    return decoded as RideSettings[K];
  } catch {
    return value as RideSettings[K];
  }
}

export async function loadRideSettings() {
  await initializeDatabase();
  const db = await getDatabase();
  const rows = await db.getAllAsync<SettingRow>(
    'SELECT key, value FROM settings',
  );
  const settings = { ...defaultRideSettings };
  let loadedDashboardLayout = false;
  let loadedDashboardScreens = false;

  for (const row of rows) {
    if (row.key in settings) {
      const key = row.key as SettingKey;

      loadedDashboardLayout =
        loadedDashboardLayout || key === 'dashboardLayout';
      loadedDashboardScreens =
        loadedDashboardScreens || key === 'dashboardScreens';

      Object.assign(settings, { [key]: decodeSetting(key, row.value) });
    }
  }

  if (loadedDashboardLayout && !loadedDashboardScreens) {
    settings.dashboardScreens = [
      { id: defaultDashboardScreens[0].id, layout: settings.dashboardLayout },
    ];
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

function useLoadedRideSettings(): RideSettingsContextValue {
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

export function RideSettingsProvider({ children }: { children: ReactNode }) {
  const value = useLoadedRideSettings();

  return createElement(RideSettingsContext.Provider, { value }, children);
}

export function useRideSettings() {
  const context = useContext(RideSettingsContext);

  if (!context) {
    throw new Error(
      'useRideSettings must be used inside RideSettingsProvider.',
    );
  }

  return context;
}

export function useThemeColors() {
  const resolvedTheme = useResolvedTheme();

  return resolvedTheme === 'light' ? lightColors : darkColors;
}

export function useResolvedTheme(): ResolvedTheme {
  const { settings } = useRideSettings();
  const systemColorScheme = useColorScheme();

  if (settings.theme !== 'system') {
    return settings.theme;
  }

  return systemColorScheme === 'light' ? 'light' : 'dark';
}
