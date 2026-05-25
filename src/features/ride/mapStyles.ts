import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import type { RideSettings } from './types';

const outdoorMapStyle =
  require('../../../assets/map-styles/outdoors-openfreemap.json') as StyleSpecification;
const outdoorDarkMapStyle =
  require('../../../assets/map-styles/outdoors-dark-openfreemap.json') as StyleSpecification;

const OPEN_FREE_MAP_STYLE_BASE_URL = 'https://tiles.openfreemap.org/styles';

const DEFAULT_STYLE_IDS: Record<'light' | 'dark', string> = {
  light: 'liberty',
  dark: 'fiord',
};

export function getRideMapStyle(
  mapType: RideSettings['mapType'],
  colorScheme: 'light' | 'dark',
) {
  if (mapType === 'outdoor') {
    return colorScheme === 'dark' ? outdoorDarkMapStyle : outdoorMapStyle;
  }

  const styleId = DEFAULT_STYLE_IDS[colorScheme];
  return `${OPEN_FREE_MAP_STYLE_BASE_URL}/${styleId}`;
}

export function getRideMapStyleKey(
  mapType: RideSettings['mapType'],
  colorScheme: 'light' | 'dark',
) {
  return mapType === 'outdoor'
    ? `outdoor-${colorScheme}-openfreemap-custom`
    : `default-${colorScheme}-openfreemap`;
}
