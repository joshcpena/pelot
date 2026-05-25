import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  type LngLat,
  type LngLatBounds,
} from '@maplibre/maplibre-react-native';
import { StyleSheet, Text, View } from 'react-native';
import type { FeatureCollection, LineString } from 'geojson';

import {
  type ThemeColors,
  useResolvedTheme,
  useThemeColors,
} from '../settings/settings';
import { getRideMapStyle, getRideMapStyleKey } from './mapStyles';
import type { RidePoint, RouteCoordinate } from './types';

const DEFAULT_COORDINATE = {
  latitude: 37.78825,
  longitude: -122.4324,
};

const EMPTY_LINE: FeatureCollection<LineString> = {
  type: 'FeatureCollection',
  features: [],
};

function toCoordinate(point: RidePoint): RouteCoordinate {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function toLngLat(point: RouteCoordinate): LngLat {
  return [point.longitude, point.latitude];
}

function getBounds(coordinates: RouteCoordinate[]): LngLatBounds | null {
  if (coordinates.length === 0) {
    return null;
  }

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);

  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

function getInitialViewState(coordinates: RouteCoordinate[]) {
  const firstCoordinate = coordinates[0] ?? DEFAULT_COORDINATE;
  const bounds = getBounds(coordinates);

  return bounds && coordinates.length > 1
    ? { bounds, padding: { top: 24, right: 24, bottom: 24, left: 24 } }
    : { center: toLngLat(firstCoordinate), zoom: 13 };
}

function lineFeature(
  coordinates: RouteCoordinate[],
): FeatureCollection<LineString> {
  if (coordinates.length < 2) {
    return EMPTY_LINE;
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'history-route',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: coordinates.map(toLngLat),
        },
      },
    ],
  };
}

export function HistoryRouteMap({ points }: { points: RidePoint[] }) {
  const cameraRef = useRef<CameraRef | null>(null);
  const colors = useThemeColors();
  const resolvedTheme = useResolvedTheme();
  const styles = createStyles(colors);
  const [loadedMapStyle, setLoadedMapStyle] = useState<string | null>(null);
  const coordinates = useMemo(() => points.map(toCoordinate), [points]);
  const routeFeature = useMemo(() => lineFeature(coordinates), [coordinates]);
  const mapStyle = useMemo(
    () => getRideMapStyle('standard', resolvedTheme),
    [resolvedTheme],
  );
  const mapStyleKey = useMemo(
    () => getRideMapStyleKey('standard', resolvedTheme),
    [resolvedTheme],
  );
  const isStyleLoaded = loadedMapStyle === mapStyleKey;

  useEffect(() => {
    if (!isStyleLoaded || coordinates.length < 2) {
      return;
    }

    const bounds = getBounds(coordinates);

    if (bounds) {
      cameraRef.current?.fitBounds(bounds, {
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        duration: 0,
      });
    }
  }, [coordinates, isStyleLoaded]);

  if (points.length < 2) {
    return (
      <View style={styles.fallbackContainer}>
        <Text style={styles.fallbackTitle}>No route saved</Text>
        <Text style={styles.fallbackCopy}>
          This ride does not have enough GPS points for a map preview.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container} pointerEvents="none">
      <Map
        androidView="texture"
        style={styles.map}
        mapStyle={mapStyle}
        attribution={false}
        compass={false}
        dragPan={false}
        doubleTapHoldZoom={false}
        doubleTapZoom={false}
        logo={false}
        touchPitch={false}
        touchRotate={false}
        touchZoom={false}
        onDidFinishLoadingStyle={() => setLoadedMapStyle(mapStyleKey)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={getInitialViewState(coordinates)}
        />
        <GeoJSONSource id="history-route-source" data={routeFeature}>
          <Layer
            id="history-route"
            type="line"
            paint={{
              'line-color': '#2ea043',
              'line-width': 5,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
        </GeoJSONSource>
      </Map>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      height: 150,
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: colors.background,
    },
    map: {
      flex: 1,
    },
    fallbackContainer: {
      minHeight: 150,
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: 18,
      backgroundColor: colors.background,
      padding: 18,
    },
    fallbackTitle: {
      color: colors.primaryText,
      fontSize: 16,
      fontWeight: '900',
    },
    fallbackCopy: {
      marginTop: 6,
      color: colors.mutedText,
      fontSize: 13,
      lineHeight: 18,
    },
  });
}
