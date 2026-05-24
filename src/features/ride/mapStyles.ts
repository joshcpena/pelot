import type { StyleSpecification } from '@maplibre/maplibre-react-native';

import type { RideSettings } from './types';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CARTO_DARK_TILE_URL =
  'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

function getRasterStyle(tileUrl: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      'base-map': {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [
      {
        id: 'base-map',
        type: 'raster',
        source: 'base-map',
      },
    ],
  };
}

function getMapTilerRasterStyle(mapId: string, mapTilerApiKey: string) {
  return getRasterStyle(
    `https://api.maptiler.com/maps/${mapId}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(mapTilerApiKey)}`,
    '<a href="https://www.maptiler.com/copyright/">MapTiler</a> <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  );
}

export function getRideMapStyle(
  mapType: RideSettings['mapType'],
  colorScheme: 'light' | 'dark',
) {
  const mapTilerApiKey = process.env.EXPO_PUBLIC_MAPTILER_API_KEY;

  if (!mapTilerApiKey) {
    return getRasterStyle(
      colorScheme === 'dark' ? CARTO_DARK_TILE_URL : OSM_TILE_URL,
      colorScheme === 'dark'
        ? '<a href="https://carto.com/attributions">CARTO</a> <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        : '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    );
  }

  const styleId =
    mapType === 'satellite'
      ? 'satellite'
      : mapType === 'outdoor'
        ? colorScheme === 'dark'
          ? 'outdoor-v2-dark'
          : 'outdoor-v2'
        : mapType === 'hybrid'
        ? 'hybrid'
        : colorScheme === 'dark'
          ? 'streets-v4-dark'
          : 'streets-v4';

  return getMapTilerRasterStyle(styleId, mapTilerApiKey);
}

export function getRideMapStyleKey(
  mapType: RideSettings['mapType'],
  colorScheme: 'light' | 'dark',
) {
  const mapTilerApiKey = process.env.EXPO_PUBLIC_MAPTILER_API_KEY;

  return mapTilerApiKey
    ? `${mapType}-${colorScheme}-maptiler-raster`
    : `${colorScheme}-fallback-raster`;
}
