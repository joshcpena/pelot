import type { RideSettings } from './types';

const OPEN_FREE_MAP_STYLE_BASE_URL = 'https://tiles.openfreemap.org/styles';

const OPEN_FREE_MAP_STYLE_IDS: Record<
  RideSettings['mapType'],
  Record<'light' | 'dark', string>
> = {
  standard: {
    light: 'positron',
    dark: 'dark',
  },
  outdoor: {
    light: 'liberty',
    dark: 'fiord',
  },
};

export function getRideMapStyle(
  mapType: RideSettings['mapType'],
  colorScheme: 'light' | 'dark',
) {
  const styleId = OPEN_FREE_MAP_STYLE_IDS[mapType][colorScheme];

  return `${OPEN_FREE_MAP_STYLE_BASE_URL}/${styleId}`;
}

export function getRideMapStyleKey(
  mapType: RideSettings['mapType'],
  colorScheme: 'light' | 'dark',
) {
  return `${mapType}-${colorScheme}-openfreemap`;
}
